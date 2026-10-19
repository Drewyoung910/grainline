import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileBlockFollowCleanup({ database, seller }) {
  const targetUserId = `${seller.userId}_block_target`;
  const outsiderUserId = `${seller.userId}_block_outsider`;
  const targetSellerId = `${seller.sellerProfileId}_block_target`;
  const outsiderSellerId = `${seller.sellerProfileId}_block_outsider`;
  const now = new Date("2026-10-19T14:00:00.000Z");

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
      ($1, $2, $3, 'Block Target', $4, $4, $4, '2026-01-01', $4),
      ($5, $6, $7, 'Block Outsider', $4, $4, $4, '2026-01-01', $4)`,
    [
      targetUserId,
      `user_full_chain_${targetUserId}`.slice(0, 191),
      `${targetUserId}@example.test`,
      now,
      outsiderUserId,
      `user_full_chain_${outsiderUserId}`.slice(0, 191),
      `${outsiderUserId}@example.test`,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
      (id, "userId", "displayName", "displayNameNormalized")
     VALUES
      ($1, $2, 'Block Target Shop', 'block target shop'),
      ($3, $4, 'Block Outsider Shop', 'block outsider shop')`,
    [targetSellerId, targetUserId, outsiderSellerId, outsiderUserId],
  );
  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${seller.sellerProfileId}_block_relationship`, seller.userId, targetUserId, now],
  );
  await database.query(
    `INSERT INTO public."Follow"
      (id, "followerId", "sellerProfileId", "createdAt")
     VALUES
      ($1, $2, $3, $7),
      ($4, $5, $6, $7),
      ($8, $2, $9, $7),
      ($10, $11, $6, $7)`,
    [
      `${seller.sellerProfileId}_follows_target`,
      seller.userId,
      targetSellerId,
      `${targetSellerId}_follows_actor`,
      targetUserId,
      seller.sellerProfileId,
      now,
      `${seller.sellerProfileId}_follows_outsider`,
      outsiderSellerId,
      `${outsiderSellerId}_follows_actor`,
      outsiderUserId,
    ],
  );

  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [seller.userId],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT public.grainline_user_block_follow_cleanup($1) AS deleted_count`,
        [targetUserId],
      )).map((row) => Number(row.deleted_count)),
      [2],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT public.grainline_user_block_follow_cleanup($1) AS deleted_count`,
        [targetUserId],
      )).map((row) => Number(row.deleted_count)),
      [0],
    );
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }

  const remaining = rowsOf(await database.query(
    `SELECT id
       FROM public."Follow"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [[
      `${seller.sellerProfileId}_follows_target`,
      `${targetSellerId}_follows_actor`,
      `${seller.sellerProfileId}_follows_outsider`,
      `${outsiderSellerId}_follows_actor`,
    ]],
  ));
  assert.deepEqual(remaining, [
    { id: `${outsiderSellerId}_follows_actor` },
    { id: `${seller.sellerProfileId}_follows_outsider` },
  ].sort((left, right) => left.id.localeCompare(right.id)));
}
