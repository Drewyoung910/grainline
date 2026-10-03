import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS } from "../scripts/user-email-address-authority-catalog.mjs";

const migration = readFileSync(
  "prisma/migrations/20261003030000_force_user_email_address_rls/migration.sql",
  "utf8",
);

test("UserEmailAddress FORCE is a single posture-only transition", () => {
  assert.equal((migration.match(/^BEGIN;$/gmu) ?? []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gmu) ?? []).length, 1);
  assert.equal(
    (
      migration.match(
        /^ALTER TABLE public\."UserEmailAddress" FORCE ROW LEVEL SECURITY;$/gmu,
      ) ?? []
    ).length,
    1,
  );
  assert.doesNotMatch(
    migration,
    /^ALTER TABLE public\."UserEmailAddress" (?:ENABLE|DISABLE|NO FORCE) ROW LEVEL SECURITY;$/gmu,
  );
  assert.doesNotMatch(migration, /\b(?:CREATE|DROP)\s+POLICY\b/iu);
  assert.doesNotMatch(migration, /\bGRANT\b/iu);
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\."UserEmailAddress"[\s\S]*FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(migration, /grainline\.user-email-address\.rls\.force/u);
  assert.match(
    migration,
    /class\.relrowsecurity AND NOT class\.relforcerowsecurity/u,
  );
  assert.match(
    migration,
    /class\.relrowsecurity AND class\.relforcerowsecurity/u,
  );
});

test("UserEmailAddress FORCE pins the accepted owner, data, index, function, and trigger catalog", () => {
  assert.match(migration, /current_user = 'neondb_owner'/u);
  assert.match(migration, /current_user = 'ci'/u);
  assert.match(migration, /UserEmailAddress FORCE data posture drifted/u);
  assert.match(migration, /table_index_count <> 6/u);
  assert.match(migration, /accepted_supporting_indexes <> 3/u);
  assert.match(migration, /accepted_functions <> 6/u);
  assert.match(migration, /actual_function_count <> 6/u);
  assert.match(migration, /accepted_triggers <> 2/u);
  assert.match(migration, /nonowner_table_acl_count <> 0/u);
  assert.match(migration, /nonowner_column_acl_count <> 0/u);
  for (const entry of USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS) {
    assert.match(migration, new RegExp(entry.name, "u"));
    assert.match(migration, new RegExp(entry.sourceMd5, "u"));
  }
});
