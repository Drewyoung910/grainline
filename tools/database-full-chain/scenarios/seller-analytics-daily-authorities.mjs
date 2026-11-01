import assert from "node:assert/strict";

import pg from "pg";

import { seedSellerProfilePrivateFixture } from "./seller-profile-private-fixture.mjs";

export const SELLER_ANALYTICS_DAILY_PREPARATION_MIGRATION =
  "20261101030000_prepare_seller_analytics_daily_authorities";
export const SELLER_ANALYTICS_DAILY_RLS_MIGRATION =
  "20261101040000_activate_seller_analytics_daily_rls";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function explainPlan(result) {
  const document = rowsOf(result)[0]?.["QUERY PLAN"];
  const root = Array.isArray(document) ? document[0]?.Plan : document?.Plan;
  assert.ok(root, "EXPLAIN (FORMAT JSON) did not return a plan root");
  return root;
}

function flattenPlan(root) {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root);
  return nodes;
}

function assertBoundedIndexPlan(result, { relation, indexes }) {
  const nodes = flattenPlan(explainPlan(result));
  assert.equal(
    nodes.some((node) =>
      node["Node Type"] === "Seq Scan" && node["Relation Name"] === relation),
    false,
    `${relation} used an unbounded sequential plan`,
  );
  assert.equal(
    nodes.some((node) => indexes.includes(node["Index Name"])),
    true,
    `${relation} did not use one of the reviewed indexes: ${indexes.join(", ")}`,
  );
}

async function beginClient(connectionString, applicationName, actorId = undefined) {
  const client = new pg.Client({
    connectionString,
    application_name: applicationName,
  });
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '8s'");
  await client.query("SET LOCAL lock_timeout = '6s'");
  await client.query("SET LOCAL deadlock_timeout = '100ms'");
  if (actorId !== undefined) {
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    await client.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [actorId ?? ""],
    );
  }
  return client;
}

async function closeClient(client, action = "ROLLBACK") {
  if (!client) return;
  await client.query(action).catch(() => {});
  await client.end().catch(() => {});
}

async function waitForLockWait(database, applicationName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = rowsOf(await database.query(
      `SELECT wait_event_type
         FROM pg_catalog.pg_stat_activity
        WHERE application_name = $1
          AND pid <> pg_catalog.pg_backend_pid()`,
      [applicationName],
    ))[0];
    if (state?.wait_event_type === "Lock") return;
    await delay(20);
  }
  throw new Error(`${applicationName} did not reach the expected lock wait`);
}

