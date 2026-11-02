import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { seedSellerProfilePrivateFixture } from "./seller-profile-private-fixture.mjs";

export const SELLER_BROADCAST_PREPARATION_MIGRATION =
  "20261101010000_prepare_seller_broadcast_authorities";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function runtimeQuery(database, actorId, sql, params = []) {
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [actorId ?? ""],
    );
    return rowsOf(await database.query(sql, params));
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id").catch(() => {});
  }
}

async function createUser(database, id, role = "USER") {
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::public."Role", false,
             pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())`,
    [id, `clerk_${id}`, `${id}@example.test`, id, role],
  );
}

async function seedProviderClaim(database, {
  followerId,
  followerEmail,
  sourceType,
  sourceId,
}) {
  const jobId = `seller_broadcast_provider_${randomUUID()}`;
  const claimToken = randomUUID();
  await database.query(
    `INSERT INTO public."EmailOutbox" (
       id, "recipientEmail", "userId", "preferenceKey", "templateName",
       "templateVersion", "sourceType", "sourceId", subject, html, "dedupKey",
       status, attempts, "claimGeneration", "claimToken", "processingStartedAt",
       "nextAttemptAt", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, 1, $6, $7,
       'Seller relationship proof', '<p>Seller relationship proof</p>', $8,
       'PROCESSING', 1, 1, $9::uuid, pg_catalog.clock_timestamp(),
       NULL, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [
      jobId,
      followerEmail,
      followerId,
      null,
      sourceType,
      sourceType,
      sourceId,
      `relationship-proof:${randomUUID()}`,
      claimToken,
    ],
  );
  return Object.freeze({ jobId, claimGeneration: 1, claimToken });
}

async function seedAccountDeletionClaim(database, userId) {
  const sideEffectId = `seller_broadcast_delete_${randomUUID()}`;
  const claimToken = randomUUID();
  const now = new Date();
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
       (id, "userId", kind, "dedupKey", payload, status, attempts,
        "claimGeneration", "claimToken", "processingStartedAt", "nextAttemptAt",
        "createdAt", "updatedAt")
     VALUES ($1, $2::varchar(191), 'LOCAL_ANONYMIZE',
             'account-delete:local:' || $2::text,
             '{}'::jsonb, 'PROCESSING', 1, 1, $3::uuid, $4, NULL, $4, $4)`,
    [sideEffectId, userId, claimToken, now],
  );
  return Object.freeze({ sideEffectId, expectedUserId: userId, claimGeneration: 1, claimToken });
}

async function beginProviderAttempt(database, actorId, claim) {
  const [result] = await runtimeQuery(
    database,
    actorId,
    `SELECT public.grainline_email_outbox_begin_provider_attempt(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [claim.jobId, claim.claimGeneration, claim.claimToken],
  );
  return result?.result;
}

async function assertProviderSkipped(database, claim) {
  const row = (await database.query(
    `SELECT status, "claimToken", "processingStartedAt", "lastError"
       FROM public."EmailOutbox"
      WHERE id = $1`,
    [claim.jobId],
  )).rows[0];
  assert.deepEqual(
    {
      status: row?.status,
      claimToken: row?.claimToken,
      processingStartedAt: row?.processingStartedAt,
      lastError: row?.lastError,
    },
    {
      status: "SKIPPED",
      claimToken: null,
      processingStartedAt: null,
      lastError: "Email source relationship became ineligible before provider attempt",
    },
  );
}

