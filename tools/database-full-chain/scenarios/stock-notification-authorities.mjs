import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { seedSellerProfilePrivateFixture } from "./seller-profile-private-fixture.mjs";

export const STOCK_NOTIFICATION_PREPARATION_MIGRATION =
  "20261026010000_prepare_stock_notification_authorities";
export const STOCK_NOTIFICATION_RLS_MIGRATION =
  "20261027040000_activate_stock_notification_rls";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function setRuntimeActor(database, userId) {
  await database.query("SET ROLE grainline_app_runtime");
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [userId ?? ""],
  );
}

async function resetRuntimeActor(database) {
  await database.query("RESET ROLE");
  await database.query("RESET app.user_id");
}

async function runtimeQuery(database, userId, sql, params = []) {
  await setRuntimeActor(database, userId);
  try {
    return await database.query(sql, params);
  } finally {
    await resetRuntimeActor(database);
  }
}

async function insertSubscription(database, fixture, key, userId, listingId) {
  const id = fixture.subscriptions[key];
  await database.query(
    `INSERT INTO public."StockNotification" (id, "listingId", "userId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp() - interval '1 minute')`,
    [id, listingId, userId],
  );
  return id;
}

async function createRestockAudit(database, fixture, key, listingId, sellerUserId) {
  const auditId = fixture.audits[key];
  const title = `Stock authority ${key}`;
  await database.query(
    `UPDATE public."Listing"
        SET status = 'ACTIVE'::public."ListingStatus",
            "stockQuantity" = 5,
            "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [listingId],
  );
  await database.query(
    `INSERT INTO public."SystemAuditLog"
       (id, "actorType", "actorId", action, "targetType", "targetId", metadata, "createdAt")
     VALUES (
       $1,
       'user',
       $2,
       'MANUAL_LISTING_RESTOCKED',
       'LISTING',
       $3::text,
       pg_catalog.jsonb_build_object(
         'listingId', $3::text,
         'listingTitle', $4::text,
         'previousStatus', 'SOLD_OUT',
         'newStatus', 'ACTIVE',
         'newQuantity', '5',
         'mutationKind', 'absolute'
       ),
       pg_catalog.clock_timestamp()
     )`,
    [auditId, sellerUserId, listingId, title],
  );
  return auditId;
}

export async function seedStockNotificationPredecessorFixture({ database, seller }) {
  const suffix = `stock_notification_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const now = "2026-10-26 10:00:00";
  const alternateSeller = await seedSellerProfilePrivateFixture(database, {
    suffix: `${suffix}_alternate`,
  });
  const fixture = {
    seller,
    alternateSeller,
    subscriberA: `${suffix}_subscriber_a`,
    subscriberB: `${suffix}_subscriber_b`,
    admin: `${suffix}_admin`,
    listings: {
      owner: `${suffix}_owner_listing`,
      foreign: `${suffix}_foreign_listing`,
      predecessorBlocked: `${suffix}_predecessor_blocked_listing`,
      sellerCleanup: `${suffix}_seller_cleanup_listing`,
      adminCleanup: `${suffix}_admin_cleanup_listing`,
      blockCleanupOwner: `${suffix}_block_cleanup_owner_listing`,
      blockCleanupForeign: `${suffix}_block_cleanup_foreign_listing`,
      subscribeRaceA: `${suffix}_subscribe_race_a_listing`,
      subscribeRaceB: `${suffix}_subscribe_race_b_listing`,
      subscribeBanRace: `${suffix}_subscribe_ban_race_listing`,
      claimRaceA: `${suffix}_claim_race_a_listing`,
      claimRaceB: `${suffix}_claim_race_b_listing`,
      activation: `${suffix}_activation_listing`,
    },
    subscriptions: Object.fromEntries(
      [
        "predecessorBlocked",
        "sellerCleanup",
        "adminCleanup",
        "blockCleanupOwner",
        "blockCleanupForeign",
        "blockedClaim",
        "claimRaceA",
        "claimRaceB",
      ].map((key) => [key, randomUUID()]),
    ),
    audits: Object.fromEntries(
      ["predecessorBlocked", "owner", "blockedClaim", "claimRaceA", "claimRaceB"]
        .map((key) => [key, `${suffix}_audit_${key}`]),
    ),
    notifications: Object.fromEntries(
      ["predecessorBlocked", "owner", "blockedClaim", "claimRaceA", "claimRaceB"]
        .map((key) => [key, randomUUID()]),
    ),
    now,
  };

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Stock subscriber A', 'USER', false, $10, $10),
       ($4, $5, $6, 'Stock subscriber B', 'USER', false, $10, $10),
       ($7, $8, $9, 'Stock admin', 'ADMIN', false, $10, $10)`,
    [
      fixture.subscriberA,
      `clerk_${fixture.subscriberA}`,
      `${fixture.subscriberA}@example.test`,
      fixture.subscriberB,
      `clerk_${fixture.subscriberB}`,
      `${fixture.subscriberB}@example.test`,
      fixture.admin,
      `clerk_${fixture.admin}`,
      `${fixture.admin}@example.test`,
      now,
    ],
  );

  const listingRows = [
    [fixture.listings.owner, seller.sellerProfileId, "Owner sold out"],
    [fixture.listings.foreign, alternateSeller.sellerProfileId, "Foreign sold out"],
    [fixture.listings.predecessorBlocked, seller.sellerProfileId, "Predecessor blocked"],
    [fixture.listings.sellerCleanup, seller.sellerProfileId, "Seller cleanup"],
    [fixture.listings.adminCleanup, seller.sellerProfileId, "Admin cleanup"],
    [fixture.listings.blockCleanupOwner, seller.sellerProfileId, "Pair owner"],
    [fixture.listings.blockCleanupForeign, alternateSeller.sellerProfileId, "Pair foreign"],
    [fixture.listings.subscribeRaceA, seller.sellerProfileId, "Subscribe race A"],
    [fixture.listings.subscribeRaceB, seller.sellerProfileId, "Subscribe race B"],
    [fixture.listings.subscribeBanRace, seller.sellerProfileId, "Subscribe ban race"],
    [fixture.listings.claimRaceA, seller.sellerProfileId, "Claim race A"],
    [fixture.listings.claimRaceB, seller.sellerProfileId, "Claim race B"],
    [fixture.listings.activation, seller.sellerProfileId, "Activation boundary"],
  ];
  for (const [id, sellerProfileId, title] of listingRows) {
    await database.query(
      `INSERT INTO public."Listing"
         (id, "sellerId", title, description, "priceCents", currency, status,
          "listingType", "stockQuantity", "isPrivate", "sellerPubliclyOrderable",
          "createdAt", "updatedAt")
       VALUES (
         $1, $2, $3, 'StockNotification full-chain fixture', 2500, 'usd',
         'SOLD_OUT'::public."ListingStatus", 'IN_STOCK'::public."ListingType", 0,
         false, true, $4, $4
       )`,
      [id, sellerProfileId, title, now],
    );
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${suffix}_predecessor_block`, fixture.subscriberB, seller.userId, now],
  );
  await insertSubscription(
    database,
    fixture,
    "predecessorBlocked",
    fixture.subscriberB,
    fixture.listings.predecessorBlocked,
  );
  await createRestockAudit(
    database,
    fixture,
    "predecessorBlocked",
    fixture.listings.predecessorBlocked,
    seller.userId,
  );
  return Object.freeze(fixture);
}

