import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
  orderPaymentSignedDisputeIdentityFunctionSource,
  predecessorOrderPaymentSignedDisputeFunctionSource,
} from "../scripts/build-order-payment-signed-dispute-identity-migration.mjs";
import {
  assertOrderPaymentSignedDisputeIdentityLedger,
  assertOrderPaymentSignedDisputeIdentityProductionScope,
} from "../scripts/verify-order-payment-signed-dispute-identity-production-scope.mjs";

const FUNCTION_IDENTITY =
  "grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)";

function predecessorSnapshot(applied) {
  return {
    blockedCheckoutTransferBinding: {
      blockedCheckoutRefundDelivery: {
        orderPaymentEventCompatible: {
          functions: [{
            identity: FUNCTION_IDENTITY,
            function_source: applied
              ? orderPaymentSignedDisputeIdentityFunctionSource()
              : predecessorOrderPaymentSignedDisputeFunctionSource(),
          }],
        },
      },
    },
  };
}

function functionRow(applied, overrides = {}) {
  return {
    identity:
      "public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)",
    owner_name: "neondb_owner",
    security_definer: true,
    function_kind: "f",
    language_name: "plpgsql",
    volatility: "v",
    parallel_safety: "u",
    leakproof: false,
    config: ["search_path=pg_catalog"],
    runtime_can_execute: true,
    public_can_execute: false,
    invalid_acl_count: 0,
    function_source: applied
      ? orderPaymentSignedDisputeIdentityFunctionSource()
      : predecessorOrderPaymentSignedDisputeFunctionSource(),
    ...overrides,
  };
}

function ledgerRow(overrides = {}) {
  return {
    migration_name: ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
    checksum: ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
    finished_at: new Date().toISOString(),
    rolled_back_at: null,
    applied_steps_count: 1,
    ...overrides,
  };
}

test("signed-dispute identity scope accepts only exact predecessor and applied states", () => {
  const calls = [];
  const assertPredecessor = (snapshot, stage) => {
    calls.push({ snapshot, stage });
    assert.equal(stage, "after");
    assert.equal(
      snapshot.blockedCheckoutTransferBinding.blockedCheckoutRefundDelivery
        .orderPaymentEventCompatible.functions[0].function_source,
      predecessorOrderPaymentSignedDisputeFunctionSource(),
    );
    return { signedRefundIdentityApplied: true };
  };

  const before = assertOrderPaymentSignedDisputeIdentityProductionScope({
    signedRefundIdentity: predecessorSnapshot(false),
    candidateLedgerRows: [],
    signedDisputeFunction: functionRow(false),
  }, "before", { assertPredecessor });
  assert.equal(before.state, "signed-dispute-identity-predecessor");
  assert.equal(before.signedDisputeIdentityApplied, false);

  const after = assertOrderPaymentSignedDisputeIdentityProductionScope({
    signedRefundIdentity: predecessorSnapshot(true),
    candidateLedgerRows: [ledgerRow()],
    signedDisputeFunction: functionRow(true),
  }, "after", { assertPredecessor });
  assert.equal(after.state, "signed-dispute-identity-compatible");
  assert.equal(after.signedDisputeIdentityApplied, true);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);
  assert.equal(calls.length, 2);
});

test("signed-dispute identity scope rejects ledger, catalog and recursive-view drift", () => {
  const assertPredecessor = () => ({ signedRefundIdentityApplied: true });
  assert.equal(assertOrderPaymentSignedDisputeIdentityLedger([], "restart"), false);
  assert.equal(
    assertOrderPaymentSignedDisputeIdentityLedger([ledgerRow()], "restart"),
    true,
  );
  assert.throws(
    () => assertOrderPaymentSignedDisputeIdentityLedger([
      ledgerRow({ checksum: "0".repeat(64) }),
    ], "restart"),
    /exact reviewed stage/,
  );
  assert.throws(
    () => assertOrderPaymentSignedDisputeIdentityProductionScope({
      signedRefundIdentity: predecessorSnapshot(true),
      candidateLedgerRows: [ledgerRow()],
      signedDisputeFunction: functionRow(true, { public_can_execute: true }),
    }, "after", { assertPredecessor }),
    /function catalog drifted/,
  );
  assert.throws(
    () => assertOrderPaymentSignedDisputeIdentityProductionScope({
      signedRefundIdentity: predecessorSnapshot(false),
      candidateLedgerRows: [ledgerRow()],
      signedDisputeFunction: functionRow(true),
    }, "after", { assertPredecessor }),
    /predecessor and candidate catalog views drifted/,
  );
  const duplicate = predecessorSnapshot(true);
  duplicate.blockedCheckoutTransferBinding.blockedCheckoutRefundDelivery
    .orderPaymentEventCompatible.functions.push({
      ...duplicate.blockedCheckoutTransferBinding.blockedCheckoutRefundDelivery
        .orderPaymentEventCompatible.functions[0],
    });
  assert.throws(
    () => assertOrderPaymentSignedDisputeIdentityProductionScope({
      signedRefundIdentity: duplicate,
      candidateLedgerRows: [ledgerRow()],
      signedDisputeFunction: functionRow(true),
    }, "after", { assertPredecessor }),
    /predecessor and candidate catalog views drifted/,
  );
});
