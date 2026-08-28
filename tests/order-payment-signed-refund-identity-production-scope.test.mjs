import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
  orderPaymentSignedRefundIdentityFunctionSource,
  predecessorOrderPaymentSignedRefundFunctionSource,
} from "../scripts/build-order-payment-signed-refund-identity-migration.mjs";
import {
  assertOrderPaymentSignedRefundIdentityLedger,
  assertOrderPaymentSignedRefundIdentityProductionScope,
} from "../scripts/verify-order-payment-signed-refund-identity-production-scope.mjs";

const predecessorResult = Object.freeze({
  blockedCheckoutTransferBindingApplied: true,
});
const COMPATIBLE_FUNCTION_IDENTITY =
  "grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)";

function predecessorSnapshot(applied, overrides = {}) {
  return {
    blockedCheckoutRefundDelivery: {
      orderPaymentEventCompatible: {
        functions: [{
          identity: COMPATIBLE_FUNCTION_IDENTITY,
          function_source: applied
            ? orderPaymentSignedRefundIdentityFunctionSource()
            : predecessorOrderPaymentSignedRefundFunctionSource(),
          ...overrides,
        }],
      },
    },
  };
}

function functionRow(applied, overrides = {}) {
  return {
    identity:
      "public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)",
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
      ? orderPaymentSignedRefundIdentityFunctionSource()
      : predecessorOrderPaymentSignedRefundFunctionSource(),
    ...overrides,
  };
}

function ledgerRow(overrides = {}) {
  return {
    migration_name: ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
    checksum: ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
    finished_at: new Date().toISOString(),
    rolled_back_at: null,
    applied_steps_count: 1,
    ...overrides,
  };
}

test("signed-refund identity scope accepts exact predecessor and applied states", () => {
  const predecessorCalls = [];
  const assertPredecessor = (snapshot, stage) => {
    predecessorCalls.push({ snapshot, stage });
    return predecessorResult;
  };
  const before = assertOrderPaymentSignedRefundIdentityProductionScope({
    blockedCheckoutTransferBinding: predecessorSnapshot(false),
    candidateLedgerRows: [],
    signedRefundFunction: functionRow(false),
  }, "before", { assertPredecessor });
  assert.equal(before.state, "signed-refund-identity-predecessor");
  assert.equal(before.signedRefundIdentityApplied, false);

  const after = assertOrderPaymentSignedRefundIdentityProductionScope({
    blockedCheckoutTransferBinding: predecessorSnapshot(true),
    candidateLedgerRows: [ledgerRow()],
    signedRefundFunction: functionRow(true),
  }, "after", { assertPredecessor });
  assert.equal(after.state, "signed-refund-identity-compatible");
  assert.equal(after.signedRefundIdentityApplied, true);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);
  assert.equal(predecessorCalls.length, 2);
  assert.equal(predecessorCalls[0].stage, "after");
  assert.equal(predecessorCalls[1].stage, "after");
  assert.equal(
    predecessorCalls[1].snapshot.blockedCheckoutRefundDelivery
      .orderPaymentEventCompatible.functions[0].function_source,
    predecessorOrderPaymentSignedRefundFunctionSource(),
  );
});

test("signed-refund identity scope is restart-safe but rejects ledger and catalog drift", () => {
  const assertPredecessor = () => predecessorResult;
  assert.equal(assertOrderPaymentSignedRefundIdentityLedger([], "restart"), false);
  assert.equal(
    assertOrderPaymentSignedRefundIdentityLedger([ledgerRow()], "restart"),
    true,
  );
  assert.throws(
    () => assertOrderPaymentSignedRefundIdentityLedger([
      ledgerRow({ checksum: "0".repeat(64) }),
    ], "restart"),
    /exact reviewed stage/,
  );
  assert.throws(
    () => assertOrderPaymentSignedRefundIdentityProductionScope({
      blockedCheckoutTransferBinding: predecessorSnapshot(true),
      candidateLedgerRows: [ledgerRow()],
      signedRefundFunction: functionRow(true, { public_can_execute: true }),
    }, "after", { assertPredecessor }),
    /function catalog drifted/,
  );
  assert.throws(
    () => assertOrderPaymentSignedRefundIdentityProductionScope({
      blockedCheckoutTransferBinding: predecessorSnapshot(false),
      candidateLedgerRows: [],
      signedRefundFunction: functionRow(true),
    }, "before", { assertPredecessor }),
    /function catalog drifted/,
  );
  assert.throws(
    () => assertOrderPaymentSignedRefundIdentityProductionScope({
      blockedCheckoutTransferBinding: predecessorSnapshot(true, {
        function_source: `${orderPaymentSignedRefundIdentityFunctionSource()}\n-- drift`,
      }),
      candidateLedgerRows: [ledgerRow()],
      signedRefundFunction: functionRow(true),
    }, "after", { assertPredecessor }),
    /predecessor and candidate catalog views drifted/,
  );
  const duplicate = predecessorSnapshot(true);
  duplicate.blockedCheckoutRefundDelivery.orderPaymentEventCompatible.functions
    .push({ ...duplicate.blockedCheckoutRefundDelivery
      .orderPaymentEventCompatible.functions[0] });
  assert.throws(
    () => assertOrderPaymentSignedRefundIdentityProductionScope({
      blockedCheckoutTransferBinding: duplicate,
      candidateLedgerRows: [ledgerRow()],
      signedRefundFunction: functionRow(true),
    }, "after", { assertPredecessor }),
    /predecessor and candidate catalog views drifted/,
  );
});

test("production workflow is exact-main, restart-safe, and candidate-only", () => {
  const workflow = readFileSync(
    ".github/workflows/order-payment-signed-refund-identity-production.yml",
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /run\.head_sha !== releaseCommit/);
  assert.match(workflow, /run\.name !== 'CI'/);
  assert.match(workflow, /run\.conclusion !== 'success'/);
  assert.match(workflow, /guard-production-migration-runner\.mjs/);
  assert.match(workflow, /20260828010000_prepare_order_payment_signed_refund_identity/);
  assert.match(workflow, /ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_SCOPE_STAGE: restart/);
  assert.match(workflow, /signed-refund-identity-predecessor/);
  assert.match(workflow, /signed-refund-identity-compatible/);
  assert.match(workflow, /if: steps\.scope\.outputs\.state == 'signed-refund-identity-predecessor'/);
  assert.match(workflow, /npx prisma migrate deploy/);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/);
  assert.match(workflow, /ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_SCOPE_STAGE: after/);
  assert.doesNotMatch(workflow, /vercel deploy|stripe|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/i);
});
