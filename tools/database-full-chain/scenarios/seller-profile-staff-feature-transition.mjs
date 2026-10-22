import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileStaffFeatureTransition({ database, seller }) {
  const adminUserId = `${seller.userId}_feature_admin`;
  const employeeUserId = `${seller.userId}_feature_employee`;
  const adminSellerProfileId = `${seller.sellerProfileId}_feature_admin`;
  const now = new Date("2026-10-19T18:00:00.000Z");

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
       'public.grainline_seller_staff_feature_transition(text,text,text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "v",
    config: ["search_path=pg_catalog"],
    staffExecute: true,
    runtimeExecute: false,
    publicExecute: false,
  }]);

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
       'public.grainline_seller_staff_orderability_transition(text,text,boolean,boolean,boolean,boolean)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "v",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    staffExecute: false,
    publicExecute: false,
  }]);

  for (const [id, suffix, role] of [
    [adminUserId, "admin", "ADMIN"],
    [employeeUserId, "employee", "EMPLOYEE"],
  ]) {
    await database.query(
      `INSERT INTO public."User"
        (id, "clerkId", email, name, role, "createdAt", "updatedAt",
         "termsAcceptedAt", "termsVersion", "ageAttestedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6, '2026-01-01', $6)`,
      [
        id,
        `user_full_chain_feature_${suffix}_${seller.userId}`,
        `feature-${suffix}-${seller.userId}@example.test`,
        `Feature ${suffix}`,
        role,
        now,
      ],
    );
  }

  await database.query(
    `INSERT INTO public."SellerProfile"
      (id, "userId", "displayName", "displayNameNormalized", "guildLevel",
       "chargesEnabled", "stripeAccountSupported", "vacationMode",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'Admin Workshop', 'admin workshop', 'GUILD_MASTER',
             true, true, false, $3, $3)`,
    [adminSellerProfileId, adminUserId, now],
  );

  await database.query(
    `UPDATE public."SellerProfile"
        SET "guildLevel" = 'GUILD_MEMBER',
            "chargesEnabled" = true,
            "stripeAccountSupported" = true,
            "vacationMode" = false,
            "featuredUntil" = NULL,
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [adminUserId],
    );
    assert.deepEqual(rowsOf(await database.query(`
      SELECT *
        FROM public.grainline_seller_staff_orderability_transition(
          $1, $2, true, false, false, true
        )
    `, [seller.userId, seller.sellerProfileId])), [{
      sellerProfileId: seller.sellerProfileId,
      previousChargesEnabled: true,
      previousVacationMode: false,
      changed: true,
    }]);
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_staff_orderability_transition(
            $1, $2, true, false, false, true
          )
      `, [seller.userId, seller.sellerProfileId]),
      (error) => error?.code === "40001",
    );
    assert.deepEqual(rowsOf(await database.query(`
      SELECT *
        FROM public.grainline_seller_staff_orderability_transition(
          $1, $2, false, true, true, false
        )
    `, [seller.userId, seller.sellerProfileId])), [{
      sellerProfileId: seller.sellerProfileId,
      previousChargesEnabled: false,
      previousVacationMode: true,
      changed: true,
    }]);

    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [seller.userId],
    );
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_staff_orderability_transition(
            $1, $2, true, false, NULL, NULL
          )
      `, [seller.userId, seller.sellerProfileId]),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.query("SELECT pg_catalog.set_config('app.user_id', '', false)");
    await database.query("RESET ROLE");
  }

  let featureAuditId;
  let unfeatureAuditId;
  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_feature_transition($1, $2, 'FEATURE')`,
      [adminUserId, adminSellerProfileId],
    )), [{ applied: false, auditId: null, sellerProfileId: adminSellerProfileId }]);

    const featured = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_feature_transition($1, $2, 'FEATURE')`,
      [adminUserId, seller.sellerProfileId],
    ));
    assert.equal(featured.length, 1);
    assert.equal(featured[0].applied, true);
    assert.equal(featured[0].sellerProfileId, seller.sellerProfileId);
    assert.equal(typeof featured[0].auditId, "string");
    featureAuditId = featured[0].auditId;

    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_feature_transition($1, $2, 'FEATURE')`,
      [adminUserId, seller.sellerProfileId],
    )), [{ applied: false, auditId: null, sellerProfileId: seller.sellerProfileId }]);

    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_feature_transition($1, $2, 'UNFEATURE')`,
        [employeeUserId, seller.sellerProfileId],
      ),
      /actor is not authorized/u,
    );

    const unfeatured = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_feature_transition($1, $2, 'UNFEATURE')`,
      [adminUserId, seller.sellerProfileId],
    ));
    assert.equal(unfeatured[0].applied, true);
    assert.equal(unfeatured[0].sellerProfileId, seller.sellerProfileId);
    assert.equal(typeof unfeatured[0].auditId, "string");
    unfeatureAuditId = unfeatured[0].auditId;
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  assert.deepEqual(rowsOf(await database.query(
    `SELECT "featuredUntil" FROM public."SellerProfile" WHERE id = $1`,
    [seller.sellerProfileId],
  )), [{ featuredUntil: null }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT action, "targetType", "targetId"
       FROM public."AdminAuditLog"
      WHERE id IN ($1, $2)
      ORDER BY action ASC`,
    [featureAuditId, unfeatureAuditId],
  )), [
    { action: "FEATURE_MAKER", targetType: "SELLER_PROFILE", targetId: seller.sellerProfileId },
    { action: "UNFEATURE_MAKER", targetType: "SELLER_PROFILE", targetId: seller.sellerProfileId },
  ]);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_feature_transition($1, $2, 'FEATURE')`,
        [adminUserId, seller.sellerProfileId],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `DELETE FROM public."AdminAuditLog" WHERE "adminId" IN ($1, $2)`,
    [adminUserId, employeeUserId],
  );
  await database.query(
    `DELETE FROM public."User" WHERE id IN ($1, $2)`,
    [adminUserId, employeeUserId],
  );
}
