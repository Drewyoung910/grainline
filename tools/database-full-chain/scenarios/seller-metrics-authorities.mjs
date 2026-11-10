import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";

import { seedSellerProfilePrivateFixture } from "./seller-profile-private-fixture.mjs";

export const SELLER_METRICS_PREPARATION_MIGRATION =
  "20261102030000_prepare_seller_metrics_authorities";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

function runtimeConnectionString(connectionString, password) {
  const value = new URL(connectionString);
  value.username = "grainline_app_runtime";
  value.password = password;
  return value.toString();
}

async function expectSqlState(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

async function connectRuntime(connectionString, applicationName) {
  const client = new pg.Client({
    connectionString,
    application_name: applicationName,
  });
  await client.connect();
  await client.query("SET statement_timeout = '8s'");
  await client.query("SET lock_timeout = '6s'");
  const identity = (await client.query(
    "SELECT current_user, session_user",
  )).rows[0];
  assert.deepEqual(identity, {
    current_user: "grainline_app_runtime",
    session_user: "grainline_app_runtime",
  });
  return client;
}

async function beginActor(client, actorId) {
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, true)",
    [actorId ?? ""],
  );
}

async function closeTransaction(client, action = "ROLLBACK") {
  await client.query(action).catch(() => {});
}

async function ownerMetrics(client, actorId, { force = false, period = 3 } = {}) {
  await beginActor(client, actorId);
  try {
    const result = await client.query(
      `SELECT *
         FROM public.grainline_seller_metrics_owner_state($1, $2)`,
      [period, force],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await closeTransaction(client);
    throw error;
  }
}

function assertMetricsRow(row, sellerProfileId, periodMonths = 3) {
  assert.ok(row, "SellerMetrics authority did not return a row");
  assert.equal(row.sellerProfileId, sellerProfileId);
  assert.equal(row.periodMonths, periodMonths);
  assert.ok(row.calculatedAt instanceof Date);
  assert.equal(Number.isFinite(row.calculatedAt.getTime()), true);
  assert.equal(Number(row.averageRating) >= 0 && Number(row.averageRating) <= 5, true);
  assert.equal(Number(row.reviewCount) >= 0, true);
  assert.equal(Number(row.onTimeShippingRate) >= 0, true);
  assert.equal(Number(row.onTimeShippingRate) <= 1, true);
  assert.equal(Number(row.responseRate) >= 0, true);
  assert.equal(Number(row.responseRate) <= 1, true);
  assert.equal(BigInt(row.totalSalesCents) >= 0n, true);
  assert.equal(Number(row.completedOrderCount) >= 0, true);
  assert.equal(Number(row.activeCaseCount) >= 0, true);
  assert.equal(Number(row.accountAgeDays) >= 0, true);
}

async function insertDeletionClaim(database, seller, sideEffectId, claimToken) {
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect" (
       id, "userId", kind, "dedupKey", payload, status,
       "claimGeneration", "claimToken", "processingStartedAt"
     ) VALUES (
       $1, $2::varchar(191), 'LOCAL_ANONYMIZE',
       'account-delete:local:' || $2::varchar(191), '{}'::jsonb,
       'PROCESSING', 1, $3::uuid,
       pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
     )`,
    [sideEffectId, seller.userId, claimToken],
  );
}

async function waitForLockWait(database, applicationName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = rowsOf(await database.query(
      `SELECT wait_event_type
         FROM pg_catalog.pg_stat_activity
        WHERE application_name = $1
          AND pid <> pg_catalog.pg_backend_pid()`,
      [applicationName],
    ))[0];
    if (row?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${applicationName} did not reach the expected lock wait`);
}

async function finalizeDeletion(client, seller, sideEffectId, claimToken) {
  const finalized = await client.query(
    `SELECT *
       FROM public.grainline_user_account_deletion_finalize(
         $1, 1, $2::uuid
       )`,
    [sideEffectId, claimToken],
  );
  assert.equal(finalized.rows[0]?.userId, seller.userId);
}

