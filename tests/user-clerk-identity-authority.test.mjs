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
  });
});