async function runtimeQuery(database, actorId, sql, params = []) {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [actorId ?? ""],
    );
    const result = await database.query(sql, params);
    await database.query("COMMIT");
    return result;
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function insertListing(database, id, sellerProfileId, title) {
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "isPrivate", "sellerPubliclyOrderable",
        "viewCount", "clickCount", "createdAt", "updatedAt")
     VALUES (
       $1, $2, $3, 'Seller analytics full-chain fixture', 2500, 'usd',
       'ACTIVE'::public."ListingStatus", 'MADE_TO_ORDER'::public."ListingType",
       false, true, 0, 0,
       pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
       pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
     )`,
    [id, sellerProfileId, title],
  );
}

async function callRecord(database, actorId, listingId, kind) {
  const rows = rowsOf(await runtimeQuery(
    database,
    actorId,
    "SELECT public.grainline_listing_analytics_record($1, $2) AS recorded",
    [listingId, kind],
  ));
  assert.equal(rows.length, 1);
  return rows[0].recorded;
}

async function proveConcurrentListingIncrements({ connectionString, database, listingId }) {
  const first = new pg.Client({ connectionString });
  const second = new pg.Client({ connectionString });
  await Promise.all([first.connect(), second.connect()]);
  try {
    const invoke = async (client) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE grainline_app_runtime");
      await client.query("SELECT pg_catalog.set_config('app.user_id', '', true)");
      const result = await client.query(
        "SELECT public.grainline_listing_analytics_record($1, 'view') AS recorded",
        [listingId],
      );
      await client.query("COMMIT");
      return result.rows[0]?.recorded;
    };
    assert.deepEqual(await Promise.all([invoke(first), invoke(second)]), [true, true]);
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }

  const state = rowsOf(await database.query(
    `SELECT listing."viewCount" AS scalar_views,
            daily.views AS daily_views
       FROM public."Listing" AS listing
       JOIN public."ListingViewDaily" AS daily
         ON daily."listingId" = listing.id
        AND daily.date = pg_catalog.date_trunc(
          'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
        )
      WHERE listing.id = $1`,
    [listingId],
  ));
  assert.deepEqual(state, [{ scalar_views: 2, daily_views: 2 }]);
}

async function proveSellerAnalyticsQueryPlans({ database, seller, otherSeller, suffix }) {
  const targetListingId = `${suffix}_plan_target`;
  const noiseListingIds = Array.from(
    { length: 12 },
    (_, index) => `${suffix}_plan_noise_${index}`,
  );
  const listingIds = [targetListingId, ...noiseListingIds];
  await insertListing(
    database,
    targetListingId,
    seller.sellerProfileId,
    "Seller analytics plan target",
  );
  for (const [index, listingId] of noiseListingIds.entries()) {
    await insertListing(
      database,
      listingId,
      otherSeller.sellerProfileId,
      `Seller analytics plan noise ${index}`,
    );
  }

  const profilePrefix = `${suffix}_plan_profile_`;
  try {
    await database.query(
      `INSERT INTO public."ListingViewDaily"
         (id, "listingId", "sellerProfileId", date, views, clicks)
       SELECT $1 || '_' || source.ordinal::text || '_' || day.day_offset::text,
              source.listing_id,
              ($3::text[])[source.ordinal],
              pg_catalog.date_trunc(
                'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
              ) - day.day_offset * INTERVAL '1 day',
              1,
              1
         FROM pg_catalog.unnest($2::text[])
                WITH ORDINALITY AS source(listing_id, ordinal)
        CROSS JOIN pg_catalog.generate_series(0, 179) AS day(day_offset)`,
      [
        `${suffix}_plan_daily`,
        listingIds,
        [seller.sellerProfileId, ...noiseListingIds.map(() => otherSeller.sellerProfileId)],
      ],
    );
    await database.query(
      `INSERT INTO public."SellerProfileViewDaily"
         (id, "sellerProfileId", date, views)
       SELECT $1 || source.ordinal::text || '_' || day.day_offset::text,
              source.seller_profile_id,
              pg_catalog.date_trunc(
                'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
              ) - day.day_offset * INTERVAL '1 day',
              1
         FROM pg_catalog.unnest($2::text[])
                WITH ORDINALITY AS source(seller_profile_id, ordinal)
        CROSS JOIN pg_catalog.generate_series(0, 729) AS day(day_offset)
       ON CONFLICT ("sellerProfileId", date) DO NOTHING`,
      [profilePrefix, [seller.sellerProfileId, otherSeller.sellerProfileId]],
    );
    await database.query(
      `INSERT INTO public."ListingViewDaily"
         (id, "listingId", "sellerProfileId", date, views, clicks)
       SELECT $1 || '_old_' || source.ordinal::text,
              source.listing_id,
              source.seller_profile_id,
              pg_catalog.date_trunc(
                'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
              ) - INTERVAL '731 days',
              1,
              0
         FROM pg_catalog.unnest($2::text[], $3::text[])
                WITH ORDINALITY AS source(listing_id, seller_profile_id, ordinal)`,
      [
        `${suffix}_plan_daily`,
        listingIds,
        [seller.sellerProfileId, ...noiseListingIds.map(() => otherSeller.sellerProfileId)],
      ],
    );
    await database.query(
      `INSERT INTO public."SellerProfileViewDaily"
         (id, "sellerProfileId", date, views)
       VALUES (
         $1,
         $2,
         pg_catalog.date_trunc(
           'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
         ) - INTERVAL '731 days',
         1
       )`,
      [`${profilePrefix}old`, otherSeller.sellerProfileId],
    );
    await database.query('ANALYZE public."ListingViewDaily"');
    await database.query('ANALYZE public."SellerProfileViewDaily"');

    assertBoundedIndexPlan(await database.query(
      `EXPLAIN (FORMAT JSON)
       SELECT id
         FROM public."ListingViewDaily"
        WHERE "listingId" = $1
          AND date = pg_catalog.date_trunc(
            'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
          )
        FOR UPDATE`,
      [targetListingId],
    ), {
      relation: "ListingViewDaily",
      indexes: ["ListingViewDaily_listingId_date_key"],
    });

    const rangeStart = rowsOf(await database.query(
      `SELECT pg_catalog.date_trunc(
                'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
              ) - INTERVAL '30 days' AS value`,
    ))[0]?.value;
    const rangeEnd = rowsOf(await database.query(
      `SELECT pg_catalog.date_trunc(
                'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
              ) + INTERVAL '1 day' AS value`,
    ))[0]?.value;
    assertBoundedIndexPlan(await database.query(
      `EXPLAIN (FORMAT JSON)
       SELECT pg_catalog.sum(views), pg_catalog.sum(clicks)
         FROM public."ListingViewDaily"
        WHERE "sellerProfileId" = $1
          AND date >= $2
          AND date < $3`,
      [seller.sellerProfileId, rangeStart, rangeEnd],
    ), {
      relation: "ListingViewDaily",
      indexes: ["ListingViewDaily_sellerProfileId_date_idx"],
    });
    assertBoundedIndexPlan(await database.query(
      `EXPLAIN (FORMAT JSON)
       SELECT pg_catalog.sum(views)
         FROM public."SellerProfileViewDaily"
        WHERE "sellerProfileId" = $1
          AND date >= $2
          AND date < $3`,
      [seller.sellerProfileId, rangeStart, rangeEnd],
    ), {
      relation: "SellerProfileViewDaily",
      indexes: ["SellerProfileViewDaily_sellerProfileId_date_idx"],
    });

    const cutoff = rowsOf(await database.query(
      `SELECT (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
                - INTERVAL '730 days' AS value`,
    ))[0]?.value;
    assertBoundedIndexPlan(await database.query(
      `EXPLAIN (FORMAT JSON)
       SELECT id
         FROM public."ListingViewDaily"
        WHERE date < $1
        ORDER BY date ASC, id ASC
        LIMIT 5000
        FOR UPDATE SKIP LOCKED`,
      [cutoff],
    ), {
      relation: "ListingViewDaily",
      indexes: ["ListingViewDaily_date_idx"],
    });
    assertBoundedIndexPlan(await database.query(
      `EXPLAIN (FORMAT JSON)
       SELECT id
         FROM public."SellerProfileViewDaily"
        WHERE date < $1
        ORDER BY date ASC, id ASC
        LIMIT 5000
        FOR UPDATE SKIP LOCKED`,
      [cutoff],
    ), {
      relation: "SellerProfileViewDaily",
      indexes: ["SellerProfileViewDaily_date_idx"],
    });
  } finally {
    await database.query(
      `DELETE FROM public."SellerProfileViewDaily"
        WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
      [profilePrefix],
    );
    await database.query(
      `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
      [listingIds],
    );
  }
}

async function proveConcurrentViewAndClick({ connectionString, database, listingId }) {
  const first = await beginClient(connectionString, "seller_analytics_view_click_a", null);
  const second = await beginClient(connectionString, "seller_analytics_view_click_b", null);
  try {
    const [view, click] = await Promise.all([
      first.query(
        "SELECT public.grainline_listing_analytics_record($1, 'view') AS recorded",
        [listingId],
      ),
      second.query(
        "SELECT public.grainline_listing_analytics_record($1, 'click') AS recorded",
        [listingId],
      ),
    ]);
    assert.equal(view.rows[0]?.recorded, true);
    assert.equal(click.rows[0]?.recorded, true);
    await Promise.all([first.query("COMMIT"), second.query("COMMIT")]);
  } finally {
    await Promise.all([closeClient(first), closeClient(second)]);
  }
  assert.deepEqual(rowsOf(await database.query(
    `SELECT listing."viewCount" AS scalar_views,
            listing."clickCount" AS scalar_clicks,
            daily.views AS daily_views,
            daily.clicks AS daily_clicks
       FROM public."Listing" AS listing
       JOIN public."ListingViewDaily" AS daily
         ON daily."listingId" = listing.id
        AND daily.date = pg_catalog.date_trunc(
          'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
        )
      WHERE listing.id = $1`,
    [listingId],
  )), [{
    scalar_views: 1,
    scalar_clicks: 1,
    daily_views: 1,
    daily_clicks: 1,
  }]);
}

async function proveListingDeleteRaces({ connectionString, database, seller, suffix }) {
  const viewWinsListingId = `${suffix}_view_wins_delete`;
  await insertListing(
    database,
    viewWinsListingId,
    seller.sellerProfileId,
    "Seller analytics view-wins delete",
  );
  let viewClient;
  let deleteClient;
  try {
    viewClient = await beginClient(
      connectionString,
      "seller_analytics_view_winner",
      null,
    );
    const view = await viewClient.query(
      "SELECT public.grainline_listing_analytics_record($1, 'view') AS recorded",
      [viewWinsListingId],
    );
    assert.equal(view.rows[0]?.recorded, true);
    deleteClient = await beginClient(
      connectionString,
      "seller_analytics_delete_waiter",
    );
    const deletion = deleteClient.query(
      'DELETE FROM public."Listing" WHERE id = $1',
      [viewWinsListingId],
    );
    await waitForLockWait(database, "seller_analytics_delete_waiter");
    await viewClient.query("COMMIT");
    await deletion;
    await deleteClient.query("COMMIT");
  } finally {
    await Promise.all([closeClient(viewClient), closeClient(deleteClient)]);
  }
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."ListingViewDaily"
      WHERE "listingId" = $1`,
    [viewWinsListingId],
  ))[0]?.count ?? -1), 0);

  const deleteWinsListingId = `${suffix}_delete_wins_view`;
  await insertListing(
    database,
    deleteWinsListingId,
    seller.sellerProfileId,
    "Seller analytics delete-wins view",
  );
  let deleteWinner;
  let viewWaiter;
  try {
    deleteWinner = await beginClient(
      connectionString,
      "seller_analytics_delete_winner",
    );
    await deleteWinner.query(
      'DELETE FROM public."Listing" WHERE id = $1',
      [deleteWinsListingId],
    );
    viewWaiter = await beginClient(
      connectionString,
      "seller_analytics_view_waiter",
      null,
    );
    const view = viewWaiter.query(
      "SELECT public.grainline_listing_analytics_record($1, 'view') AS recorded",
      [deleteWinsListingId],
    );
    await waitForLockWait(database, "seller_analytics_view_waiter");
    await deleteWinner.query("COMMIT");
    assert.equal((await view).rows[0]?.recorded, false);
    await viewWaiter.query("COMMIT");
  } finally {
    await Promise.all([closeClient(deleteWinner), closeClient(viewWaiter)]);
  }
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."ListingViewDaily"
      WHERE "listingId" = $1`,
    [deleteWinsListingId],
  ))[0]?.count ?? -1), 0);
}

async function insertDeletionClaim(database, seller, claimId, claimToken) {
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
       (id, "userId", kind, "dedupKey", payload, status,
        "claimGeneration", "claimToken", "processingStartedAt")
     VALUES ($1, $2::varchar(191), 'LOCAL_ANONYMIZE',
             'account-delete:local:' || $2::varchar(191),
             '{}'::jsonb, 'PROCESSING', 1, $3::uuid,
             pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')`,
    [claimId, seller.userId, claimToken],
  );
}