async function cleanupDeletedFixture(database, seller, sideEffectId) {
  await database.query(
    'DELETE FROM public."AccountDeletionSideEffect" WHERE id = $1',
    [sideEffectId],
  );
  await database.query('DELETE FROM public."SellerProfile" WHERE id = $1', [
    seller.sellerProfileId,
  ]);
  await database.query('DELETE FROM public."User" WHERE id = $1', [seller.userId]);
}

async function proveRefreshWinsDeletionRace({
  connectionString,
  database,
  suffix,
}) {
  const seller = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_refresh_wins`,
  });
  const sideEffectId = `${suffix}_refresh_wins_claim`;
  const claimToken = randomUUID();
  await insertDeletionClaim(database, seller, sideEffectId, claimToken);

  const refresh = await connectRuntime(
    connectionString,
    "seller_metrics_refresh_winner",
  );
  const deletion = await connectRuntime(
    connectionString,
    "seller_metrics_deletion_waiter",
  );
  try {
    await beginActor(refresh, seller.userId);
    const refreshed = await refresh.query(
      "SELECT * FROM public.grainline_seller_metrics_owner_state(3, true)",
    );
    assertMetricsRow(refreshed.rows[0], seller.sellerProfileId);

    await beginActor(deletion, seller.userId);
    const clearing = deletion.query(
      `SELECT public.grainline_seller_metrics_account_deletion_clear(
         $1, 1, $2::uuid
       ) AS removed`,
      [sideEffectId, claimToken],
    );
    await waitForLockWait(database, "seller_metrics_deletion_waiter");
    await refresh.query("COMMIT");
    assert.equal(Number((await clearing).rows[0]?.removed), 1);
    await finalizeDeletion(deletion, seller, sideEffectId, claimToken);
    await deletion.query("COMMIT");

    const count = rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."SellerMetrics"
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    ))[0]?.count;
    assert.equal(count, 0, "deletion must remove the refresh winner's row");
  } finally {
    await Promise.all([
      closeTransaction(refresh),
      closeTransaction(deletion),
    ]);
    await Promise.all([refresh.end(), deletion.end()]);
    await cleanupDeletedFixture(database, seller, sideEffectId);
  }
}

async function proveDeletionWinsRefreshRace({
  connectionString,
  database,
  suffix,
}) {
  const seller = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_deletion_wins`,
  });
  const sideEffectId = `${suffix}_deletion_wins_claim`;
  const claimToken = randomUUID();
  await insertDeletionClaim(database, seller, sideEffectId, claimToken);

  const deletion = await connectRuntime(
    connectionString,
    "seller_metrics_deletion_winner",
  );
  const refresh = await connectRuntime(
    connectionString,
    "seller_metrics_refresh_waiter",
  );
  try {
    await ownerMetrics(deletion, seller.userId, { force: true });
    await beginActor(deletion, seller.userId);
    const cleared = await deletion.query(
      `SELECT public.grainline_seller_metrics_account_deletion_clear(
         $1, 1, $2::uuid
       ) AS removed`,
      [sideEffectId, claimToken],
    );
    assert.equal(Number(cleared.rows[0]?.removed), 1);
    await finalizeDeletion(deletion, seller, sideEffectId, claimToken);

    await beginActor(refresh, seller.userId);
    const waitingRefresh = refresh.query(
      "SELECT * FROM public.grainline_seller_metrics_owner_state(3, true)",
    );
    await waitForLockWait(database, "seller_metrics_refresh_waiter");
    await deletion.query("COMMIT");
    await expectSqlState(waitingRefresh, "42501");
    await refresh.query("ROLLBACK");

    const count = rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."SellerMetrics"
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    ))[0]?.count;
    assert.equal(count, 0, "a refresh must not resurrect deleted metrics");
  } finally {
    await Promise.all([
      closeTransaction(refresh),
      closeTransaction(deletion),
    ]);
    await Promise.all([refresh.end(), deletion.end()]);
    await cleanupDeletedFixture(database, seller, sideEffectId);
  }
}

