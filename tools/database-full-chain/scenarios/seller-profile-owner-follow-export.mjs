import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerFollowExport({ database, seller }) {
  const actorUserId = `${seller.userId}_follow_export_actor`;
  const followId = `${seller.sellerProfileId}_follow_export`;
  const now = new Date("2026-10-20T12:00:00.000Z");

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
       'public.grainline_seller_owner_follow_export()'
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
     VALUES ($1, $2, $3, 'Follow export actor', $4, $4, $4, '2026-01-01', $4)`,
    [
      actorUserId,
      `user_${actorUserId}`.slice(0, 191),
      `${actorUserId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [followId, actorUserId, seller.sellerProfileId, now],
  );

  await database.query("SELECT set_config('app.user_id', $1, false)", [actorUserId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const rows = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_follow_export()",
    ));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sellerProfileId, seller.sellerProfileId);
    assert.equal(rows[0].displayName, "Full Chain Workshop");
    assert.equal(rows[0].createdAt.toISOString(), now.toISOString());
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = true, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.equal(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_follow_export()",
    )).length, 1);
  } finally {
    await database.query("RESET ROLE");
  }
  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = false, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );

  await database.query("DELETE FROM public.\"Follow\" WHERE id = $1", [followId]);
  await database.query("DELETE FROM public.\"User\" WHERE id = $1", [actorUserId]);
  await database.query("SELECT set_config('app.user_id', '', false)");
}