export async function seedSellerBroadcastPredecessorEligibilityGap({
  database,
  seller,
}) {
  const suffix = `broadcast_predecessor_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const followerId = `${suffix}_follower`;
  await createUser(database, followerId);
  await database.query(
    `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [randomUUID(), followerId, seller.sellerProfileId],
  );
  const broadcastId = randomUUID();
  await database.query(
    `INSERT INTO public."SellerBroadcast"
       (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES ($1, $2, 'Predecessor eligibility gap', pg_catalog.clock_timestamp(), 1)`,
    [broadcastId, seller.sellerProfileId],
  );
  const claim = await seedProviderClaim(database, {
    followerId,
    followerEmail: `${followerId}@example.test`,
    sourceType: "seller_broadcast",
    sourceId: broadcastId,
  });
  await database.query(
    `DELETE FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [followerId, seller.sellerProfileId],
  );
  const predecessorResult = (await database.query(
    `SELECT public.grainline_email_outbox_begin_provider_attempt(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [claim.jobId, claim.claimGeneration, claim.claimToken],
  )).rows[0]?.result;
  assert.equal(
    predecessorResult,
    "ready",
    "the predecessor must reproduce the queued-email eligibility gap",
  );
  return Object.freeze({ followerId, broadcastId, claim });
}

export async function proveSellerBroadcastEligibilityGapClosed({
  database,
  predecessor,
}) {
  const replayResult = (await database.query(
    `SELECT public.grainline_email_outbox_begin_provider_attempt(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [
      predecessor.claim.jobId,
      predecessor.claim.claimGeneration,
      predecessor.claim.claimToken,
    ],
  )).rows[0]?.result;
  assert.equal(
    replayResult,
    "ready",
    "an already-marked provider attempt must retain its ambiguous generation",
  );
  const completion = (await database.query(
    `SELECT public.grainline_email_outbox_complete(
       $1, $2::bigint, $3::uuid, $4
     ) AS result`,
    [
      predecessor.claim.jobId,
      predecessor.claim.claimGeneration,
      predecessor.claim.claimToken,
      `provider-${predecessor.claim.jobId}`,
    ],
  )).rows[0]?.result;
  assert.equal(completion, "applied");

  const freshClaim = await seedProviderClaim(database, {
    followerId: predecessor.followerId,
    followerEmail: `${predecessor.followerId}@example.test`,
    sourceType: "seller_broadcast",
    sourceId: predecessor.broadcastId,
  });
  const result = (await database.query(
    `SELECT public.grainline_email_outbox_begin_provider_attempt(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [freshClaim.jobId, freshClaim.claimGeneration, freshClaim.claimToken],
  )).rows[0]?.result;
  assert.equal(result, "ineligible");
  await assertProviderSkipped(database, freshClaim);
  return Object.freeze({
    predecessorReproduced: true,
    ambiguousGenerationPreserved: true,
    candidateClosed: true,
  });
}

async function proveConcurrentOwnerCreate({ connectionString, seller }) {
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ];
  await Promise.all(clients.map((client) => client.connect()));
  try {
    for (const client of clients) {
      await client.query("SET SESSION AUTHORIZATION grainline_app_runtime");
      await client.query(
        "SELECT pg_catalog.set_config('app.user_id', $1, false)",
        [seller.userId],
      );
    }
    const attempts = await Promise.all(clients.map((client, index) => client.query(
      `SELECT * FROM public.grainline_seller_broadcast_owner_create(
         $1, $2, NULL, 0
       )`,
      [randomUUID(), `Concurrent broadcast ${index}`],
    )));
    const results = attempts.flatMap((result) => result.rows);
    assert.equal(results.filter((row) => row.created === true).length, 1);
    assert.equal(results.filter((row) => row.created === false).length, 1);
  } finally {
    await Promise.all(clients.map(async (client) => {
      await client.query("RESET SESSION AUTHORIZATION").catch(() => {});
      await client.end().catch(() => {});
    }));
  }
}

