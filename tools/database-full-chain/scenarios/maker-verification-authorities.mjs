import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function expectSqlState(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

async function assertActivatedDirectDenials(database) {
  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS enabled,
           class.relforcerowsecurity AS forced,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS "policyCount"
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."MakerVerification"'::pg_catalog.regclass
  `));
  assert.deepEqual(posture, [{ enabled: true, forced: true, policyCount: 0 }]);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    for (const statement of [
      'SELECT id FROM public."MakerVerification" LIMIT 1',
      'INSERT INTO public."MakerVerification" SELECT * FROM public."MakerVerification" WHERE false',
      'UPDATE public."MakerVerification" SET "updatedAt" = "updatedAt" WHERE false',
      'DELETE FROM public."MakerVerification" WHERE false',
    ]) {
      await expectSqlState(database.query(statement), "42501");
    }
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    await expectSqlState(
      database.query('SELECT id FROM public."MakerVerification" LIMIT 1'),
      "42501",
    );
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

async function proveActivationRollbackRoundTrip(database) {
  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS enabled,
           class.relforcerowsecurity AS forced
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."MakerVerification"'::pg_catalog.regclass
  `));
  if (posture[0]?.enabled !== true || posture[0]?.forced !== true) return;

  const rollbackSql = readFileSync(
    "docs/rls-drafts/maker-verification-activation-rollback.sql",
    "utf8",
  );
  const activationSql = readFileSync(
    "prisma/migrations/20261028080000_activate_maker_verification_rls/migration.sql",
    "utf8",
  );
  await database.query(rollbackSql);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await database.query('SELECT id FROM public."MakerVerification" LIMIT 1');
    await database.query(
      'INSERT INTO public."MakerVerification" SELECT * FROM public."MakerVerification" WHERE false',
    );
    await database.query(
      'UPDATE public."MakerVerification" SET "updatedAt" = "updatedAt" WHERE false',
    );
    await database.query('DELETE FROM public."MakerVerification" WHERE false');
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(activationSql);
  await assertActivatedDirectDenials(database);
}

async function proveOwnerInputAndActorDenials({ database, seller }) {
  const validMemberArguments = ["Denial matrix craft", 12, null, true];

  await database.query("RESET app.user_id").catch(() => {});
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await expectSqlState(
      database.query(
        "SELECT * FROM public.grainline_maker_verification_owner_member_apply($1, $2, $3, $4)",
        validMemberArguments,
      ),
      "42501",
    );
    await database.query("SELECT pg_catalog.set_config('app.user_id', 'not valid', false)");
    await expectSqlState(
      database.query(
        "SELECT * FROM public.grainline_maker_verification_owner_member_apply($1, $2, $3, $4)",
        validMemberArguments,
      ),
      "42501",
    );
    await database.query("SELECT pg_catalog.set_config('app.user_id', $1, false)", [seller.userId]);
    for (const input of [
      [null, 12, null, true],
      ["   ", 12, null, true],
      ["x".repeat(501), 12, null, true],
      ["Valid craft", -1, null, true],
      ["Valid craft", 101, null, true],
      ["Valid craft", 12, "http://example.com", true],
      ["Valid craft", 12, `https://example.com/${"x".repeat(500)}`, true],
      ["Valid craft", 12, null, false],
    ]) {
      await expectSqlState(
        database.query(
          "SELECT * FROM public.grainline_maker_verification_owner_member_apply($1, $2, $3, $4)",
          input,
        ),
        "22023",
      );
    }
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id").catch(() => {});
  }

  const expectInactive = async (prepare, restore) => {
    await prepare();
    const inactiveMirror = rowsOf(await database.query(
      'SELECT "ownerAccountActive" FROM public."SellerProfile" WHERE id = $1',
      [seller.sellerProfileId],
    ));
    assert.equal(inactiveMirror[0]?.ownerAccountActive, false);
    await database.query("SELECT pg_catalog.set_config('app.user_id', $1, false)", [seller.userId]);
    await database.query("SET ROLE grainline_app_runtime");
    try {
      await expectSqlState(
        database.query(
          "SELECT * FROM public.grainline_maker_verification_owner_member_apply($1, $2, $3, $4)",
          validMemberArguments,
        ),
        "42501",
      );
    } finally {
      await database.query("RESET ROLE");
      await database.query("RESET app.user_id").catch(() => {});
      await restore();
      const activeMirror = rowsOf(await database.query(
        'SELECT "ownerAccountActive" FROM public."SellerProfile" WHERE id = $1',
        [seller.sellerProfileId],
      ));
      assert.equal(activeMirror[0]?.ownerAccountActive, true);
    }
  };

  await expectInactive(
    () => database.query('UPDATE public."User" SET banned = true WHERE id = $1', [seller.userId]),
    () => database.query('UPDATE public."User" SET banned = false WHERE id = $1', [seller.userId]),
  );
  await expectInactive(
    () => database.query('UPDATE public."User" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = $1', [seller.userId]),
    () => database.query('UPDATE public."User" SET "deletedAt" = NULL WHERE id = $1', [seller.userId]),
  );
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