async function proveProfileDeletionRaces({ connectionString, database, suffix }) {
  const seller = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_profile_race`,
  });
  const claimId = `${suffix}_profile_race_claim`;
  const claimToken = "21111111-2222-4333-8444-555555555555";
  await insertDeletionClaim(database, seller, claimId, claimToken);
  const viewedOn = rowsOf(await database.query(
    `SELECT (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date::text AS value`,
  ))[0]?.value;
  let viewWinner;
  let cleanupWaiter;
  try {
    viewWinner = await beginClient(
      connectionString,
      "seller_analytics_profile_view_winner",
      null,
    );
    assert.equal((await viewWinner.query(
      "SELECT public.grainline_seller_profile_view_record($1, $2::date) AS recorded",
      [seller.sellerProfileId, viewedOn],
    )).rows[0]?.recorded, true);
    cleanupWaiter = await beginClient(
      connectionString,
      "seller_analytics_profile_cleanup_waiter",
    );
    await cleanupWaiter.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [seller.userId],
    );
    const cleanup = cleanupWaiter.query(
      `SELECT public.grainline_seller_profile_view_daily_account_deletion_clear(
         $1, 1, $2::uuid
       ) AS removed`,
      [claimId, claimToken],
    );
    await waitForLockWait(database, "seller_analytics_profile_cleanup_waiter");
    await viewWinner.query("COMMIT");
    assert.equal(Number((await cleanup).rows[0]?.removed ?? -1) >= 1, true);
    await cleanupWaiter.query("COMMIT");
  } finally {
    await Promise.all([closeClient(viewWinner), closeClient(cleanupWaiter)]);
  }
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."SellerProfileViewDaily"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ))[0]?.count ?? -1), 0);

  assert.equal(rowsOf(await runtimeQuery(
    database,
    null,
    "SELECT public.grainline_seller_profile_view_record($1, $2::date) AS recorded",
    [seller.sellerProfileId, viewedOn],
  ))[0]?.recorded, true);
  let cleanupWinner;
  let viewWaiter;
  try {
    cleanupWinner = await beginClient(
      connectionString,
      "seller_analytics_profile_cleanup_winner",
    );
    await cleanupWinner.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [seller.userId],
    );
    await cleanupWinner.query(
      `UPDATE public."SellerProfile"
          SET "chargesEnabled" = false
        WHERE id = $1`,
      [seller.sellerProfileId],
    );
    assert.equal(Number((await cleanupWinner.query(
      `SELECT public.grainline_seller_profile_view_daily_account_deletion_clear(
         $1, 1, $2::uuid
       ) AS removed`,
      [claimId, claimToken],
    )).rows[0]?.removed ?? -1) >= 1, true);
    viewWaiter = await beginClient(
      connectionString,
      "seller_analytics_profile_view_waiter",
      null,
    );
    const view = viewWaiter.query(
      "SELECT public.grainline_seller_profile_view_record($1, $2::date) AS recorded",
      [seller.sellerProfileId, viewedOn],
    );
    await waitForLockWait(database, "seller_analytics_profile_view_waiter");
    await cleanupWinner.query("COMMIT");
    assert.equal((await view).rows[0]?.recorded, false);
    await viewWaiter.query("COMMIT");
  } finally {
    await Promise.all([closeClient(cleanupWinner), closeClient(viewWaiter)]);
  }
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."SellerProfileViewDaily"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ))[0]?.count ?? -1), 0);
  await database.query(
    'DELETE FROM public."AccountDeletionSideEffect" WHERE id = $1',
    [claimId],
  );
  await database.query('DELETE FROM public."SellerProfile" WHERE id = $1', [
    seller.sellerProfileId,
  ]);
  await database.query('DELETE FROM public."User" WHERE id = $1', [seller.userId]);
}

async function proveRetentionCascadeRaces({ connectionString, database, seller, suffix }) {
  const retentionWinsListingId = `${suffix}_retention_wins_listing`;
  await insertListing(
    database,
    retentionWinsListingId,
    seller.sellerProfileId,
    "Seller analytics retention-wins listing",
  );
  await database.query(
    `INSERT INTO public."ListingViewDaily"
       (id, "listingId", "sellerProfileId", date, views, clicks)
     VALUES (
       $1, $2, $3,
       pg_catalog.date_trunc(
         'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - INTERVAL '731 days',
       1, 0
     )`,
    [`${suffix}_retention_wins_daily`, retentionWinsListingId, seller.sellerProfileId],
  );
  let retentionWinner;
  let listingDeleteWaiter;
  try {
    retentionWinner = await beginClient(
      connectionString,
      "seller_analytics_retention_winner",
      null,
    );
    await retentionWinner.query(
      "SELECT * FROM public.grainline_seller_analytics_retention_prune(5000)",
    );
    listingDeleteWaiter = await beginClient(
      connectionString,
      "seller_analytics_parent_delete_waiter",
    );
    const deletion = listingDeleteWaiter.query(
      'DELETE FROM public."Listing" WHERE id = $1',
      [retentionWinsListingId],
    );
    await waitForLockWait(database, "seller_analytics_parent_delete_waiter");
    await retentionWinner.query("COMMIT");
    await deletion;
    await listingDeleteWaiter.query("COMMIT");
  } finally {
    await Promise.all([
      closeClient(retentionWinner),
      closeClient(listingDeleteWaiter),
    ]);
  }

  const cascadeWinsListingId = `${suffix}_cascade_wins_listing`;
  await insertListing(
    database,
    cascadeWinsListingId,
    seller.sellerProfileId,
    "Seller analytics cascade-wins listing",
  );
  await database.query(
    `INSERT INTO public."ListingViewDaily"
       (id, "listingId", "sellerProfileId", date, views, clicks)
     VALUES (
       $1, $2, $3,
       pg_catalog.date_trunc(
         'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - INTERVAL '731 days',
       1, 0
     )`,
    [`${suffix}_cascade_wins_daily`, cascadeWinsListingId, seller.sellerProfileId],
  );
  let listingDeleteWinner;
  let retentionSkipper;
  try {
    listingDeleteWinner = await beginClient(
      connectionString,
      "seller_analytics_parent_delete_winner",
    );
    await listingDeleteWinner.query(
      'DELETE FROM public."Listing" WHERE id = $1',
      [cascadeWinsListingId],
    );
    retentionSkipper = await beginClient(
      connectionString,
      "seller_analytics_retention_skipper",
      null,
    );
    await retentionSkipper.query(
      "SELECT * FROM public.grainline_seller_analytics_retention_prune(5000)",
    );
    await retentionSkipper.query("COMMIT");
    await listingDeleteWinner.query("COMMIT");
  } finally {
    await Promise.all([
      closeClient(listingDeleteWinner),
      closeClient(retentionSkipper),
    ]);
  }
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."ListingViewDaily"
      WHERE "listingId" = ANY($1::text[])`,
    [[retentionWinsListingId, cascadeWinsListingId]],
  ))[0]?.count ?? -1), 0);

  const retentionProfile = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_retention_profile`,
  });
  await database.query(
    `INSERT INTO public."SellerProfileViewDaily"
       (id, "sellerProfileId", date, views)
     VALUES (
       $1, $2,
       pg_catalog.date_trunc(
         'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - INTERVAL '731 days',
       1
     )`,
    [`${suffix}_retention_profile_daily`, retentionProfile.sellerProfileId],
  );
  let profileRetentionWinner;
  let profileDeleteWaiter;
  try {
    profileRetentionWinner = await beginClient(
      connectionString,
      "seller_analytics_profile_retention_winner",
      null,
    );
    await profileRetentionWinner.query(
      "SELECT * FROM public.grainline_seller_analytics_retention_prune(5000)",
    );
    profileDeleteWaiter = await beginClient(
      connectionString,
      "seller_analytics_profile_delete_waiter",
    );
    const deletion = profileDeleteWaiter.query(
      'DELETE FROM public."SellerProfile" WHERE id = $1',
      [retentionProfile.sellerProfileId],
    );
    await waitForLockWait(database, "seller_analytics_profile_delete_waiter");
    await profileRetentionWinner.query("COMMIT");
    await deletion;
    await profileDeleteWaiter.query("COMMIT");
  } finally {
    await Promise.all([
      closeClient(profileRetentionWinner),
      closeClient(profileDeleteWaiter),
    ]);
  }
  await database.query('DELETE FROM public."User" WHERE id = $1', [
    retentionProfile.userId,
  ]);

  const cascadeProfile = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_cascade_profile`,
  });
  await database.query(
    `INSERT INTO public."SellerProfileViewDaily"
       (id, "sellerProfileId", date, views)
     VALUES (
       $1, $2,
       pg_catalog.date_trunc(
         'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - INTERVAL '731 days',
       1
     )`,
    [`${suffix}_cascade_profile_daily`, cascadeProfile.sellerProfileId],
  );
  let profileDeleteWinner;
  let profileRetentionSkipper;
  try {
    profileDeleteWinner = await beginClient(
      connectionString,
      "seller_analytics_profile_delete_winner",
    );
    await profileDeleteWinner.query(
      'DELETE FROM public."SellerProfile" WHERE id = $1',
      [cascadeProfile.sellerProfileId],
    );
    profileRetentionSkipper = await beginClient(
      connectionString,
      "seller_analytics_profile_retention_skipper",
      null,
    );
    await profileRetentionSkipper.query(
      "SELECT * FROM public.grainline_seller_analytics_retention_prune(5000)",
    );
    await profileRetentionSkipper.query("COMMIT");
    await profileDeleteWinner.query("COMMIT");
  } finally {
    await Promise.all([
      closeClient(profileDeleteWinner),
      closeClient(profileRetentionSkipper),
    ]);
  }
  await database.query('DELETE FROM public."User" WHERE id = $1', [
    cascadeProfile.userId,
  ]);
}

