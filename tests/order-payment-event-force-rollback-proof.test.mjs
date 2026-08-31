import assert from "node:assert/strict";
import test from "node:test";

import {
  provePhaseARuntimeBoundary,
} from "../scripts/order-payment-event-force-rollback-proof.mjs";

test("FORCE rollback proof recovers from the expected ACL denial before its read RPC", async () => {
  const statements = [];
  const runtime = {
    async query(sql) {
      const statement = sql.replace(/\s+/gu, " ").trim();
      statements.push(statement);
      if (statement.startsWith('SELECT id FROM public."OrderPaymentEvent"')) {
        const error = new Error("permission denied");
        error.code = "42501";
        throw error;
      }
      if (statement.includes("grainline_order_payment_buyer_export_page")) {
        return { rowCount: 0 };
      }
      return { rowCount: 0 };
    },
  };

  await provePhaseARuntimeBoundary(runtime);

  assert.deepEqual(statements, [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "SAVEPOINT order_payment_event_direct_select_probe",
    'SELECT id FROM public."OrderPaymentEvent" LIMIT 1',
    "ROLLBACK TO SAVEPOINT order_payment_event_direct_select_probe",
    "RELEASE SAVEPOINT order_payment_event_direct_select_probe",
    "SELECT * FROM public.grainline_order_payment_buyer_export_page( $1, 1, NULL, NULL )",
    "ROLLBACK",
  ]);
});

test("FORCE rollback proof fails closed when direct table SELECT unexpectedly succeeds", async () => {
  const statements = [];
  const runtime = {
    async query(sql) {
      const statement = sql.replace(/\s+/gu, " ").trim();
      statements.push(statement);
      return { rowCount: 0 };
    },
  };

  await assert.rejects(
    provePhaseARuntimeBoundary(runtime),
    (error) => {
      assert.equal(error?.code, "ERR_ASSERTION");
      assert.match(error?.message ?? "", /42501/u);
      return true;
    },
  );
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(
    statements.some((statement) => (
      statement.includes("grainline_order_payment_buyer_export_page")
    )),
    false,
  );
});