async function waitForLockWait(database, pid, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await database.query(
      `SELECT activity.wait_event_type AS "waitEventType",
              activity.wait_event AS "waitEvent",
              pg_catalog.count(lock.*) FILTER (
                WHERE lock.locktype = 'advisory' AND lock.granted
              )::integer AS "grantedAdvisoryLocks"
         FROM pg_catalog.pg_stat_activity AS activity
         LEFT JOIN pg_catalog.pg_locks AS lock
           ON lock.pid = activity.pid
        WHERE activity.pid = $1
        GROUP BY activity.wait_event_type, activity.wait_event`,
      [pid],
    );
    if (result.rows[0]?.waitEventType === "Lock") {
      return Object.freeze({
        waitEvent: result.rows[0].waitEvent,
        grantedAdvisoryLocks: Number(result.rows[0].grantedAdvisoryLocks ?? 0),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label} never reached a database lock wait`);
}

async function seedDeletionProviderFixture({ database, seller, label }) {
  const followerId = `broadcast_${label}_${randomUUID()}`;
  await createUser(database, followerId);
  await database.query(
    `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [randomUUID(), followerId, seller.sellerProfileId],
  );
  const broadcastId = randomUUID();
  await database.query(
    `INSERT INTO public."SellerBroadcast"
       (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp(), 1)`,
    [broadcastId, seller.sellerProfileId, `Deletion ${label} lock-order proof`],
  );
  const claim = await seedProviderClaim(database, {
    followerId,
    followerEmail: `${followerId}@example.test`,
    sourceType: "seller_broadcast",
    sourceId: broadcastId,
  });
  return Object.freeze({ followerId, broadcastId, claim });
}

async function proveAccountDeletionProviderLockOrder({
  database,
  connectionString,
  seller,
  deletionClaim,
}) {
  const deletionFirst = await seedDeletionProviderFixture({
    database,
    seller,
    label: "deletion_first",
  });
  const deletionClient = new pg.Client({ connectionString });
  const providerClient = new pg.Client({ connectionString });
  await Promise.all([deletionClient.connect(), providerClient.connect()]);
  let deletionCommitted = false;
  let providerCommitted = false;
  try {
    await deletionClient.query("BEGIN");
    await deletionClient.query(
      "SET LOCAL statement_timeout = '8s'; SET LOCAL lock_timeout = '6s'; SET LOCAL deadlock_timeout = '100ms'",
    );
    await deletionClient.query("SET LOCAL ROLE grainline_app_runtime");
    await deletionClient.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [seller.userId],
    );
    const snapshot = await deletionClient.query(
      `SELECT "userId", email
         FROM public.grainline_user_account_deletion_snapshot(
           $1,$2::bigint,$3::uuid
         )`,
      [
        deletionClaim.sideEffectId,
        deletionClaim.claimGeneration,
        deletionClaim.claimToken,
      ],
    );
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0]?.userId, seller.userId);
    assert.match(snapshot.rows[0]?.email ?? "", /@example\.test$/u);

    await providerClient.query("BEGIN");
    await providerClient.query(
      "SET LOCAL statement_timeout = '8s'; SET LOCAL lock_timeout = '6s'; SET LOCAL deadlock_timeout = '100ms'",
    );
    await providerClient.query("SET LOCAL ROLE grainline_app_runtime");
    await providerClient.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [deletionFirst.followerId],
    );
    const providerPid = Number((await providerClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const providerAttempt = providerClient.query(
      `SELECT public.grainline_email_outbox_begin_provider_attempt(
         $1, $2::bigint, $3::uuid
       ) AS result`,
      [
        deletionFirst.claim.jobId,
        deletionFirst.claim.claimGeneration,
        deletionFirst.claim.claimToken,
      ],
    );
    const providerWait = await waitForLockWait(
      database,
      providerPid,
      "seller-broadcast provider attempt behind the deletion User lock",
    );

    let deletionError;
    try {
      await deletionClient.query(
        `SELECT public.grainline_email_outbox_account_deletion_fence(
           $1, ARRAY[$2]::text[]
         ) AS pending`,
        [seller.userId, snapshot.rows[0].email],
      );
      await deletionClient.query("COMMIT");
      deletionCommitted = true;
    } catch (error) {
      deletionError = error;
      await deletionClient.query("ROLLBACK").catch(() => {});
    }

    let providerError;
    let providerResult;
    try {
      providerResult = (await providerAttempt).rows[0]?.result;
      await providerClient.query("COMMIT");
      providerCommitted = true;
    } catch (error) {
      providerError = error;
      await providerClient.query("ROLLBACK").catch(() => {});
    }

    const deadlockError = [deletionError, providerError]
      .find((error) => error?.code === "40P01");
    assert.equal(
      deadlockError,
      undefined,
      "seller-broadcast provider start deadlocked with account deletion after "
        + `taking ${providerWait.grantedAdvisoryLocks} advisory locks before the User lock`,
    );
    if (deletionError) throw deletionError;
    if (providerError) throw providerError;
    assert.equal(deletionCommitted, true);
    assert.equal(providerCommitted, true);
    assert.equal(providerWait.grantedAdvisoryLocks, 0);
    assert.equal(providerResult, "ready");
  } finally {
    if (!deletionCommitted) await deletionClient.query("ROLLBACK").catch(() => {});
    if (!providerCommitted) await providerClient.query("ROLLBACK").catch(() => {});
    await Promise.all([
      deletionClient.end().catch(() => {}),
      providerClient.end().catch(() => {}),
    ]);
  }

  const providerFirst = await seedDeletionProviderFixture({
    database,
    seller,
    label: "provider_first",
  });
  const providerFirstClient = new pg.Client({ connectionString });
  const deletionSecondClient = new pg.Client({ connectionString });
  await Promise.all([providerFirstClient.connect(), deletionSecondClient.connect()]);
  try {
    await providerFirstClient.query("BEGIN");
    await providerFirstClient.query(
      "SET LOCAL statement_timeout = '8s'; SET LOCAL lock_timeout = '6s'; SET LOCAL deadlock_timeout = '100ms'",
    );
    await providerFirstClient.query("SET LOCAL ROLE grainline_app_runtime");
    await providerFirstClient.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [providerFirst.followerId],
    );
    assert.equal(
      (await providerFirstClient.query(
        `SELECT public.grainline_email_outbox_begin_provider_attempt(
           $1,$2::bigint,$3::uuid
         ) AS result`,
        [
          providerFirst.claim.jobId,
          providerFirst.claim.claimGeneration,
          providerFirst.claim.claimToken,
        ],
      )).rows[0]?.result,
      "ready",
    );

    await deletionSecondClient.query("BEGIN");
    await deletionSecondClient.query(
      "SET LOCAL statement_timeout = '8s'; SET LOCAL lock_timeout = '6s'; SET LOCAL deadlock_timeout = '100ms'",
    );
    await deletionSecondClient.query("SET LOCAL ROLE grainline_app_runtime");
    await deletionSecondClient.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [seller.userId],
    );
    const deletionPid = Number((await deletionSecondClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const deletionSnapshot = deletionSecondClient.query(
      `SELECT "userId", email
         FROM public.grainline_user_account_deletion_snapshot(
           $1,$2::bigint,$3::uuid
         )`,
      [
        deletionClaim.sideEffectId,
        deletionClaim.claimGeneration,
        deletionClaim.claimToken,
      ],
    );
    const deletionWait = await waitForLockWait(
      database,
      deletionPid,
      "account deletion behind seller-broadcast provider start",
    );
    assert.equal(deletionWait.grantedAdvisoryLocks, 0);

    await providerFirstClient.query("COMMIT");
    const snapshot = (await deletionSnapshot).rows[0];
    await deletionSecondClient.query(
      `SELECT public.grainline_email_outbox_account_deletion_fence(
         $1, ARRAY[$2]::text[]
       )`,
      [seller.userId, snapshot.email],
    );
    await deletionSecondClient.query("COMMIT");
  } catch (error) {
    await providerFirstClient.query("ROLLBACK").catch(() => {});
    await deletionSecondClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await Promise.all([
      providerFirstClient.end().catch(() => {}),
      deletionSecondClient.end().catch(() => {}),
    ]);
  }

  return Object.freeze({
    deletionFirst: true,
    providerFirst: true,
    noDeadlock: true,
  });
}

