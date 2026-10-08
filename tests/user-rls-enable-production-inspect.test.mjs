import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_RLS_ENABLE_MIGRATIONS,
  verifyUserRlsEnableCatalog,
} from "../scripts/user-rls-enable-production-inspect.mjs";

function catalog(state = "predecessor") {
  const direct = state === "predecessor";
  const applied = (expected) => ({
    migration_name: expected.name,
    checksum: expected.checksum,
    finished: true,
    rolled_back: false,
    applied_steps_count: "1",
  });
  return {
    identity: {
      current_user: "neondb_owner",
      session_user: "neondb_owner",
      database_name: "neondb",
      read_only: "on",
      isolation: "repeatable read",
      owner_bypass_rls: true,
      runtime_bypass_rls: false,
      runtime_superuser: false,
      runtime_inherit: false,
      staff_bypass_rls: false,
      staff_superuser: false,
      staff_inherit: false,
    },
    ledger: [
      applied(USER_RLS_ENABLE_MIGRATIONS.convergence),
      ...(state === "enabled" ? [applied(USER_RLS_ENABLE_MIGRATIONS.enable)] : []),
    ],
    table: {
      table_name: "User",
      owner_name: "neondb_owner",
      rls_enabled: !direct,
      rls_forced: false,
      policy_count: 0,
      runtime_select: direct,
      runtime_insert: direct,
      runtime_update: direct,
      runtime_delete: direct,
      staff_select: false,
      staff_insert: false,
      staff_update: false,
      staff_delete: false,
      nonowner_acl: direct ? [
        "grainline_app_runtime:DELETE:false",
        "grainline_app_runtime:INSERT:false",
        "grainline_app_runtime:SELECT:false",
        "grainline_app_runtime:UPDATE:false",
      ] : [],
      nonowner_column_acl_count: 0,
    },
    indexes: [
      ["User_active_email_suppression_key_idx", false],
      ["User_banned_deletedAt_idx", false],
      ["User_clerkId_key", true],
      ["User_deletedAt_idx", false],
      ["User_email_key", true],
      ["User_pkey", true],
    ].map(([index_name, unique_index]) => ({
      index_name, unique_index, valid: true, ready: true, live: true,
    })),
    triggers: [
      ["grainline_user_public_blog_state_sync", "grainline_user_public_blog_state_sync"],
      ["grainline_user_public_review_commission_state_sync", "grainline_user_public_review_commission_state_sync"],
      ["grainline_user_public_seller_state_sync", "grainline_user_public_seller_state_sync"],
    ].map(([trigger_name, function_name]) => ({ trigger_name, function_name, enabled: "O" })),
    constraints: [
      ["User_notificationPreferences_shape_chk", "c"],
      ["User_notificationPreferences_size_chk", "c"],
      ["User_pkey", "p"],
    ].map(([constraint_name, constraint_type]) => ({
      constraint_name, constraint_type, validated: true,
    })),
    readers: { direct_reader_count: 55, security_definer_count: 55 },
    convergence: [
      {
        function_name: "grainline_case_resolution_claim_immutable",
        security_definer: true,
        source_md5: "06289e9db780c559e07188c20e680887",
        uses_user_table: true,
        runtime_execute: false,
      },
      {
        function_name: "grainline_conversation_inbox",
        security_definer: false,
        source_md5: "4b2884765f4ca0db432c4678f98b1bdd",
        uses_user_table: false,
        runtime_execute: true,
      },
    ],
  };
}

test("accepts exact predecessor and policyless zero-direct ENABLE catalogs", () => {
  assert.deepEqual(verifyUserRlsEnableCatalog(catalog(), "predecessor"), {
    expectedState: "predecessor",
    directReaderCount: 55,
    indexCount: 6,
    triggerCount: 3,
    constraintCount: 3,
    userRlsEnabled: false,
    userRlsForced: false,
    runtimeDirectCrud: true,
    rowDataRead: false,
    productionChanged: false,
  });
  const enabled = verifyUserRlsEnableCatalog(catalog("enabled"), "enabled");
  assert.equal(enabled.userRlsEnabled, true);
  assert.equal(enabled.runtimeDirectCrud, false);
});

test("rejects ledger, structure, cross-domain, reader-mode, and RLS drift", () => {
  const cases = [
    (value) => { value.ledger[0].checksum = "0".repeat(64); },
    (value) => { value.indexes.pop(); },
    (value) => { value.triggers[0].enabled = "D"; },
    (value) => { value.constraints[0].validated = false; },
    (value) => { value.readers.security_definer_count -= 1; },
    (value) => { value.convergence[1].uses_user_table = true; },
    (value) => { value.table.rls_enabled = true; },
  ];
  for (const mutate of cases) {
    const value = catalog();
    mutate(value);
    assert.throws(() => verifyUserRlsEnableCatalog(value, "predecessor"));
  }
});
