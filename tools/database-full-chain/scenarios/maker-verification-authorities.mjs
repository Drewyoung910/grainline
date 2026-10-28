import assert from "node:assert/strict";
import pg from "pg";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function proveOwnerStaffLockOrder({ connectionString, seller, staffId, verificationId }) {
  const ownerClient = new pg.Client({ connectionString });
  const staffClient = new pg.Client({ connectionString });
  await Promise.all([ownerClient.connect(), staffClient.connect()]);
  try {
    // deadlock_timeout is superuser-only. Configure the disposable proof
    // sessions before either connection assumes a restricted runtime identity.
    await Promise.all([
      ownerClient.query("SET lock_timeout = '5s'; SET deadlock_timeout = '100ms'"),
      staffClient.query("SET lock_timeout = '5s'; SET deadlock_timeout = '100ms'"),
    ]);
    await ownerClient.query("BEGIN");
    await ownerClient.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [seller.userId]);
    await ownerClient.query("SET LOCAL ROLE grainline_app_runtime");
    const ownerWinner = await ownerClient.query(`
      SELECT * FROM public.grainline_maker_verification_owner_member_apply(
        'Owner wins race', 9, NULL, true
      )
    `);
    assert.equal(ownerWinner.rows[0]?.applied, true);

    await staffClient.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
    await staffClient.query("BEGIN");
    const waitingStaff = staffClient.query(
      `SELECT * FROM public.grainline_seller_guild_staff_transition(
         $1, 'APPROVE_GUILD_MEMBER', $2, NULL, NULL, false
       )`,
      [staffId, verificationId],
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await ownerClient.query("COMMIT");
    const staffAfterOwner = await waitingStaff;
    assert.equal(staffAfterOwner.rows[0]?.applied, true);
    await staffClient.query("COMMIT");
    await staffClient.query("RESET SESSION AUTHORIZATION");

    // Restore a pending predecessor state, then hold the staff transition while
    // the owner operation starts. The owner must wait and return a conflict,
    // not deadlock or overwrite the committed staff decision.
    await ownerClient.query("RESET ROLE").catch(() => {});
    await ownerClient.query("RESET app.user_id").catch(() => {});
    await ownerClient.query(
      `UPDATE public."SellerProfile" SET "guildLevel" = 'NONE' WHERE id = $1`,
      [seller.sellerProfileId],
    );
    await ownerClient.query(
      `UPDATE public."MakerVerification"
          SET status = 'PENDING', "reviewedAt" = NULL, "reviewedById" = NULL
        WHERE id = $1`,
      [verificationId],
    );

    await staffClient.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
    await staffClient.query("BEGIN");
    const committedStaff = await staffClient.query(
      `SELECT * FROM public.grainline_seller_guild_staff_transition(
         $1, 'APPROVE_GUILD_MEMBER', $2, NULL, NULL, false
       )`,
      [staffId, verificationId],
    );
    assert.equal(committedStaff.rows[0]?.applied, true);

    await ownerClient.query("BEGIN");
    await ownerClient.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [seller.userId]);
    await ownerClient.query("SET LOCAL ROLE grainline_app_runtime");
    const waitingOwner = ownerClient.query(`
      SELECT * FROM public.grainline_maker_verification_owner_member_apply(
        'Staff wins race', 10, NULL, true
      )
    `);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await staffClient.query("COMMIT");
    await staffClient.query("RESET SESSION AUTHORIZATION");
    const ownerAfterStaff = await waitingOwner;
    assert.equal(ownerAfterStaff.rows[0]?.applied, false);
    assert.equal(ownerAfterStaff.rows[0]?.status, "APPROVED");
    await ownerClient.query("COMMIT");
  } finally {
    await ownerClient.query("ROLLBACK").catch(() => {});
    await staffClient.query("ROLLBACK").catch(() => {});
    await staffClient.query("RESET SESSION AUTHORIZATION").catch(() => {});
    await Promise.all([ownerClient.end(), staffClient.end()]);
  }
}

