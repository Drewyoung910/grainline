import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileParticipantConversationListingTarget({ database, seller }) {
  const actorId = `${seller.userId}_conversation_actor`;
  const unrelatedId = `${seller.userId}_conversation_unrelated`;
  const publicListingId = `${seller.sellerProfileId}_conversation_public`;
  const privateListingId = `${seller.sellerProfileId}_conversation_private`;
  const unrelatedPrivateListingId = `${seller.sellerProfileId}_conversation_other_private`;
  const hiddenListingId = `${seller.sellerProfileId}_conversation_hidden`;
  const blockId = `${actorId}_blocks_seller`;
  const now = "2026-10-21 12:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_participant_conversation_listing_target(text,text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Conversation actor', $7, $7, $7, '2026-01-01', $7),
       ($4, $5, $6, 'Conversation unrelated user', $7, $7, $7, '2026-01-01', $7)`,
    [
      actorId,
      `user_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 191),
      unrelatedId,
      `user_${unrelatedId}`.slice(0, 191),
      `${unrelatedId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
       "archivedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $5, 'Public conversation listing', 'Full-chain participant target',
        1000, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, NULL, $6, $6),
       ($2, $5, 'Private conversation listing', 'Full-chain participant target',
        1000, 'usd', 'ACTIVE', 'IN_STOCK', 1, true, $7, NULL, $6, $6),
       ($3, $5, 'Other private conversation listing', 'Full-chain participant target',
        1000, 'usd', 'ACTIVE', 'IN_STOCK', 1, true, $8, NULL, $6, $6),
       ($4, $5, 'Hidden conversation listing', 'Full-chain participant target',
        1000, 'usd', 'HIDDEN', 'IN_STOCK', 1, false, NULL, NULL, $6, $6)`,
    [
      publicListingId,
      privateListingId,
      unrelatedPrivateListingId,
      hiddenListingId,
      seller.sellerProfileId,
      now,
      actorId,
      unrelatedId,
    ],
  );

  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_participant_conversation_listing_target($1,$2)",
      [seller.userId, publicListingId],
    )), [{
      listingId: publicListingId,
      title: "Public conversation listing",
    }]);
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_participant_conversation_listing_target($1,$2)",
      [seller.userId, privateListingId],
    )), [{
      listingId: privateListingId,
      title: "Private conversation listing",
    }]);
    for (const unavailableId of [unrelatedPrivateListingId, hiddenListingId, "missing"]) {
      assert.deepEqual(rowsOf(await database.query(
        "SELECT * FROM public.grainline_seller_participant_conversation_listing_target($1,$2)",
        [seller.userId, unavailableId],
      )), []);
    }
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_participant_conversation_listing_target($1,'bad id')",
        [seller.userId],
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, actorId, seller.userId, now],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_participant_conversation_listing_target($1,$2)",
      [seller.userId, publicListingId],
    )), []);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SELECT set_config('app.user_id', '', false)");
  await database.query(`DELETE FROM public."Block" WHERE id = $1`, [blockId]);
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[publicListingId, privateListingId, unrelatedPrivateListingId, hiddenListingId]],
  );
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[actorId, unrelatedId]],
  );
}
