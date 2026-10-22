import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileOwnerGuildApplicationAuthority({ database, seller }) {
  const verificationId = `${seller.sellerProfileId}_guild_application`;
  const now = new Date("2026-10-19T15:00:00.000Z");

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
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
       'public.grainline_seller_owner_guild_application_state(text)'
     )
  `)), [{
    securityDefiner: true,
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    publicExecute: false,
  }]);

  await database.query(
    `UPDATE public."SellerProfile"
        SET "guildLevel" = 'GUILD_MEMBER',
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."MakerVerification"
      (id, "sellerProfileId", "craftDescription", "yearsExperience", status,
       "appliedAt", "reviewedAt")
     VALUES ($1, $2, 'Full-chain guild application', 7, 'APPROVED', $3,
             '2026-10-19 15:30:00'::timestamp)`,
    [verificationId, seller.sellerProfileId, now],
  );

  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [seller.userId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_guild_application_state($1)`,
      [seller.sellerProfileId],
    )), [{
      userId: seller.userId,
      guildLevel: "GUILD_MEMBER",
      verificationStatus: "APPROVED",
      verificationReviewedAt: new Date("2026-10-19T15:30:00.000Z"),
    }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_owner_guild_application_state($1)`,
      [`${seller.sellerProfileId}_other`],
    )), []);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_owner_guild_application_state($1)`,
        [seller.sellerProfileId],
      ),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(`DELETE FROM public."MakerVerification" WHERE id = $1`, [verificationId]);
}
