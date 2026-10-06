import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261006010000_prepare_user_staff_ban_authorities/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const runtimeProvisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const staffProvisioning = readFileSync("scripts/provision-order-staff-read-role.sql", "utf8");

async function asSession(database, role, callback) {
  await database.exec(`SET SESSION AUTHORIZATION ${role}`);
  try {
    return await callback();
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION");
  }
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      name varchar(100),
      role public."Role" NOT NULL DEFAULT 'USER',
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT now(),
      "deletedAt" timestamp(3) without time zone,
      banned boolean NOT NULL DEFAULT false,
      "bannedAt" timestamp(3) without time zone,
      "banReason" varchar(500),
      "bannedBy" varchar(255)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      "stripeAccountId" varchar(255)
    );
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY,
      "adminId" text NOT NULL REFERENCES public."User"(id),
      action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL,
      "targetId" varchar(255) NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      undone boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."OrderStaffCapability" (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "actorUserId" text NOT NULL,
      "targetUserId" text NOT NULL,
      operation varchar(32) NOT NULL,
      "payloadHash" varchar(64),
      "expiresAt" timestamp(3) with time zone NOT NULL,
      "createdAt" timestamp(3) with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "OrderStaffCapability_operation_check"
        CHECK (operation IN ('BAN_REVIEW_FLAG', 'BAN_REVIEW_RESTORE')),
      CONSTRAINT "OrderStaffCapability_payload_check"
        CHECK (
          (operation = 'BAN_REVIEW_FLAG' AND "payloadHash" IS NULL)
          OR (operation = 'BAN_REVIEW_RESTORE' AND "payloadHash" ~ '^[a-f0-9]{64}$')
        )
    );
    ALTER TABLE public."OrderStaffCapability" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."OrderStaffCapability" FORCE ROW LEVEL SECURITY;
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", banned, "bannedAt", "deletedAt"
    ) VALUES
      ('admin_one', 'clerk_admin_one', 'admin@example.com', 'Admin', 'ADMIN', '2026-10-01', false, NULL, NULL),
      ('admin_two', 'clerk_admin_two', 'admin2@example.com', 'Admin Two', 'ADMIN', '2026-10-01', false, NULL, NULL),
      ('employee', 'clerk_employee', 'employee@example.com', 'Employee', 'EMPLOYEE', '2026-10-02', false, NULL, NULL),
      ('active_one', 'clerk_active_one', 'active@example.com', 'Active', 'USER', '2026-10-03', false, NULL, NULL),
      ('banned_one', 'clerk_banned_one', 'banned@example.com', 'Banned', 'USER', '2026-10-04', true, '2026-10-04 12:00:00', NULL),
      ('deleted_one', 'clerk_deleted_one', 'deleted@example.com', 'Deleted', 'USER', '2026-10-05', false, NULL, '2026-10-05');
    INSERT INTO public."SellerProfile" (id, "userId", "displayName", "stripeAccountId")
    VALUES ('seller_active', 'active_one', 'Active Shop', 'acct_test');
    INSERT INTO public."AdminAuditLog" (
      id, "adminId", action, "targetType", "targetId", metadata, undone
    ) VALUES
      (
        'audit_banned_one', 'admin_one', 'BAN_USER', 'USER', 'banned_one',
        '{"externalSyncVersion":1,"appliedBannedAt":"2026-10-04T12:00:00.000Z"}'::jsonb,
        false
      ),
      (
        'audit_wrong_timestamp', 'admin_one', 'BAN_USER', 'USER', 'banned_one',
        '{"externalSyncVersion":1,"appliedBannedAt":"2026-10-04T12:00:01.000Z"}'::jsonb,
        false
      ),
      (
        'audit_undone', 'admin_one', 'BAN_USER', 'USER', 'banned_one',
        '{"externalSyncVersion":1,"appliedBannedAt":"2026-10-04T12:00:00.000Z"}'::jsonb,
        true
      );
    REVOKE ALL ON TABLE public."User", public."SellerProfile",
      public."AdminAuditLog", public."OrderStaffCapability"
      FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime, grainline_untrusted;
  `);
  await database.exec(migration);
  return database;
}

test("isolated staff projections stay bounded and shared runtime cannot forge an actor", async () => {
  const database = await createDatabase();
  try {
    await asSession(database, "grainline_staff_read_runtime", async () => {
      assert.deepEqual(
        (await database.query(`SELECT public.grainline_user_staff_directory_count('admin_one', 'active') AS value`)).rows,
        [{ value: 1 }],
      );
      const page = (await database.query(`
        SELECT * FROM public.grainline_user_staff_directory_page('admin_one', '', 1)
      `)).rows;
      assert.equal(page.length, 6);
      assert.equal(page.find((row) => row.id === "active_one").sellerDisplayName, "Active Shop");
      assert.deepEqual(
        (await database.query(`SELECT * FROM public.grainline_user_staff_exact_email_target('admin_one', 'active@example.com')`)).rows,
        [{ id: "active_one", name: "Active", email: "active@example.com" }],
      );
      const labels = (await database.query(`
        SELECT * FROM public.grainline_user_staff_report_labels(
          'employee', ARRAY['deleted_one', 'active_one']::text[]
        )
      `)).rows;
      assert.deepEqual(labels.map((row) => row.id), ["deleted_one", "active_one"]);
      assert.equal((await database.query(`
        SELECT * FROM public.grainline_user_staff_email_recipient(
          'admin_one', 'banned_one', NULL
        )
      `)).rows[0].banned, true);
    });
    await asSession(database, "grainline_app_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT public.grainline_user_staff_directory_count('admin_one', '')`),
        /permission denied for function grainline_user_staff_directory_count/,
      );
      await assert.rejects(
        database.query(`SELECT public.grainline_user_staff_capability_mint(
          'admin_one', 'active_one', 'USER_BAN', NULL
        )`),
        /permission denied for function grainline_user_staff_capability_mint/,
      );
    });
    await asSession(database, "grainline_staff_read_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_user_staff_ban_apply(
          'missing', 'active_one', '2026-10-05 18:00:00'::timestamp, 'Denied'
        )`),
        /permission denied for function grainline_user_staff_ban_apply/,
      );
    });
  } finally {
    await database.close();
  }
});

test("ban and unban mutations consume exact one-use staff capabilities", async () => {
  const database = await createDatabase();
  try {
    await asSession(database, "grainline_staff_read_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT public.grainline_user_staff_capability_mint(
          'employee', 'active_one', 'USER_BAN', NULL
        )`),
        /User staff actor is not authorized/,
      );
      await assert.rejects(
        database.query(`SELECT public.grainline_user_staff_capability_mint(
          'admin_one', 'admin_two', 'USER_BAN', NULL
        )`),
        /Cannot change admin ban state/,
      );
      await assert.rejects(
        database.query(`SELECT public.grainline_user_staff_capability_mint(
          'admin_one', 'deleted_one', 'USER_BAN', NULL
        )`),
        /User not found/,
      );
    });
    const banCapability = await asSession(database, "grainline_staff_read_runtime", async () =>
      (await database.query(`SELECT public.grainline_user_staff_capability_mint(
        'admin_one', 'active_one', 'USER_BAN', NULL
      ) AS id`)).rows[0].id,
    );
    const appliedAt = "2026-10-05 18:00:00";
    await asSession(database, "grainline_app_runtime", async () => {
      assert.deepEqual((await database.query(`
        SELECT * FROM public.grainline_user_staff_ban_apply(
          '${banCapability}', 'active_one', '${appliedAt}'::timestamp, 'Reviewed abuse'
        )
      `)).rows, [{ clerkId: "clerk_active_one" }]);
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_user_staff_ban_apply(
          '${banCapability}', 'active_one', '${appliedAt}'::timestamp, 'Replay'
        )`),
        /User ban capability is invalid or expired/,
      );
    });

    const unbanCapability = await asSession(database, "grainline_staff_read_runtime", async () =>
      (await database.query(`SELECT public.grainline_user_staff_capability_mint(
        'admin_two', 'active_one', 'USER_UNBAN', '${appliedAt}'::timestamp
      ) AS id`)).rows[0].id,
    );
    await asSession(database, "grainline_app_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_user_staff_unban_apply(
          '${unbanCapability}', 'active_one', '2026-10-05 17:59:00'::timestamp
        )`),
        /User unban capability is invalid or expired/,
      );
      const unbanned = (await database.query(`
        SELECT * FROM public.grainline_user_staff_unban_apply(
          '${unbanCapability}', 'active_one', '${appliedAt}'::timestamp
        )
      `)).rows[0];
      assert.equal(unbanned.clerkId, "clerk_active_one");
      assert.equal(unbanned.banned, true);
      assert.equal(unbanned.banReason, "Reviewed abuse");
    });
  } finally {
    await database.close();
  }
});

