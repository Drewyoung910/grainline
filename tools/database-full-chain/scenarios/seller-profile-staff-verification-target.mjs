import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

export async function proveSellerProfileStaffVerificationTarget({ database, seller }) {
  const staffUserId = `${seller.userId}_verification_staff`;
  const verificationId = `${seller.sellerProfileId}_staff_verification`;
  const metricsId = `${seller.sellerProfileId}_staff_metrics`;
  // SellerMetrics.calculatedAt is timestamp without time zone. Bind the UTC
  // wall-clock value directly so the fixture is independent of host timezone.
  const now = "2026-10-21T09:00:00.000";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffExecute",
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
       'public.grainline_seller_staff_verification_target(text,text)'
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
     VALUES ($1, $2, $3, 'Verification Staff', 'EMPLOYEE', $4, $4, $4, '2026-01-01', $4)`,
    [
      staffUserId,
      `user_full_chain_verification_staff_${seller.userId}`,
      `verification-staff-${seller.userId}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."MakerVerification"
      (id, "sellerProfileId", "craftDescription", "yearsExperience", status,
       "appliedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full-chain verification evidence', 7,
             'GUILD_MASTER_PENDING', $3, $3, $3)`,
    [verificationId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."SellerMetrics"
      (id, "sellerProfileId", "calculatedAt", "periodMonths", "averageRating",
       "reviewCount", "onTimeShippingRate", "responseRate", "totalSalesCents",
       "completedOrderCount", "activeCaseCount", "accountAgeDays")
     VALUES ($1, $2, $3, 3, 4.9, 18, 0.98, 0.97, 425000, 21, 0, 500)`,
    [metricsId, seller.sellerProfileId, now],
  );

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    const rows = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_verification_target($1, $2)`,
      [staffUserId, verificationId],
    ));
    assert.equal(rows.length, 1);
    assert.deepEqual({
      ...rows[0],
      metricsCalculatedAt: rows[0].metricsCalculatedAt.toISOString(),
      metricsTotalSalesCents: String(rows[0].metricsTotalSalesCents),
    }, {
      verificationId,
      verificationStatus: "GUILD_MASTER_PENDING",
      sellerProfileId: seller.sellerProfileId,
      sellerUserId: seller.userId,
      sellerDisplayName: "Full Chain Workshop",
      ownerAccountActive: true,
      metricsCalculatedAt: `${now}Z`,
      metricsPeriodMonths: 3,
      metricsAverageRating: 4.9,
      metricsReviewCount: 18,
      metricsOnTimeShippingRate: 0.98,
      metricsResponseRate: 0.97,
      metricsTotalSalesCents: "425000",
      metricsCompletedOrderCount: 21,
      metricsActiveCaseCount: 0,
      metricsAccountAgeDays: 500,
    });
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_verification_target($1, 'missing')`,
      [staffUserId],
    )), []);
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_verification_target($1, $2)`,
        [seller.userId, verificationId],
      ),
      /actor is not authorized/u,
    );
    await assert.rejects(
      database.query(`SELECT id FROM public."SellerProfile" LIMIT 1`),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_verification_target($1, $2)`,
        [staffUserId, verificationId],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(`DELETE FROM public."SellerMetrics" WHERE id = $1`, [metricsId]);
  await database.query(`DELETE FROM public."MakerVerification" WHERE id = $1`, [verificationId]);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [staffUserId]);
}
