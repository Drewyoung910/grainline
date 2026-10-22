import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicVisibilityMirrors({ database, seller }) {
  const listingId = `zz_visibility_${seller.sellerProfileId}`.slice(0, 191);
  const postId = `zz_visibility_post_${seller.sellerProfileId}`.slice(0, 191);
  const slug = `visibility-${seller.sellerProfileId}`.slice(0, 255);
  const now = "2026-10-22 17:00:00";

  const priorSeller = rowsOf(await database.query(
    `SELECT "displayName",
            "displayNameNormalized",
            "vacationMode"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ))[0];
  assert.ok(priorSeller);

  const priorRating = rowsOf(await database.query(
    `SELECT "averageRating", "reviewCount"
       FROM public."SellerRatingSummary"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ))[0] ?? null;

  const catalog = rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
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
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure(
         'public.grainline_listing_seller_public_state_bind()'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_blog_post_author_public_state_bind()'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_public_blog_state_sync()'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_rating_listing_state_sync()'
       )
     )
     ORDER BY routine.proname
  `));
  assert.equal(catalog.length, 4);
  assert.equal(catalog.every((row) =>
    row.securityDefiner
    && JSON.stringify(row.config) === JSON.stringify(["search_path=pg_catalog"])
    && !row.runtimeExecute
    && !row.publicExecute), true);

  await database.query(
    `INSERT INTO public."SellerRatingSummary"
      ("sellerProfileId", "averageRating", "reviewCount", "updatedAt")
     VALUES ($1, 4.5, 8, $2)
     ON CONFLICT ("sellerProfileId") DO UPDATE
       SET "averageRating" = EXCLUDED."averageRating",
           "reviewCount" = EXCLUDED."reviewCount",
           "updatedAt" = EXCLUDED."updatedAt"`,
    [seller.sellerProfileId, now],
  );

  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "archivedAt",
       "sellerPubliclyOrderable", "sellerDisplayName",
       "sellerDisplayNameNormalized", "sellerAverageRating", "sellerReviewCount",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'Visibility mirror', 'Full-chain visibility mirror proof',
             5400, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL,
             false, 'Forged', 'forged', 1, 1, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."BlogPost"
      (id, slug, title, body, "authorId", "authorType", "sellerProfileId", status,
       "authorSellerPubliclyOrderable", "publishedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Visibility mirror post', 'Full-chain visibility mirror proof',
             $3, 'MAKER', $4, 'PUBLISHED', false, $5, $5, $5)`,
    [postId, slug, seller.userId, seller.sellerProfileId, now],
  );

  assert.deepEqual(rowsOf(await database.query(
    `SELECT "sellerPubliclyOrderable" AS orderable,
            "sellerDisplayName" AS name,
            "sellerDisplayNameNormalized" AS normalized,
            "sellerAverageRating" AS rating,
            "sellerReviewCount" AS reviews
       FROM public."Listing"
      WHERE id = $1`,
    [listingId],
  )), [{
    orderable: true,
    name: priorSeller.displayName,
    normalized: priorSeller.displayNameNormalized,
    rating: 4.5,
    reviews: 8,
  }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "authorSellerPubliclyOrderable" AS orderable
       FROM public."BlogPost"
      WHERE id = $1`,
    [postId],
  )), [{ orderable: true }]);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await database.query(
      `UPDATE public."Listing"
          SET "sellerPubliclyOrderable" = false,
              "sellerDisplayName" = 'Forged',
              "sellerAverageRating" = 1,
              "sellerReviewCount" = 1
        WHERE id = $1`,
      [listingId],
    );
    await database.query(
      `UPDATE public."BlogPost"
          SET "authorSellerPubliclyOrderable" = false
        WHERE id = $1`,
      [postId],
    );
  } finally {
    await database.query("RESET ROLE");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT "sellerPubliclyOrderable" AS orderable,
            "sellerDisplayName" AS name,
            "sellerAverageRating" AS rating,
            "sellerReviewCount" AS reviews
       FROM public."Listing"
      WHERE id = $1`,
    [listingId],
  )), [{ orderable: true, name: priorSeller.displayName, rating: 4.5, reviews: 8 }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "authorSellerPubliclyOrderable" AS orderable
       FROM public."BlogPost"
      WHERE id = $1`,
    [postId],
  )), [{ orderable: true }]);

  await database.query(
    `UPDATE public."SellerProfile"
        SET "displayName" = 'Full Chain Renamed',
            "displayNameNormalized" = 'full chain renamed',
            "vacationMode" = true
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."SellerRatingSummary"
        SET "averageRating" = 4.75,
            "reviewCount" = 9,
            "updatedAt" = $2
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId, now],
  );

  assert.deepEqual(rowsOf(await database.query(
    `SELECT "sellerPubliclyOrderable" AS orderable,
            "sellerDisplayName" AS name,
            "sellerDisplayNameNormalized" AS normalized,
            "sellerAverageRating" AS rating,
            "sellerReviewCount" AS reviews
       FROM public."Listing"
      WHERE id = $1`,
    [listingId],
  )), [{
    orderable: false,
    name: "Full Chain Renamed",
    normalized: "full chain renamed",
    rating: 4.75,
    reviews: 9,
  }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "authorSellerPubliclyOrderable" AS orderable
       FROM public."BlogPost"
      WHERE id = $1`,
    [postId],
  )), [{ orderable: false }]);

  await database.query("DELETE FROM public.\"BlogPost\" WHERE id = $1", [postId]);
  await database.query("DELETE FROM public.\"Listing\" WHERE id = $1", [listingId]);
  await database.query(
    `UPDATE public."SellerProfile"
        SET "displayName" = $2,
            "displayNameNormalized" = $3,
            "vacationMode" = $4
      WHERE id = $1`,
    [
      seller.sellerProfileId,
      priorSeller.displayName,
      priorSeller.displayNameNormalized,
      priorSeller.vacationMode,
    ],
  );
  if (priorRating) {
    await database.query(
      `UPDATE public."SellerRatingSummary"
          SET "averageRating" = $2,
              "reviewCount" = $3
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId, priorRating.averageRating, priorRating.reviewCount],
    );
  } else {
    await database.query(
      `DELETE FROM public."SellerRatingSummary" WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    );
  }
}
