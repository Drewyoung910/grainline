import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileQualityScoreAuthorities({ database, seller }) {
  const activeListingId = `zz_quality_${seller.sellerProfileId}_active`.slice(0, 191);
  const hiddenListingId = `zz_quality_${seller.sellerProfileId}_hidden`.slice(0, 191);
  const photoId = `zz_quality_${seller.sellerProfileId}_photo`.slice(0, 191);
  const now = "2026-10-22 16:00:00";

  const catalog = rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
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
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure(
         'public.grainline_seller_service_quality_score_batch(text,integer)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_service_quality_score_zero_ineligible()'
       )
     )
     ORDER BY routine.proname
  `));
  assert.deepEqual(catalog, [
    {
      name: "grainline_seller_service_quality_score_batch",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
    {
      name: "grainline_seller_service_quality_score_zero_ineligible",
      securityDefiner: true,
      volatility: "v",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
  ]);

  const priorIneligibleScores = rowsOf(await database.query(`
    SELECT listing.id,
           listing."qualityScore" AS score
      FROM public."Listing" AS listing
     WHERE listing."qualityScore" > 0
       AND (
         listing.status::text <> 'ACTIVE'
         OR listing."isPrivate" = true
         OR EXISTS (
           SELECT 1
             FROM public."SellerProfile" AS seller
            WHERE seller.id = listing."sellerId"
              AND (
                seller."chargesEnabled" = false
                OR seller."vacationMode" = true
                OR seller."ownerAccountActive" = false
              )
         )
       )
  `));

  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", category, tags, "isPrivate",
       "viewCount", "clickCount", "qualityScore", "createdAt", "updatedAt")
     VALUES
       ($1, $3, 'Quality active', 'Detailed active listing', 10000, 'usd',
        'ACTIVE', 'IN_STOCK', 1, 'DECOR', ARRAY['quality'], false,
        9, 4, 0.4, $4, $4),
       ($2, $3, 'Quality hidden', 'Hidden listing', 10000, 'usd',
        'HIDDEN', 'IN_STOCK', 1, 'DECOR', ARRAY['quality'], false,
        0, 0, 0.6, $4, $4)`,
    [activeListingId, hiddenListingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Photo"
      (id, "listingId", url, "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://example.test/quality.jpg', 'Quality photo', 0, $3)`,
    [photoId, activeListingId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    const rows = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_service_quality_score_batch($1, 200)`,
      ["zz_quality_"],
    ));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, activeListingId);
    assert.equal(Number(rows[0].photoCount), 1);
    assert.equal(rows[0].hasAltText, true);

    const zeroed = rowsOf(await database.query(
      `SELECT public.grainline_seller_service_quality_score_zero_ineligible()
         AS count`,
    ));
    assert.ok(Number(zeroed[0].count) >= 1);
  } finally {
    await database.query("RESET ROLE");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT id, "qualityScore"
       FROM public."Listing"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [[activeListingId, hiddenListingId]],
  )), [
    { id: activeListingId, qualityScore: 0.4 },
    { id: hiddenListingId, qualityScore: 0 },
  ]);

  for (const row of priorIneligibleScores) {
    await database.query(
      `UPDATE public."Listing" SET "qualityScore" = $2 WHERE id = $1`,
      [row.id, row.score],
    );
  }

  await database.query("DELETE FROM public.\"Photo\" WHERE id = $1", [photoId]);
  await database.query(
    `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
    [[activeListingId, hiddenListingId]],
  );
}
