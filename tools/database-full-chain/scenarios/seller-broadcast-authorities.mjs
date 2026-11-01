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

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [randomUUID(), seller.userId, followerId],
  );
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
  const deletionIds = await runtimeQuery(
    database,
    seller.userId,
    "SELECT * FROM public.grainline_seller_broadcast_account_deletion_ids($1)",
    [seller.sellerProfileId],
  );
  assert.deepEqual(deletionIds.map((row) => row.id), [deletionId]);
  const [deletedCount] = await runtimeQuery(
    database,
    seller.userId,
    "SELECT public.grainline_seller_broadcast_account_deletion_cleanup($1)::integer AS count",
    [seller.sellerProfileId],
  );
  assert.equal(deletedCount?.count, 1);
  assert.equal((await database.query(
    `SELECT id FROM public."SellerBroadcast" WHERE id = $1`,
    [foreignId],
  )).rows.length, 1);

  await proveConcurrentOwnerCreate({ connectionString, seller: concurrencySeller });
  return Object.freeze({ ownerCreateSerialized: true, staffBoundaryProven: true });
}
