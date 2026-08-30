import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  blockedCheckoutTransferBindingFunctionSource,
  verifyBlockedCheckoutTransferBindingMigrationBytes,
} from "./build-blocked-checkout-transfer-binding-migration.mjs";
import {
  orderPaymentSignedDisputeIdentityFunctionSource,
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes,
} from "./build-order-payment-signed-dispute-identity-migration.mjs";
import {
  orderPaymentSignedRefundIdentityFunctionSource,
  verifyOrderPaymentSignedRefundIdentityMigrationBytes,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  orderPaymentEventAggregateAuthorityFunctionSources,
} from "./order-payment-event-aggregate-authority-catalog.mjs";
import {
  orderPaymentEventInvariantFunctionSources,
} from "./order-payment-event-invariants-catalog.mjs";
import {
  orderPaymentEventReadAuthorityFunctionSources,
} from "./order-payment-event-read-authority-catalog.mjs";
import {
  orderPaymentEventTransitionAuthorityFunctionSources,
} from "./order-payment-event-transition-authority-catalog.mjs";
import {
  orderPaymentEventCompatibleFunctionSources,
} from "./verify-order-payment-event-compatible-production-scope.mjs";

export const ORDER_PAYMENT_EVENT_RUNTIME_FUNCTION_IDENTITIES = Object.freeze([
  "grainline_blocked_checkout_refund_claim_resume(text,bigint,text,text,integer)",
  "grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)",
  "grainline_blocked_checkout_refund_record(text,bigint,text,bigint,text,text,text,integer)",
  "grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)",
  "grainline_order_payment_buyer_export_page(text,integer,bigint,text)",
  "grainline_order_payment_buyer_refund_outcomes(text,text[])",
  "grainline_order_payment_seller_export_page(text,integer,bigint,text)",
  "grainline_order_payment_seller_refund_outcomes(text,text[])",
  "grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)",
  "grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)",
  "grainline_order_payment_staff_timeline(text,text,integer)",
  "grainline_order_refund_claim_mark_ambiguous(text,bigint,text)",
  "grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)",
  "grainline_order_refund_reconciliation_prepare(text,text)",
  "grainline_seller_refund_claim(text,text)",
  "grainline_seller_refund_record(text,text,bigint,text,text,text,integer)",
]);

// These predecessor entry points are no longer called by application source.
// Keep their definitions installed for database-first rollback, but activation
// removes ordinary-runtime EXECUTE alongside the table CRUD revocation.
export const ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES =
  Object.freeze([
    "grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)",
    "grainline_case_seller_refund_apply(text,text)",
  ]);

export const ORDER_PAYMENT_EVENT_PRIVATE_FUNCTION_IDENTITIES = Object.freeze([
  "grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)",
  "grainline_order_currency_payment_immutable()",
  "grainline_order_payment_event_immutable()",
  "grainline_order_payment_event_validate_insert()",
  "grainline_order_payment_open_dispute_guard()",
  "grainline_order_payment_open_dispute_refresh()",
  "grainline_order_payment_open_dispute_state(text)",
  "grainline_order_payment_projection_guard()",
  "grainline_order_payment_projection_refresh()",
  "grainline_order_payment_projection_state(text)",
  "grainline_order_refund_reconciliation_immutable()",
]);

export const ORDER_PAYMENT_EVENT_ACTIVATION_FUNCTION_IDENTITIES = Object.freeze([
  ...ORDER_PAYMENT_EVENT_RUNTIME_FUNCTION_IDENTITIES,
  ...ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES,
  ...ORDER_PAYMENT_EVENT_PRIVATE_FUNCTION_IDENTITIES,
].sort());

