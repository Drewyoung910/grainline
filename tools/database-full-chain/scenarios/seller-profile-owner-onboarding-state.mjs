import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerOnboardingState({ database, seller }) {
  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.oid::pg_catalog.regprocedure::text AS signature,
           routine.prosecdef AS "securityDefiner",
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
              WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure('public.grainline_seller_owner_export_profile()'),
       pg_catalog.to_regprocedure('public.grainline_seller_owner_onboarding_step_one_update(text,text,text,text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_seller_owner_onboarding_step_two_update(text,integer,text,text,text,text,boolean)')
     )
     ORDER BY signature
  `)), [
    {
      signature: "grainline_seller_owner_export_profile()",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      signature: "grainline_seller_owner_onboarding_step_one_update(text,text,text,text,text,text)",
      securityDefiner: true,
      volatility: "v",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      signature: "grainline_seller_owner_onboarding_step_two_update(text,integer,text,text,text,text,boolean)",
      securityDefiner: true,
      volatility: "v",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
  ]);

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

    const exportBefore = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_export_profile()",
    ));
    assert.equal(exportBefore.length, 1);
    assert.equal(exportBefore[0].id, seller.sellerProfileId);
    assert.equal(exportBefore[0].profile.id, seller.sellerProfileId);
    assert.equal(exportBefore[0].profile.displayName, expected[0].displayName);
    assert.equal(exportBefore[0].profile.userId, undefined);
    assert.equal(exportBefore[0].profile.ownerAccountActive, undefined);

    assert.deepEqual(rowsOf(await database.query(`
      SELECT public.grainline_seller_owner_onboarding_step_one_update(
        $1, 'Final Direct Workshop', 'final direct workshop',
        'Owner bio', 'Owner tagline', 'https://example.test/avatar.jpg'
      ) AS updated
    `, [seller.sellerProfileId])), [{ updated: true }]);
    assert.deepEqual(rowsOf(await database.query(`
      SELECT public.grainline_seller_owner_onboarding_step_two_update(
        $1, 12, 'Austin', 'TX', 'Returns accepted', 'Ships safely', true
      ) AS updated
    `, [seller.sellerProfileId])), [{ updated: true }]);
    const updatedState = rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_onboarding_state($1)`,
      [seller.sellerProfileId],
    ));
    assert.equal(updatedState.length, 1);
    assert.deepEqual({
      displayName: updatedState[0].displayName,
      bio: updatedState[0].bio,
      tagline: updatedState[0].tagline,
      avatarImageUrl: updatedState[0].avatarImageUrl,
      yearsInBusiness: updatedState[0].yearsInBusiness,
      city: updatedState[0].city,
      state: updatedState[0].state,
      returnPolicy: updatedState[0].returnPolicy,
      shippingPolicy: updatedState[0].shippingPolicy,
      acceptsCustomOrders: updatedState[0].acceptsCustomOrders,
    }, {
      displayName: "Final Direct Workshop",
      bio: "Owner bio",
      tagline: "Owner tagline",
      avatarImageUrl: "https://example.test/avatar.jpg",
      yearsInBusiness: 12,
      city: "Austin",
      state: "TX",
      returnPolicy: "Returns accepted",
      shippingPolicy: "Ships safely",
      acceptsCustomOrders: true,
    });
    const privateState = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_private_state($1)",
      [seller.userId],
    ));
    assert.equal(privateState.length, 1);
    assert.equal(privateState[0].state.onboardingStep, 3);

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [`${seller.userId}_other`],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_onboarding_state(NULL)`,
    )), []);
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_export_profile()",
    )), []);
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_owner_onboarding_step_one_update(
          $1, NULL, NULL, NULL, NULL, NULL
        )
      `, [seller.sellerProfileId]),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.query(`SELECT pg_catalog.set_config('app.user_id', '', false)`);
    await database.query("RESET ROLE");
  }
}
