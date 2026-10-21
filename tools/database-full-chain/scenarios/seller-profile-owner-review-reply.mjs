import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerReviewReply({ database, seller }) {
  const reviewerId = `${seller.userId}_review_reply_buyer`;
  const listingId = `${seller.sellerProfileId}_review_reply_listing`;
  const reviewId = `${seller.sellerProfileId}_review_reply_review`;
  const now = "2026-10-20 12:00:00";

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
       'public.grainline_seller_owner_review_reply(text,text,text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "v",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Review reply buyer', $4, $4, $4, '2026-01-01', $4)`,
    [
      reviewerId,
      `user_${reviewerId}`.slice(0, 191),
      `${reviewerId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "archivedAt",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'Review reply listing', 'Full-chain reply listing', 7500,
             'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Review"
      (id, "listingId", "reviewerId", "reviewerAccountActive", "ratingX2",
       verified, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, 10, true, $4, $4)`,
    [reviewId, listingId, reviewerId, now],
  );

  await database.query("SELECT set_config('app.user_id', $1, false)", [seller.userId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT public.grainline_seller_owner_review_reply($1,$2,$3) AS saved`,
      [reviewId, seller.sellerProfileId, "Full-chain seller reply"],
    )), [{ saved: true }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT public.grainline_seller_owner_review_reply($1,$2,$3) AS saved`,
      [reviewId, seller.sellerProfileId, "Overwrite"],
    )), [{ saved: false }]);
  } finally {
    await database.query("RESET ROLE");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT "sellerReply", "sellerReplyAt" IS NOT NULL AS "hasReplyAt",
            "updatedAt" = "sellerReplyAt" AS "timestampsMatch"
       FROM public."Review"
      WHERE id = $1`,
    [reviewId],
  )), [{
    sellerReply: "Full-chain seller reply",
    hasReplyAt: true,
    timestampsMatch: true,
  }]);

  await database.query("DELETE FROM public.\"Review\" WHERE id = $1", [reviewId]);
  await database.query("DELETE FROM public.\"Listing\" WHERE id = $1", [listingId]);
  await database.query("DELETE FROM public.\"User\" WHERE id = $1", [reviewerId]);
  await database.query("SELECT set_config('app.user_id', '', false)");
}