export async function proveStockNotificationPredecessorBlockGap({ database, fixture }) {
  const result = rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT * FROM public.grainline_notification_claim_back_in_stock($1, $2, $3)`,
    [
      fixture.notifications.predecessorBlocked,
      fixture.audits.predecessorBlocked,
      fixture.subscriptions.predecessorBlocked,
    ],
  ));
  assert.deepEqual(result, [{
    claimed: true,
    user_id: fixture.subscriberB,
    notification_id: fixture.notifications.predecessorBlocked,
  }]);
  const notificationCount = Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."Notification"
      WHERE id = $1`,
    [fixture.notifications.predecessorBlocked],
  ))[0]?.count ?? -1);
  assert.equal(
    notificationCount,
    1,
    "preparation must reproduce the predecessor reciprocal-block alert gap",
  );
  return Object.freeze({ blockedNotificationCreated: true });
}

async function callSubscribe(database, actorId, listingId) {
  return rowsOf(await runtimeQuery(
    database,
    actorId,
    `SELECT * FROM public.grainline_stock_notification_owner_subscribe($1, $2)`,
    [randomUUID(), listingId],
  ));
}

async function callClaim(database, fixture, key, subscriptionId) {
  return rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT * FROM public.grainline_notification_claim_back_in_stock($1, $2, $3)`,
    [fixture.notifications[key], fixture.audits[key], subscriptionId],
  ));
}

async function beginRuntime(client, actorId, lockTimeout = null) {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  if (lockTimeout) await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
  await client.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, true)",
    [actorId ?? ""],
  );
}

async function proveSubscribeBlockSerialization({ connectionString, database, fixture }) {
  const subscribeFirst = new pg.Client({ connectionString });
  const blockSecond = new pg.Client({ connectionString });
  await Promise.all([subscribeFirst.connect(), blockSecond.connect()]);
  try {
    await beginRuntime(subscribeFirst, fixture.subscriberA);
    assert.deepEqual(
      (await subscribeFirst.query(
        `SELECT * FROM public.grainline_stock_notification_owner_subscribe($1, $2)`,
        [randomUUID(), fixture.listings.subscribeRaceA],
      )).rows,
      [{ resultStatus: "OK", subscribed: true }],
    );

    await beginRuntime(blockSecond, fixture.seller.userId, "250ms");
    await assert.rejects(
      blockSecond.query(
        `SELECT * FROM public.grainline_user_block_pair_lock($1)`,
        [fixture.subscriberA],
      ),
      (error) => error?.code === "55P03",
      "block creation must wait behind a concurrent subscription decision",
    );
    await blockSecond.query("ROLLBACK");
    await subscribeFirst.query("COMMIT");

    await beginRuntime(blockSecond, fixture.seller.userId);
    await blockSecond.query(
      `SELECT * FROM public.grainline_user_block_pair_lock($1)`,
      [fixture.subscriberA],
    );
    await blockSecond.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [`${fixture.listings.subscribeRaceA}_block`, fixture.seller.userId, fixture.subscriberA],
    );
    await blockSecond.query(
      `SELECT public.grainline_stock_notification_block_cleanup($1)`,
      [fixture.subscriberA],
    );
    await blockSecond.query("COMMIT");
    assert.equal(Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."StockNotification"
        WHERE "listingId" = $1`,
      [fixture.listings.subscribeRaceA],
    ))[0]?.count ?? -1), 0);

    await beginRuntime(blockSecond, fixture.seller.userId);
    await blockSecond.query(
      `SELECT * FROM public.grainline_user_block_pair_lock($1)`,
      [fixture.subscriberB],
    );
    await blockSecond.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [`${fixture.listings.subscribeRaceB}_block`, fixture.seller.userId, fixture.subscriberB],
    );

    await beginRuntime(subscribeFirst, fixture.subscriberB, "250ms");
    await assert.rejects(
      subscribeFirst.query(
        `SELECT * FROM public.grainline_stock_notification_owner_subscribe($1, $2)`,
        [randomUUID(), fixture.listings.subscribeRaceB],
      ),
      (error) => error?.code === "55P03",
      "subscription creation must wait behind a concurrent block decision",
    );
    await subscribeFirst.query("ROLLBACK");
    await blockSecond.query("COMMIT");
    assert.deepEqual(
      await callSubscribe(database, fixture.subscriberB, fixture.listings.subscribeRaceB),
      [{ resultStatus: "BLOCKED", subscribed: false }],
    );
  } finally {
    await subscribeFirst.query("ROLLBACK").catch(() => {});
    await blockSecond.query("ROLLBACK").catch(() => {});
    await Promise.all([subscribeFirst.end(), blockSecond.end()]);
  }
}

