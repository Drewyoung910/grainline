import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerAuxiliaryUpdates({ database, seller }) {
  const metroId = `${seller.sellerProfileId}_owner_aux_metro`;
  const now = new Date("2026-10-19T21:00:00.000Z");
  const prior = rowsOf(await database.query(
    `SELECT "avatarImageUrl", "metroId", "cityMetroId"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ))[0];
  assert.ok(prior);

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
       pg_catalog.to_regprocedure('public.grainline_seller_owner_avatar_clear(text)'),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_owner_metro_assignment_update(text,text,text)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_owner_avatar_clear",
      securityDefiner: true,
      volatility: "v",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
    {
      name: "grainline_seller_owner_metro_assignment_update",
      securityDefiner: true,
      volatility: "v",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
  ]);

  await database.query(
    `INSERT INTO public."Metro"
      (id, slug, name, state, latitude, longitude, "radiusMiles", "isActive",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'Owner auxiliary metro', 'TX', 30, -97, 45, true, $3, $3)`,
    [metroId, `owner-aux-${seller.sellerProfileId}`.slice(0, 100), now],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET "avatarImageUrl" = 'https://cdn.example.test/avatar.png'
      WHERE id = $1`,
    [seller.sellerProfileId],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_seller_owner_avatar_clear($1)`,
        [seller.sellerProfileId],
      ),
      /context is invalid/u,
    );
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_owner_metro_assignment_update($1, $2, $2)`,
        [seller.sellerProfileId, metroId],
      ),
      /context is invalid/u,
    );

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [seller.userId],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_avatar_clear($1)`,
      [seller.sellerProfileId],
    )), [{ sellerProfileId: seller.sellerProfileId }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_metro_assignment_update($1, $2, $2)`,
      [seller.sellerProfileId, metroId],
    )), [{ sellerProfileId: seller.sellerProfileId }]);

    await database.query(
      `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
      [`${seller.userId}_other`],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_owner_avatar_clear($1)`,
      [seller.sellerProfileId],
    )), []);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_metro_assignment_update($1, NULL, NULL)`,
      [seller.sellerProfileId],
    )), []);
  } finally {
    await database.query(`SELECT pg_catalog.set_config('app.user_id', '', false)`);
    await database.query("RESET ROLE");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT "avatarImageUrl", "metroId", "cityMetroId"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  )), [{ avatarImageUrl: null, metroId, cityMetroId: metroId }]);

  await database.query(
    `UPDATE public."SellerProfile"
        SET "avatarImageUrl" = $2,
            "metroId" = $3,
            "cityMetroId" = $4,
            "updatedAt" = $5
      WHERE id = $1`,
    [
      seller.sellerProfileId,
      prior.avatarImageUrl,
      prior.metroId,
      prior.cityMetroId,
      now,
    ],
  );
  await database.query(`DELETE FROM public."Metro" WHERE id = $1`, [metroId]);
}