async function proveOwnerCronLockOrder({ connectionString, seller, verificationId }) {
  const ownerClient = new pg.Client({ connectionString });
  const cronClient = new pg.Client({ connectionString });
  let activeListingIds = [];
  await Promise.all([ownerClient.connect(), cronClient.connect()]);
  try {
    await Promise.all([
      ownerClient.query("SET lock_timeout = '5s'; SET deadlock_timeout = '100ms'"),
      cronClient.query("SET lock_timeout = '5s'; SET deadlock_timeout = '100ms'"),
    ]);
    activeListingIds = (await ownerClient.query(
      `SELECT id
         FROM public."Listing"
        WHERE "sellerId" = $1
          AND status = 'ACTIVE'
          AND "isPrivate" = false`,
      [seller.sellerProfileId],
    )).rows.map((row) => row.id);
    if (activeListingIds.length > 0) {
      await ownerClient.query(
        `UPDATE public."Listing"
            SET status = 'DRAFT'
          WHERE id = ANY($1::text[])`,
        [activeListingIds],
      );
    }

    const resetMemberState = async () => {
      await ownerClient.query(
        `UPDATE public."SellerProfile"
            SET "guildLevel" = 'GUILD_MEMBER', "isVerifiedMaker" = true
          WHERE id = $1`,
        [seller.sellerProfileId],
      );
      await ownerClient.query(
        `UPDATE public."MakerVerification"
            SET status = 'APPROVED', "reviewedAt" = CURRENT_TIMESTAMP - INTERVAL '31 days'
          WHERE id = $1`,
        [verificationId],
      );
      await ownerClient.query(
        `UPDATE public."SellerProfilePrivate"
            SET "listingsBelowThresholdSince" = CURRENT_TIMESTAMP - INTERVAL '31 days',
                "guildMemberApprovedAt" = CURRENT_TIMESTAMP - INTERVAL '31 days'
          WHERE "sellerProfileId" = $1`,
        [seller.sellerProfileId],
      );
    };

    await resetMemberState();
    await ownerClient.query("BEGIN");
    await ownerClient.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [seller.userId]);
    await ownerClient.query("SET LOCAL ROLE grainline_app_runtime");
    const ownerWinner = await ownerClient.query(`
      SELECT * FROM public.grainline_maker_verification_owner_master_apply(
        'Owner wins cron race', NULL, true
      )
    `);
    assert.equal(ownerWinner.rows[0]?.applied, true);

    await cronClient.query("BEGIN");
    await cronClient.query("SET LOCAL ROLE grainline_app_runtime");
    const waitingCron = cronClient.query(
      "SELECT * FROM public.grainline_seller_guild_member_revoke($1)",
      [seller.sellerProfileId],
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await ownerClient.query("COMMIT");
    const cronAfterOwner = await waitingCron;
    assert.equal(cronAfterOwner.rows[0]?.applied, false);
    await cronClient.query("COMMIT");

    await resetMemberState();
    await cronClient.query("BEGIN");
    await cronClient.query("SET LOCAL ROLE grainline_app_runtime");
    const cronWinner = await cronClient.query(
      "SELECT * FROM public.grainline_seller_guild_member_revoke($1)",
      [seller.sellerProfileId],
    );
    assert.equal(cronWinner.rows[0]?.applied, true);

    await ownerClient.query("BEGIN");
    await ownerClient.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [seller.userId]);
    await ownerClient.query("SET LOCAL ROLE grainline_app_runtime");
    const waitingOwner = ownerClient.query(`
      SELECT * FROM public.grainline_maker_verification_owner_master_apply(
        'Cron wins owner race', NULL, true
      )
    `).then(
      (result) => ({ result, error: null }),
      (error) => ({ result: null, error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await cronClient.query("COMMIT");
    const ownerAfterCron = await waitingOwner;
    assert.equal(ownerAfterCron.result, null);
    assert.equal(ownerAfterCron.error?.code, "42501");
    await ownerClient.query("ROLLBACK");
  } finally {
    await ownerClient.query("ROLLBACK").catch(() => {});
    await cronClient.query("ROLLBACK").catch(() => {});
    if (activeListingIds.length > 0) {
      await ownerClient.query(
        `UPDATE public."Listing"
            SET status = 'ACTIVE'
          WHERE id = ANY($1::text[])`,
        [activeListingIds],
      );
    }
    await Promise.all([ownerClient.end(), cronClient.end()]);
  }
}

export async function proveMakerVerificationPreparedAuthorities({ database, seller, connectionString }) {
  const verificationIdPrefix = `${seller.sellerProfileId}_maker_verification`;
  const staffId = `${verificationIdPrefix}_staff`;
  const otherUserId = `${verificationIdPrefix}_other`;
  const deletionTime = new Date("2026-10-28T18:15:00.000Z");

  const catalog = rowsOf(await database.query(`
    SELECT procedure.proname AS name,
           procedure.prosecdef AS "securityDefiner",
           procedure.proconfig AS config,
           owner_role.rolsuper OR owner_role.rolbypassrls AS "ownerBypassesRls",
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
           ) AS "staffExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner)
                 )
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE procedure.proname LIKE 'grainline_maker_verification_%'
     ORDER BY procedure.proname
  `));
  assert.equal(catalog.length, 6);
  assert.equal(catalog.every((row) => (
    row.securityDefiner === true
    && row.ownerBypassesRls === true
    && row.publicExecute === false
    && JSON.stringify(row.config) === JSON.stringify(["search_path=pg_catalog"])
  )), true);
  assert.equal(
    catalog.filter((row) => row.name.includes("staff_pending")).every((row) => (
      row.staffExecute === true && row.runtimeExecute === false
    )),
    true,
  );
  assert.equal(
    catalog.filter((row) => !row.name.includes("staff_pending")).every((row) => (
      row.runtimeExecute === true && row.staffExecute === false
    )),
    true,
  );

  const lockEnvelopes = rowsOf(await database.query(`
    SELECT procedure.proname AS name,
           procedure.prosecdef AS "securityDefiner",
           procedure.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
           ) AS "staffExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.proname IN (
       'grainline_seller_guild_staff_transition',
       'grainline_seller_guild_staff_transition_prepared_impl',
       'grainline_seller_guild_member_revoke',
       'grainline_seller_guild_member_revoke_prepared_impl',
       'grainline_seller_guild_metrics_apply',
       'grainline_seller_guild_metrics_apply_prepared_impl'
     )
     ORDER BY procedure.proname
  `));
  assert.equal(lockEnvelopes.length, 6);
  assert.equal(lockEnvelopes.every((row) => (
    row.securityDefiner === true
    && JSON.stringify(row.config) === JSON.stringify(["search_path=pg_catalog"])
    && row.publicExecute === false
  )), true);
  assert.equal(
    lockEnvelopes.filter((row) => row.name.endsWith("_prepared_impl")).every((row) => (
      row.runtimeExecute === false && row.staffExecute === false
    )),
    true,
  );
  assert.equal(
    lockEnvelopes.find((row) => row.name === "grainline_seller_guild_staff_transition")?.staffExecute,
    true,
  );
  assert.equal(
    lockEnvelopes.filter((row) => new Set([
      "grainline_seller_guild_member_revoke",
      "grainline_seller_guild_metrics_apply",
    ]).has(row.name)).every((row) => row.runtimeExecute === true && row.staffExecute === false),
    true,
  );

  await database.query(
    `DELETE FROM public."MakerVerification" WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    'DELETE FROM public."AdminAuditLog" WHERE "adminId" = $1',
    [staffId],
  );
  await database.query(
    'DELETE FROM public."User" WHERE id = ANY($1::text[])',
    [[staffId, otherUserId]],
  );
  await database.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, 'Verification staff', 'ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ($4, $5, $6, 'Other user', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      staffId,
      `${verificationIdPrefix}_staff_clerk`,
      `${verificationIdPrefix}_staff@example.com`,
      otherUserId,
      `${verificationIdPrefix}_other_clerk`,
      `${verificationIdPrefix}_other@example.com`,
    ],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET "guildLevel" = 'NONE',
            "isVerifiedMaker" = false,
            "ownerAccountActive" = true
      WHERE id = $1`,
    [seller.sellerProfileId],
  );

  await database.query("SELECT pg_catalog.set_config('app.user_id', $1, false)", [seller.userId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_maker_verification_owner_member_apply(
           'Hand-built chairs', 8, NULL, false
         )`,
      ),
      (error) => error?.code === "22023",
    );
    const applied = rowsOf(await database.query(`
      SELECT * FROM public.grainline_maker_verification_owner_member_apply(
        'Hand-built chairs', 8, 'https://example.com/portfolio', true
      )
    `));
    assert.equal(applied.length, 1);
    assert.equal(applied[0].applied, true);
    assert.equal(applied[0].status, "PENDING");

    const duplicate = rowsOf(await database.query(`
      SELECT * FROM public.grainline_maker_verification_owner_member_apply(
        'Replacement narrative', 9, NULL, true
      )
    `));
    assert.equal(duplicate.length, 1);
    assert.equal(duplicate[0].applied, false);
    assert.equal(duplicate[0].status, "PENDING");

    const exported = rowsOf(await database.query(
      "SELECT * FROM public.grainline_maker_verification_owner_export()",
    ));
    assert.equal(exported.length, 1);
    assert.equal(exported[0].craftDescription, "Hand-built chairs");
    assert.equal(Object.hasOwn(exported[0], "reviewedById"), false);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    const count = rowsOf(await database.query(
      "SELECT public.grainline_maker_verification_staff_pending_count($1) AS value",
      [staffId],
    ));
    assert.equal(count.length, 1);
    assert.equal(Number(count[0].value), 1);
    const pending = rowsOf(await database.query(
      `SELECT * FROM public.grainline_maker_verification_staff_pending_page(
         $1, NULL, NULL, 50
       )`,
      [staffId],
    ));
    assert.equal(pending.length, 1);
    assert.equal(pending[0].sellerProfileId, seller.sellerProfileId);
    const approval = rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_guild_staff_transition(
         $1, 'APPROVE_GUILD_MEMBER', $2, NULL, NULL, false
       )`,
      [staffId, pending[0].id],
    ));
    assert.equal(approval.length, 1);
    assert.equal(approval[0].applied, true);
    assert.equal(approval[0].sellerProfileId, seller.sellerProfileId);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  await database.query(
    `UPDATE public."MakerVerification"
        SET "reviewNotes" = 'Member approval evidence'
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "guildMasterReviewNotes" = 'Stale Master decision'
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  );

  await database.query("SELECT pg_catalog.set_config('app.user_id', $1, false)", [seller.userId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const master = rowsOf(await database.query(`
      SELECT * FROM public.grainline_maker_verification_owner_master_apply(
        'A sustainable studio', 'https://example.com/master', true
      )
    `));
    assert.equal(master.length, 1);
    assert.equal(master[0].applied, true);
    assert.equal(master[0].status, "GUILD_MASTER_PENDING");
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  const pairedState = rowsOf(await database.query(
    `SELECT verification.status::text AS status,
            verification."guildMasterCraftBusiness" AS narrative,
            verification."reviewedById" AS "reviewedById",
            verification."reviewNotes" AS "reviewNotes",
            verification."reviewedAt" AS "reviewedAt",
            seller_private."guildMasterAppliedAt" AS "privateAppliedAt",
            seller_private."guildMasterReviewNotes" AS "privateReviewNotes"
       FROM public."MakerVerification" AS verification
       JOIN public."SellerProfilePrivate" AS seller_private
         ON seller_private."sellerProfileId" = verification."sellerProfileId"
      WHERE verification."sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ));
  assert.equal(pairedState.length, 1);
  assert.equal(pairedState[0].status, "GUILD_MASTER_PENDING");
  assert.equal(pairedState[0].narrative, "A sustainable studio");
  assert.equal(pairedState[0].reviewedById, staffId);
  assert.equal(pairedState[0].reviewNotes, "Member approval evidence");
  assert.equal(pairedState[0].reviewedAt instanceof Date, true);
  assert.equal(pairedState[0].privateAppliedAt instanceof Date, true);
  assert.equal(pairedState[0].privateReviewNotes, null);

  if (connectionString) {
    await database.query(
      `UPDATE public."SellerProfile" SET "guildLevel" = 'NONE' WHERE id = $1`,
      [seller.sellerProfileId],
    );
    await database.query(
      `UPDATE public."MakerVerification"
          SET status = 'REJECTED',
              "reviewedAt" = CURRENT_TIMESTAMP - INTERVAL '31 days'
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    );
    await proveOwnerStaffLockOrder({
      connectionString,
      seller,
      staffId,
      verificationId: pairedState[0] ? (await database.query(
        `SELECT id FROM public."MakerVerification" WHERE "sellerProfileId" = $1`,
        [seller.sellerProfileId],
      )).rows[0].id : null,
    });
    await proveOwnerCronLockOrder({
      connectionString,
      seller,
      verificationId: (await database.query(
        `SELECT id FROM public."MakerVerification" WHERE "sellerProfileId" = $1`,
        [seller.sellerProfileId],
      )).rows[0].id,
    });
  }

  await database.query("SELECT pg_catalog.set_config('app.user_id', $1, false)", [otherUserId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_maker_verification_owner_export()",
    )), []);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    const count = rowsOf(await database.query(
      "SELECT public.grainline_maker_verification_staff_pending_count($1) AS value",
      [staffId],
    ));
    assert.equal(count.length, 1);
    assert.equal(Number(count[0].value), 0);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_maker_verification_staff_pending_page(
         $1, NULL, NULL, 50
       )`,
      [staffId],
    )), []);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  await database.query("SELECT pg_catalog.set_config('app.user_id', $1, false)", [seller.userId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const redaction = rowsOf(await database.query(
      `SELECT public.grainline_maker_verification_owner_delete_redact($1) AS redacted`,
      [deletionTime],
    ));
    assert.deepEqual(redaction, [{ redacted: true }]);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  const redacted = rowsOf(await database.query(
    `SELECT "craftDescription", "guildMasterCraftBusiness", "yearsExperience",
            "portfolioUrl", status::text AS status, "reviewedById", "reviewNotes",
            "reviewedAt", "appliedAt"
       FROM public."MakerVerification"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ));
  assert.deepEqual(redacted, [{
    craftDescription: "[Deleted]",
    guildMasterCraftBusiness: null,
    yearsExperience: 0,
    portfolioUrl: null,
    status: "REJECTED",
    reviewedById: null,
    reviewNotes: null,
    reviewedAt: null,
    appliedAt: deletionTime,
  }]);

  await database.query(
    `DELETE FROM public."MakerVerification" WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET "guildLevel" = 'NONE',
            "isVerifiedMaker" = false
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "guildMasterAppliedAt" = NULL,
            "guildMasterReviewNotes" = NULL,
            "guildMemberApprovedAt" = NULL,
            "listingsBelowThresholdSince" = NULL
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    'DELETE FROM public."AdminAuditLog" WHERE "adminId" = $1',
    [staffId],
  );
  await database.query(
    `DELETE FROM public."SystemAuditLog"
      WHERE "targetType" = 'SELLER_PROFILE'
        AND "targetId" = $1
        AND action = 'AUTO_REVOKE_GUILD_MEMBER'`,
    [seller.sellerProfileId],
  );
  await database.query('DELETE FROM public."User" WHERE id = ANY($1::text[])', [[staffId, otherUserId]]);
}
