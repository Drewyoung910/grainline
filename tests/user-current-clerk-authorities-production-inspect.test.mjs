import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_CURRENT_CLERK_FUNCTIONS,
  verifyUserCurrentClerkCatalog,
} from "../scripts/user-current-clerk-authorities-production-inspect.mjs";

function table(name) {
  return {
    table_name: name,
    owner_name: "neondb_owner",
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
  };
}

function catalog(state) {
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
    },
    tables: [table("SellerProfile"), table("User")],
    functions: state === "pending" ? [] : USER_CURRENT_CLERK_FUNCTIONS.map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.identityArguments,
      owner_name: "neondb_owner",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      volatility: "s",
      parallel_safety: "u",
      function_config: ["search_path=pg_catalog"],
      source_md5: entry.sourceMd5,
      contains_dynamic_execute: false,
      nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
    })),
  };
}

test("current-Clerk inspector accepts exact pending and applied catalogs", () => {
  assert.equal(verifyUserCurrentClerkCatalog(catalog("pending"), "pending").functionCount, 0);
  assert.equal(verifyUserCurrentClerkCatalog(catalog("applied"), "applied").functionCount, 2);
});

test("current-Clerk inspector rejects public execution", () => {
  const drifted = catalog("applied");
  drifted.functions[0].nonowner_acl.unshift("PUBLIC:EXECUTE:false");
  assert.throws(
    () => verifyUserCurrentClerkCatalog(drifted, "applied"),
    /Expected values to be strictly equal/,
  );
});