async function proveStaffPagination({ database, staffId, prefix }) {
  const userPrefix = `${prefix}_page_user_`;
  const sellerPrefix = `${prefix}_page_seller_`;
  const verificationPrefix = `${prefix}_page_verification_`;
  const baseTime = new Date("2026-10-28T12:00:00.000Z");

  await database.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, "createdAt", "updatedAt"
     )
     SELECT $1 || source.n,
            'clerk_' || $1 || source.n,
            $1 || source.n || '@example.test',
            'Pagination maker ' || source.n,
            'USER',
            $2::timestamp,
            $2::timestamp
       FROM pg_catalog.generate_series(1, 55) AS source(n)`,
    [userPrefix, baseTime],
  );
  await database.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "createdAt", "updatedAt"
     )
     SELECT $2 || source.n,
            $1 || source.n,
            'Pagination workshop ' || source.n,
            'pagination workshop ' || source.n,
            $3::timestamp,
            $3::timestamp
       FROM pg_catalog.generate_series(1, 55) AS source(n)`,
    [userPrefix, sellerPrefix, baseTime],
  );
  await database.query(
    `INSERT INTO public."MakerVerification" (
       id, "sellerProfileId", "craftDescription", "yearsExperience", status,
       "appliedAt", "createdAt", "updatedAt"
     )
     SELECT $2 || source.n,
            $1 || source.n,
            'Pagination craft ' || source.n,
            source.n,
            'PENDING'::public."VerificationStatus",
            $3::timestamp + source.n * INTERVAL '1 second',
            $3::timestamp,
            $3::timestamp
       FROM pg_catalog.generate_series(1, 55) AS source(n)`,
    [sellerPrefix, verificationPrefix, baseTime],
  );

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    const memberCount = rowsOf(await database.query(
      "SELECT public.grainline_maker_verification_staff_pending_count($1) AS value",
      [staffId],
    ));
    const memberRows = [];
    let memberCursorAt = null;
    let memberCursorId = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = rowsOf(await database.query(
        `SELECT * FROM public.grainline_maker_verification_staff_pending_page(
           $1, $2, $3, 50
         )`,
        [staffId, memberCursorAt, memberCursorId],
      ));
      memberRows.push(...page);
      if (page.length < 50) break;
      memberCursorAt = page.at(-1).appliedAt;
      memberCursorId = page.at(-1).id;
    }
    assert.equal(memberRows.length, Number(memberCount[0]?.value));
    assert.equal(new Set(memberRows.map((row) => row.id)).size, memberRows.length);
    assert.equal(memberRows.filter((row) => row.id.startsWith(verificationPrefix)).length, 55);
    await assert.rejects(
      database.query(
        "SELECT public.grainline_seller_guild_staff_roster_count($1, NULL)",
        [staffId],
      ),
      (error) => error?.code === "22023",
    );
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_roster_page(
           $1, 'GUILD_MEMBER', NULL, NULL, 101
         )`,
        [staffId],
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  await database.query(
    `UPDATE public."MakerVerification"
        SET status = 'GUILD_MASTER_PENDING'::public."VerificationStatus"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [verificationPrefix],
  );
  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    const masterCount = rowsOf(await database.query(
      "SELECT public.grainline_seller_guild_staff_master_pending_count($1) AS value",
      [staffId],
    ));
    const masterRows = [];
    let masterCursorAt = null;
    let masterCursorId = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = rowsOf(await database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_master_pending_page(
           $1, $2, $3, 50
         )`,
        [staffId, masterCursorAt, masterCursorId],
      ));
      masterRows.push(...page);
      if (page.length < 50) break;
      masterCursorAt = page.at(-1).appliedAt;
      masterCursorId = page.at(-1).id;
    }
    assert.equal(masterRows.length, Number(masterCount[0]?.value));
    assert.equal(new Set(masterRows.map((row) => row.id)).size, masterRows.length);
    assert.equal(masterRows.filter((row) => row.id.startsWith(verificationPrefix)).length, 55);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  const proveRoster = async ({
    cohort,
    level,
    approvalColumn,
    expectedSyntheticRows = 55,
    excludedSellerId = null,
  }) => {
    await database.query(
      `UPDATE public."SellerProfile"
          SET "guildLevel" = $2::public."GuildLevel"
        WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
      [sellerPrefix, level],
    );
    await database.query(
      `UPDATE public."SellerProfilePrivate"
          SET "guildMemberApprovedAt" = CASE
                WHEN $2 = 'guildMemberApprovedAt' THEN $3::timestamp + substring("sellerProfileId" from '[0-9]+$')::integer * INTERVAL '1 second'
                ELSE "guildMemberApprovedAt"
              END,
              "guildMasterApprovedAt" = CASE
                WHEN $2 = 'guildMasterApprovedAt' THEN $3::timestamp + substring("sellerProfileId" from '[0-9]+$')::integer * INTERVAL '1 second'
                ELSE "guildMasterApprovedAt"
              END
        WHERE pg_catalog.left("sellerProfileId", pg_catalog.length($1)) = $1`,
      [sellerPrefix, approvalColumn, baseTime],
    );
    if (cohort === "GUILD_MASTER") {
      await database.query(
        `UPDATE public."SellerProfilePrivate"
            SET "guildMasterApprovedAt" = NULL
          WHERE "sellerProfileId" = $1`,
        [`${sellerPrefix}1`],
      );
    }
    await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
    try {
      const count = rowsOf(await database.query(
        "SELECT public.grainline_seller_guild_staff_roster_count($1, $2) AS value",
        [staffId, cohort],
      ));
      const rosterRows = [];
      let cursorAt = null;
      let cursorId = null;
      for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
        const page = rowsOf(await database.query(
          `SELECT * FROM public.grainline_seller_guild_staff_roster_page(
             $1, $2, $3, $4, 50
           )`,
          [staffId, cohort, cursorAt, cursorId],
        ));
        rosterRows.push(...page);
        if (page.length < 50) break;
        const last = page.at(-1);
        cursorAt = cohort === "GUILD_MASTER"
          ? last.guildMasterApprovedAt
          : last.guildMemberApprovedAt;
        cursorId = last.id;
      }
      assert.equal(rosterRows.length, Number(count[0]?.value));
      assert.equal(new Set(rosterRows.map((row) => row.id)).size, rosterRows.length);
      const syntheticRows = rosterRows.filter((row) => row.id.startsWith(sellerPrefix));
      assert.equal(syntheticRows.length, expectedSyntheticRows);
      if (excludedSellerId !== null) {
        assert.equal(syntheticRows.some((row) => row.id === excludedSellerId), false);
      }
      if (cohort === "GUILD_MASTER") {
        assert.equal(
          syntheticRows.find((row) => row.id === `${sellerPrefix}1`)?.guildMasterApprovedAt,
          null,
        );
      }
    } finally {
      await database.query("RESET SESSION AUTHORIZATION");
    }
  };

  await proveRoster({
    cohort: "GUILD_MEMBER",
    level: "GUILD_MEMBER",
    approvalColumn: "guildMemberApprovedAt",
  });
  await proveRoster({
    cohort: "GUILD_MASTER",
    level: "GUILD_MASTER",
    approvalColumn: "guildMasterApprovedAt",
  });
  await proveRoster({
    cohort: "REVOKED_MEMBER",
    level: "NONE",
    approvalColumn: "guildMemberApprovedAt",
  });
  const reappliedSellerId = `${sellerPrefix}0`;
  await database.query(
    `UPDATE public."MakerVerification"
        SET status = 'PENDING'::public."VerificationStatus"
      WHERE "sellerProfileId" = $1`,
    [reappliedSellerId],
  );
  await proveRoster({
    cohort: "REVOKED_MEMBER",
    level: "NONE",
    approvalColumn: "guildMemberApprovedAt",
    expectedSyntheticRows: 54,
    excludedSellerId: reappliedSellerId,
  });

  await database.query(
    `UPDATE public."SellerProfile"
        SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
            "featuredUntil" = CURRENT_TIMESTAMP + INTERVAL '30 days'
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [sellerPrefix],
  );
  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    const featuredCount = rowsOf(await database.query(
      "SELECT public.grainline_seller_guild_staff_roster_count($1, 'FEATURED') AS value",
      [staffId],
    ));
    const featuredRows = [];
    let featuredCursorAt = null;
    let featuredCursorId = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = rowsOf(await database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_roster_page(
           $1, 'FEATURED', $2, $3, 50
         )`,
        [staffId, featuredCursorAt, featuredCursorId],
      ));
      featuredRows.push(...page);
      if (page.length < 50) break;
      featuredCursorAt = page.at(-1).featuredUntil;
      featuredCursorId = page.at(-1).id;
    }
    assert.equal(featuredRows.length, Number(featuredCount[0]?.value));
    assert.equal(new Set(featuredRows.map((row) => row.id)).size, featuredRows.length);
    assert.equal(featuredRows.filter((row) => row.id.startsWith(sellerPrefix)).length, 55);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  await database.query(
    `DELETE FROM public."MakerVerification"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [verificationPrefix],
  );
  await database.query(
    `DELETE FROM public."SellerProfile"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [sellerPrefix],
  );
  await database.query(
    `DELETE FROM public."User"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [userPrefix],
  );
}

async function proveStaffTransitionMatrix({ database, staffId, prefix }) {
  const userPrefix = `${prefix}_staff_user_`;
  const sellerPrefix = `${prefix}_staff_seller_`;
  const verificationPrefix = `${prefix}_staff_verification_`;
  const employeeId = `${prefix}_staff_employee`;
  const operations = [
    ["approve_member", "APPROVE_GUILD_MEMBER", true],
    ["reject_member", "REJECT_GUILD_MEMBER", false],
    ["revoke_member", "REVOKE_GUILD_MEMBER", false],
    ["approve_master", "APPROVE_GUILD_MASTER", false],
    ["reject_master", "REJECT_GUILD_MASTER", false],
    ["revoke_master", "REVOKE_GUILD_MASTER", false],
    ["reinstate", "REINSTATE_GUILD_MEMBER", false],
  ];
  const keys = operations.map(([key]) => key);

  await database.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, "createdAt", "updatedAt"
     )
     SELECT $1 || source.key,
            'clerk_' || $1 || source.key,
            $1 || source.key || '@example.test',
            'Transition ' || source.key,
            'USER',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
       FROM pg_catalog.unnest($2::text[]) AS source(key)`,
    [userPrefix, keys],
  );
  await database.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "guildLevel",
       "isVerifiedMaker", "ownerAccountActive", "createdAt", "updatedAt"
     )
     SELECT $1 || source.key,
            $2 || source.key,
            'Transition ' || source.key,
            'transition ' || source.key,
            CASE
              WHEN source.key IN ('revoke_member', 'approve_master', 'reject_master')
                THEN 'GUILD_MEMBER'::public."GuildLevel"
              WHEN source.key = 'revoke_master'
                THEN 'GUILD_MASTER'::public."GuildLevel"
              ELSE 'NONE'::public."GuildLevel"
            END,
            source.key IN ('revoke_member', 'approve_master', 'reject_master', 'revoke_master'),
            true,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
       FROM pg_catalog.unnest($3::text[]) AS source(key)`,
    [sellerPrefix, userPrefix, keys],
  );
  await database.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, "createdAt", "updatedAt"
     ) VALUES (
       $1, 'clerk_' || $1, $1 || '@example.test', 'Transition employee',
       'EMPLOYEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [employeeId],
  );
  await database.query(
    `INSERT INTO public."MakerVerification" (
       id, "sellerProfileId", "craftDescription", "yearsExperience", status,
       "appliedAt", "createdAt", "updatedAt"
     )
     SELECT $1 || source.key,
            $2 || source.key,
            'Transition craft ' || source.key,
            10,
            CASE
              WHEN source.key IN ('approve_member', 'reject_member')
                THEN 'PENDING'::public."VerificationStatus"
              WHEN source.key = 'revoke_member'
                THEN 'APPROVED'::public."VerificationStatus"
              WHEN source.key IN ('approve_master', 'reject_master')
                THEN 'GUILD_MASTER_PENDING'::public."VerificationStatus"
              WHEN source.key = 'revoke_master'
                THEN 'GUILD_MASTER_APPROVED'::public."VerificationStatus"
              ELSE 'REJECTED'::public."VerificationStatus"
            END,
            CURRENT_TIMESTAMP - INTERVAL '31 days',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
       FROM pg_catalog.unnest($3::text[]) AS source(key)`,
    [verificationPrefix, sellerPrefix, keys],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate" AS seller_private
        SET "guildMemberApprovedAt" = CURRENT_TIMESTAMP - INTERVAL '31 days',
            "guildMasterApprovedAt" = CASE
              WHEN seller_private."sellerProfileId" = $1 || 'revoke_master'
                THEN CURRENT_TIMESTAMP - INTERVAL '31 days'
              ELSE NULL
            END,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE pg_catalog.left(
              seller_private."sellerProfileId",
              pg_catalog.length($1)
            ) = $1
        AND seller_private."sellerProfileId" NOT IN (
          $1 || 'approve_member',
          $1 || 'reject_member'
        )`,
    [sellerPrefix],
  );
  await database.query(
    `INSERT INTO public."Listing" (
       id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt"
     )
     SELECT $1 || source.n,
            $2 || 'reinstate',
            'Reinstatement listing ' || source.n,
            'Transition-matrix reinstatement proof',
            1000,
            'usd',
            'ACTIVE'::public."ListingStatus",
            'IN_STOCK'::public."ListingType",
            1,
            false,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
       FROM pg_catalog.generate_series(1, 5) AS source(n)`,
    [`${prefix}_staff_listing_`, sellerPrefix],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await expectSqlState(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, 'APPROVE_GUILD_MEMBER', $2, NULL, NULL, false
         )`,
        [staffId, `${verificationPrefix}approve_member`],
      ),
      "42501",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    await expectSqlState(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, NULL, NULL, $2, NULL, false
         )`,
        [staffId, `${sellerPrefix}revoke_member`],
      ),
      "22023",
    );
    await expectSqlState(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, 'APPROVE_GUILD_MEMBER', $2, NULL, NULL, false
         )`,
        [`${userPrefix}approve_member`, `${verificationPrefix}approve_member`],
      ),
      "42501",
    );
    await expectSqlState(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, 'REINSTATE_GUILD_MEMBER', NULL, $2, NULL, false
         )`,
        [employeeId, `${sellerPrefix}reinstate`],
      ),
      "42501",
    );
    await expectSqlState(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, 'APPROVE_GUILD_MEMBER', $2, NULL, NULL, true
         )`,
        [employeeId, `${verificationPrefix}approve_member`],
      ),
      "42501",
    );
    await expectSqlState(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, 'REJECT_GUILD_MEMBER', $2, NULL, $3, false
         )`,
        [staffId, `${verificationPrefix}reject_member`, "x".repeat(2001)],
      ),
      "22023",
    );
    await expectSqlState(
      database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, 'APPROVE_GUILD_MEMBER', $2, $3, NULL, false
         )`,
        [staffId, `${verificationPrefix}approve_member`, `${sellerPrefix}approve_member`],
      ),
      "22023",
    );
    await expectSqlState(
      database.query(
        "SELECT public.grainline_maker_verification_staff_pending_count($1)",
        [`${userPrefix}approve_member`],
      ),
      "42501",
    );
    for (const [key, operation, adminOverride] of operations) {
      const usesVerification = new Set([
        "APPROVE_GUILD_MEMBER",
        "REJECT_GUILD_MEMBER",
        "APPROVE_GUILD_MASTER",
        "REJECT_GUILD_MASTER",
      ]).has(operation);
      const result = rowsOf(await database.query(
        `SELECT * FROM public.grainline_seller_guild_staff_transition(
           $1, $2, $3, $4, $5, $6
         )`,
        [
          staffId,
          operation,
          usesVerification ? `${verificationPrefix}${key}` : null,
          usesVerification ? null : `${sellerPrefix}${key}`,
          operation.startsWith("REJECT_") ? `Matrix reason for ${key}` : null,
          adminOverride,
        ],
      ));
      assert.equal(result.length, 1, operation);
      assert.equal(result[0].applied, true, operation);
      assert.equal(typeof result[0].auditId, "string", operation);
      assert.equal(result[0].sellerProfileId, `${sellerPrefix}${key}`, operation);
      assert.equal(result[0].sellerUserId, `${userPrefix}${key}`, operation);
    }
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  for (const [prepare, restore] of [
    [
      () => database.query('UPDATE public."User" SET banned = true WHERE id = $1', [employeeId]),
      () => database.query('UPDATE public."User" SET banned = false WHERE id = $1', [employeeId]),
    ],
    [
      () => database.query('UPDATE public."User" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = $1', [employeeId]),
      () => database.query('UPDATE public."User" SET "deletedAt" = NULL WHERE id = $1', [employeeId]),
    ],
  ]) {
    await prepare();
    await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
    try {
      await expectSqlState(
        database.query(
          "SELECT public.grainline_maker_verification_staff_pending_count($1)",
          [employeeId],
        ),
        "42501",
      );
    } finally {
      await database.query("RESET SESSION AUTHORIZATION");
      await restore();
    }
  }

  const state = rowsOf(await database.query(
    `SELECT pg_catalog.substr(seller.id, pg_catalog.length($1) + 1) AS key,
            seller."guildLevel"::text AS "guildLevel",
            seller."isVerifiedMaker" AS "isVerifiedMaker",
            verification.status::text AS status,
            verification."reviewNotes" AS "reviewNotes",
            seller_private."guildMemberApprovedAt" AS "guildMemberApprovedAt",
            seller_private."guildMasterApprovedAt" AS "guildMasterApprovedAt"
       FROM public."SellerProfile" AS seller
       JOIN public."SellerProfilePrivate" AS seller_private
         ON seller_private."sellerProfileId" = seller.id
       JOIN public."MakerVerification" AS verification
         ON verification."sellerProfileId" = seller.id
      WHERE pg_catalog.left(seller.id, pg_catalog.length($1)) = $1
      ORDER BY seller.id`,
    [sellerPrefix],
  ));
  const byKey = Object.fromEntries(state.map((row) => [row.key, row]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(byKey).map(([key, row]) => [key, [row.status, row.guildLevel]])),
    {
      approve_master: ["GUILD_MASTER_APPROVED", "GUILD_MASTER"],
      approve_member: ["APPROVED", "GUILD_MEMBER"],
      reinstate: ["APPROVED", "GUILD_MEMBER"],
      reject_master: ["GUILD_MASTER_REJECTED", "GUILD_MEMBER"],
      reject_member: ["REJECTED", "NONE"],
      revoke_master: ["GUILD_MASTER_REJECTED", "GUILD_MEMBER"],
      revoke_member: ["REJECTED", "NONE"],
    },
  );
  assert.equal(byKey.approve_member.isVerifiedMaker, true);
  assert.equal(byKey.reinstate.isVerifiedMaker, true);
  assert.equal(byKey.revoke_member.isVerifiedMaker, false);
  assert.equal(byKey.approve_member.guildMemberApprovedAt instanceof Date, true);
  assert.equal(byKey.approve_master.guildMasterApprovedAt instanceof Date, true);
  assert.equal(byKey.revoke_master.guildMasterApprovedAt, null);
  assert.equal(byKey.reject_member.reviewNotes, "Matrix reason for reject_member");
  assert.equal(
    Number(rowsOf(await database.query(
      `SELECT pg_catalog.count(*) AS value
         FROM public."AdminAuditLog"
        WHERE "adminId" = $1
          AND pg_catalog.left("targetId", pg_catalog.length($2)) = $2`,
      [staffId, sellerPrefix],
    ))[0]?.value),
    7,
  );

  await database.query(
    `DELETE FROM public."AdminAuditLog"
      WHERE "adminId" = $1
        AND pg_catalog.left("targetId", pg_catalog.length($2)) = $2`,
    [staffId, sellerPrefix],
  );
  await database.query(
    `DELETE FROM public."Listing"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [`${prefix}_staff_listing_`],
  );
  await database.query(
    `DELETE FROM public."MakerVerification"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [verificationPrefix],
  );
  await database.query(
    `DELETE FROM public."SellerProfile"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [sellerPrefix],
  );
  await database.query(
    `DELETE FROM public."User"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [userPrefix],
  );
  await database.query('DELETE FROM public."User" WHERE id = $1', [employeeId]);
}

async function proveServiceTransitionMatrix({ database, prefix }) {
  const userPrefix = `${prefix}_service_user_`;
  const sellerPrefix = `${prefix}_service_seller_`;
  const verificationPrefix = `${prefix}_service_verification_`;
  const memberSellerId = `${sellerPrefix}member`;
  const masterSellerId = `${sellerPrefix}master`;

  await database.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, "createdAt", "updatedAt"
     ) VALUES
       ($1 || 'member', 'clerk_' || $1 || 'member', $1 || 'member@example.test',
        'Service member', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ($1 || 'master', 'clerk_' || $1 || 'master', $1 || 'master@example.test',
        'Service master', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [userPrefix],
  );
  await database.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "guildLevel",
       "isVerifiedMaker", "ownerAccountActive", "createdAt", "updatedAt"
     ) VALUES
       ($1, $2 || 'member', 'Service member', 'service member',
        'GUILD_MEMBER', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ($3, $2 || 'master', 'Service master', 'service master',
        'GUILD_MASTER', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [memberSellerId, userPrefix, masterSellerId],
  );
  await database.query(
    `INSERT INTO public."MakerVerification" (
       id, "sellerProfileId", "craftDescription", "yearsExperience", status,
       "appliedAt", "createdAt", "updatedAt"
     ) VALUES
       ($1 || 'member', $2, 'Service member craft', 12, 'APPROVED',
        CURRENT_TIMESTAMP - INTERVAL '60 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ($1 || 'master', $3, 'Service master craft', 20, 'GUILD_MASTER_APPROVED',
        CURRENT_TIMESTAMP - INTERVAL '60 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [verificationPrefix, memberSellerId, masterSellerId],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "guildMemberApprovedAt" = CURRENT_TIMESTAMP - INTERVAL '60 days',
            "guildMasterApprovedAt" = CASE
              WHEN "sellerProfileId" = $2
                THEN CURRENT_TIMESTAMP - INTERVAL '45 days'
              ELSE NULL
            END,
            "listingsBelowThresholdSince" = CASE
              WHEN "sellerProfileId" = $1
                THEN CURRENT_TIMESTAMP - INTERVAL '31 days'
              ELSE NULL
            END,
            "consecutiveMetricFailures" = 0,
            "metricWarningSentAt" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "sellerProfileId" IN ($1, $2)`,
    [memberSellerId, masterSellerId],
  );
  await database.query(
    `INSERT INTO public."SellerMetrics" (
       id, "sellerProfileId", "calculatedAt", "periodMonths",
       "averageRating", "reviewCount", "onTimeShippingRate", "responseRate",
       "totalSalesCents", "completedOrderCount", "activeCaseCount", "accountAgeDays"
     ) VALUES (
       $1, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3), 3,
       4.0, 10, 0.80, 0.80, 50000, 10, 1, 200
     )`,
    [`${prefix}_service_metrics`, masterSellerId],
  );
  const calculatedAt = rowsOf(await database.query(
    `SELECT "calculatedAt" AS value
       FROM public."SellerMetrics"
      WHERE "sellerProfileId" = $1`,
    [masterSellerId],
  ))[0]?.value;
  assert.equal(calculatedAt instanceof Date, true);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    const memberRevocation = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_guild_member_revoke($1)",
      [memberSellerId],
    ));
    assert.equal(memberRevocation.length, 1);
    assert.equal(memberRevocation[0].applied, true);
    assert.equal(memberRevocation[0].guardKind, "listing_threshold");
    assert.equal(typeof memberRevocation[0].auditId, "string");

    const warning = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_guild_metrics_apply($1, $2)",
      [masterSellerId, calculatedAt],
    ));
    assert.equal(warning.length, 1);
    assert.equal(warning[0].action, "MASTER_WARNED");
    assert.equal(typeof warning[0].auditId, "string");
    assert.equal(warning[0].warningSentAt instanceof Date, true);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."SellerProfile"
        SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
            "isVerifiedMaker" = true,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [memberSellerId],
  );
  await database.query(
    `UPDATE public."MakerVerification"
        SET status = 'GUILD_MASTER_PENDING'::public."VerificationStatus",
            "reviewedAt" = NULL,
            "reviewNotes" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "sellerProfileId" = $1`,
    [memberSellerId],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "listingsBelowThresholdSince" = CURRENT_TIMESTAMP - INTERVAL '31 days',
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "sellerProfileId" = $1`,
    [memberSellerId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const pendingMasterRevocation = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_guild_member_revoke($1)",
      [memberSellerId],
    ));
    assert.equal(pendingMasterRevocation.length, 1);
    assert.equal(pendingMasterRevocation[0].applied, true);
    assert.equal(pendingMasterRevocation[0].guardKind, "listing_threshold");
    assert.equal(typeof pendingMasterRevocation[0].auditId, "string");
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "consecutiveMetricFailures" = 1,
            "metricWarningSentAt" = CURRENT_TIMESTAMP - INTERVAL '31 days',
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "sellerProfileId" = $1`,
    [masterSellerId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const downgrade = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_guild_metrics_apply($1, $2)",
      [masterSellerId, calculatedAt],
    ));
    assert.equal(downgrade.length, 1);
    assert.equal(downgrade[0].action, "MASTER_REVOKED");
    assert.equal(typeof downgrade[0].auditId, "string");
  } finally {
    await database.query("RESET ROLE");
  }

  const finalState = rowsOf(await database.query(
    `SELECT seller.id,
            seller."guildLevel"::text AS "guildLevel",
            seller."isVerifiedMaker" AS "isVerifiedMaker",
            verification.status::text AS status,
            seller_private."consecutiveMetricFailures" AS "consecutiveMetricFailures",
            seller_private."metricWarningSentAt" AS "metricWarningSentAt",
            seller_private."guildMasterApprovedAt" AS "guildMasterApprovedAt"
       FROM public."SellerProfile" AS seller
       JOIN public."SellerProfilePrivate" AS seller_private
         ON seller_private."sellerProfileId" = seller.id
       JOIN public."MakerVerification" AS verification
         ON verification."sellerProfileId" = seller.id
      WHERE seller.id IN ($1, $2)
      ORDER BY seller.id`,
    [memberSellerId, masterSellerId],
  ));
  const stateById = Object.fromEntries(finalState.map((row) => [row.id, row]));
  assert.deepEqual(
    [stateById[memberSellerId].status, stateById[memberSellerId].guildLevel],
    ["REJECTED", "NONE"],
  );
  assert.equal(stateById[memberSellerId].isVerifiedMaker, false);
  assert.deepEqual(
    [stateById[masterSellerId].status, stateById[masterSellerId].guildLevel],
    ["GUILD_MASTER_REJECTED", "GUILD_MEMBER"],
  );
  assert.equal(stateById[masterSellerId].isVerifiedMaker, true);
  assert.equal(stateById[masterSellerId].consecutiveMetricFailures, 0);
  assert.equal(stateById[masterSellerId].metricWarningSentAt, null);
  assert.equal(stateById[masterSellerId].guildMasterApprovedAt, null);
  assert.deepEqual(
    rowsOf(await database.query(
      `SELECT action
         FROM public."SystemAuditLog"
        WHERE "targetId" IN ($1, $2)
        ORDER BY action`,
      [memberSellerId, masterSellerId],
    )).map((row) => row.action),
    [
      "AUTO_REVOKE_GUILD_MASTER",
      "AUTO_REVOKE_GUILD_MEMBER",
      "WARN_GUILD_MASTER_METRICS",
    ],
  );

  await database.query(
    `DELETE FROM public."SystemAuditLog" WHERE "targetId" IN ($1, $2)`,
    [memberSellerId, masterSellerId],
  );
  await database.query(
    `DELETE FROM public."SellerMetrics" WHERE "sellerProfileId" = $1`,
    [masterSellerId],
  );
  await database.query(
    `DELETE FROM public."MakerVerification"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [verificationPrefix],
  );
  await database.query(
    `DELETE FROM public."SellerProfile" WHERE id IN ($1, $2)`,
    [memberSellerId, masterSellerId],
  );
  await database.query(
    `DELETE FROM public."User"
      WHERE pg_catalog.left(id, pg_catalog.length($1)) = $1`,
    [userPrefix],
  );
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
        OR procedure.proname IN (
          'grainline_seller_guild_staff_master_pending_count',
          'grainline_seller_guild_staff_master_pending_page',
          'grainline_seller_guild_staff_roster_count',
          'grainline_seller_guild_staff_roster_page'
        )
     ORDER BY procedure.proname
  `));
  assert.equal(catalog.length, 10);
  assert.equal(catalog.every((row) => (
    row.securityDefiner === true
    && row.ownerBypassesRls === true
    && row.publicExecute === false
    && JSON.stringify(row.config) === JSON.stringify(["search_path=pg_catalog"])
  )), true);
  assert.equal(
    catalog.filter((row) => row.name.includes("staff_")).every((row) => (
      row.staffExecute === true && row.runtimeExecute === false
    )),
    true,
  );
  assert.equal(
    catalog.filter((row) => !row.name.includes("staff_")).every((row) => (
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
  await proveStaffPagination({
    database,
    staffId,
    prefix: `${verificationIdPrefix}_pagination`,
  });
  await proveStaffTransitionMatrix({
    database,
    staffId,
    prefix: `${verificationIdPrefix}_transitions`,
  });
  await proveServiceTransitionMatrix({
    database,
    prefix: `${verificationIdPrefix}_transitions`,
  });
  await database.query(
    `UPDATE public."SellerProfile"
        SET "guildLevel" = 'NONE',
            "isVerifiedMaker" = false,
            "ownerAccountActive" = true
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await proveOwnerInputAndActorDenials({ database, seller });

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
    for (const input of [
      [null, null, true],
      ["   ", null, true],
      ["x".repeat(501), null, true],
      ["Valid Master evidence", "http://example.com", true],
      ["Valid Master evidence", `https://example.com/${"x".repeat(500)}`, true],
      ["Valid Master evidence", null, false],
    ]) {
      await expectSqlState(
        database.query(
          "SELECT * FROM public.grainline_maker_verification_owner_master_apply($1, $2, $3)",
          input,
        ),
        "22023",
      );
    }
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
    const retriedRedaction = rowsOf(await database.query(
      `SELECT public.grainline_maker_verification_owner_delete_redact($1) AS redacted`,
      [deletionTime],
    ));
    assert.deepEqual(retriedRedaction, [{ redacted: true }]);
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
  await proveActivationRollbackRoundTrip(database);
}
