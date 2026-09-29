import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION,
  ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_SHA256,
  ORDER_ITEM_QUOTE_RUNTIME_LOCKED_TABLES,
  REQUIRED_TABLE_PRIVILEGES,
  readOrderItemQuoteRuntimeLockState,
  requiredRuntimeTablePrivileges,
} from "../scripts/audit-runtime-db-grants.mjs";

const migration = readFileSync(
  process.env.ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_PATH
    ?? "prisma/migrations/20260929130000_revoke_order_item_shipping_quote_runtime_access/migration.sql",
  "utf8",
);
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("runtime lock removes only direct OrderItem and quote table authority", () => {
  assert.match(
    migration,
    /REVOKE ALL ON TABLE\s+public\."OrderItem",\s+public\."OrderShippingRateQuote"\s+FROM PUBLIC, grainline_app_runtime;/u,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:GRANT|DROP|CREATE|ALTER)\b|ROW LEVEL SECURITY|\bPOLICY\b|\bFUNCTION\b/iu,
  );
});

test("runtime provisioning preserves predecessor grants until the exact lock ledger", () => {
  assert.match(provision, new RegExp(ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION, "u"));
  assert.match(provision, new RegExp(ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_SHA256, "u"));
  assert.match(
    provision,
    /Order item\/quote runtime-lock ledger drifted; refusing runtime-role provisioning/u,
  );
  assert.match(
    provision,
    /\\if :grainline_order_item_quote_runtime_lock_applied[\s\S]*?REVOKE ALL ON TABLE\s+public\."OrderItem",\s+public\."OrderShippingRateQuote"\s+FROM PUBLIC, :"runtime_role";[\s\S]*?\\endif/u,
  );
  assert.match(provision, /\\unset grainline_order_item_quote_runtime_lock_applied/u);
  assert.match(
    ciWorkflow,
    /Apply only Order item and quote runtime lock in disposable PostgreSQL[\s\S]*?prisma migrate resolve\s+--applied 20260929130000_revoke_order_item_shipping_quote_runtime_access[\s\S]*?Converge runtime grants after Order item and quote runtime lock/u,
  );
});

test("grant audit changes expectations only after an exact completed ledger row", async () => {
  const absent = await readOrderItemQuoteRuntimeLockState({
    async query() {
      return { rows: [{ migration_table: null }] };
    },
  });
  assert.deepEqual(absent, { applied: false, issues: [] });

  const queries = [];
  const exact = await readOrderItemQuoteRuntimeLockState({
    async query(sql, parameters) {
      queries.push([sql, parameters]);
      if (queries.length === 1) {
        return { rows: [{ migration_table: "_prisma_migrations" }] };
      }
      return { rows: [{
        checksum: ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_SHA256,
        finished_at: new Date("2026-09-29T00:00:00Z"),
        rolled_back_at: null,
        applied_steps_count: "1",
      }] };
    },
  });
  assert.deepEqual(exact, { applied: true, issues: [] });
  assert.deepEqual(queries[1][1], [ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION]);

  for (const tableName of ORDER_ITEM_QUOTE_RUNTIME_LOCKED_TABLES) {
    assert.deepEqual(
      requiredRuntimeTablePrivileges(tableName, {
        orderItemQuoteRuntimeLockApplied: false,
      }),
      REQUIRED_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(tableName, {
        orderItemQuoteRuntimeLockApplied: true,
      }),
      [],
    );
  }

  const drifted = await readOrderItemQuoteRuntimeLockState({
    queryCount: 0,
    async query() {
      this.queryCount += 1;
      return this.queryCount === 1
        ? { rows: [{ migration_table: "_prisma_migrations" }] }
        : { rows: [{
          checksum: "0".repeat(64),
          finished_at: null,
          rolled_back_at: null,
          applied_steps_count: "0",
        }] };
    },
  });
  assert.deepEqual(drifted, {
    applied: false,
    issues: [
      "Order item/quote runtime-lock migration ledger is partial or drifted",
    ],
  });
});
