import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildUserRlsEnableMigration,
  USER_RLS_ENABLE_RELEASE,
  verifyCommittedUserRlsEnableMigration,
} from "../scripts/build-user-rls-enable-candidate.mjs";
import {
  buildUserInstalledCatalogExpectation,
} from "../scripts/user-installed-catalog-production-inspect.mjs";

const migration = readFileSync(USER_RLS_ENABLE_RELEASE.migrationPath, "utf8");

test("User ENABLE migration is generated exactly from the reviewed authority catalog", () => {
  assert.equal(migration, buildUserRlsEnableMigration());
  assert.deepEqual(verifyCommittedUserRlsEnableMigration(), {
    migrationName: "20261008010000_enable_user_rls",
    migrationPath:
      "prisma/migrations/20261008010000_enable_user_rls/migration.sql",
    migrationSha256:
      "628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f",
    functionCount: 53,
    runtimeFunctionCount: 34,
    staffFunctionCount: 9,
  });
});

test("User ENABLE is policyless, zero-direct, NO FORCE, and restart-safe", () => {
  assert.equal(
    (migration.match(/^ALTER TABLE public\."User" ENABLE ROW LEVEL SECURITY;$/gmu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (migration.match(/^ALTER TABLE public\."User" NO FORCE ROW LEVEL SECURITY;$/gmu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (migration.match(/^REVOKE ALL PRIVILEGES ON TABLE public\."User"$/gmu) ?? [])
      .length,
    1,
  );
  assert.match(
    migration,
    /FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;/u,
  );
  assert.match(migration, /LOCK TABLE public\."User" IN ACCESS EXCLUSIVE MODE;/u);
  assert.match(migration, /grainline\.user\.rls\.activation/u);
  assert.match(migration, /current_user = 'neondb_owner'/u);
  assert.match(migration, /current_user = 'ci'/u);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(
    migration,
    /^ALTER TABLE public\."User" FORCE ROW LEVEL SECURITY;$/gmu,
  );
  assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY/iu);
});

test("preflight pins all authorities, convergence, roles, ACLs, indexes, triggers and constraints", () => {
  const expectation = buildUserInstalledCatalogExpectation();
  assert.equal(expectation.functions.length, 53);
  for (const entry of expectation.functions) {
    assert.match(migration, new RegExp(entry.name, "u"));
    assert.match(migration, new RegExp(entry.sourceMd5, "u"));
  }
  for (const group of expectation.groups) {
    assert.match(migration, new RegExp(group.migration, "u"));
    assert.match(migration, new RegExp(group.checksum, "u"));
  }
  assert.match(migration, /accepted_migration_count <> 18/u);
  assert.match(migration, /accepted_function_count <> 53/u);
  assert.match(migration, /unsafe_direct_user_reader_count <> 0/u);
  assert.match(migration, /4b2884765f4ca0db432c4678f98b1bdd/u);
  assert.match(migration, /06289e9db780c559e07188c20e680887/u);
  assert.match(migration, /accepted_index_count <> 6/u);
  assert.match(migration, /accepted_trigger_count <> 3/u);
  assert.match(migration, /accepted_constraint_count <> 3/u);
  assert.match(migration, /pg_catalog\.pg_auth_members/u);
  assert.match(migration, /nonowner_column_acl_count <> 0/u);
});

test("postflight requires exact policyless zero-direct User state", () => {
  assert.match(
    migration,
    /class\.relrowsecurity AND NOT class\.relforcerowsecurity/u,
  );
  assert.match(migration, /nonowner_table_acl_count <> 0/u);
  assert.match(migration, /nonowner_column_acl_count <> 0/u);
  assert.match(
    migration,
    /User ENABLE postflight did not reach policyless zero-direct state/u,
  );
});
