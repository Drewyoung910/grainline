import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "prisma/migrations/20261004000000_prepare_user_clerk_provider_lifecycle/migration.sql",
);

describe("User Clerk provider lifecycle authority", () => {
  it("defines a bounded provider snapshot and atomic welcome reservation", () => {
    const snapshotStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_user_clerk_lifecycle_state",
    );
    const reserveStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_user_clerk_welcome_reserve",
    );
    const snapshot = migration.slice(snapshotStart, reserveStart);
    const reserve = migration.slice(reserveStart, migration.indexOf("REVOKE ALL", reserveStart));

    assert.ok(snapshotStart >= 0);
    assert.ok(reserveStart > snapshotStart);
    assert.match(
      snapshot,
      /RETURNS TABLE \(\s*id text,\s*email text,\s*banned boolean,\s*"deletedAt" timestamp\(3\)/,
    );
    assert.doesNotMatch(
      snapshot,
      /account_user\.(?:role|name|"imageUrl"|"shipping|"notificationPreferences")/,
    );
    assert.match(snapshot, /WHEN account_user\.banned OR account_user\."deletedAt" IS NOT NULL THEN NULL/);
    assert.match(reserve, /AND account_user\.id = p_user_id/);
    assert.match(reserve, /AND account_user\.banned = false/);
    assert.match(reserve, /AND account_user\."deletedAt" IS NULL/);
    assert.match(reserve, /AND account_user\."welcomeEmailSentAt" IS NULL/);
    assert.match(reserve, /SET "welcomeEmailSentAt" = changed_at,\s*"updatedAt" = changed_at/);
  });

  it("pins both definer functions and exposes execution only to runtime", () => {
    for (const signature of [
      "grainline_user_clerk_lifecycle_state\\(text\\)",
      "grainline_user_clerk_welcome_reserve\\(text, text\\)",
    ]) {
      const name = signature.slice(0, signature.indexOf("\\"));
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
      const block = migration.slice(start, next < 0 ? migration.indexOf("REVOKE ALL", start) : next);
      assert.ok(start >= 0, `${name} must exist`);
      assert.match(block, /SECURITY DEFINER/);
      assert.match(block, /SET search_path = pg_catalog/);
      assert.match(block, /\^\[A-Za-z0-9\._:-\]\{1,255\}\$/);
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${signature}\\s+FROM PUBLIC, grainline_app_runtime`),
      );
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${signature}\\s+TO grainline_app_runtime`),
      );
    }
  });

  it("routes the signed Clerk lifecycle through validated wrappers", () => {
    const route = source("src/app/api/clerk/webhook/route.ts");
    const access = source("src/lib/userIdentityAccess.ts");

    assert.match(access, /export async function userClerkLifecycleState/);
    assert.match(access, /FROM public\.grainline_user_clerk_lifecycle_state/);
    assert.match(access, /validUserClerkLifecycleState/);
    assert.match(access, /export async function reserveUserClerkWelcomeEmail/);
    assert.match(access, /SELECT public\.grainline_user_clerk_welcome_reserve/);
    assert.match(access, /typeof outcome\.reserved !== "boolean"/);
    assert.match(route, /existingLocalUser = await userClerkLifecycleState\(prisma, id\)/);
    assert.match(route, /reserveUserClerkWelcomeEmail\(prisma, \{\s*clerkId: id,\s*userId: user\.id/);
    assert.doesNotMatch(route, /prisma\.user\.(?:findUnique|updateMany)/);
  });

  it("isolates the additive migration before historical guards and proves its catalog afterward", () => {
    const workflow = source(".github/workflows/ci.yml");
    const verify = workflow.indexOf("name: Verify User Clerk provider lifecycle source package");
    const isolate = workflow.indexOf("name: Isolate User Clerk provider lifecycle until historical release guards pass");
    const historical = workflow.indexOf("name: Verify compatible Order checkout receipt authority release");
    const tests = workflow.indexOf("name: Tests");
    const restore = workflow.indexOf("name: Restore User Clerk provider lifecycle source package");
    const apply = workflow.indexOf("name: Apply User Clerk provider lifecycle in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User Clerk provider lifecycle catalog");
    const build = workflow.indexOf("name: Production build");

    assert.ok(verify >= 0);
    assert.ok(verify < isolate);
    assert.ok(isolate < historical);
    assert.ok(historical < tests);
    assert.ok(tests < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < build);
    assert.match(
      workflow.slice(isolate, historical),
      /prisma\/migrations\/20261004000000_prepare_user_clerk_provider_lifecycle/,
    );
    assert.match(
      workflow.slice(restore, build),
      /--file=prisma\/migrations\/20261004000000_prepare_user_clerk_provider_lifecycle\/migration\.sql/,
    );
    assert.match(workflow.slice(catalog, build), /pg_catalog\.count\(\*\) = 2/);
    assert.match(workflow.slice(catalog, build), /grainline_user_clerk_welcome_reserve/);
    assert.match(workflow.slice(catalog, build), /procedure\.provolatile = 'v'/);
    assert.match(workflow.slice(catalog, build), /Audit runtime grants after User Clerk provider lifecycle/);
  });
});
