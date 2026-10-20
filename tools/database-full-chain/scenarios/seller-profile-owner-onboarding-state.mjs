import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerOnboardingState({ database, seller }) {
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
       'public.grainline_seller_owner_onboarding_state(text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    staffExecute: false,
    publicExecute: false,
  }]);

  const expected = rowsOf(await database.query(`
    SELECT seller.id AS "sellerProfileId",
           seller."userId",
           seller."displayName"::text AS "displayName",
           seller.bio::text AS bio,
           seller.tagline::text AS tagline,
           seller."avatarImageUrl"::text AS "avatarImageUrl",
           seller."yearsInBusiness",
           seller.city::text AS city,
           seller.state::text AS state,
           seller."returnPolicy"::text AS "returnPolicy",
           seller."shippingPolicy"::text AS "shippingPolicy",
           seller."acceptsCustomOrders",
           seller."chargesEnabled",
           (
             SELECT pg_catalog.count(*)
               FROM public."Listing" AS counted_listing
              WHERE counted_listing."sellerId" = seller.id
           ) AS "totalListingCount",
           latest_listing.id AS "latestListingId",
           latest_listing.title::text AS "latestListingTitle",
           latest_listing.status::text AS "latestListingStatus"
      FROM public."SellerProfile" AS seller
      LEFT JOIN LATERAL (
        SELECT listing.id, listing.title, listing.status
          FROM public."Listing" AS listing
         WHERE listing."sellerId" = seller.id
         ORDER BY listing."createdAt" DESC, listing.id DESC
         LIMIT 1
      ) AS latest_listing ON true
     WHERE seller.id = $1
  `, [seller.sellerProfileId]));
  assert.equal(expected.length, 1);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_seller_owner_onboarding_state($1)`,
        [seller.sellerProfileId],
      ),
      /context is invalid/u,
    );

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [seller.userId],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_onboarding_state($1)`,
      [seller.sellerProfileId],
    )), expected);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_onboarding_state(NULL)`,
    )), expected);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_onboarding_state($1)`,
      [`${seller.sellerProfileId}_other`],
    )), []);

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [`${seller.userId}_other`],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_onboarding_state(NULL)`,
    )), []);
  } finally {
    await database.query(`SELECT pg_catalog.set_config('app.user_id', '', false)`);
    await database.query("RESET ROLE");
  }
}
