import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  USER_PUBLIC_SELLER_STATE_FUNCTIONS,
  USER_PUBLIC_SELLER_STATE_TRIGGERS,
  verifyUserPublicSellerStateCatalog,
} from "../scripts/user-public-seller-state-production-inspect.mjs";

const migration = readFileSync(
  "prisma/migrations/20261004050000_prepare_user_public_seller_state/migration.sql",
  "utf8",
);

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
    tables: ["SellerProfile", "User"].map((table_name) => ({
      table_name,
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
    })),
    columns: state === "pending" ? [] : [
      {
        table_name: "SellerProfile",
        column_name: "ownerAccountActive",
        data_type: "boolean",
        not_null: true,
        default_expression: "false",
      },
      {
        table_name: "SellerProfile",
        column_name: "ownerImageUrl",
        data_type: "character varying(2048)",
        not_null: false,
        default_expression: null,
      },
    ],
    functions: state === "pending" ? [] : USER_PUBLIC_SELLER_STATE_FUNCTIONS.map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.identityArguments,
      owner_name: "neondb_owner",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: ["search_path=pg_catalog"],
      source_md5: entry.sourceMd5,
      contains_dynamic_execute: false,
      nonowner_acl: [],
    })),
    triggers: state === "pending" ? [] : USER_PUBLIC_SELLER_STATE_TRIGGERS.map((entry) => ({
      table_name: entry.tableName,
      trigger_name: entry.triggerName,
      function_name: entry.functionName,
      enabled: "O",
      internal: false,
    })),
  };
}

test("seller-state inspector accepts exact pending and applied catalogs", () => {
  assert.equal(verifyUserPublicSellerStateCatalog(catalog("pending"), "pending").columnCount, 0);
  const applied = verifyUserPublicSellerStateCatalog(catalog("applied"), "applied");
  assert.equal(applied.columnCount, 2);
  assert.equal(applied.functionCount, 2);
  assert.equal(applied.triggerCount, 2);
});

test("seller-state inspector pins exact PostgreSQL function bodies", () => {
  for (const expected of USER_PUBLIC_SELLER_STATE_FUNCTIONS) {
    const escapedName = expected.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = migration.match(new RegExp(
      `CREATE FUNCTION public\\.${escapedName}\\(\\)[\\s\\S]*?AS (\\$[^$]+\\$)([\\s\\S]*?)\\1;`,
      "u",
    ));
    assert.ok(match, `${expected.name} body is missing`);
    assert.equal(createHash("md5").update(match[2]).digest("hex"), expected.sourceMd5);
  }
});

test("seller-state inspector rejects PUBLIC execution and catalog drift", () => {
  const publicExecute = catalog("applied");
  publicExecute.functions[0].nonowner_acl.push("PUBLIC:EXECUTE:false");
  assert.throws(() => verifyUserPublicSellerStateCatalog(publicExecute, "applied"));

  const sourceDrift = catalog("applied");
  sourceDrift.functions[0].source_md5 = "00000000000000000000000000000000";
  assert.throws(() => verifyUserPublicSellerStateCatalog(sourceDrift, "applied"));

  const triggerDrift = catalog("applied");
  triggerDrift.triggers[0].enabled = "D";
  assert.throws(() => verifyUserPublicSellerStateCatalog(triggerDrift, "applied"));

  const columnDrift = catalog("applied");
  columnDrift.columns[0].default_expression = "true";
  assert.throws(() => verifyUserPublicSellerStateCatalog(columnDrift, "applied"));
});