export async function proveSellerMetricsPreparedAuthorities({
  connectionString,
  database,
  seller,
}) {
  const suffix = `seller_metrics_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const runtimePassword = randomBytes(24).toString("base64url");
  await database.query(
    `ALTER ROLE grainline_app_runtime PASSWORD '${runtimePassword}'`,
  );
  const runtimeUrl = runtimeConnectionString(connectionString, runtimePassword);
  const first = await connectRuntime(runtimeUrl, "seller_metrics_primary");
  const second = await connectRuntime(runtimeUrl, "seller_metrics_secondary");
  const parityReviewerId = `${suffix}_inactive_reviewer`;
  const parityListingId = `${suffix}_review_listing`;
  const parityReviewId = `${suffix}_inactive_review`;

  const originalSellerState = rowsOf(await database.query(
    `SELECT "guildLevel"::text AS guild_level,
            "vacationMode" AS vacation_mode,
            "ownerAccountActive" AS owner_account_active
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ))[0];
  const originalUserState = rowsOf(await database.query(
    `SELECT banned, "deletedAt" AS deleted_at
       FROM public."User"
      WHERE id = $1`,
    [seller.userId],
  ))[0];
  const originalMetricsRows = rowsOf(await database.query(
    `SELECT id, "sellerProfileId", "calculatedAt", "periodMonths",
            "averageRating", "reviewCount", "onTimeShippingRate",
            "responseRate", "totalSalesCents", "completedOrderCount",
            "activeCaseCount", "accountAgeDays"
       FROM public."SellerMetrics"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ));

  try {
    const posture = rowsOf(await database.query(`
      SELECT relation.relrowsecurity AS enabled,
             relation.relforcerowsecurity AS forced,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = relation.oid) AS policy_count,
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
             ) AS runtime_delete
        FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public."SellerMetrics"'::pg_catalog.regclass
    `));
    assert.deepEqual(posture, [{
      enabled: false,
      forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
    }]);

    await expectSqlState(
      first.query("SELECT * FROM public.grainline_seller_metrics_owner_state(3, false)"),
      "42501",
    );

    const initial = await ownerMetrics(first, seller.userId, { force: true });
    assert.equal(initial.length, 1);
    assertMetricsRow(initial[0], seller.sellerProfileId);

    await database.query(
      `INSERT INTO public."User" (id, "clerkId", email)
       VALUES ($1, $2, $3)`,
      [
        parityReviewerId,
        `${parityReviewerId}_clerk`,
        `${parityReviewerId}@example.test`,
      ],
    );
    await database.query(
      `INSERT INTO public."Listing" (
         id, "sellerId", title, description, "priceCents", status
       ) VALUES ($1, $2, 'Metrics parity listing', 'Metrics parity fixture', 100,
                 'ACTIVE'::public."ListingStatus")`,
      [parityListingId, seller.sellerProfileId],
    );
    await database.query(
      `INSERT INTO public."Review" (
         id, "listingId", "reviewerId", "reviewerAccountActive", "ratingX2"
       ) VALUES ($1, $2, $3, false, 10)`,
      [parityReviewId, parityListingId, parityReviewerId],
    );

    const inactiveReview = await ownerMetrics(first, seller.userId, { force: true });
    assert.equal(
      Number(inactiveReview[0]?.reviewCount),
      Number(initial[0]?.reviewCount),
      "inactive reviewer rows must remain excluded from Guild metrics",
    );
    await database.query(
      `UPDATE public."Review"
          SET "reviewerAccountActive" = true
        WHERE id = $1`,
      [parityReviewId],
    );
    const activeReview = await ownerMetrics(first, seller.userId, { force: true });
    assert.equal(
      Number(activeReview[0]?.reviewCount),
      Number(initial[0]?.reviewCount) + 1,
      "reactivated reviewer rows must be counted once",
    );

    const cached = await ownerMetrics(first, seller.userId);
    assert.equal(cached.length, 1);
    assertMetricsRow(cached[0], seller.sellerProfileId);
    assert.equal(
      cached[0].calculatedAt.getTime(),
      initial[0].calculatedAt.getTime(),
      "a fresh cache read must not recalculate",
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    const forced = await ownerMetrics(first, seller.userId, { force: true });
    assertMetricsRow(forced[0], seller.sellerProfileId);
    assert.equal(
      forced[0].calculatedAt.getTime() >= cached[0].calculatedAt.getTime(),
      true,
    );

    await expectSqlState(ownerMetrics(first, seller.userId, { period: 0 }), "42501");
    await expectSqlState(
      first.query(
        `SELECT * FROM public.grainline_seller_metrics_refresh_prepared_impl(
           $1, 3, false, 'OWNER'
         )`,
        [seller.sellerProfileId],
      ),
      "42501",
    );

    await database.query(
      `UPDATE public."SellerProfile"
          SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
              "vacationMode" = false
        WHERE id = $1`,
      [seller.sellerProfileId],
    );
    await database.query(
      `UPDATE public."User"
          SET banned = true
        WHERE id = $1`,
      [seller.userId],
    );
    await expectSqlState(ownerMetrics(first, seller.userId, { force: true }), "42501");
    assert.equal(Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."SellerMetrics"
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    ))[0]?.count ?? -1), 0, "inactive-owner transition must remove cached metrics");
    await database.query(
      `UPDATE public."User"
          SET banned = $2,
              "deletedAt" = $3
        WHERE id = $1`,
      [seller.userId, originalUserState.banned, originalUserState.deleted_at],
    );

    // The Guild cron reuses the owner-bound refresh under the user id returned
    // by its database-derived cohort. There is no arbitrary-seller refresh
    // function on the ordinary runtime role.
    const guild = await ownerMetrics(first, seller.userId, { force: true });
    assertMetricsRow(guild[0], seller.sellerProfileId);
    assert.equal(rowsOf(await database.query(
      `SELECT pg_catalog.to_regprocedure(
         'public.grainline_seller_metrics_guild_refresh(text,integer)'
       ) AS function_oid`,
    ))[0]?.function_oid, null, "owner-bound Guild refresh must not add a cross-owner function");
    await database.query(
      `UPDATE public."SellerProfile"
          SET "vacationMode" = true
        WHERE id = $1`,
      [seller.sellerProfileId],
    );
    const guildCohort = await first.query(
      "SELECT * FROM public.grainline_seller_guild_metrics_cron_batch(NULL, 100)",
    );
    assert.equal(
      guildCohort.rows.some((row) => row.id === seller.sellerProfileId),
      false,
      "vacation sellers must remain outside the Guild metrics cohort",
    );
    await database.query(
      `UPDATE public."SellerProfile"
          SET "guildLevel" = $2::public."GuildLevel",
              "vacationMode" = $3
        WHERE id = $1`,
      [
        seller.sellerProfileId,
        originalSellerState.guild_level,
        originalSellerState.vacation_mode,
      ],
    );

    await first.query("BEGIN");
    await expectSqlState(
      first.query(
        `UPDATE public."SellerMetrics"
            SET "averageRating" = 6
          WHERE "sellerProfileId" = $1`,
        [seller.sellerProfileId],
      ),
      "23514",
    );
    await first.query("ROLLBACK");

    const sideEffectId = `${suffix}_claim`;
    const claimToken = randomUUID();
    await insertDeletionClaim(database, seller, sideEffectId, claimToken);
    await beginActor(first, seller.userId);
    await expectSqlState(
      first.query(
        `SELECT public.grainline_seller_metrics_account_deletion_clear(
           $1, 2, $2::uuid
         )`,
        [sideEffectId, claimToken],
      ),
      "42501",
    );
    await first.query("ROLLBACK");
    await beginActor(first, seller.userId);
    const removed = await first.query(
      `SELECT public.grainline_seller_metrics_account_deletion_clear(
         $1, 1, $2::uuid
       ) AS removed`,
      [sideEffectId, claimToken],
    );
    assert.equal(Number(removed.rows[0]?.removed), 1);
    await first.query("COMMIT");
    await beginActor(first, seller.userId);
    const replay = await first.query(
      `SELECT public.grainline_seller_metrics_account_deletion_clear(
         $1, 1, $2::uuid
       ) AS removed`,
      [sideEffectId, claimToken],
    );
    assert.equal(Number(replay.rows[0]?.removed), 0);
    await first.query("COMMIT");
    await database.query(
      'DELETE FROM public."AccountDeletionSideEffect" WHERE id = $1',
      [sideEffectId],
    );

    const concurrent = await Promise.all([
      ownerMetrics(first, seller.userId, { force: true }),
      ownerMetrics(second, seller.userId, { force: true }),
    ]);
    assertMetricsRow(concurrent[0][0], seller.sellerProfileId);
    assertMetricsRow(concurrent[1][0], seller.sellerProfileId);
    const cacheCount = rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."SellerMetrics"
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    ))[0]?.count;
    assert.equal(cacheCount, 1, "concurrent refreshes must leave one cache row");

    await proveRefreshWinsDeletionRace({
      connectionString: runtimeUrl,
      database,
      suffix,
    });
    await proveDeletionWinsRefreshRace({
      connectionString: runtimeUrl,
      database,
      suffix,
    });
  } finally {
    await Promise.all([closeTransaction(first), closeTransaction(second)]);
    await Promise.all([first.end(), second.end()]);
    await database.query('DELETE FROM public."Review" WHERE id = $1', [
      parityReviewId,
    ]).catch(() => {});
    await database.query('DELETE FROM public."Listing" WHERE id = $1', [
      parityListingId,
    ]).catch(() => {});
    await database.query('DELETE FROM public."User" WHERE id = $1', [
      parityReviewerId,
    ]).catch(() => {});
    await database.query(
      `UPDATE public."SellerProfile"
          SET "guildLevel" = $2::public."GuildLevel",
              "vacationMode" = $3,
              "ownerAccountActive" = $4
        WHERE id = $1`,
      [
        seller.sellerProfileId,
        originalSellerState.guild_level,
        originalSellerState.vacation_mode,
        originalSellerState.owner_account_active,
      ],
    ).catch(() => {});
    await database.query(
      `UPDATE public."User"
          SET banned = $2,
              "deletedAt" = $3
        WHERE id = $1`,
      [seller.userId, originalUserState.banned, originalUserState.deleted_at],
    ).catch(() => {});
    if (originalMetricsRows.length === 0) {
      await database.query(
        'DELETE FROM public."SellerMetrics" WHERE "sellerProfileId" = $1',
        [seller.sellerProfileId],
      ).catch(() => {});
    } else {
      const metrics = originalMetricsRows[0];
      await database.query(
        `INSERT INTO public."SellerMetrics" (
           id, "sellerProfileId", "calculatedAt", "periodMonths",
           "averageRating", "reviewCount", "onTimeShippingRate",
           "responseRate", "totalSalesCents", "completedOrderCount",
           "activeCaseCount", "accountAgeDays"
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         )
         ON CONFLICT ("sellerProfileId") DO UPDATE SET
           id = EXCLUDED.id,
           "calculatedAt" = EXCLUDED."calculatedAt",
           "periodMonths" = EXCLUDED."periodMonths",
           "averageRating" = EXCLUDED."averageRating",
           "reviewCount" = EXCLUDED."reviewCount",
           "onTimeShippingRate" = EXCLUDED."onTimeShippingRate",
           "responseRate" = EXCLUDED."responseRate",
           "totalSalesCents" = EXCLUDED."totalSalesCents",
           "completedOrderCount" = EXCLUDED."completedOrderCount",
           "activeCaseCount" = EXCLUDED."activeCaseCount",
           "accountAgeDays" = EXCLUDED."accountAgeDays"`,
        [
          metrics.id,
          metrics.sellerProfileId,
          metrics.calculatedAt,
          metrics.periodMonths,
          metrics.averageRating,
          metrics.reviewCount,
          metrics.onTimeShippingRate,
          metrics.responseRate,
          metrics.totalSalesCents,
          metrics.completedOrderCount,
          metrics.activeCaseCount,
          metrics.accountAgeDays,
        ],
      ).catch(() => {});
    }
    await database.query("ALTER ROLE grainline_app_runtime PASSWORD NULL");
  }
}
