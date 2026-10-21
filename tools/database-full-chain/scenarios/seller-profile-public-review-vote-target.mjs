import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicReviewVoteTarget({ database, seller }) {
  const actorId = `${seller.userId}_review_vote_actor`;
  const reviewerId = `${seller.userId}_review_vote_reviewer`;
  const publicListingId = `${seller.sellerProfileId}_review_vote_public`;
  const privateListingId = `${seller.sellerProfileId}_review_vote_private`;
  const hiddenListingId = `${seller.sellerProfileId}_review_vote_hidden`;
  const publicReviewId = `${seller.sellerProfileId}_review_vote_public_review`;
  const privateReviewId = `${seller.sellerProfileId}_review_vote_private_review`;
  const hiddenReviewId = `${seller.sellerProfileId}_review_vote_hidden_review`;
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
       'public.grainline_seller_public_review_vote_target(text)'
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
       ($1, $2, $3, 'Review vote actor', $7, $7, $7, '2026-01-01', $7),
       ($4, $5, $6, 'Review vote reviewer', $7, $7, $7, '2026-01-01', $7)`,
    [
      actorId,
      `user_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 191),
      reviewerId,
      `user_${reviewerId}`.slice(0, 191),
      `${reviewerId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
       "archivedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $4, 'Public review vote', 'Full-chain review vote target', 1000,
        'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, NULL, $5, $5),
       ($2, $4, 'Private review vote', 'Full-chain review vote target', 1000,
        'usd', 'ACTIVE', 'IN_STOCK', 1, true, $6, NULL, $5, $5),
       ($3, $4, 'Hidden review vote', 'Full-chain review vote target', 1000,
        'usd', 'HIDDEN', 'IN_STOCK', 1, false, NULL, NULL, $5, $5)`,
    [
      publicListingId,
      privateListingId,
      hiddenListingId,
      seller.sellerProfileId,
      now,
      actorId,
    ],
  );
  await database.query(
    `INSERT INTO public."Review"
      (id, "listingId", "reviewerId", "reviewerAccountActive", "ratingX2",
       verified, "helpfulCount", "createdAt", "updatedAt")
     VALUES
       ($1, $4, $7, true, 10, true, 4, $8, $8),
       ($2, $5, $7, true, 8, true, 2, $8, $8),
       ($3, $6, $7, true, 6, true, 1, $8, $8)`,
    [
      publicReviewId,
      privateReviewId,
      hiddenReviewId,
      publicListingId,
      privateListingId,
      hiddenListingId,
      reviewerId,
      now,
    ],
  );

  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_review_vote_target($1)",
      [publicReviewId],
    )), [{
      reviewId: publicReviewId,
      reviewerId,
      helpfulCount: 4,
      listingId: publicListingId,
      sellerUserId: seller.userId,
    }]);
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_review_vote_target($1)",
      [privateReviewId],
    )), [{
      reviewId: privateReviewId,
      reviewerId,
      helpfulCount: 2,
      listingId: privateListingId,
      sellerUserId: seller.userId,
    }]);
    for (const unavailableId of [hiddenReviewId, "missing"]) {
      assert.deepEqual(rowsOf(await database.query(
        "SELECT * FROM public.grainline_seller_public_review_vote_target($1)",
        [unavailableId],
      )), []);
    }
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_review_vote_target('bad id')",
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SELECT set_config('app.user_id', $1, false)", [seller.userId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_review_vote_target($1)",
      [hiddenReviewId],
    )), [{
      reviewId: hiddenReviewId,
      reviewerId,
      helpfulCount: 1,
      listingId: hiddenListingId,
      sellerUserId: seller.userId,
    }]);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SELECT set_config('app.user_id', '', false)");
  await database.query(
    `DELETE FROM public."Review" WHERE id = ANY($1::text[])`,
    [[publicReviewId, privateReviewId, hiddenReviewId]],
  );
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[publicListingId, privateListingId, hiddenListingId]],
  );
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[actorId, reviewerId]],
  );
}