test("repair projection is bound to the exact active ban audit record", async () => {
  const database = await createDatabase();
  try {
    await asSession(database, "grainline_staff_read_runtime", async () => {
      const exact = (await database.query(`SELECT * FROM public.grainline_user_ban_repair_target(
        'audit_banned_one', 'banned_one'
      )`)).rows;
      assert.equal(exact.length, 1);
      assert.equal(exact[0].clerkId, "clerk_banned_one");
      assert.deepEqual((await database.query(`SELECT * FROM public.grainline_user_ban_repair_target(
        'audit_banned_one', 'active_one'
      )`)).rows, []);
      assert.deepEqual((await database.query(`SELECT * FROM public.grainline_user_ban_repair_target(
        'audit_wrong_timestamp', 'banned_one'
      )`)).rows, []);
      assert.deepEqual((await database.query(`SELECT * FROM public.grainline_user_ban_repair_target(
        'audit_undone', 'banned_one'
      )`)).rows, []);
    });
  } finally {
    await database.close();
  }
});

test("source conversion and role convergence expose only the reviewed surfaces", () => {
  for (const path of [
    "src/app/admin/reports/page.tsx",
    "src/app/admin/users/page.tsx",
    "src/app/api/admin/email/route.ts",
    "src/app/api/admin/users/[id]/ban/route.ts",
    "src/lib/audit.ts",
    "src/lib/ban.ts",
    "src/lib/banSideEffectRepair.ts",
  ]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /(?:prisma|tx)\.user\./u, path);
  }
  assert.equal((migration.match(/SECURITY DEFINER/gu) ?? []).length, 10);
  assert.equal((migration.match(/SET search_path = pg_catalog/gu) ?? []).length, 10);
  assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/gu) ?? []).length, 10);
  assert.equal((migration.match(/TO grainline_staff_read_runtime/gu) ?? []).length, 8);
  assert.equal((migration.match(/TO grainline_app_runtime/gu) ?? []).length, 2);
  assert.match(migration, /SESSION_USER <> 'grainline_staff_read_runtime'/u);
  assert.match(migration, /operation = 'USER_BAN'/u);
  assert.match(migration, /operation = 'USER_UNBAN'/u);
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/u);
  for (const name of [
    "grainline_user_staff_directory_count",
    "grainline_user_staff_directory_page",
    "grainline_user_staff_exact_email_target",
    "grainline_user_staff_report_labels",
    "grainline_user_staff_email_recipient",
    "grainline_user_staff_ban_target",
    "grainline_user_staff_capability_mint",
    "grainline_user_ban_repair_target",
  ]) {
    assert.match(staffProvisioning, new RegExp(name, "u"), name);
    const privateConvergence = runtimeProvisioning.match(/WITH user_isolated_staff_private\(function_signature\) AS \([\s\S]*?;\n\\gexec/u)?.[0];
    assert.ok(privateConvergence, "isolated staff revocation convergence is required");
    assert.match(privateConvergence, new RegExp(name, "u"), name);
    assert.match(privateConvergence, /REVOKE ALL ON FUNCTION/u);
    assert.doesNotMatch(privateConvergence, /GRANT EXECUTE/u);
  }
  for (const name of [
    "grainline_user_staff_ban_apply",
    "grainline_user_staff_unban_apply",
  ]) {
    assert.match(runtimeProvisioning, new RegExp(name, "u"), name);
  }
});
