import assert from "node:assert/strict";

import pg from "pg";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
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

export async function proveSellerAnalyticsDailyPreparedAuthorities({
  connectionString,
  database,
  seller,
  otherSeller,
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
    "SELECT (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date AS value",
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
     VALUES ($1, $2, 'LOCAL_ANONYMIZE', 'account-delete:local:' || $2,
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
           pg_catalog.has_function_privilege('PUBLIC', source.oid, 'EXECUTE')
             AS public_execute
      FROM pg_catalog.pg_proc AS source
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = source.pronamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = source.proowner
     WHERE namespace.nspname = 'public'
       AND source.proname IN (
         'grainline_listing_analytics_record',
         'grainline_seller_profile_view_record',
         'grainline_seller_engagement_analytics',
         'grainline_seller_analytics_retention_prune',
         'grainline_seller_profile_view_daily_account_deletion_clear'
       )
     ORDER BY source.proname
  `));
  assert.equal(posture.length, 5);
  assert.equal(posture.every((row) =>
    row.owner_bypasses_rls && row.runtime_execute && !row.public_execute), true);
}