async function proveOwnerReadsDuringWrites({
  connectionString,
  database,
  seller,
  suffix,
}) {
  const listingId = `${suffix}_owner_read_race`;
  await insertListing(
    database,
    listingId,
    seller.sellerProfileId,
    "Seller analytics owner-read race",
  );
  assert.equal(await callRecord(database, null, listingId, "view"), true);
  const range = rowsOf(await database.query(`
    SELECT pg_catalog.floor(
             EXTRACT(EPOCH FROM (
               (
                 (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
                 - INTERVAL '800 days'
               ) AT TIME ZONE 'UTC'
             )) * 1000
           )::bigint AS start_millis,
           pg_catalog.floor(
             EXTRACT(EPOCH FROM (
               (
                 (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
                 + INTERVAL '1 day'
               ) AT TIME ZONE 'UTC'
             )) * 1000
           )::bigint AS end_millis
  `))[0];
  const readViews = async () => {
    const rows = rowsOf(await runtimeQuery(
      database,
      seller.userId,
      `SELECT * FROM public.grainline_seller_engagement_analytics(
         $1::bigint, $2::bigint, true, 'day'
       )`,
      [range.start_millis, range.end_millis],
    ));
    assert.ok(rows.length > 0);
    return BigInt(rows[0].listing_views);
  };

  const beforeTelemetry = await readViews();
  let telemetry;
  try {
    telemetry = await beginClient(
      connectionString,
      "seller_analytics_owner_read_telemetry",
      null,
    );
    assert.equal((await telemetry.query(
      "SELECT public.grainline_listing_analytics_record($1, 'view') AS recorded",
      [listingId],
    )).rows[0]?.recorded, true);
    assert.equal(await readViews(), beforeTelemetry);
    await telemetry.query("COMMIT");
  } finally {
    await closeClient(telemetry);
  }
  assert.equal(await readViews(), beforeTelemetry + 1n);

  await database.query(
    `INSERT INTO public."ListingViewDaily"
       (id, "listingId", "sellerProfileId", date, views, clicks)
     VALUES (
       $1, $2, $3,
       pg_catalog.date_trunc(
         'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - INTERVAL '731 days',
       7, 0
     )`,
    [`${suffix}_owner_read_old`, listingId, seller.sellerProfileId],
  );
  const beforeRetention = await readViews();
  let retention;
  try {
    retention = await beginClient(
      connectionString,
      "seller_analytics_owner_read_retention",
      null,
    );
    await retention.query(
      "SELECT * FROM public.grainline_seller_analytics_retention_prune(5000)",
    );
    assert.equal(await readViews(), beforeRetention);
    await retention.query("COMMIT");
  } finally {
    await closeClient(retention);
  }
  assert.equal(await readViews(), beforeRetention - 7n);
  await database.query('DELETE FROM public."Listing" WHERE id = $1', [listingId]);
}

