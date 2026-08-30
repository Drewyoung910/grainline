import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256,
  ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS,
  ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS,
  ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS,
  orderPaymentEventInvariantFunctionSources,
} from "../scripts/order-payment-event-invariants-catalog.mjs";
import {
  assertOrderPaymentEventInvariantsProductionScope,
} from "../scripts/verify-order-payment-event-invariants-production-scope.mjs";

const definitions = Object.freeze({
  OrderPaymentEvent_amountCents_check: "CHECK amountCents >= 0",
  OrderPaymentEvent_currency_check: "CHECK currency [a-z]{3}",
  OrderPaymentEvent_eventType_check: "CHECK eventType REFUND DISPUTE",
  OrderPaymentEvent_source_shape_check:
    "CHECK charge.refunded latestRefundId refundIds SELLER_REFUND_RECORDED CASE_REFUND_RECORDED BLOCKED_CHECKOUT_REFUND_RECORDED",
  OrderPaymentEvent_text_shape_check: "CHECK btrim jsonb_typeof metadata",
  OrderPaymentEvent_timestamp_immutable_shape_check: "CHECK updatedAt createdAt",
});

function candidateSnapshot(applied) {
  const sources = orderPaymentEventInvariantFunctionSources();
  return {
    signedDisputeIdentity: {},
    candidateLedgerRows: applied ? [{
      migration_name: ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
      checksum: ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256,
      finished_at: new Date(),
      rolled_back_at: null,
      applied_steps_count: 1,
    }] : [],
    constraints: applied ? ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS.map((name) => ({
      constraint_name: name,
      constraint_type: "c",
      validated: true,
      definition: definitions[name],
    })) : [],
    functions: applied ? ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS.map((name) => ({
      identity: `${name}()`,
      owner_name: "neondb_owner",
      security_definer: name !== "grainline_order_payment_event_immutable",
      function_kind: "f",
      language_name: "plpgsql",
      volatility: "v",
      parallel_safety: "u",
      leakproof: false,
      config: ["search_path=pg_catalog"],
      function_source: sources[`${name}()`],
      runtime_can_execute: false,
      public_can_execute: false,
      invalid_acl_count: 0,
    })) : [],
    triggers: applied ? ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS.map((name) => ({
      trigger_name: name,
      relation_name: name === "grainline_order_currency_payment_immutable"
        ? "Order"
        : "OrderPaymentEvent",
      function_name: name,
      definition: `CREATE TRIGGER ${name} EXECUTE FUNCTION ${name}()`,
    })) : [],
  };
}

const dependencies = Object.freeze({
  assertPredecessor: () => ({ signedDisputeIdentityApplied: true }),
});

test("OrderPaymentEvent invariant scope accepts only exact predecessor or applied state", () => {
  const before = assertOrderPaymentEventInvariantsProductionScope(
    candidateSnapshot(false),
    "restart",
    dependencies,
  );
  assert.equal(before.state, "invariants-predecessor");
  const after = assertOrderPaymentEventInvariantsProductionScope(
    candidateSnapshot(true),
    "after",
    dependencies,
  );
  assert.equal(after.state, "invariants-prepared");
  assert.equal(after.validatedConstraintCount, 6);
  assert.equal(after.triggerCount, 3);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);
});

test("OrderPaymentEvent invariant scope rejects catalog and ledger drift", () => {
  const badConstraint = candidateSnapshot(true);
  badConstraint.constraints[0].validated = false;
  assert.throws(() => assertOrderPaymentEventInvariantsProductionScope(
    badConstraint,
    "after",
    dependencies,
  ));
  const badFunction = candidateSnapshot(true);
  badFunction.functions[0].runtime_can_execute = true;
  assert.throws(() => assertOrderPaymentEventInvariantsProductionScope(
    badFunction,
    "after",
    dependencies,
  ));
  const badLedger = candidateSnapshot(true);
  badLedger.candidateLedgerRows[0].checksum = "0".repeat(64);
  assert.throws(() => assertOrderPaymentEventInvariantsProductionScope(
    badLedger,
    "after",
    dependencies,
  ));
});

test("OrderPaymentEvent invariant scope reader is engine-read-only", () => {
  const source = readFileSync(
    "scripts/verify-order-payment-event-invariants-production-scope.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /transaction_read_only/);
  assert.match(source, /readOnly !== "on"/);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/);
});
