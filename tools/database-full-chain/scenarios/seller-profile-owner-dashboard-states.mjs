import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerDashboardStates({ database, seller }) {
  assert.deepEqual(rowsOf(await database.query(`
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
         'public.grainline_seller_owner_guild_dashboard_state(text)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_owner_shop_settings_state(text)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_owner_guild_dashboard_state",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
    {
      name: "grainline_seller_owner_shop_settings_state",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
  ]);

  const expectedGuild = rowsOf(await database.query(`
    SELECT seller.id AS "sellerProfileId",
           seller."userId",
           seller.bio::text AS bio,
           seller."avatarImageUrl"::text AS "avatarImageUrl",
           seller."returnPolicy"::text AS "returnPolicy",
           seller."customOrderPolicy"::text AS "customOrderPolicy",
           seller."shippingPolicy"::text AS "shippingPolicy",
           seller."guildLevel"::text AS "guildLevel",
           verification.status::text AS "verificationStatus",
           verification."reviewedAt" AS "verificationReviewedAt",
           verification."reviewNotes"::text AS "verificationReviewNotes",
           verification."craftDescription"::text AS "verificationCraftDescription",
           verification."yearsExperience" AS "verificationYearsExperience",
           verification."portfolioUrl"::text AS "verificationPortfolioUrl"
      FROM public."SellerProfile" AS seller
      LEFT JOIN public."MakerVerification" AS verification
        ON verification."sellerProfileId" = seller.id
     WHERE seller.id = $1
  `, [seller.sellerProfileId]));
  const expectedSettings = rowsOf(await database.query(`
    SELECT seller.id AS "sellerProfileId",
           seller."chargesEnabled",
           seller."vacationMode",
           seller."vacationReturnDate",
           seller."vacationMessage"::text AS "vacationMessage",
           seller.city::text AS city,
           seller.state::text AS state,
           seller.lat,
           seller.lng,
           seller."radiusMeters",
           seller."publicMapOptIn",
           seller."shippingFlatRateCents",
           seller."freeShippingOverCents",
           seller."allowLocalPickup"
      FROM public."SellerProfile" AS seller
     WHERE seller.id = $1
  `, [seller.sellerProfileId]));
  assert.equal(expectedGuild.length, 1);
  assert.equal(expectedSettings.length, 1);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_seller_owner_guild_dashboard_state($1)`,
        [seller.sellerProfileId],
      ),
      /context is invalid/u,
    );
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_seller_owner_shop_settings_state($1)`,
        [seller.sellerProfileId],
      ),
      /context is invalid/u,
    );

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [seller.userId],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_guild_dashboard_state($1)`,
      [seller.sellerProfileId],
    )), expectedGuild);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_shop_settings_state($1)`,
      [seller.sellerProfileId],
    )), expectedSettings);

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [`${seller.userId}_other`],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_guild_dashboard_state($1)`,
      [seller.sellerProfileId],
    )), []);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_shop_settings_state($1)`,
      [seller.sellerProfileId],
    )), []);
  } finally {
    await database.query(`SELECT pg_catalog.set_config('app.user_id', '', false)`);
    await database.query("RESET ROLE");
  }
}
