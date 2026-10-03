import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_CLERK_IDENTITY_FUNCTIONS,
  verifyUserClerkIdentityCatalog,
} from "../scripts/user-clerk-identity-production-inspect.mjs";

function catalog({ state = "applied" } = {}) {
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
    table: {
      table_name: "User",
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
    },
    functions:
      state === "pending"
        ? []
        : USER_CLERK_IDENTITY_FUNCTIONS.map((entry) => ({
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

test("accepts pending and applied Clerk identity catalog states", () => {
  const pending = verifyUserClerkIdentityCatalog(
    catalog({ state: "pending" }),
    "pending",
  );
  assert.equal(pending.functionCount, 0);
  assert.equal(pending.productionChanged, false);
  assert.equal(pending.rowDataRead, false);

  const applied = verifyUserClerkIdentityCatalog(catalog(), "applied");
  assert.equal(applied.functionCount, 3);
  assert.deepEqual(applied.runtimeCrud, {
    select: true,
    insert: true,
    update: true,
    delete: true,
  });
});

test("rejects User RLS or function authority drift", () => {
  const rls = catalog();
  rls.table.rls_enabled = true;
  assert.throws(
    () => verifyUserClerkIdentityCatalog(rls, "applied"),
    /User RLS must remain disabled/,
  );

  const source = catalog();
  source.functions[0].source_md5 = "0".repeat(32);
  assert.throws(
    () => verifyUserClerkIdentityCatalog(source, "applied"),
    /Expected values to be strictly equal/,
  );

  const acl = catalog();
  acl.functions[1].nonowner_acl.push("PUBLIC:EXECUTE:false");
  assert.throws(
    () => verifyUserClerkIdentityCatalog(acl, "applied"),
    /Expected values to be strictly equal/,
  );
});

test("rejects a catalog state that disagrees with the ledger state", () => {
  assert.throws(
    () => verifyUserClerkIdentityCatalog(catalog(), "pending"),
    /function count drifted/,
  );
  assert.throws(
    () =>
      verifyUserClerkIdentityCatalog(catalog({ state: "pending" }), "applied"),
    /function count drifted/,
  );
  assert.throws(
    () => verifyUserClerkIdentityCatalog(catalog(), "unknown"),
    /state must be pending or applied/,
  );
});
