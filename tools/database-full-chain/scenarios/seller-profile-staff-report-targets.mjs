import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileStaffReportTargetsAuthority({ database, seller }) {
  const staffUserId = `${seller.userId}_report_staff`;
  const now = new Date("2026-10-19T17:00:00.000Z");

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime',
             routine.oid,
             'EXECUTE'
           ) AS "staffExecute",
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
       'public.grainline_seller_staff_report_targets(text,text[])'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    staffExecute: true,
    runtimeExecute: false,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Report Staff', 'EMPLOYEE', $4, $4, $4, '2026-01-01', $4)`,
    [
      staffUserId,
      `user_full_chain_report_staff_${seller.userId}`,
      `report-staff-${seller.userId}@example.test`,
      now,
    ],
  );

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_report_targets($1, $2::text[])`,
      [staffUserId, [seller.sellerProfileId, "missing", seller.sellerProfileId]],
    )), [{
      id: seller.sellerProfileId,
      displayName: "Full Chain Workshop",
    }]);

    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_report_targets($1, $2::text[])`,
        [staffUserId, Array.from({ length: 51 }, (_, index) => `seller-${index}`)],
      ),
      /input is invalid/u,
    );

    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_report_targets($1, $2::text[])`,
        [seller.userId, [seller.sellerProfileId]],
      ),
      /actor is not authorized/u,
    );
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_report_targets($1, $2::text[])`,
        [staffUserId, [seller.sellerProfileId]],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(`DELETE FROM public."User" WHERE id = $1`, [staffUserId]);
}
