import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import yaml from "js-yaml";

const migration = readFileSync(
  "prisma/migrations/20261007150000_prepare_user_staff_admin_labels/migration.sql",
  "utf8",
);

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
      email varchar(254) NOT NULL UNIQUE,
      name varchar(100),
      role public."Role" NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO public."User" (id, email, name, role, banned, "deletedAt") VALUES
      ('admin_one', 'admin@example.com', 'Admin', 'ADMIN', false, NULL),
      ('employee', 'employee@example.com', 'Employee', 'EMPLOYEE', false, NULL),
      ('active_one', 'active@example.com', 'Active', 'USER', false, NULL),
      ('deleted_one', 'deleted@example.com', 'Deleted', 'USER', false, '2026-10-05'),
      ('banned_staff', 'banned-staff@example.com', 'Banned Staff', 'EMPLOYEE', true, NULL);
    REVOKE ALL ON TABLE public."User"
      FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime, grainline_untrusted;
  `);
  await database.exec(migration);
  return database;
}

test("staff admin labels are bounded, ordered, deduplicated, and isolated", async () => {
  const database = await createDatabase();
  try {
    await asSession(database, "grainline_staff_read_runtime", async () => {
      const labels = (await database.query(`
        SELECT * FROM public.grainline_user_staff_admin_labels(
          'employee', ARRAY['deleted_one', 'active_one', 'deleted_one', 'missing']::text[]
        )
      `)).rows;
      assert.deepEqual(labels.map((row) => row.id), ["deleted_one", "active_one"]);
      assert.equal(labels[0].deletedAt instanceof Date, true);
      assert.equal(labels[1].email, "active@example.com");
      assert.equal(labels[1].createdAt instanceof Date, true);

      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_user_staff_admin_labels(
          'banned_staff', ARRAY['active_one']::text[]
        )`),
        /User staff actor is not authorized/,
      );
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_user_staff_admin_labels(
          'admin_one', ARRAY(SELECT 'active_one' FROM generate_series(1, 201))
        )`),
        /User staff admin-label input is invalid/,
      );
    });

    await asSession(database, "grainline_app_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_user_staff_admin_labels(
          'admin_one', ARRAY['active_one']::text[]
        )`),
        /permission denied for function grainline_user_staff_admin_labels/,
      );
    });
    await asSession(database, "grainline_untrusted", async () => {
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_user_staff_admin_labels(
          'admin_one', ARRAY['active_one']::text[]
        )`),
        /permission denied for function grainline_user_staff_admin_labels/,
      );
    });
  } finally {
    await database.close();
  }
});

test("staff admin label source keeps the isolated role and bounded callers", () => {
  const access = readFileSync("src/lib/userStaffAccess.ts", "utf8");
  const pages = [
    "src/app/admin/audit/page.tsx",
    "src/app/admin/blog/page.tsx",
    "src/app/admin/broadcasts/page.tsx",
    "src/app/admin/reports/page.tsx",
    "src/app/admin/reviews/page.tsx",
    "src/app/admin/support/page.tsx",
    "src/app/admin/verification/page.tsx",
  ].map((path) => readFileSync(path, "utf8"));
  const verification = pages.at(-1);
  const listingReview = readFileSync("src/app/api/admin/listings/[id]/review/route.ts", "utf8");

  assert.match(access, /input\.userIds\.length > 200/);
  assert.match(access, /grainline_user_staff_admin_labels/);
  assert.match(migration, /account_user\."createdAt"/);
  for (const page of pages) {
    assert.match(page, /userStaffAdminLabels\(getOrderStaffReadClient\(\), \{/);
  }
  assert.match(verification, /sellerAccount\.createdAt\.getTime\(\)/);
  assert.match(verification, /ownerAccountActive: true/);
  assert.doesNotMatch(verification, /user:\s*\{\s*(?:select|banned|deletedAt)/);
  assert.match(listingReview, /ownerAccountActive: true/);
  assert.doesNotMatch(listingReview, /user:\s*\{\s*(?:select|banned|deletedAt)/);
});

test("CI keeps the staff catalog pair isolated until the follower predecessor passes", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.doesNotThrow(() => yaml.load(workflow, { schema: yaml.JSON_SCHEMA }));
  const step = (name) => {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    assert.ok(start >= 0, name);
    const next = workflow.indexOf("\n      - ", start + 1);
    return workflow.slice(start, next < 0 ? undefined : next);
  };

  const verify = workflow.indexOf("name: Verify User staff admin-label source package");
  const isolate = workflow.indexOf("name: Isolate User staff admin labels until follower passes");
  const followerApply = workflow.indexOf("name: Apply User follower authorities in disposable PostgreSQL");
  const restore = workflow.indexOf("name: Restore User staff admin-label source package");
  const apply = workflow.indexOf("name: Apply User staff admin-label authority in disposable PostgreSQL");
  const catalog = workflow.indexOf("name: Verify User staff admin-label authority catalog");
  const build = workflow.indexOf("name: Production build");
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < followerApply && followerApply < restore);
  assert.ok(restore < apply && apply < catalog && catalog < build);

  const isolateBody = step("Isolate User staff admin labels until follower passes");
  assert.match(isolateBody, /mv scripts\/user-authority-catalog\.mjs "\$holding\/user-authority-catalog-script"/);
  assert.match(isolateBody, /20261007150000_prepare_user_staff_admin_labels/);
  const accumulatedRestore = step("Restore accumulated User access source package");
  assert.match(accumulatedRestore, /"\$staff_holding\/user-authority-catalog-test"/);
  assert.match(accumulatedRestore, /"\$follower_holding\/user-authority-catalog-test"/);
  const restoreBody = step("Restore User staff admin-label source package");
  assert.match(restoreBody, /"\$holding\/user-authority-catalog-script"/);
  assert.match(restoreBody, /"\$holding\/user-authority-catalog-test"/);
});
