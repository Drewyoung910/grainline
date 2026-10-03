import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS,
  USER_EMAIL_ADDRESS_REQUIRED_INDEXES,
  userEmailAddressExpectedPostureFromEnvironment,
  verifyUserEmailAddressAuthorityCatalog,
} from "../scripts/user-email-address-authority-catalog.mjs";

const owner = "neondb_owner";

function acceptedCatalog({
  rlsEnabled = false,
  rlsForced = false,
  runtimeDirectCrud = true,
} = {}) {
  return {
    identity: {
      current_user: owner,
      session_user: owner,
      database_name: "neondb",
      read_only: "on",
      isolation: "repeatable read",
      owner_bypass_rls: true,
      runtime_bypass_rls: false,
      runtime_superuser: false,
      runtime_inherit: false,
    },
    table: {
      table_name: "UserEmailAddress",
      owner_name: owner,
      rls_enabled: rlsEnabled,
      rls_forced: rlsForced,
      policy_count: 0,
      runtime_select: runtimeDirectCrud,
      runtime_insert: runtimeDirectCrud,
      runtime_update: runtimeDirectCrud,
      runtime_delete: runtimeDirectCrud,
    },
    counts: {
      total_rows: "10",
      current_rows: "10",
      historical_rows: "0",
      users_with_rows: "10",
      duplicate_current_user_groups: "0",
      duplicate_current_row_excess: "0",
      current_rows_without_matching_active_user: "0",
      active_users_without_current_row: "0",
      active_suppression_key_collision_groups: "1",
    },
    indexes: [
      {
        table_name: "User",
        index_name: "User_active_email_suppression_key_idx",
        valid: true,
        ready: true,
        live: true,
        unique_index: false,
        predicate: '("deletedAt" IS NULL)',
        expression: "reviewed-expression",
      },
      ...USER_EMAIL_ADDRESS_REQUIRED_INDEXES.map((index_name) => ({
        table_name: "UserEmailAddress",
        index_name,
        valid: true,
        ready: true,
        live: true,
        unique_index: [
          "UserEmailAddress_one_current_per_user_key",
          "UserEmailAddress_pkey",
          "UserEmailAddress_userId_email_key",
        ].includes(index_name),
        predicate: index_name.includes("current")
          ? '("isCurrent" = true)'
          : null,
        expression:
          index_name === "UserEmailAddress_current_suppression_key_idx"
            ? "reviewed-expression"
            : null,
      })),
    ],
    functions: USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS.map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.identityArguments,
      owner_name: owner,
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      volatility: entry.volatility,
      parallel_safety: "u",
      function_config: ["search_path=pg_catalog"],
      source_md5: entry.sourceMd5,
      contains_dynamic_execute: false,
      nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
    })),
    triggers: ["RI_FKey_check_ins", "RI_FKey_check_upd"].map(
      (function_name, index) => ({
        trigger_name: `RI_ConstraintTrigger_c_${index + 1}`,
        function_name,
        enabled: "O",
        internal: true,
      }),
    ),
  };
}

test("prepared and policyless ENABLE UserEmailAddress catalogs are exact", () => {
  assert.deepEqual(verifyUserEmailAddressAuthorityCatalog(acceptedCatalog()), {
    databaseMode: "owner-catalog-read-only",
    tableOwner: owner,
    functionCount: 6,
    indexCount: 6,
    policyCount: 0,
    rlsEnabled: false,
    rlsForced: false,
    runtimeDirectCrud: true,
    rowDataRead: false,
    productionChanged: false,
  });
  assert.deepEqual(
    verifyUserEmailAddressAuthorityCatalog(
      acceptedCatalog({ rlsEnabled: true, runtimeDirectCrud: false }),
      { rlsEnabled: true, rlsForced: false, runtimeDirectCrud: false },
    ),
    {
      databaseMode: "owner-catalog-read-only",
      tableOwner: owner,
      functionCount: 6,
      indexCount: 6,
      policyCount: 0,
      rlsEnabled: true,
      rlsForced: false,
      runtimeDirectCrud: false,
      rowDataRead: false,
      productionChanged: false,
    },
  );
});

test("catalog rejects mixed grants, function drift, row drift, and unexpected indexes", () => {
  const mixed = acceptedCatalog({ rlsEnabled: true, runtimeDirectCrud: false });
  mixed.table.runtime_select = true;
  assert.throws(
    () =>
      verifyUserEmailAddressAuthorityCatalog(mixed, {
        rlsEnabled: true,
        rlsForced: false,
        runtimeDirectCrud: false,
      }),
    /table posture drifted/u,
  );

  const functionDrift = acceptedCatalog();
  functionDrift.functions[0].source_md5 = "0".repeat(32);
  assert.throws(
    () => verifyUserEmailAddressAuthorityCatalog(functionDrift),
    /Expected values to be strictly equal/u,
  );

  const rowDrift = acceptedCatalog();
  rowDrift.counts.active_users_without_current_row = "1";
  assert.throws(
    () => verifyUserEmailAddressAuthorityCatalog(rowDrift),
    /active owner lacks a current row/u,
  );

  const extraIndex = acceptedCatalog();
  extraIndex.indexes.push({
    ...extraIndex.indexes.at(-1),
    index_name: "unexpected",
  });
  assert.throws(
    () => verifyUserEmailAddressAuthorityCatalog(extraIndex),
    /index inventory drifted/u,
  );
});

test("catalog CLI requires an explicit exact expected posture", () => {
  assert.deepEqual(
    userEmailAddressExpectedPostureFromEnvironment({
      EXPECTED_USER_EMAIL_ADDRESS_RLS_ENABLED: "true",
      EXPECTED_USER_EMAIL_ADDRESS_RLS_FORCED: "false",
      EXPECTED_USER_EMAIL_ADDRESS_RUNTIME_DIRECT_CRUD: "false",
    }),
    {
      rlsEnabled: true,
      rlsForced: false,
      runtimeDirectCrud: false,
    },
  );
  assert.throws(
    () => userEmailAddressExpectedPostureFromEnvironment({}),
    /EXPECTED_USER_EMAIL_ADDRESS_RLS_ENABLED must be true or false/u,
  );
});

test("ENABLE migration is policyless, revokes direct grants, and pins the live catalog", () => {
  const migration = readFileSync(
    "prisma/migrations/20261003020000_enable_user_email_address_rls/migration.sql",
    "utf8",
  );
  assert.equal(
    (
      migration.match(
        /^ALTER TABLE public\."UserEmailAddress" ENABLE ROW LEVEL SECURITY;$/gmu,
      ) ?? []
    ).length,
    1,
  );
  assert.equal(
    (
      migration.match(
        /^ALTER TABLE public\."UserEmailAddress" NO FORCE ROW LEVEL SECURITY;$/gmu,
      ) ?? []
    ).length,
    1,
  );
  assert.doesNotMatch(migration, /^CREATE POLICY/gmu);
  assert.doesNotMatch(
    migration,
    /^ALTER TABLE public\."UserEmailAddress" FORCE ROW LEVEL SECURITY;$/gmu,
  );
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\."UserEmailAddress"[\s\S]*FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /LOCK TABLE public\."UserEmailAddress" IN ACCESS EXCLUSIVE MODE/u,
  );
  assert.match(migration, /grainline\.user-email-address\.rls\.activation/u);
  assert.match(migration, /current_user = 'neondb_owner'/u);
  assert.match(migration, /current_user = 'ci'/u);
  for (const entry of USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS) {
    assert.match(migration, new RegExp(entry.name, "u"));
    assert.match(migration, new RegExp(entry.sourceMd5, "u"));
  }
});
