import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "prisma/migrations/20261003100000_prepare_user_clerk_identity_authority/migration.sql",
);

describe("User Clerk identity authority", () => {
  it("adds separate private-account, narrow-gate, and identity-sync operations", () => {
    assert.match(migration, /grainline_user_clerk_account\(\s*p_clerk_id text/);
    assert.match(migration, /grainline_user_clerk_gate\(\s*p_clerk_id text/);
    assert.match(migration, /grainline_user_clerk_identity_ensure\(/);
    assert.match(migration, /RETURNS SETOF public\."User"/);
    assert.match(
      migration,
      /grainline_user_clerk_gate[\s\S]*RETURNS TABLE \([\s\S]*id text,[\s\S]*role public\."Role",[\s\S]*banned boolean,[\s\S]*"deletedAt" timestamp\(3\),[\s\S]*"termsAcceptedAt" timestamp\(3\),[\s\S]*"termsVersion" text,[\s\S]*"ageAttestedAt" timestamp\(3\)/,
    );
    const gateBlock = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_user_clerk_gate"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_user_clerk_identity_ensure"),
    );
    assert.doesNotMatch(gateBlock, /account_user\.(?:email|name|"imageUrl"|"shipping|"notificationPreferences")/);
  });

  it("serializes identity races and co-commits accepted email history", () => {
    assert.match(migration, /pg_advisory_xact_lock\([\s\S]*hashtextextended\(p_clerk_id, 20261003\)/);
    assert.match(migration, /WHERE account_user\."clerkId" = p_clerk_id[\s\S]*FOR UPDATE/);
    assert.match(migration, /constraint_name = 'User_clerkId_key'[\s\S]*CONTINUE ensure_account/);
    assert.match(migration, /constraint_name <> 'User_email_key'/);
    assert.match(migration, /'ensure_user_create_email_conflict'/);
    assert.equal(
      (migration.match(/PERFORM public\.grainline_user_email_address_sync\(/g) ?? []).length,
      2,
    );
    assert.doesNotMatch(migration, /^\s*EXECUTE\b/im);
    assert.doesNotMatch(migration, /\bformat\s*\(/i);
  });

  it("keeps all three operations path-pinned and runtime-only", () => {
    for (const name of [
      "grainline_user_clerk_account",
      "grainline_user_clerk_gate",
      "grainline_user_clerk_identity_ensure",
    ]) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
      const block = migration.slice(start, next < 0 ? migration.indexOf("REVOKE ALL", start) : next);
      assert.ok(start >= 0, `${name} must exist`);
      assert.match(block, /SECURITY DEFINER/);
      assert.match(block, /SET search_path = pg_catalog/);
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?FROM PUBLIC, grainline_app_runtime`),
      );
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?TO grainline_app_runtime`),
      );
    }
  });

  it("routes request bootstrap and identity sync through the bounded wrappers", () => {
    const access = source("src/lib/userIdentityAccess.ts");
    const ensureUser = source("src/lib/ensureUser.ts");
    const ensureSeller = source("src/lib/ensureSeller.ts");
    const middleware = source("src/middleware.ts");

    assert.match(access, /grainline_user_clerk_account/);
    assert.match(access, /grainline_user_clerk_gate/);
    assert.match(access, /grainline_user_clerk_identity_ensure/);
    assert.match(ensureUser, /ensureUserIdentityByClerkId\(tx, identity\)/);
    assert.match(ensureSeller, /userAccountByClerkId\(prisma, userId\)/);
    assert.match(middleware, /userClerkGate\(prisma, userId\)/);

    for (const applicationSource of [ensureUser, ensureSeller, middleware]) {
      assert.doesNotMatch(applicationSource, /\b(?:prisma|tx)\.user\./);
    }

    const gateCallers = [
      "src/app/admin/actions.ts",
      "src/app/admin/blog/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/admin/layout.tsx",
      "src/app/admin/orders/[id]/refundReconciliationActions.ts",
      "src/app/admin/support/actions.ts",
      "src/app/admin/verification/page.tsx",
      "src/app/api/admin/audit/[id]/undo/route.ts",
      "src/app/api/admin/email/route.ts",
      "src/app/api/admin/listings/[id]/review/route.ts",
      "src/app/api/admin/listings/[id]/route.ts",
      "src/app/api/admin/reports/[id]/resolve/route.ts",
      "src/app/api/admin/reviews/[id]/route.ts",
      "src/app/api/admin/users/[id]/ban/route.ts",
      "src/app/api/admin/verify-pin/route.ts",
      "src/app/dashboard/blog/[id]/edit/page.tsx",
      "src/app/dashboard/blog/new/page.tsx",
      "src/app/listing/[id]/page.tsx",
      "src/lib/adminPageAccess.ts",
    ];
    const gateCalls = gateCallers.reduce((count, path) => {
      const text = source(path);
      assert.match(text, /import \{ userClerkGate \} from ["']@\/lib\/userIdentityAccess["']/);
      assert.doesNotMatch(
        text,
        /prisma\.user\.findUnique\(\{[\s\S]*?where:\s*\{\s*clerkId[\s\S]*?select:\s*\{\s*id:\s*true,\s*role:\s*true,\s*banned:\s*true,\s*deletedAt:\s*true/,
      );
      return count + (text.match(/userClerkGate\(prisma,\s*(?:userId|uid|clerkId)\)/g) ?? []).length;
    }, 0);
    assert.equal(gateCalls, 21);
  });

  it("isolates the package from historical cutoffs, then proves it in disposable PostgreSQL", () => {
    const workflow = source(".github/workflows/ci.yml");
    const verify = workflow.indexOf(
      "name: Verify User Clerk identity authority source package",
    );
    const isolate = workflow.indexOf(
      "name: Isolate User Clerk identity authority until historical release guards pass",
    );
    const emailVerify = workflow.indexOf(
      "name: Verify UserEmailAddress authority source package",
    );
    const historical = workflow.indexOf(
      "name: Verify compatible Order checkout receipt authority release",
    );
    const tests = workflow.indexOf("name: Tests");
    const emailRestore = workflow.indexOf(
      "name: Restore UserEmailAddress authority source package",
    );
    const emailReverify = workflow.indexOf(
      "name: Re-verify UserEmailAddress authority source package",
    );
    const emailStage = workflow.indexOf(
      "name: Stage only corrected UserEmailAddress package for Prisma",
    );
    const restore = workflow.indexOf(
      "name: Restore User Clerk identity authority source package",
    );
    const apply = workflow.indexOf(
      "name: Apply User Clerk identity authority in disposable PostgreSQL",
    );
    const catalog = workflow.indexOf(
      "name: Verify User Clerk identity authority catalog",
    );
    const build = workflow.indexOf("name: Production build");

    assert.ok(verify >= 0);
    assert.ok(verify < emailVerify);
    assert.ok(emailVerify < isolate);
    assert.ok(isolate < historical);
    assert.ok(historical < tests);
    assert.ok(tests < restore);
    assert.ok(tests < emailRestore);
    assert.ok(emailRestore < emailReverify);
    assert.ok(emailReverify < emailStage);
    assert.ok(emailStage < restore);
    assert.ok(historical < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < build);
    assert.match(
      workflow.slice(isolate, historical),
      /mv \\\s+prisma\/migrations\/20261003100000_prepare_user_clerk_identity_authority \\\s+"\$holding\/migration"/u,
    );
    assert.match(
      workflow.slice(tests, restore),
      /USER_CLERK_IDENTITY_MIGRATION_PATH: \$\{\{ runner\.temp \}\}\/user-clerk-identity-authority\/migration\/migration\.sql/u,
    );
    assert.match(
      workflow.slice(emailReverify, emailStage),
      /USER_CLERK_IDENTITY_MIGRATION_PATH: \$\{\{ runner\.temp \}\}\/user-clerk-identity-authority\/migration\/migration\.sql/u,
    );
    assert.match(
      workflow.slice(restore, build),
      /--file=prisma\/migrations\/20261003100000_prepare_user_clerk_identity_authority\/migration\.sql/u,
    );
    assert.match(
      workflow.slice(catalog, build),
      /Audit runtime grants after User Clerk identity authority/u,
    );
  });
});