export async function proveSellerBroadcastPreparedAuthorities({
  database,
  connectionString,
}) {
  const suffix = `broadcast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const seller = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_seller`,
  });
  const otherSeller = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_other`,
  });
  const concurrencySeller = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_concurrent`,
  });
  const followerId = `${suffix}_follower`;
  const adminId = `${suffix}_admin`;
  await createUser(database, followerId);
  await createUser(database, adminId, "ADMIN");
  await database.query(
    `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [randomUUID(), followerId, seller.sellerProfileId],
  );

  const proposedId = randomUUID();
  const created = await runtimeQuery(
    database,
    seller.userId,
    `SELECT * FROM public.grainline_seller_broadcast_owner_create(
       $1, 'Prepared authority message', 'https://example.test/broadcast.jpg', 3
     )`,
    [proposedId],
  );
  assert.equal(created.length, 1);
  assert.equal(created[0]?.created, true);
  assert.equal(created[0]?.broadcastId, proposedId);

  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "stripeAccountVersion" = 'legacy'
      WHERE "sellerProfileId" = $1`,
    [otherSeller.sellerProfileId],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      otherSeller.userId,
      `SELECT * FROM public.grainline_seller_broadcast_owner_create(
         $1, 'Unsupported Stripe account', NULL, 0
       )`,
      [randomUUID()],
    ),
    (error) => error?.code === "42501",
    "a seller whose Stripe account version is unsupported must not create a hidden broadcast",
  );

  const cooldown = await runtimeQuery(
    database,
    seller.userId,
    "SELECT * FROM public.grainline_seller_broadcast_owner_cooldown()",
  );
  assert.equal(cooldown.length, 1);
  assert.ok(cooldown[0]?.lastSentAt instanceof Date);
  assert.ok(cooldown[0]?.nextAvailableAt instanceof Date);

  const refused = await runtimeQuery(
    database,
    seller.userId,
    `SELECT * FROM public.grainline_seller_broadcast_owner_create(
       $1, 'Too soon', NULL, 0
     )`,
    [randomUUID()],
  );
  assert.deepEqual(refused.map((row) => row.created), [false]);

  const [count] = await runtimeQuery(
    database,
    seller.userId,
    "SELECT public.grainline_seller_broadcast_owner_count()::integer AS count",
  );
  assert.equal(count?.count, 1);
  const ownerPage = await runtimeQuery(
    database,
    seller.userId,
    "SELECT * FROM public.grainline_seller_broadcast_owner_page(0, 10)",
  );
  assert.equal(ownerPage[0]?.id, proposedId);
  const ownerExport = await runtimeQuery(
    database,
    seller.userId,
    "SELECT * FROM public.grainline_seller_broadcast_owner_export()",
  );
  assert.equal(ownerExport.length, 1);
  assert.equal((await runtimeQuery(
    database,
    otherSeller.userId,
    "SELECT * FROM public.grainline_seller_broadcast_owner_export()",
  )).length, 0);

  const signedOutLatest = await runtimeQuery(
    database,
    null,
    "SELECT * FROM public.grainline_seller_broadcast_public_latest($1)",
    [seller.sellerProfileId],
  );
  assert.equal(signedOutLatest[0]?.message, "Prepared authority message");
  const followerLatest = await runtimeQuery(
    database,
    followerId,
    "SELECT * FROM public.grainline_seller_broadcast_public_latest($1)",
    [seller.sellerProfileId],
  );
  assert.equal(followerLatest.length, 1);

  const feed = await runtimeQuery(
    database,
    followerId,
    `SELECT * FROM public.grainline_seller_broadcast_actor_feed_page(
       $1::text[],
       (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC' - interval '90 days')::timestamp(3),
       NULL::timestamp(3), NULL::text, 'none'::text, 21
     )`,
    [[seller.sellerProfileId]],
  );
  assert.equal(feed[0]?.id, proposedId);

  const wideEmptyFeed = await runtimeQuery(
    database,
    followerId,
    `SELECT * FROM public.grainline_seller_broadcast_actor_feed_page(
       $1::text[],
       (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC' - interval '90 days')::timestamp(3),
       NULL::timestamp(3), NULL::text, 'none'::text, 21
     )`,
    [Array.from({ length: 101 }, (_, index) => `${suffix}_absent_${index}`)],
  );
  assert.deepEqual(
    wideEmptyFeed,
    [],
    "the 1,000-shop feed contract must not inherit the 100-id public-state helper cap",
  );

  const unfollowClaim = await seedProviderClaim(database, {
    followerId,
    followerEmail: `${followerId}@example.test`,
    sourceType: "seller_broadcast",
    sourceId: proposedId,
  });
  await database.query(
    `DELETE FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [followerId, seller.sellerProfileId],
  );
  assert.equal(
    await beginProviderAttempt(database, followerId, unfollowClaim),
    "ineligible",
  );
  await assertProviderSkipped(database, unfollowClaim);
  await database.query(
    `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [randomUUID(), followerId, seller.sellerProfileId],
  );

  const listingId = randomUUID();
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", status, "isPrivate",
        "createdAt", "updatedAt")
     VALUES ($1, $2, 'Relationship proof listing', 'Relationship proof listing',
             1200, 'ACTIVE', false,
             pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())`,
    [listingId, seller.sellerProfileId],
  );
  const blockedListingClaim = await seedProviderClaim(database, {
    followerId,
    followerEmail: `${followerId}@example.test`,
    sourceType: "followed_maker_new_listing",
    sourceId: listingId,
  });

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [randomUUID(), seller.userId, followerId],
  );
  assert.equal(
    await beginProviderAttempt(database, followerId, blockedListingClaim),
    "ineligible",
  );
  await assertProviderSkipped(database, blockedListingClaim);
  assert.equal((await runtimeQuery(
    database,
    followerId,
    "SELECT * FROM public.grainline_seller_broadcast_public_latest($1)",
    [seller.sellerProfileId],
  )).length, 0);
  assert.equal((await runtimeQuery(
    database,
    followerId,
    `SELECT * FROM public.grainline_seller_broadcast_actor_feed_page(
       $1::text[],
       (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC' - interval '90 days')::timestamp(3),
       NULL::timestamp(3), NULL::text, 'none'::text, 21
     )`,
    [[seller.sellerProfileId]],
  )).length, 0);
  await database.query(
    'DELETE FROM public."Block" WHERE "blockerId" = $1 AND "blockedId" = $2',
    [seller.userId, followerId],
  );

  const deliverySource = await runtimeQuery(
    database,
    seller.userId,
    "SELECT * FROM public.grainline_seller_broadcast_owner_delivery_source($1)",
    [proposedId],
  );
  assert.equal(deliverySource[0]?.sellerProfileId, seller.sellerProfileId);
  assert.equal((await runtimeQuery(
    database,
    otherSeller.userId,
    "SELECT * FROM public.grainline_seller_broadcast_owner_delivery_source($1)",
    [proposedId],
  )).length, 0);
  const [deliveryReduced] = await runtimeQuery(
    database,
    seller.userId,
    "SELECT public.grainline_seller_broadcast_owner_record_delivery($1, 2) AS updated",
    [proposedId],
  );
  assert.equal(deliveryReduced?.updated, true);
  const [deliveryInflated] = await runtimeQuery(
    database,
    seller.userId,
    "SELECT public.grainline_seller_broadcast_owner_record_delivery($1, 3) AS updated",
    [proposedId],
  );
  assert.equal(deliveryInflated?.updated, false);

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    const staffCount = rowsOf(await database.query(
      "SELECT public.grainline_seller_broadcast_staff_count($1, 'authority')::integer AS count",
      [adminId],
    ));
    assert.equal(staffCount[0]?.count, 1);
    const staffPage = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_broadcast_staff_page($1, '', 0, 25)",
      [adminId],
    ));
    assert.ok(staffPage.some((row) => row.id === proposedId));
    const deleted = rowsOf(await database.query(
      "SELECT public.grainline_seller_broadcast_staff_delete($1, $2) AS deleted",
      [adminId, proposedId],
    ));
    assert.equal(deleted[0]?.deleted, true);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
  assert.equal((await database.query(
    `SELECT id FROM public."SellerBroadcast" WHERE id = $1`,
    [proposedId],
  )).rows.length, 0);
  assert.equal((await database.query(
    `SELECT id FROM public."AdminAuditLog"
      WHERE action = 'DELETE_BROADCAST' AND "targetId" = $1`,
    [proposedId],
  )).rows.length, 1);

  const deletionId = randomUUID();
  const foreignId = randomUUID();
  await database.query(
    `INSERT INTO public."SellerBroadcast"
       (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES
       ($1, $2, 'Deletion owner', pg_catalog.clock_timestamp() - interval '8 days', 0),
       ($3, $4, 'Deletion foreign', pg_catalog.clock_timestamp() - interval '8 days', 0)`,
    [deletionId, seller.sellerProfileId, foreignId, otherSeller.sellerProfileId],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      seller.userId,
      `SELECT * FROM public.grainline_seller_broadcast_account_deletion_ids(
         $1,$2,1,$3::uuid
       )`,
      [`missing_${randomUUID()}`, seller.userId, randomUUID()],
    ),
    (error) => error?.code === "42501",
    "an owner without an active account-deletion claim must not lock broadcasts",
  );
  const deletionClaim = await seedAccountDeletionClaim(database, seller.userId);
  await assert.rejects(
    runtimeQuery(
      database,
      otherSeller.userId,
      `SELECT * FROM public.grainline_seller_broadcast_account_deletion_ids(
         $1,$2,1,$3::uuid
       )`,
      [deletionClaim.sideEffectId, seller.userId, deletionClaim.claimToken],
    ),
    (error) => error?.code === "42501",
    "another actor must not use the owner's account-deletion claim",
  );
  const deletionIds = await runtimeQuery(
    database,
    seller.userId,
    `SELECT * FROM public.grainline_seller_broadcast_account_deletion_ids(
       $1,$2,1,$3::uuid
     )`,
    [deletionClaim.sideEffectId, seller.userId, deletionClaim.claimToken],
  );
  assert.deepEqual(deletionIds.map((row) => row.id), [deletionId]);
  const [deletedCount] = await runtimeQuery(
    database,
    seller.userId,
    `SELECT public.grainline_seller_broadcast_account_deletion_cleanup(
       $1,$2,1,$3::uuid
     )::integer AS count`,
    [deletionClaim.sideEffectId, seller.userId, deletionClaim.claimToken],
  );
  assert.equal(deletedCount?.count, 1);
  assert.equal((await database.query(
    `SELECT id FROM public."SellerBroadcast" WHERE id = $1`,
    [foreignId],
  )).rows.length, 1);

  await proveConcurrentOwnerCreate({ connectionString, seller: concurrencySeller });
  await proveAccountDeletionProviderLockOrder({
    database,
    connectionString,
    seller,
    deletionClaim,
  });
  return Object.freeze({
    ownerCreateSerialized: true,
    unsupportedStripeAccountRejected: true,
    staffBoundaryProven: true,
    accountDeletionProviderLockOrderProven: true,
  });
}
