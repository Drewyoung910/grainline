import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildUserRlsForceMigration,
  USER_RLS_FORCE_RELEASE,
  verifyCommittedUserRlsForceMigration,
} from "../scripts/build-user-rls-force-candidate.mjs";
import {
  buildUserInstalledCatalogExpectation,
} from "../scripts/user-installed-catalog-production-inspect.mjs";

const migration = readFileSync(USER_RLS_FORCE_RELEASE.migrationPath, "utf8");

test("User FORCE migration is generated exactly from reviewed ENABLE source", () => {
  assert.equal(migration, buildUserRlsForceMigration());
  assert.deepEqual(verifyCommittedUserRlsForceMigration(), {
    migrationName: "20261008020000_force_user_rls",
    migrationPath: "prisma/migrations/20261008020000_force_user_rls/migration.sql",
    migrationSha256:
      "d6e9e9afca641f527c4c120806c5af219d6b4f08936def91d16c348cff2480c3",
    functionCount: 53,
    runtimeFunctionCount: 34,
    staffFunctionCount: 9,
  });
});

test("User FORCE is one policyless posture-only transition", () => {
  assert.equal(
    (migration.match(/^ALTER TABLE public\."User" FORCE ROW LEVEL SECURITY;$/gmu) ?? [])
      .length,
    1,
  );
  assert.match(migration, /LOCK TABLE public\."User" IN ACCESS EXCLUSIVE MODE;/u);
  assert.match(migration, /grainline\.user\.rls\.force/u);
  assert.match(migration, /User FORCE requires policyless ENABLE predecessor/u);
  assert.match(migration, /nonowner_table_acl_count <> 0/u);
  assert.match(migration, /nonowner_column_acl_count <> 0/u);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(
    migration,
    /^ALTER TABLE public\."User" (?:ENABLE|DISABLE|NO FORCE) ROW LEVEL SECURITY;$/gmu,
  );
  assert.doesNotMatch(migration, /^REVOKE ALL PRIVILEGES ON TABLE public\."User"$/gmu);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+public\."User"\b/iu);
});

test("User FORCE preflight pins the ENABLE ledger and complete authority catalog", () => {
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
  assert.match(migration, /20261008010000_enable_user_rls/u);
  assert.match(
    migration,
    /628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f/u,
  );
  assert.match(migration, /accepted_migration_count <> 19/u);
  assert.match(migration, /accepted_function_count <> 53/u);
  assert.match(migration, /unsafe_direct_user_reader_count <> 0/u);
  assert.match(migration, /accepted_index_count <> 6/u);
  assert.match(migration, /accepted_trigger_count <> 3/u);
  assert.match(migration, /accepted_constraint_count <> 3/u);
});

test("User FORCE postflight requires exact policyless forced zero-direct state", () => {
  assert.match(
    migration,
    /class\.relrowsecurity AND class\.relforcerowsecurity/u,
  );
  assert.match(migration, /User FORCE postflight did not reach policyless zero-direct state/u);
});