async function proveSubscribeBanSerialization({ connectionString, database, fixture }) {
  const banFirst = new pg.Client({ connectionString });
  const subscribeSecond = new pg.Client({ connectionString });
  await Promise.all([banFirst.connect(), subscribeSecond.connect()]);
  try {
    await banFirst.query("BEGIN");
    await banFirst.query(
      `UPDATE public."User"
          SET banned = true,
              "updatedAt" = pg_catalog.clock_timestamp()
        WHERE id = $1`,
      [fixture.subscriberA],
    );

    await beginRuntime(subscribeSecond, fixture.subscriberA, "2s");
    let subscribeSettled = false;
    const subscribeResult = assert.rejects(
      subscribeSecond.query(
        `SELECT * FROM public.grainline_stock_notification_owner_subscribe($1, $2)`,
        [randomUUID(), fixture.listings.subscribeBanRace],
      ),
      (error) => error?.code === "42501",
      "subscription must recheck actor activity after the user lock is acquired",
    ).finally(() => {
      subscribeSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      subscribeSettled,
      false,
      "subscription must wait behind a concurrent account ban",
    );

    await banFirst.query("COMMIT");
    await subscribeResult;
    await subscribeSecond.query("ROLLBACK");
    assert.equal(Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."StockNotification"
        WHERE "listingId" = $1`,
      [fixture.listings.subscribeBanRace],
    ))[0]?.count ?? -1), 0);
  } finally {
    await banFirst.query("ROLLBACK").catch(() => {});
    await subscribeSecond.query("ROLLBACK").catch(() => {});
    await Promise.all([banFirst.end(), subscribeSecond.end()]);
    await database.query(
      `UPDATE public."User"
          SET banned = false,
              "updatedAt" = pg_catalog.clock_timestamp()
        WHERE id = $1`,
      [fixture.subscriberA],
    );
  }
}

async function proveClaimBlockSerialization({ connectionString, database, fixture }) {
  const claimFirst = new pg.Client({ connectionString });
  const blockSecond = new pg.Client({ connectionString });
  await Promise.all([claimFirst.connect(), blockSecond.connect()]);
  try {
    await insertSubscription(
      database,
      fixture,
      "claimRaceA",
      fixture.subscriberA,
      fixture.listings.claimRaceA,
    );
    await createRestockAudit(
      database,
      fixture,
      "claimRaceA",
      fixture.listings.claimRaceA,
      fixture.seller.userId,
    );
    await beginRuntime(claimFirst, null);
    assert.deepEqual(
      (await claimFirst.query(
        `SELECT * FROM public.grainline_notification_claim_back_in_stock($1, $2, $3)`,
        [
          fixture.notifications.claimRaceA,
          fixture.audits.claimRaceA,
          fixture.subscriptions.claimRaceA,
        ],
      )).rows,
      [{
        claimed: true,
        user_id: fixture.subscriberA,
        notification_id: fixture.notifications.claimRaceA,
      }],
    );
    await beginRuntime(blockSecond, fixture.seller.userId, "250ms");
    await assert.rejects(
      blockSecond.query(
        `SELECT * FROM public.grainline_user_block_pair_lock($1)`,
        [fixture.subscriberA],
      ),
      (error) => error?.code === "55P03",
      "block creation must wait behind an admitted notification claim",
    );
    await blockSecond.query("ROLLBACK");
    await claimFirst.query("COMMIT");

    await insertSubscription(
      database,
      fixture,
      "claimRaceB",
      fixture.subscriberB,
      fixture.listings.claimRaceB,
    );
    await createRestockAudit(
      database,
      fixture,
      "claimRaceB",
      fixture.listings.claimRaceB,
      fixture.seller.userId,
    );
    await beginRuntime(blockSecond, fixture.seller.userId);
    await blockSecond.query(
      `SELECT * FROM public.grainline_user_block_pair_lock($1)`,
      [fixture.subscriberB],
    );
    await blockSecond.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [`${fixture.listings.claimRaceB}_block`, fixture.seller.userId, fixture.subscriberB],
    );
    await beginRuntime(claimFirst, null, "250ms");
    await assert.rejects(
      claimFirst.query(
        `SELECT * FROM public.grainline_notification_claim_back_in_stock($1, $2, $3)`,
        [
          fixture.notifications.claimRaceB,
          fixture.audits.claimRaceB,
          fixture.subscriptions.claimRaceB,
        ],
      ),
      (error) => error?.code === "55P03",
      "notification claim must wait behind a concurrent block decision",
    );
    await claimFirst.query("ROLLBACK");
    await blockSecond.query("COMMIT");
    assert.deepEqual(
      await callClaim(database, fixture, "claimRaceB", fixture.subscriptions.claimRaceB),
      [{ claimed: false, user_id: null, notification_id: null }],
    );
    assert.equal(Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."Notification"
        WHERE id = $1`,
      [fixture.notifications.claimRaceB],
    ))[0]?.count ?? -1), 0);
  } finally {
    await claimFirst.query("ROLLBACK").catch(() => {});
    await blockSecond.query("ROLLBACK").catch(() => {});
    await Promise.all([claimFirst.end(), blockSecond.end()]);
  }
}

