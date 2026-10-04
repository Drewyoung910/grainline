import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "prisma/migrations/20261003230000_prepare_user_current_clerk_authorities/migration.sql",
);

describe("User current-Clerk authorities", () => {
  it("defines bounded actor and commission projections", () => {
    assert.match(migration, /grainline_user_clerk_actor\(\s*p_clerk_id text/);
    assert.match(migration, /grainline_user_clerk_commission_context\(\s*p_clerk_id text/);
    const actor = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_user_clerk_actor"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_user_clerk_commission_context"),
    );
    assert.match(actor, /RETURNS TABLE \(\s*id text,\s*name text,\s*banned boolean,\s*"deletedAt" timestamp\(3\)/);
    assert.doesNotMatch(actor, /account_user\.(?:email|role|"imageUrl"|"shipping|"notificationPreferences")/);
    const commission = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_user_clerk_commission_context"),
      migration.indexOf("REVOKE ALL ON FUNCTION"),
    );
    assert.match(commission, /LEFT JOIN public\."SellerProfile"/);
    assert.match(commission, /"sellerRadiusMeters" integer/);
    assert.doesNotMatch(commission, /(?:stripeAccountId|shipFrom|notificationPreferences|email)/);
  });

  it("pins both definer functions and grants only runtime execution", () => {
    for (const name of [
      "grainline_user_clerk_actor",
      "grainline_user_clerk_commission_context",
    ]) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
      const block = migration.slice(start, next < 0 ? migration.indexOf("REVOKE ALL", start) : next);
      assert.ok(start >= 0, `${name} must exist`);
      assert.match(block, /SECURITY DEFINER/);
      assert.match(block, /SET search_path = pg_catalog/);
      assert.match(block, /\^\[A-Za-z0-9\._:-\]\{1,255\}\$/);
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${name}\\(text\\)\\s+FROM PUBLIC, grainline_app_runtime`),
      );
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\(text\\)\\s+TO grainline_app_runtime`),
      );
    }
  });

  it("validates and maps both result shapes in the application wrapper", () => {
    const access = source("src/lib/userIdentityAccess.ts");
    assert.match(access, /export async function userClerkActor/);
    assert.match(access, /FROM public\.grainline_user_clerk_actor/);
    assert.match(access, /validUserClerkActor/);
    assert.match(access, /export async function userClerkCommissionContext/);
    assert.match(access, /FROM public\.grainline_user_clerk_commission_context/);
    assert.match(access, /sellerProfile: row\.sellerProfileId === null \? null/);
    assert.match(access, /Number\.isSafeInteger\(row\.sellerRadiusMeters\)/);
  });

  it("isolates the additive migration from historical cutoffs before disposable application", () => {
    const workflow = source(".github/workflows/ci.yml");
    const verify = workflow.indexOf("name: Verify User current-Clerk authority source package");
    const isolate = workflow.indexOf("name: Isolate User current-Clerk authority until historical release guards pass");
    const historical = workflow.indexOf("name: Verify compatible Order checkout receipt authority release");
    const tests = workflow.indexOf("name: Tests");
    const restore = workflow.indexOf("name: Restore User current-Clerk authority source package");
    const apply = workflow.indexOf("name: Apply User current-Clerk authority in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User current-Clerk authority catalog");
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
      /prisma\/migrations\/20261003230000_prepare_user_current_clerk_authorities/,
    );
    assert.match(
      workflow.slice(restore, build),
      /--file=prisma\/migrations\/20261003230000_prepare_user_current_clerk_authorities\/migration\.sql/,
    );
    assert.match(workflow.slice(catalog, build), /pg_catalog\.count\(\*\) = 2/);
    assert.match(workflow.slice(catalog, build), /Audit runtime grants after User current-Clerk authority/);
  });
});
