import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("UserEmailAddress authority preparation", () => {
  it("removes direct application table access in favor of four narrow authorities", () => {
    const helper = source("src/lib/userEmailAddresses.ts");
    const ownerWrapper = source("src/lib/userEmailAddressOwnerAccess.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const unsubscribe = source("src/lib/unsubscribe.ts");
    const migration = source(
      "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
    );

    assert.match(helper, /grainline_user_email_address_sync/);
    assert.doesNotMatch(
      migration,
      /grainline_user_email_address_sync\(\s*p_user_id text,\s*p_previous_email text/,
    );
    assert.match(helper, /grainline_user_email_address_owner_rows/);
    assert.match(helper, /grainline_user_email_address_delete_for_current_user/);
    assert.match(ownerWrapper, /withDbUserContext/);
    assert.match(deletion, /deleteCurrentUserEmailAddressHistory\(tx\)/);
    assert.match(unsubscribe, /grainline_user_email_address_newer_current_claim/);

    for (const applicationSource of [helper, deletion, unsubscribe]) {
      assert.doesNotMatch(applicationSource, /\.userEmailAddress\./);
      assert.doesNotMatch(applicationSource, /FROM\s+"UserEmailAddress"/);
      assert.doesNotMatch(applicationSource, /(?:INSERT|UPDATE|DELETE)\s+(?:FROM\s+)?"UserEmailAddress"/);
    }
  });

  it("binds owner reads and deletion to transaction-local app.user_id", () => {
    const migration = source(
      "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
    );

    assert.match(migration, /grainline_user_email_address_owner_rows\(\)[\s\S]*current_setting\('app\.user_id', true\)/);
    assert.match(migration, /grainline_user_email_address_delete_for_current_user\(\)[\s\S]*current_setting\('app\.user_id', true\)/);
    assert.match(migration, /DELETE FROM public\."UserEmailAddress" AS address[\s\S]*address\."userId" = request_user_id/);
    assert.doesNotMatch(migration, /grainline_user_email_address_owner_rows\([^)]*p_user_id/);
    assert.doesNotMatch(migration, /grainline_user_email_address_delete_for_current_user\([^)]*p_user_id/);
  });

  it("keeps each authority security-definer, path-pinned, and runtime-only", () => {
    const migration = source(
      "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
    );
    const names = [
      "grainline_user_email_address_sync",
      "grainline_user_email_address_owner_rows",
      "grainline_user_email_address_delete_for_current_user",
      "grainline_user_email_address_newer_current_claim",
    ];

    for (const name of names) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
      const block = migration.slice(start, next < 0 ? migration.indexOf("REVOKE ALL", start) : next);
      assert.ok(start >= 0, `${name} must exist`);
      assert.match(block, /SECURITY DEFINER/);
      assert.match(block, /SET search_path = pg_catalog/);
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?FROM PUBLIC, grainline_app_runtime`));
      assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?TO grainline_app_runtime`));
    }
  });

  it("backs both suppression-key lookups with matching partial indexes", () => {
    const indexes = source(
      "prisma/migrations/20261002160000_add_user_email_suppression_key_index/migration.sql",
    );
    const authority = source(
      "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
    );

    assert.match(indexes, /User_active_email_suppression_key_idx/);
    assert.match(indexes, /UserEmailAddress_current_suppression_key_idx/);
    assert.match(indexes, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "UserEmailAddress_one_current_per_user_key"/);
    assert.match(indexes, /ON "UserEmailAddress" \("userId"\)\s+WHERE "isCurrent" = true/);
    assert.match(indexes, /WHERE "isCurrent" = true/);
    assert.match(indexes, /"currentSinceAt" DESC/);
    assert.match(authority, /address\."isCurrent" = true/);
    assert.match(authority, /address\."currentSinceAt" > p_issued_at/);
    assert.match(authority, /END = ANY\(p_suppression_keys\)/);
  });
});