export async function proveStockNotificationPreparedAuthorities({
  database,
  connectionString,
  fixture,
}) {
  await database.query(
    `DELETE FROM public."Block"
      WHERE "blockerId" = $1
        AND "blockedId" = $2`,
    [fixture.subscriberB, fixture.seller.userId],
  );
  assert.deepEqual(
    await callSubscribe(database, fixture.subscriberA, fixture.listings.owner),
    [{ resultStatus: "OK", subscribed: true }],
  );
  assert.deepEqual(
    await callSubscribe(database, fixture.subscriberA, fixture.listings.owner),
    [{ resultStatus: "OK", subscribed: true }],
    "duplicate subscription must be idempotent",
  );
  assert.deepEqual(
    await callSubscribe(database, fixture.seller.userId, fixture.listings.owner),
    [{ resultStatus: "SELF", subscribed: false }],
  );
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [`${fixture.listings.owner}_blocked_check`, fixture.subscriberB, fixture.seller.userId],
  );
  assert.deepEqual(
    await callSubscribe(database, fixture.subscriberB, fixture.listings.owner),
    [{ resultStatus: "BLOCKED", subscribed: false }],
  );
  assert.deepEqual(
    await callSubscribe(database, fixture.subscriberA, fixture.listings.predecessorBlocked),
    [{ resultStatus: "UNAVAILABLE", subscribed: false }],
  );

  const sellerCounts = rowsOf(await runtimeQuery(
    database,
    fixture.seller.userId,
    `SELECT * FROM public.grainline_stock_notification_seller_counts($1::text[])`,
    [[fixture.listings.owner, fixture.listings.foreign]],
  ));
  assert.deepEqual(sellerCounts, [{ listingId: fixture.listings.owner, value: "1" }]);
  const rangeCount = rowsOf(await runtimeQuery(
    database,
    fixture.seller.userId,
    `SELECT public.grainline_stock_notification_seller_range_count(
       '2026-01-01'::timestamp, '2027-01-01'::timestamp, true
     ) AS value`,
  ));
  assert.deepEqual(rangeCount, [{ value: "1" }]);

  const exported = rowsOf(await runtimeQuery(
    database,
    fixture.subscriberA,
    `SELECT "listingId", title, status
       FROM public.grainline_stock_notification_owner_export()`,
  ));
  assert.deepEqual(exported, [{
    listingId: fixture.listings.owner,
    title: "Owner sold out",
    status: "SOLD_OUT",
  }]);

  await createRestockAudit(
    database,
    fixture,
    "owner",
    fixture.listings.owner,
    fixture.seller.userId,
  );
  const candidate = rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT * FROM public.grainline_stock_notification_restock_candidates($1, 100)`,
    [fixture.audits.owner],
  ));
  assert.equal(candidate.length, 1);
  assert.equal(typeof candidate[0]?.stockNotificationId, "string");
  assert.equal(Object.hasOwn(candidate[0] ?? {}, "userId"), false);
  const ownerClaim = await callClaim(
    database,
    fixture,
    "owner",
    candidate[0].stockNotificationId,
  );
  assert.deepEqual(ownerClaim, [{
    claimed: true,
    user_id: fixture.subscriberA,
    notification_id: fixture.notifications.owner,
  }]);

  await insertSubscription(
    database,
    fixture,
    "blockedClaim",
    fixture.subscriberB,
    fixture.listings.owner,
  );
  fixture.audits.blockedClaim = fixture.audits.owner;
  assert.deepEqual(
    await callClaim(database, fixture, "blockedClaim", fixture.subscriptions.blockedClaim),
    [{ claimed: false, user_id: null, notification_id: null }],
  );
  await database.query(
    `DELETE FROM public."Block"
      WHERE "blockerId" = $1
        AND "blockedId" = $2`,
    [fixture.subscriberB, fixture.seller.userId],
  );

  await insertSubscription(
    database,
    fixture,
    "sellerCleanup",
    fixture.subscriberA,
    fixture.listings.sellerCleanup,
  );
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.alternateSeller.userId,
      `SELECT public.grainline_stock_notification_seller_listing_cleanup($1)`,
      [fixture.listings.sellerCleanup],
    ),
    (error) => error?.code === "42501",
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.seller.userId,
    `SELECT public.grainline_stock_notification_seller_listing_cleanup($1) AS value`,
    [fixture.listings.sellerCleanup],
  )), [{ value: "1" }]);

  await insertSubscription(
    database,
    fixture,
    "adminCleanup",
    fixture.subscriberA,
    fixture.listings.adminCleanup,
  );
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.subscriberA,
      `SELECT public.grainline_stock_notification_admin_listing_cleanup($1)`,
      [fixture.listings.adminCleanup],
    ),
    (error) => error?.code === "42501",
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.admin,
    `SELECT public.grainline_stock_notification_admin_listing_cleanup($1) AS value`,
    [fixture.listings.adminCleanup],
  )), [{ value: "1" }]);

  await insertSubscription(
    database,
    fixture,
    "blockCleanupOwner",
    fixture.seller.userId,
    fixture.listings.blockCleanupForeign,
  );
  await insertSubscription(
    database,
    fixture,
    "blockCleanupForeign",
    fixture.alternateSeller.userId,
    fixture.listings.blockCleanupOwner,
  );
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [
      `${fixture.listings.blockCleanupOwner}_block`,
      fixture.seller.userId,
      fixture.alternateSeller.userId,
    ],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.seller.userId,
    `SELECT public.grainline_stock_notification_block_cleanup($1) AS value`,
    [fixture.alternateSeller.userId],
  )), [{ value: "2" }]);

  await proveClaimBlockSerialization({ connectionString, database, fixture });
  await database.query(
    `DELETE FROM public."Block"
      WHERE ("blockerId" = $1 AND "blockedId" IN ($2, $3))
         OR ("blockedId" = $1 AND "blockerId" IN ($2, $3))`,
    [fixture.seller.userId, fixture.subscriberA, fixture.subscriberB],
  );
  await proveSubscribeBlockSerialization({ connectionString, database, fixture });
  await proveSubscribeBanSerialization({ connectionString, database, fixture });
}

export async function proveStockNotificationRlsAuthorities({ database, fixture }) {
  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'DELETE'
           ) AS runtime_delete,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'StockNotification'
       AND class.relkind = 'r'
  `))[0];
  assert.deepEqual(posture, {
    rls_enabled: true,
    rls_forced: true,
    runtime_select: true,
    runtime_insert: false,
    runtime_update: false,
    runtime_delete: true,
    policy_count: 2,
  });

  await database.query(
    `DELETE FROM public."Block"
      WHERE ("blockerId" = $1 AND "blockedId" IN ($2, $3))
         OR ("blockedId" = $1 AND "blockerId" IN ($2, $3))`,
    [fixture.seller.userId, fixture.subscriberA, fixture.subscriberB],
  );
  assert.deepEqual(
    await callSubscribe(database, fixture.subscriberA, fixture.listings.activation),
    [{ resultStatus: "OK", subscribed: true }],
    "SECURITY DEFINER subscribe must remain usable without direct INSERT",
  );

  const ownerRows = rowsOf(await runtimeQuery(
    database,
    fixture.subscriberA,
    `SELECT "userId", "listingId"
       FROM public."StockNotification"
      WHERE "listingId" = $1`,
    [fixture.listings.activation],
  ));
  assert.deepEqual(ownerRows, [{
    userId: fixture.subscriberA,
    listingId: fixture.listings.activation,
  }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberB,
    `SELECT "userId", "listingId"
       FROM public."StockNotification"
      WHERE "listingId" = $1`,
    [fixture.listings.activation],
  )), [], "another subscriber must not read the owner's row");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    null,
    `SELECT "userId", "listingId"
       FROM public."StockNotification"
      WHERE "listingId" = $1`,
    [fixture.listings.activation],
  )), [], "a missing actor context must reveal no rows");

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberB,
    `DELETE FROM public."StockNotification"
      WHERE "listingId" = $1
      RETURNING id`,
    [fixture.listings.activation],
  )), [], "another subscriber must not delete the owner's row");
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.subscriberB,
      `INSERT INTO public."StockNotification"
         (id, "listingId", "userId", "createdAt")
       VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
      [randomUUID(), fixture.listings.activation, fixture.subscriberB],
    ),
    (error) => error?.code === "42501",
    "runtime must not bypass the fixed subscribe authority with direct INSERT",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      fixture.subscriberA,
      `UPDATE public."StockNotification"
          SET "createdAt" = pg_catalog.clock_timestamp()
        WHERE "listingId" = $1`,
      [fixture.listings.activation],
    ),
    (error) => error?.code === "42501",
    "StockNotification has no direct UPDATE contract",
  );

  assert.deepEqual(
    await callSubscribe(database, fixture.subscriberB, fixture.listings.activation),
    [{ resultStatus: "OK", subscribed: true }],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberA,
    `DELETE FROM public."StockNotification"
      WHERE "listingId" = $1
      RETURNING "userId"`,
    [fixture.listings.activation],
  )), [{ userId: fixture.subscriberA }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberB,
    `DELETE FROM public."StockNotification"
      WHERE "listingId" = $1
      RETURNING "userId"`,
    [fixture.listings.activation],
  )), [{ userId: fixture.subscriberB }]);

  const cascadeUser = `${fixture.listings.activation}_cascade_user`;
  const cascadeListing = `${fixture.listings.activation}_cascade_listing`;
  const now = "2026-10-27 12:00:00";
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Stock cascade user', 'USER', false, $4, $4)`,
    [cascadeUser, `clerk_${cascadeUser}`, `${cascadeUser}@example.test`, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "isPrivate", "sellerPubliclyOrderable",
        "createdAt", "updatedAt")
     VALUES (
       $1, $2, 'Stock cascade listing', 'RLS cascade proof', 2500, 'usd',
       'SOLD_OUT'::public."ListingStatus", 'IN_STOCK'::public."ListingType", 0,
       false, true, $3, $3
     )`,
    [cascadeListing, fixture.seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."StockNotification" (id, "listingId", "userId", "createdAt")
     VALUES
       ($1, $2, $3, $5),
       ($4, $6, $7, $5)`,
    [
      randomUUID(), fixture.listings.activation, cascadeUser,
      randomUUID(), now, cascadeListing, fixture.subscriberA,
    ],
  );
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [cascadeUser]);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."StockNotification"
      WHERE "userId" = $1`,
    [cascadeUser],
  ))[0]?.count ?? -1), 0, "User deletion must cascade under FORCE");
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [cascadeListing]);
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."StockNotification"
      WHERE "listingId" = $1`,
    [cascadeListing],
  ))[0]?.count ?? -1), 0, "Listing deletion must cascade under FORCE");
}

export async function proveStockNotificationRlsRollback({ database, fixture }) {
  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'DELETE'
           ) AS runtime_delete,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'StockNotification'
       AND class.relkind = 'r'
  `))[0];
  assert.deepEqual(posture, {
    rls_enabled: false,
    rls_forced: false,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    policy_count: 0,
  });

  const subscriptionId = randomUUID();
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberB,
    `INSERT INTO public."StockNotification"
       (id, "listingId", "userId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())
     RETURNING id, "userId"`,
    [subscriptionId, fixture.listings.activation, fixture.subscriberA],
  )), [{ id: subscriptionId, userId: fixture.subscriberA }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberB,
    `UPDATE public."StockNotification"
        SET "createdAt" = "createdAt" + interval '1 second'
      WHERE id = $1
      RETURNING id`,
    [subscriptionId],
  )), [{ id: subscriptionId }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberB,
    `SELECT id, "userId"
       FROM public."StockNotification"
      WHERE id = $1`,
    [subscriptionId],
  )), [{ id: subscriptionId, userId: fixture.subscriberA }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    fixture.subscriberB,
    `DELETE FROM public."StockNotification"
      WHERE id = $1
      RETURNING id`,
    [subscriptionId],
  )), [{ id: subscriptionId }]);
}