async function proveSellerAnalyticsRaceMatrix({
  connectionString,
  database,
  seller,
  suffix,
}) {
  const viewClickListingId = `${suffix}_view_click`;
  await insertListing(
    database,
    viewClickListingId,
    seller.sellerProfileId,
    "Seller analytics view-click race",
  );
  try {
    await proveConcurrentViewAndClick({
      connectionString,
      database,
      listingId: viewClickListingId,
    });
  } finally {
    await database.query('DELETE FROM public."Listing" WHERE id = $1', [
      viewClickListingId,
    ]);
  }
  await proveListingDeleteRaces({ connectionString, database, seller, suffix });
  await proveProfileDeletionRaces({ connectionString, database, suffix });
  await proveRetentionCascadeRaces({ connectionString, database, seller, suffix });
  await proveOwnerReadsDuringWrites({ connectionString, database, seller, suffix });
}

export async function proveSellerAnalyticsDailyPreparedAuthorities({
  connectionString,
  database,
  seller,
  otherSeller,
  directTableAuthority = true,
  comprehensiveProof = false,
}) {
  const suffix = `seller_analytics_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const listingId = `${suffix}_listing`;
  const concurrentListingId = `${suffix}_concurrent`;
  const otherListingId = `${suffix}_other_listing`;
  const directListingId = `${suffix}_direct_listing`;

  await insertListing(database, listingId, seller.sellerProfileId, "Seller analytics listing");
  await insertListing(
    database,
    concurrentListingId,
    seller.sellerProfileId,
    "Seller analytics concurrent listing",
  );
  await insertListing(
    database,
    otherListingId,
    otherSeller.sellerProfileId,
    "Other seller analytics listing",
  );
  await insertListing(
    database,
    directListingId,
    seller.sellerProfileId,
    "Seller analytics predecessor listing",
  );

  assert.equal(await callRecord(database, null, listingId, "view"), true);
  assert.equal(await callRecord(database, null, listingId, "click"), true);
  assert.equal(
    await callRecord(database, seller.userId, listingId, "view"),
    false,
    "an active owner must not count their own listing traffic",
  );
  assert.equal(await callRecord(database, null, otherListingId, "view"), true);
  assert.equal(await callRecord(database, null, `${suffix}_missing`, "view"), false);
  await database.query(
    `UPDATE public."Listing"
        SET status = 'SOLD_OUT'::public."ListingStatus"
      WHERE id = $1`,
    [listingId],
  );
  assert.equal(await callRecord(database, null, listingId, "view"), false);
  await database.query(
    `UPDATE public."Listing"
        SET status = 'ACTIVE'::public."ListingStatus"
      WHERE id = $1`,
    [listingId],
  );

  await proveConcurrentListingIncrements({
    connectionString,
    database,
    listingId: concurrentListingId,
  });

  const today = rowsOf(await database.query(
    `SELECT ((pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date)::text
            AS value`,
  ))[0]?.value;
  assert.match(String(today), /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(
    rowsOf(await runtimeQuery(
      database,
      null,
      "SELECT public.grainline_seller_profile_view_record($1, $2::date) AS recorded",
      [seller.sellerProfileId, today],
    ))[0]?.recorded,
    true,
  );

  const range = rowsOf(await database.query(`
    SELECT pg_catalog.floor(
             EXTRACT(EPOCH FROM (
               pg_catalog.date_trunc('day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
               AT TIME ZONE 'UTC'
             )) * 1000
           )::bigint AS start_millis,
           pg_catalog.floor(
             EXTRACT(EPOCH FROM (
               (
                 (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 day'
               ) AT TIME ZONE 'UTC'
             )) * 1000
           )::bigint AS end_millis
  `))[0];
  assert.ok(range);

  const sellerRows = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT * FROM public.grainline_seller_engagement_analytics(
       $1::bigint, $2::bigint, true, 'day'
     )`,
    [range.start_millis, range.end_millis],
  ));
  assert.equal(sellerRows.length, 1);
  assert.deepEqual({
    listingViews: BigInt(sellerRows[0].listing_views),
    listingClicks: BigInt(sellerRows[0].listing_clicks),
    profileViews: BigInt(sellerRows[0].profile_views),
    bucketEpochMillis: BigInt(sellerRows[0].bucket_epoch_millis),
    bucketViews: BigInt(sellerRows[0].bucket_views),
    bucketClicks: BigInt(sellerRows[0].bucket_clicks),
  }, {
    listingViews: 3n,
    listingClicks: 1n,
    profileViews: 1n,
    bucketEpochMillis: BigInt(range.start_millis),
    bucketViews: 3n,
    bucketClicks: 1n,
  });

  const topListings = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT * FROM public.grainline_order_seller_analytics_top_listings(
       $1, $2::bigint, $3::bigint, true, false
     )`,
    [seller.userId, range.start_millis, range.end_millis],
  ));
  const topListing = topListings.find((row) => row.listing_id === listingId);
  assert.ok(topListing, "top-listings authority omitted the seller listing");
  assert.equal(BigInt(topListing.view_count), 1n);
  assert.equal(BigInt(topListing.click_count), 1n);

  const otherRows = rowsOf(await runtimeQuery(
    database,
    otherSeller.userId,
    `SELECT * FROM public.grainline_seller_engagement_analytics(
       $1::bigint, $2::bigint, true, 'day'
     )`,
    [range.start_millis, range.end_millis],
  ));
  assert.equal(otherRows.length, 1);
  assert.deepEqual({
    listingViews: BigInt(otherRows[0].listing_views),
    listingClicks: BigInt(otherRows[0].listing_clicks),
    profileViews: BigInt(otherRows[0].profile_views),
    bucketEpochMillis: BigInt(otherRows[0].bucket_epoch_millis),
    bucketViews: BigInt(otherRows[0].bucket_views),
    bucketClicks: BigInt(otherRows[0].bucket_clicks),
  }, {
    listingViews: 1n,
    listingClicks: 0n,
    profileViews: 0n,
    bucketEpochMillis: BigInt(range.start_millis),
    bucketViews: 1n,
    bucketClicks: 0n,
  });
  await database.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [otherSeller.userId],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    otherSeller.userId,
    `SELECT * FROM public.grainline_seller_engagement_analytics(
       $1::bigint, $2::bigint, true, 'day'
     )`,
    [range.start_millis, range.end_millis],
  )), []);
  await database.query(
    `UPDATE public."User" SET banned = false WHERE id = $1`,
    [otherSeller.userId],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      `SELECT * FROM public.grainline_seller_engagement_analytics(
         $1::bigint, $2::bigint, true, 'day'
       )`,
      [range.start_millis, range.end_millis],
    ),
    (error) => error?.code === "42501",
  );

  if (comprehensiveProof) {
    assert.equal(
      directTableAuthority,
      false,
      "the comprehensive race and plan proof must run under active RLS",
    );
    await proveSellerAnalyticsQueryPlans({
      database,
      seller,
      otherSeller,
      suffix,
    });
    await proveSellerAnalyticsRaceMatrix({
      connectionString,
      database,
      seller,
      suffix,
    });
  }

  if (directTableAuthority) {
    // Preparation must preserve the predecessor's direct runtime operations.
    await runtimeQuery(
      database,
      seller.userId,
      `INSERT INTO public."ListingViewDaily"
         (id, "listingId", "sellerProfileId", date, views, clicks)
       VALUES (
         $1, $2, $3,
         pg_catalog.date_trunc('day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'),
         4, 2
       )`,
      [`${suffix}_direct_daily`, directListingId, seller.sellerProfileId],
    );
    await runtimeQuery(
      database,
      seller.userId,
      `UPDATE public."ListingViewDaily"
          SET views = views + 1
        WHERE "listingId" = $1`,
      [directListingId],
    );
    await runtimeQuery(
      database,
      seller.userId,
      `DELETE FROM public."ListingViewDaily" WHERE "listingId" = $1`,
      [directListingId],
    );
    await runtimeQuery(
      database,
      seller.userId,
      `INSERT INTO public."SellerProfileViewDaily"
         (id, "sellerProfileId", date, views)
       VALUES (
         $1, $2,
         pg_catalog.date_trunc('day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
           - interval '1 day',
         1
       )`,
      [`${suffix}_direct_profile`, seller.sellerProfileId],
    );
    await runtimeQuery(
      database,
      seller.userId,
      `UPDATE public."SellerProfileViewDaily"
          SET views = views + 1
        WHERE id = $1`,
      [`${suffix}_direct_profile`],
    );
    await runtimeQuery(
      database,
      seller.userId,
      `DELETE FROM public."SellerProfileViewDaily" WHERE id = $1`,
      [`${suffix}_direct_profile`],
    );
  } else {
    for (const statement of [
      'SELECT id FROM public."ListingViewDaily" LIMIT 1',
      `INSERT INTO public."ListingViewDaily"
         (id, "listingId", "sellerProfileId", date, views, clicks)
       VALUES ('denied', 'denied', 'denied', pg_catalog.date_trunc(
         'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ), 0, 0)`,
      'UPDATE public."ListingViewDaily" SET views = views WHERE false',
      'DELETE FROM public."ListingViewDaily" WHERE false',
      'SELECT id FROM public."SellerProfileViewDaily" LIMIT 1',
      `INSERT INTO public."SellerProfileViewDaily"
         (id, "sellerProfileId", date, views)
       VALUES ('denied', 'denied', pg_catalog.date_trunc(
         'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ), 0)`,
      'UPDATE public."SellerProfileViewDaily" SET views = views WHERE false',
      'DELETE FROM public."SellerProfileViewDaily" WHERE false',
    ]) {
      await assert.rejects(
        runtimeQuery(database, seller.userId, statement),
        (error) => error?.code === "42501",
      );
    }
  }

  await assert.rejects(
    runtimeQuery(
      database,
      seller.userId,
      `INSERT INTO public."ListingViewDaily"
         (id, "listingId", "sellerProfileId", date, views, clicks)
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp(), -1, 0)`,
      [`${suffix}_invalid_daily`, directListingId, seller.sellerProfileId],
    ),
    (error) => error?.code === "23514",
  );

  const driftListingId = `${suffix}_drift_listing`;
  await insertListing(
    database,
    driftListingId,
    seller.sellerProfileId,
    "Seller analytics drift listing",
  );
  await database.query(
    `INSERT INTO public."ListingViewDaily"
       (id, "listingId", "sellerProfileId", date, views, clicks)
     VALUES (
       $1, $2, $3,
       pg_catalog.date_trunc('day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'),
       0, 0
     )`,
    [`${suffix}_drift_daily`, driftListingId, otherSeller.sellerProfileId],
  );
  await assert.rejects(
    callRecord(database, null, driftListingId, "view"),
    (error) => error?.code === "23514",
  );
  await database.query(
    `DELETE FROM public."ListingViewDaily" WHERE "listingId" = $1`,
    [driftListingId],
  );

  await database.query(
    `UPDATE public."Listing" SET "viewCount" = 2147483647 WHERE id = $1`,
    [driftListingId],
  );
  await assert.rejects(
    callRecord(database, null, driftListingId, "view"),
    (error) => error?.code === "22003",
  );
  await database.query(
    `UPDATE public."Listing" SET "viewCount" = 0 WHERE id = $1`,
    [driftListingId],
  );

  await database.query(
    `INSERT INTO public."ListingViewDaily"
       (id, "listingId", "sellerProfileId", date, views, clicks)
     VALUES (
       $1, $2, $3,
       pg_catalog.date_trunc('day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'),
       2147483647, 0
     )`,
    [`${suffix}_exhausted_daily`, driftListingId, seller.sellerProfileId],
  );
  await assert.rejects(
    callRecord(database, null, driftListingId, "view"),
    (error) => error?.code === "22003",
  );

  const oldProfileRowId = `${suffix}_old_profile`;
  const secondOldProfileRowId = `${suffix}_old_profile_2`;
  const recentProfileRowId = `${suffix}_recent_profile`;
  await database.query(
    `INSERT INTO public."SellerProfileViewDaily"
       (id, "sellerProfileId", date, views)
     VALUES
       ($1, $3, pg_catalog.date_trunc(
          'day', (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '731 days'
        ), 1),
       ($2, $3, pg_catalog.date_trunc(
          'day', (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '732 days'
        ), 1),
       ($4, $3, pg_catalog.date_trunc(
          'day', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
        ), 1)`,
    [
      oldProfileRowId,
      secondOldProfileRowId,
      otherSeller.sellerProfileId,
      recentProfileRowId,
    ],
  );
  const boundedRetention = rowsOf(await runtimeQuery(
    database,
    null,
    "SELECT * FROM public.grainline_seller_analytics_retention_prune(1)",
  ));
  assert.equal(boundedRetention.length, 1);
  assert.equal(boundedRetention[0].profile_deleted, 1);
  assert.equal(boundedRetention[0].profile_complete, false);
  const retention = rowsOf(await runtimeQuery(
    database,
    null,
    "SELECT * FROM public.grainline_seller_analytics_retention_prune(5000)",
  ));
  assert.equal(retention.length, 1);
  assert.equal(retention[0].listing_complete, true);
  assert.equal(retention[0].profile_complete, true);
  assert.equal(rowsOf(await database.query(
    `SELECT id FROM public."SellerProfileViewDaily"
      WHERE id IN ($1, $2, $3) ORDER BY id`,
    [oldProfileRowId, secondOldProfileRowId, recentProfileRowId],
  )).some((row) => row.id === oldProfileRowId || row.id === secondOldProfileRowId), false);
  assert.equal(rowsOf(await database.query(
    `SELECT id FROM public."SellerProfileViewDaily"
      WHERE id IN ($1, $2, $3) ORDER BY id`,
    [oldProfileRowId, secondOldProfileRowId, recentProfileRowId],
  )).some((row) => row.id === recentProfileRowId), true);

  const lockedOldProfileRowId = `${suffix}_locked_old_profile`;
  await database.query(
    `INSERT INTO public."SellerProfileViewDaily"
       (id, "sellerProfileId", date, views)
     VALUES (
       $1, $2, pg_catalog.date_trunc(
         'day', (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '731 days'
       ), 1
     )`,
    [lockedOldProfileRowId, otherSeller.sellerProfileId],
  );
  const retentionLocker = new pg.Client({ connectionString });
  await retentionLocker.connect();
  try {
    await retentionLocker.query("BEGIN");
    await retentionLocker.query(
      `SELECT id FROM public."SellerProfileViewDaily" WHERE id = $1 FOR UPDATE`,
      [lockedOldProfileRowId],
    );
    const skippedLockedRetention = rowsOf(await runtimeQuery(
      database,
      null,
      "SELECT * FROM public.grainline_seller_analytics_retention_prune(1)",
    ));
    assert.equal(skippedLockedRetention.length, 1);
    assert.equal(skippedLockedRetention[0].profile_deleted, 0);
    assert.equal(
      skippedLockedRetention[0].profile_complete,
      false,
      "a skipped locked row must keep retention incomplete",
    );
  } finally {
    await retentionLocker.query("ROLLBACK").catch(() => {});
    await retentionLocker.end();
  }
  const unlockedRetention = rowsOf(await runtimeQuery(
    database,
    null,
    "SELECT * FROM public.grainline_seller_analytics_retention_prune(5000)",
  ));
  assert.equal(unlockedRetention[0]?.profile_deleted, 1);
  assert.equal(unlockedRetention[0]?.profile_complete, true);

  const claimId = `${suffix}_claim`;
  const claimToken = "11111111-2222-4333-8444-555555555555";
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
       (id, "userId", kind, "dedupKey", payload, status,
        "claimGeneration", "claimToken", "processingStartedAt")
     VALUES ($1, $2::varchar(191), 'LOCAL_ANONYMIZE',
             'account-delete:local:' || $2::varchar(191),
             '{}'::jsonb, 'PROCESSING', 1, $3::uuid,
             pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')`,
    [claimId, seller.userId, claimToken],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      otherSeller.userId,
      `SELECT public.grainline_seller_profile_view_daily_account_deletion_clear(
         $1, 1, $2::uuid
       )`,
      [claimId, claimToken],
    ),
    (error) => error?.code === "42501",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      seller.userId,
      `SELECT public.grainline_seller_profile_view_daily_account_deletion_clear(
         $1, 2, $2::uuid
       )`,
      [claimId, claimToken],
    ),
    (error) => error?.code === "42501",
  );
  const cleared = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT public.grainline_seller_profile_view_daily_account_deletion_clear(
       $1, 1, $2::uuid
     ) AS removed`,
    [claimId, claimToken],
  ));
  assert.equal(Number(cleared[0]?.removed ?? -1) >= 1, true);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."SellerProfileViewDaily"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ))[0]?.count ?? -1), 0);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."SellerProfileViewDaily"
      WHERE "sellerProfileId" = $1`,
    [otherSeller.sellerProfileId],
  ))[0]?.count ?? -1) > 0, true);

  const posture = rowsOf(await database.query(`
    SELECT source.proname,
           owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', source.oid, 'EXECUTE'
           ) AS runtime_execute,
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   source.proacl,
                   pg_catalog.acldefault('f', source.proowner)
                 )
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute
      FROM pg_catalog.pg_proc AS source
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = source.pronamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = source.proowner
     WHERE namespace.nspname = 'public'
       AND source.proname IN (
         'grainline_listing_analytics_record',
         'grainline_seller_profile_view_record',
         'grainline_seller_engagement_analytics',
         'grainline_seller_analytics_retention_prune',
         'grainline_seller_profile_view_daily_account_deletion_clear',
         'grainline_order_seller_analytics_top_listings'
       )
     ORDER BY source.proname
  `));
  assert.equal(posture.length, 6);
  assert.equal(posture.every((row) =>
    row.owner_bypasses_rls && row.runtime_execute && !row.public_execute), true);

  const tablePosture = rowsOf(await database.query(`
    SELECT relation.relname,
           relation.relrowsecurity AS rls_enabled,
           relation.relforcerowsecurity AS rls_forced,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'DELETE'
           ) AS runtime_delete,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = relation.oid) AS policy_count
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('ListingViewDaily', 'SellerProfileViewDaily')
     ORDER BY relation.relname
  `));
  assert.deepEqual(tablePosture, [
    {
      relname: "ListingViewDaily",
      rls_enabled: !directTableAuthority,
      rls_forced: !directTableAuthority,
      runtime_select: directTableAuthority,
      runtime_insert: directTableAuthority,
      runtime_update: directTableAuthority,
      runtime_delete: directTableAuthority,
      policy_count: 0,
    },
    {
      relname: "SellerProfileViewDaily",
      rls_enabled: !directTableAuthority,
      rls_forced: !directTableAuthority,
      runtime_select: directTableAuthority,
      runtime_insert: directTableAuthority,
      runtime_update: directTableAuthority,
      runtime_delete: directTableAuthority,
      policy_count: 0,
    },
  ]);

  // This scenario runs before the public-map and account-deletion proofs.
  // Remove every fixture it owns so public selection, exact deduplication keys,
  // and later retention counts are independent of scenario order.
  await database.query(
    `DELETE FROM public."ListingViewDaily"
      WHERE "listingId" IN ($1, $2, $3, $4, $5)`,
    [listingId, concurrentListingId, otherListingId, directListingId, driftListingId],
  );
  await database.query(
    `DELETE FROM public."SellerProfileViewDaily"
      WHERE id IN ($1, $2, $3, $4)`,
    [oldProfileRowId, secondOldProfileRowId, recentProfileRowId, lockedOldProfileRowId],
  );
  await database.query(
    `DELETE FROM public."AccountDeletionSideEffect" WHERE id = $1`,
    [claimId],
  );
  await database.query(
    `DELETE FROM public."Listing"
      WHERE id IN ($1, $2, $3, $4, $5)`,
    [listingId, concurrentListingId, otherListingId, directListingId, driftListingId],
  );
}
