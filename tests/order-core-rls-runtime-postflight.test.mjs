import assert from "node:assert/strict";
import test from "node:test";
import { proveOrderCoreDirectSelectDenied } from "../scripts/order-core-rls-runtime-postflight.mjs";

test("Core Order postflight requires an actual database denial", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql === 'SELECT 1 FROM public."Order" LIMIT 0') {
        throw Object.assign(new Error("permission denied"), { code: "42501" });
      }
      return { rows: [] };
    },
  };
  assert.deepEqual(await proveOrderCoreDirectSelectDenied(client), {
    directSelectSqlstate: "42501", rowDataRead: false,
  });
  assert.deepEqual(statements, [
    "SAVEPOINT order_core_direct_select_denial",
    'SELECT 1 FROM public."Order" LIMIT 0',
    "ROLLBACK TO SAVEPOINT order_core_direct_select_denial",
    "RELEASE SAVEPOINT order_core_direct_select_denial",
  ]);
});

test("Core Order postflight refuses a successful direct SELECT", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      return { rows: [] };
    },
  };
  await assert.rejects(
    proveOrderCoreDirectSelectDenied(client),
    /direct SELECT was not denied/,
  );
  assert.equal(statements.at(-1), "RELEASE SAVEPOINT order_core_direct_select_denial");
});
