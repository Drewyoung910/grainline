import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_PUBLIC_MEMBER_AGGREGATE_FUNCTION,
  verifyUserPublicMemberAggregateCatalog,
} from "../scripts/user-public-member-aggregate-production-inspect.mjs";

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
    functions: state === "pending" ? [] : [{
      function_name: USER_PUBLIC_MEMBER_AGGREGATE_FUNCTION.name,
      identity_arguments: USER_PUBLIC_MEMBER_AGGREGATE_FUNCTION.identityArguments,
      owner_name: "neondb_owner",
      language_name: "sql",
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      volatility: "s",
      parallel_safety: "s",
      function_config: ["search_path=pg_catalog"],
      source_md5: USER_PUBLIC_MEMBER_AGGREGATE_FUNCTION.sourceMd5,
      contains_dynamic_execute: false,
      nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
    }],
  };
}

test("public-member inspector accepts exact pending and applied catalogs", () => {
  assert.equal(
    verifyUserPublicMemberAggregateCatalog(catalog("pending"), "pending").functionCount,
    0,
  );
  assert.equal(
    verifyUserPublicMemberAggregateCatalog(catalog("applied"), "applied").functionCount,
    1,
  );
});

test("public-member inspector rejects PUBLIC execution, source, and table drift", () => {
  const publicExecute = catalog("applied");
  publicExecute.functions[0].nonowner_acl.unshift("PUBLIC:EXECUTE:false");
  assert.throws(
    () => verifyUserPublicMemberAggregateCatalog(publicExecute, "applied"),
    /Expected values to be strictly equal/,
  );

  const sourceDrift = catalog("applied");
  sourceDrift.functions[0].source_md5 = "00000000000000000000000000000000";
  assert.throws(
    () => verifyUserPublicMemberAggregateCatalog(sourceDrift, "applied"),
    /Expected values to be strictly equal/,
  );

  const tableDrift = catalog("applied");
  tableDrift.tables[0].runtime_select = "true";
  assert.throws(
    () => verifyUserPublicMemberAggregateCatalog(tableDrift, "applied"),
    /User\.runtime_select is missing/,
  );
});
