import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerFeaturedListingToggle({ database, seller }) {
  const listingId = `${seller.sellerProfileId}_featured_toggle`;
  const now = new Date("2026-10-19T20:00:00.000Z");
  const priorIds = rowsOf(await database.query(
    `SELECT "featuredListingIds"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ))[0]?.featuredListingIds;
  assert.ok(Array.isArray(priorIds));

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
       'public.grainline_seller_owner_featured_listing_toggle(text,text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "v",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    staffExecute: false,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", status,
       "isPrivate", "qualityScore", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Featured toggle listing', 'Featured toggle proof', 1200,
             'ACTIVE', false, 0, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_owner_featured_listing_toggle($1, $2)`,
        [seller.sellerProfileId, listingId],
      ),
      /context is invalid/u,
    );

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [seller.userId],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_featured_listing_toggle($1, $2)`,
      [seller.sellerProfileId, listingId],
    )), [{ applied: true, featured: true }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_featured_listing_toggle($1, $2)`,
      [seller.sellerProfileId, listingId],
    )), [{ applied: true, featured: false }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_featured_listing_toggle($1, $2)`,
      [seller.sellerProfileId, `${listingId}_missing`],
    )), [{ applied: false, featured: false }]);

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [`${seller.userId}_other`],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_featured_listing_toggle($1, $2)`,
      [seller.sellerProfileId, listingId],
    )), [{ applied: false, featured: false }]);
  } finally {
    await database.query(`SELECT pg_catalog.set_config('app.user_id', '', false)`);
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."SellerProfile"
        SET "featuredListingIds" = ARRAY['cap-1','cap-2','cap-3','cap-4','cap-5','cap-6']::text[]
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [seller.userId],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_featured_listing_toggle($1, $2)`,
      [seller.sellerProfileId, listingId],
    )), [{ applied: false, featured: false }]);
  } finally {
    await database.query(`SELECT pg_catalog.set_config('app.user_id', '', false)`);
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."SellerProfile"
        SET "featuredListingIds" = $2::text[],
            "updatedAt" = $3
      WHERE id = $1`,
    [seller.sellerProfileId, priorIds, now],
  );
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [listingId]);
}
