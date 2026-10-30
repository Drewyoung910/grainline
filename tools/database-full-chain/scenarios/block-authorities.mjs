import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const BLOCK_PREPARATION_MIGRATION =
  "20261028050000_prepare_block_authorities";

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
    return rowsOf(result);
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function proveBlockPreparedAuthorities({ database }) {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = `block_actor_${suffix}`;
  const targetId = `block_target_${suffix}`;
  const outsiderId = `block_outsider_${suffix}`;
  const actorSellerId = `block_actor_seller_${suffix}`;
  const targetSellerId = `block_target_seller_${suffix}`;
  const actorListingId = `block_actor_listing_${suffix}`;
  const targetListingId = `block_target_listing_${suffix}`;
  const now = "2026-10-28 05:00:00";

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Block actor', 'USER', false, $10, $10),
       ($4, $5, $6, 'Block target', 'USER', false, $10, $10),
       ($7, $8, $9, 'Block outsider', 'USER', false, $10, $10)`,
    [
      actorId,
      `clerk_${actorId}`,
      `${actorId}@example.test`,
      targetId,
      `clerk_${targetId}`,
      `${targetId}@example.test`,
      outsiderId,
      `clerk_${outsiderId}`,
      `${outsiderId}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
       (id, "userId", "displayName", "displayNameNormalized", "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'Block actor shop', 'block actor shop', $5, $5),
       ($3, $4, 'Block target shop', 'block target shop', $5, $5)`,
    [actorSellerId, actorId, targetSellerId, targetId, now],
  );
  for (const [id, sellerId, title] of [
    [actorListingId, actorSellerId, "Block actor listing"],
    [targetListingId, targetSellerId, "Block target listing"],
  ]) {
    await database.query(
      `INSERT INTO public."Listing"
         (id, "sellerId", title, description, "priceCents", currency, status,
          "listingType", "stockQuantity", "isPrivate", "sellerPubliclyOrderable",
          "createdAt", "updatedAt")
       VALUES (
         $1, $2, $3, 'Block authority full-chain fixture', 2500, 'usd',
         'SOLD_OUT'::public."ListingStatus", 'IN_STOCK'::public."ListingType", 0,
         false, true, $4, $4
       )`,
      [id, sellerId, title, now],
    );
  }

  await database.query(
    `INSERT INTO public."Follow"
       (id, "followerId", "sellerProfileId", "createdAt")
     VALUES
       ($1, $2, $3, $7),
       ($4, $5, $6, $7)`,
    [
      randomUUID(), actorId, targetSellerId,
      randomUUID(), targetId, actorSellerId,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."StockNotification"
       (id, "listingId", "userId", "createdAt")
     VALUES
       ($1, $2, $3, $7),
       ($4, $5, $6, $7)`,
    [
      randomUUID(), targetListingId, actorId,
      randomUUID(), actorListingId, targetId,
      now,
    ],
  );

  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_create($1) AS created",
      [targetId],
    ),
    [{ created: true }],
  );
  assert.deepEqual(
    await database.query(
      `SELECT
         (SELECT pg_catalog.count(*)::integer FROM public."Block"
           WHERE "blockerId" = $1 AND "blockedId" = $2) AS blocks,
         (SELECT pg_catalog.count(*)::integer FROM public."Follow"
           WHERE ("followerId" = $1 AND "sellerProfileId" = $3)
              OR ("followerId" = $2 AND "sellerProfileId" = $4)) AS follows,
         (SELECT pg_catalog.count(*)::integer FROM public."StockNotification"
           WHERE ("userId" = $1 AND "listingId" = $5)
              OR ("userId" = $2 AND "listingId" = $6)) AS subscriptions`,
      [
        actorId,
        targetId,
        targetSellerId,
        actorSellerId,
        targetListingId,
        actorListingId,
      ],
    ).then((result) => result.rows),
    [{ blocks: 1, follows: 0, subscriptions: 0 }],
    "Block creation and both reciprocal cleanup families must commit together",
  );

  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_create($1) AS created",
      [targetId],
    ),
    [{ created: true }],
    "repeating a block must be idempotent",
  );
  assert.equal(Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."Block"
      WHERE "blockerId" = $1 AND "blockedId" = $2`,
    [actorId, targetId],
  ))[0]?.count ?? -1), 1);

  for (const [actor, target, expected] of [
    [actorId, targetId, true],
    [targetId, actorId, true],
    [outsiderId, actorId, false],
  ]) {
    assert.deepEqual(
      await runtimeQuery(
        database,
        actor,
        "SELECT public.grainline_user_block_pair_is_blocked($1) AS blocked",
        [target],
      ),
      [{ blocked: expected }],
    );
  }

  const actorExport = await runtimeQuery(
    database,
    actorId,
    `SELECT "blockerId", "blockedId"
       FROM public.grainline_user_block_export()`,
  );
  const targetExport = await runtimeQuery(
    database,
    targetId,
    `SELECT "blockerId", "blockedId"
       FROM public.grainline_user_block_export()`,
  );
  assert.deepEqual(actorExport, [{ blockerId: actorId, blockedId: targetId }]);
  assert.deepEqual(targetExport, actorExport, "both participants export the relationship");

  assert.deepEqual(
    await runtimeQuery(
      database,
      targetId,
      "SELECT public.grainline_user_block_remove($1) AS deleted_count",
      [actorId],
    ),
    [{ deleted_count: 0 }],
    "the blocked user cannot remove the other user's block",
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_remove($1) AS deleted_count",
      [targetId],
    ),
    [{ deleted_count: 1 }],
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_remove($1) AS deleted_count",
      [targetId],
    ),
    [{ deleted_count: 0 }],
    "repeating an unblock must be idempotent",
  );

  await runtimeQuery(
    database,
    targetId,
    "SELECT public.grainline_user_block_create($1)",
    [actorId],
  );
  await runtimeQuery(
    database,
    actorId,
    "SELECT public.grainline_user_block_create($1)",
    [outsiderId],
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_delete_owned() AS deleted_count",
    ),
    [{ deleted_count: 1 }],
    "account deletion removes only the actor's outgoing relationships",
  );
  assert.deepEqual(
    rowsOf(await database.query(
      `SELECT "blockerId", "blockedId"
         FROM public."Block"
        WHERE "blockerId" = ANY($1::text[])
           OR "blockedId" = ANY($1::text[])
        ORDER BY "blockerId", "blockedId"`,
      [[actorId, targetId, outsiderId]],
    )),
    [{ blockerId: targetId, blockedId: actorId }],
  );

  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_create($1)",
      [actorId],
    ),
    (error) => error?.code === "22023",
    "an actor cannot block themselves",
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_create($1) AS created",
      [`${actorId}_missing`],
    ),
    [{ created: false }],
    "a missing target must not create a block",
  );

  await database.query(
    `UPDATE public."User"
        SET banned = true, "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [targetId],
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_create($1) AS created",
      [targetId],
    ),
    [{ created: true }],
    "an active actor may preserve safety by blocking a suspended target",
  );
  await runtimeQuery(
    database,
    actorId,
    "SELECT public.grainline_user_block_remove($1)",
    [targetId],
  );

  await database.query(
    `UPDATE public."User"
        SET "deletedAt" = pg_catalog.clock_timestamp(),
            "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [outsiderId],
  );
  assert.deepEqual(
    await runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_create($1) AS created",
      [outsiderId],
    ),
    [{ created: false }],
    "a deleted target must not create a block",
  );

  await assert.rejects(
    runtimeQuery(
      database,
      null,
      "SELECT public.grainline_user_block_pair_is_blocked($1)",
      [actorId],
    ),
    (error) => error?.code === "42501",
    "the fixed read authority must reject a missing actor",
  );
  await database.query(
    `UPDATE public."User" SET banned = true, "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [actorId],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      "SELECT public.grainline_user_block_create($1)",
      [targetId],
    ),
    (error) => error?.code === "42501",
    "a banned actor cannot create a new block",
  );

  const posture = rowsOf(await database.query(`
    SELECT relation.relrowsecurity,
           relation.relforcerowsecurity,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'DELETE'
           ) AS runtime_delete
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."Block"'::pg_catalog.regclass
  `));
  assert.deepEqual(posture, [{
    relrowsecurity: false,
    relforcerowsecurity: false,
    runtime_select: true,
    runtime_insert: true,
    runtime_delete: true,
  }], "compatible preparation must preserve predecessor access");
}
