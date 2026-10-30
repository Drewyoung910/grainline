import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileSimilarListingCandidates({ database, seller }) {
  const viewerUserId = `${seller.userId}_similar_viewer`;
  const candidateUserId = `${seller.userId}_similar_candidate`;
  const candidateSellerId = `${seller.sellerProfileId}_similar_candidate`;
  const sourceListingId = `${seller.sellerProfileId}_similar_source`;
  const candidateListingId = `${seller.sellerProfileId}_similar_listing`;
  const candidatePhotoId = `${seller.sellerProfileId}_similar_photo`;
  const blockId = `${seller.sellerProfileId}_similar_block`;
  const now = "2026-10-22 15:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffExecute",
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
       'public.grainline_seller_actor_similar_listing_candidates(text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    staffExecute: false,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Similar viewer', $4, $4, $4, '2026-01-01', $4),
       ($5, $6, $7, 'Similar candidate', $4, $4, $4, '2026-01-01', $4)`,
    [
      viewerUserId,
      `user_${viewerUserId}`.slice(0, 191),
      `${viewerUserId}@example.test`.slice(0, 191),
      now,
      candidateUserId,
      `user_${candidateUserId}`.slice(0, 191),
      `${candidateUserId}@example.test`.slice(0, 191),
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
      (id, "userId", "displayName", "displayNameNormalized", city, state,
       "chargesEnabled", "stripeAccountSupported", "vacationMode",
       "ownerAccountActive", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Similar Candidate', 'similar candidate', 'Tulsa', 'OK',
             true, true, false, true, $3, $3)`,
    [candidateSellerId, candidateUserId, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", category, tags, "isPrivate",
       "archivedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $3, 'Walnut Coffee Table', 'Similar source', 10000, 'usd',
        'ACTIVE', 'MADE_TO_ORDER', NULL, 'FURNITURE', ARRAY['walnut','table'],
        false, NULL, $4, $4),
       ($2, $5, 'Walnut Side Table', 'Similar candidate', 11000, 'usd',
        'ACTIVE', 'IN_STOCK', 2, 'FURNITURE', ARRAY['walnut','table'],
        false, NULL, $4, $4)`,
    [
      sourceListingId,
      candidateListingId,
      seller.sellerProfileId,
      now,
      candidateSellerId,
    ],
  );
  await database.query(
    `INSERT INTO public."Photo"
      (id, "listingId", url, "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://example.test/similar.jpg', 'Walnut side table', 0, $3)`,
    [candidatePhotoId, candidateListingId, now],
  );

  await database.query("SELECT set_config('app.user_id', '', false)");
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const rows = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_actor_similar_listing_candidates($1)`,
      [sourceListingId],
    ));
    const candidateRows = rows.filter((row) => row.listingId === candidateListingId);
    assert.equal(candidateRows.length, 1);
    assert.equal(candidateRows[0].sourceTitle, "Walnut Coffee Table");
    assert.equal(candidateRows[0].sourcePriceCents, 10000);
    assert.equal(Number(candidateRows[0].tagOverlap), 2);
    assert.equal(candidateRows[0].categoryMatch, true);
    assert.equal(candidateRows[0].photoUrl, "https://example.test/similar.jpg");
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, candidateUserId, viewerUserId, now],
  );
  await database.query("SELECT set_config('app.user_id', $1, false)", [viewerUserId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const rows = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_actor_similar_listing_candidates($1)`,
      [sourceListingId],
    ));
    assert.equal(rows.some((row) => row.listingId === candidateListingId), false);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("DELETE FROM public.\"Block\" WHERE id = $1", [blockId]);
  await database.query("DELETE FROM public.\"Photo\" WHERE id = $1", [candidatePhotoId]);
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[sourceListingId, candidateListingId]],
  );
  await database.query("DELETE FROM public.\"SellerProfile\" WHERE id = $1", [candidateSellerId]);
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[viewerUserId, candidateUserId]],
  );
  await database.query("SELECT set_config('app.user_id', '', false)");
}
