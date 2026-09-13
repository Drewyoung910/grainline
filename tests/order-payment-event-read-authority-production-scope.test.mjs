import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS,
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256,
  orderPaymentEventReadAuthorityFunctionSources,
} from "../scripts/order-payment-event-read-authority-catalog.mjs";
import {
  assertOrderPaymentEventReadAuthorityProductionScope,
} from "../scripts/verify-order-payment-event-read-authority-production-scope.mjs";

function candidateSnapshot(applied) {
  const sources = orderPaymentEventReadAuthorityFunctionSources();
  return {
    orderPaymentEventInvariants: {},
    candidateLedgerRows: applied ? [{
      migration_name: ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
      checksum: ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256,
      finished_at: new Date(),
      rolled_back_at: null,
      applied_steps_count: 1,
    }] : [],
    functions: applied ? ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.map(
      (identity) => ({
        identity,
        owner_name: "neondb_owner",
        security_definer: true,
        function_kind: "f",
        language_name: "plpgsql",
        volatility: "s",
        parallel_safety: "s",
        leakproof: false,
        config: ["search_path=pg_catalog"],
        function_source: sources[identity],
        runtime_can_execute: true,
        runtime_execute_grantable: false,
        public_can_execute: false,
        invalid_acl_count: 0,
      })
    ).sort((left, right) => left.identity.localeCompare(right.identity)) : [],
  };
}

const dependencies = Object.freeze({
  assertPredecessor: () => ({ orderPaymentEventInvariantsApplied: true }),
});

test("read-authority scope accepts only exact predecessor or applied state", () => {
  const before = assertOrderPaymentEventReadAuthorityProductionScope(
    candidateSnapshot(false),
    "restart",
    dependencies,
  );
  assert.equal(before.state, "read-authority-predecessor");
  assert.equal(before.runtimeFunctionCount, 0);

  const after = assertOrderPaymentEventReadAuthorityProductionScope(
    candidateSnapshot(true),
    "after",
    dependencies,
  );
  assert.equal(after.state, "read-authority-prepared");
  assert.equal(after.runtimeFunctionCount, 5);
  assert.equal(after.runtimeExecuteOnly, true);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);
});

test("read-authority scope rejects ledger, source and ACL drift", () => {
  const badLedger = candidateSnapshot(true);
  badLedger.candidateLedgerRows[0].checksum = "0".repeat(64);
  assert.throws(() => assertOrderPaymentEventReadAuthorityProductionScope(
    badLedger,
    "after",
    dependencies,
  ));

  const badSource = candidateSnapshot(true);
  badSource.functions[0].function_source += "\n-- drift";
  assert.throws(() => assertOrderPaymentEventReadAuthorityProductionScope(
    badSource,
    "after",
    dependencies,
  ));

  const badAcl = candidateSnapshot(true);
  badAcl.functions[0].runtime_execute_grantable = true;
  assert.throws(() => assertOrderPaymentEventReadAuthorityProductionScope(
    badAcl,
    "after",
    dependencies,
  ));
});

test("read-authority scope reader is engine-read-only", () => {
  const source = readFileSync(
    "scripts/verify-order-payment-event-read-authority-production-scope.mjs",
    "utf8",
  );
  assert.match(
    source,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  assert.match(source, /transaction_read_only/);
  assert.match(source, /readOnly !== "on"/);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/);
});
