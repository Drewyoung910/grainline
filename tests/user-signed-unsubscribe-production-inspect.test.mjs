import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_SIGNED_UNSUBSCRIBE_FUNCTIONS,
  verifyUserSignedUnsubscribeCatalog,
} from "../scripts/user-signed-unsubscribe-production-inspect.mjs";

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
    tables: [{
      table_name: "User",
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
    }],
    functions: state === "pending" ? [] : USER_SIGNED_UNSUBSCRIBE_FUNCTIONS.map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.identityArguments,
      owner_name: "neondb_owner",
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
  };
}

test("signed-unsubscribe inspector accepts exact pending and applied catalogs", () => {
  assert.equal(
    verifyUserSignedUnsubscribeCatalog(catalog("pending"), "pending").functionCount,
    0,
  );
  assert.equal(
    verifyUserSignedUnsubscribeCatalog(catalog("applied"), "applied").functionCount,
    2,
  );
});

test("signed-unsubscribe inspector rejects public execution, source, and volatility drift", () => {
  const publicExecute = catalog("applied");
  publicExecute.functions[0].nonowner_acl.unshift("PUBLIC:EXECUTE:false");
  assert.throws(
    () => verifyUserSignedUnsubscribeCatalog(publicExecute, "applied"),
    /Expected values to be strictly equal/,
  );
  const sourceDrift = catalog("applied");
  sourceDrift.functions[0].source_md5 = "00000000000000000000000000000000";
  assert.throws(
    () => verifyUserSignedUnsubscribeCatalog(sourceDrift, "applied"),
    /Expected values to be strictly equal/,
  );
  const volatility = catalog("applied");
  volatility.functions[1].volatility = "v";
  assert.throws(
    () => verifyUserSignedUnsubscribeCatalog(volatility, "applied"),
    /Expected values to be strictly equal/,
  );
});
