import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerBootstrapAuthority({ database, seller }) {
  const ownerUserId = `${seller.userId}_bootstrap_owner`;
  const sellerProfileId = `${seller.sellerProfileId}_bootstrap_one`;
  const ignoredProfileId = `${seller.sellerProfileId}_bootstrap_two`;
  const now = new Date("2026-10-19T16:00:00.000Z");

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime',
             routine.oid,
             'EXECUTE'
           ) AS "runtimeExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   routine.proacl,
                   pg_catalog.acldefault('f', routine.proowner)
                 )
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_owner_bootstrap(text,text,text)'
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
     VALUES ($1, $2, $3, 'Bootstrap Owner', $4, $4, $4, '2026-01-01', $4)`,
    [
      ownerUserId,
      `user_full_chain_bootstrap_${seller.userId}`,
      `bootstrap-${seller.userId}@example.test`,
      now,
    ],
  );

  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [ownerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const first = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_bootstrap($1, $2, $3)`,
      [sellerProfileId, "Bootstrap Workshop", "bootstrap workshop"],
    ));
    assert.deepEqual(first, [{
      id: sellerProfileId,
      userId: ownerUserId,
      displayName: "Bootstrap Workshop",
      chargesEnabled: false,
      vacationMode: false,
      bannerImageUrl: null,
      avatarImageUrl: null,
      workshopImageUrl: null,
      galleryImageUrls: [],
    }]);

    const replay = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_bootstrap($1, $2, $3)`,
      [ignoredProfileId, "Changed Name", "changed name"],
    ));
    assert.deepEqual(replay, first);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT seller.id,
            seller."displayName" AS "displayName",
            seller."displayNameNormalized" AS "displayNameNormalized",
            COUNT(seller_private.*)::integer AS "privateRows"
       FROM public."SellerProfile" AS seller
       LEFT JOIN public."SellerProfilePrivate" AS seller_private
         ON seller_private."sellerProfileId" = seller.id
      WHERE seller."userId" = $1
      GROUP BY seller.id, seller."displayName", seller."displayNameNormalized"`,
    [ownerUserId],
  )), [{
    id: sellerProfileId,
    displayName: "Bootstrap Workshop",
    displayNameNormalized: "bootstrap workshop",
    privateRows: 1,
  }]);

  await database.query(`DELETE FROM public."User" WHERE id = $1`, [ownerUserId]);
}