const STABLE_PARALLEL_SAFE_IDENTITIES = new Set([
  "grainline_order_payment_buyer_export_page(text,integer,bigint,text)",
  "grainline_order_payment_buyer_refund_outcomes(text,text[])",
  "grainline_order_payment_seller_export_page(text,integer,bigint,text)",
  "grainline_order_payment_seller_refund_outcomes(text,text[])",
  "grainline_order_payment_staff_timeline(text,text,integer)",
]);
const STABLE_PARALLEL_UNSAFE_IDENTITIES = new Set([
  "grainline_order_refund_reconciliation_prepare(text,text)",
]);
const SQL_IDENTITIES = new Set([
  "grainline_order_payment_open_dispute_state(text)",
  "grainline_order_payment_projection_state(text)",
]);
const SECURITY_INVOKER_IDENTITIES = new Set([
  "grainline_order_payment_event_immutable()",
  "grainline_order_refund_reconciliation_immutable()",
]);

function md5(value) {
  return createHash("md5").update(value).digest("hex");
}

export function orderPaymentEventActivationFunctionSources(
  root = process.cwd(),
) {
  verifyBlockedCheckoutTransferBindingMigrationBytes(root);
  verifyOrderPaymentSignedRefundIdentityMigrationBytes(root);
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes(root);

  const sources = new Map(Object.entries(
    orderPaymentEventCompatibleFunctionSources(root),
  ));
  sources.set(
    "grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)",
    blockedCheckoutTransferBindingFunctionSource(),
  );
  sources.set(
    "grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)",
    orderPaymentSignedRefundIdentityFunctionSource(root),
  );
  sources.set(
    "grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)",
    orderPaymentSignedDisputeIdentityFunctionSource(root),
  );
  for (const family of [
    orderPaymentEventInvariantFunctionSources(root),
    orderPaymentEventReadAuthorityFunctionSources(root),
    orderPaymentEventAggregateAuthorityFunctionSources(root),
    orderPaymentEventTransitionAuthorityFunctionSources(root),
  ]) {
    for (const [identity, source] of Object.entries(family)) {
      assert.ok(!sources.has(identity), `duplicate activation function ${identity}`);
      sources.set(identity, source);
    }
  }

  assert.deepEqual(
    [...sources.keys()].sort(),
    [...ORDER_PAYMENT_EVENT_ACTIVATION_FUNCTION_IDENTITIES],
    "OrderPaymentEvent final activation function inventory drifted",
  );
  return Object.freeze(Object.fromEntries([...sources].sort()));
}

export function orderPaymentEventActivationFunctionSourceMd5(
  root = process.cwd(),
) {
  return Object.freeze(Object.fromEntries(
    Object.entries(orderPaymentEventActivationFunctionSources(root))
      .map(([identity, source]) => [identity, md5(source)]),
  ));
}

export function orderPaymentEventActivationFunctionCatalog(
  root = process.cwd(),
) {
  const sourceMd5 = orderPaymentEventActivationFunctionSourceMd5(root);
  return Object.freeze(ORDER_PAYMENT_EVENT_ACTIVATION_FUNCTION_IDENTITIES.map(
    (identity) => {
      const splitAt = identity.indexOf("(");
      assert.ok(splitAt > 0 && identity.endsWith(")"), "function identity drifted");
      const stableSafe = STABLE_PARALLEL_SAFE_IDENTITIES.has(identity);
      const stableUnsafe = STABLE_PARALLEL_UNSAFE_IDENTITIES.has(identity);
      return Object.freeze({
        identity,
        name: identity.slice(0, splitAt),
        identityArguments: identity.slice(splitAt + 1, -1).replaceAll(",", ", "),
        language: SQL_IDENTITIES.has(identity) ? "sql" : "plpgsql",
        volatility: stableSafe || stableUnsafe ? "s" : "v",
        parallelSafety: stableSafe ? "s" : "u",
        securityDefiner: !SECURITY_INVOKER_IDENTITIES.has(identity),
        runtimeBefore:
          ORDER_PAYMENT_EVENT_RUNTIME_FUNCTION_IDENTITIES.includes(identity)
          || ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES.includes(identity),
        runtimeAfter:
          ORDER_PAYMENT_EVENT_RUNTIME_FUNCTION_IDENTITIES.includes(identity),
        sourceMd5: sourceMd5[identity],
      });
    },
  ));
}
