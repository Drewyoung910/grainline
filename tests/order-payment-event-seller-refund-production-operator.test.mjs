import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONFIRMATION,
  REFUND_AMOUNT_CENTS,
  TRANSFER_AMOUNT_CENTS,
  assertConnectedAccount,
  assertEvidence,
  assertPayment,
  assertProofSnapshot,
  assertRefundProviderEvidence,
  assertReplayUnchanged,
  assertSignedPredecessorEvidence,
  assertState,
  buildConnectedAccountParams,
  buildEvidence,
  createInitialState,
  redact,
  validateConfiguration,
} from "../scripts/order-payment-event-seller-refund-production-proof.mjs";

const COMMIT = "a".repeat(40);
const SOURCE = "b".repeat(40);
const SIGNED = "c".repeat(40);
const CI = 32810000001;
const SIGNED_CI = 32810000002;
const DEPLOYMENT = "dpl_OrderPaymentSellerRefundProof";
const config = Object.freeze({
  expectedCommit: COMMIT,
  deployedSourceCommit: SOURCE,
  signedProofCommit: SIGNED,
  mainCiRunId: CI,
  signedProofCiRunId: SIGNED_CI,
  deploymentId: DEPLOYMENT,
});

function environment(overrides = {}) {
  return {
    ORDER_PAYMENT_SELLER_REFUND_CONFIRM: CONFIRMATION,
    ORDER_PAYMENT_SELLER_REFUND_EXPECTED_COMMIT: COMMIT,
    ORDER_PAYMENT_SELLER_REFUND_DEPLOYED_SOURCE_COMMIT: SOURCE,
    ORDER_PAYMENT_SELLER_REFUND_SIGNED_PROOF_COMMIT: SIGNED,
    ORDER_PAYMENT_SELLER_REFUND_MAIN_CI_RUN_ID: String(CI),
    ORDER_PAYMENT_SELLER_REFUND_SIGNED_PROOF_CI_RUN_ID: String(SIGNED_CI),
    ORDER_PAYMENT_SELLER_REFUND_DEPLOYMENT_ID: DEPLOYMENT,
    ORDER_PAYMENT_SELLER_REFUND_STRIPE_CLI_PATH: "/opt/homebrew/bin/stripe",
    ORDER_PAYMENT_SELLER_REFUND_SIGNED_EVIDENCE_PATH: "/private/tmp/signed.json",
    ...overrides,
  };
}

function fullState(stage = "signed-confirmed", overrides = {}) {
  return {
    version: 1,
    stage,
    expectedCommit: COMMIT,
    deployedSourceCommit: SOURCE,
    mainCiRunId: CI,
    deploymentId: DEPLOYMENT,
    signedProofCommit: SIGNED,
    signedProofCiRunId: SIGNED_CI,
    attemptId: "11111111-1111-4111-8111-111111111111",
    startedAt: "2026-08-25T00:00:00.000Z",
    sellerUserId: "opesr_11111111111111111111111111111111_selleruser",
    sellerClerkId: "user_sellerrefundproof",
    sellerProfileId: "opesr_11111111111111111111111111111111_seller",
    buyerId: "opesr_11111111111111111111111111111111_buyer",
    buyerClerkId: "opesr_11111111111111111111111111111111_buyerclerk",
    buyerEmail: "opesr_11111111111111111111111111111111_buyer@example.invalid",
    listingId: "opesr_11111111111111111111111111111111_listing",
    orderId: "opesr_11111111111111111111111111111111_order",
    orderItemId: "opesr_11111111111111111111111111111111_item",
    caseId: "opesr_11111111111111111111111111111111_case",
    stripeAccountId: "acct_sellerrefundproof",
    paymentIntentId: "pi_sellerrefundproof",
    chargeId: "ch_sellerrefundproof",
    transferId: "tr_sellerrefundproof",
    refundId: "re_sellerrefundproof",
    transferReversalId: "trr_sellerrefundproof",
    signedEventId: "evt_sellerrefundproof",
    localPaymentEventId: "local-payment-proof",
    signedPaymentEventId: "signed-payment-proof",
    caseApplicationId: "local-payment-proof",
    notificationId: "notification-proof",
    emailOutboxId: "outbox-proof",
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  const state = fullState();
  return {
    paymentCount: 2,
    localPaymentEventId: state.localPaymentEventId,
    signedPaymentEventId: state.signedPaymentEventId,
    signedReason: "local_refund_confirmed",
    localBuyerRefundAmount: "500",
    localOriginalTransferAmount: "475",
    localTransferReversalId: state.transferReversalId,
    localTransferReversalAmount: "475",
    localPlatformFundedAmount: "25",
    signedLatestRefundId: state.refundId,
    signedTotalRefunded: "500",
    signedPendingLocalLock: "false",
    refundObjectCount: 2,
    webhookCount: 1,
    webhookGeneration: "1",
    orderRefundId: state.refundId,
    orderRefundAmount: REFUND_AMOUNT_CENTS,
    claimCleared: true,
    reviewNeeded: true,
    stock: 1,
    listingStatus: "ACTIVE",
    caseStatus: "RESOLVED",
    caseResolution: "REFUND_FULL",
    caseRefundAmount: REFUND_AMOUNT_CENTS,
    caseRefundId: state.refundId,
    caseResolvedBy: state.sellerUserId,
    caseApplicationCount: 1,
    caseApplicationId: state.caseApplicationId,
    notificationCount: 1,
    notificationId: state.notificationId,
    outboxCount: 1,
    emailOutboxId: state.emailOutboxId,
    sellerAuditCount: 1,
    caseAuditCount: 1,
    signedAuditCount: 1,
    ...overrides,
  };
}

test("seller refund proof configuration and predecessor are exact", () => {
  const parsed = validateConfiguration(environment(), "/repo");
  assert.equal(parsed.expectedCommit, COMMIT);
  assert.equal(parsed.signedProofCommit, SIGNED);
  assert.equal(parsed.signedProofCiRunId, SIGNED_CI);
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_SELLER_REFUND_CONFIRM: "wrong" })), /confirmation is invalid/);
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_SELLER_REFUND_SIGNED_PROOF_COMMIT: "bad" })), /commit input is invalid/);
  const predecessor = {
    phase: "order-payment-event-signed-production-proof",
    status: "passed",
    mode: "test",
    commit: SIGNED,
    ciRunId: SIGNED_CI,
    deployedSourceCommit: SOURCE,
    deploymentId: DEPLOYMENT,
    providerStage: 4,
    stripe: { requiredResendTransitionsCompleted: 3, exactReplayProofs: 2 },
    database: { retainedProcessedWebhookLeases: 2, temporaryApplicationRowsRemoved: true, exactRetriesLeftApplicationIdentitiesUnchanged: true },
    providerConfigurationChanged: false,
    liveMoneyMoved: false,
  };
  assert.equal(assertSignedPredecessorEvidence(predecessor, config).status, "passed");
  assert.throws(() => assertSignedPredecessorEvidence({ ...predecessor, providerStage: 3 }, config), /predecessor evidence drifted/);
});

test("restart state rejects unknown fields and missing reached identities", () => {
  const initial = createInitialState(config, { id: "opesr_canary_user", clerkId: "user_canary" });
  assert.equal(initial.stage, "reserved");
  assert.equal(assertState(fullState(), config).stage, "signed-confirmed");
  assert.throws(() => assertState({ ...fullState(), unexpected: true }, config), /unknown field/);
  assert.throws(() => assertState(fullState("signed-confirmed", { signedEventId: null }), config), /signedEventId is missing/);
  assert.throws(() => assertState(fullState("payment-created", { paymentIntentId: null }), config), /paymentIntentId is missing/);
});

test("disposable account requests only transfer authority and is marker-bound", () => {
  const state = fullState("reserved", {
    stripeAccountId: null, paymentIntentId: null, chargeId: null, transferId: null,
    refundId: null, transferReversalId: null, signedEventId: null,
    localPaymentEventId: null, signedPaymentEventId: null, caseApplicationId: null,
    notificationId: null, emailOutboxId: null,
  });
  const params = buildConnectedAccountParams(config, state, new Date("2026-08-25T00:00:00Z"));
  assert.deepEqual(params.capabilities, { transfers: { requested: true } });
  assert.equal(params.capabilities.card_payments, undefined);
  assert.equal(params.type, "custom");
  assert.equal(params.tos_acceptance.date, 1787616000);
  const account = { id: "acct_proof", deleted: false, country: "US", default_currency: "usd", type: "custom",
    capabilities: { transfers: "active" }, metadata: params.metadata };
  assert.equal(assertConnectedAccount(account, config, state).id, "acct_proof");
  assert.throws(() => assertConnectedAccount({ ...account, capabilities: { transfers: "pending" } }, config, state), /transfer capability is not active/);
});

test("destination payment and provider refund prove exact reversal", () => {
  const state = fullState();
  const payment = { id: state.paymentIntentId, livemode: false, status: "succeeded", amount: 500, currency: "usd", latest_charge: state.chargeId };
  const charge = { id: state.chargeId, livemode: false, paid: true, amount: 500, currency: "usd",
    transfer: { id: state.transferId, amount: TRANSFER_AMOUNT_CENTS, destination: state.stripeAccountId } };
  assert.deepEqual(assertPayment(payment, charge, state.stripeAccountId), {
    paymentIntentId: state.paymentIntentId, chargeId: state.chargeId, transferId: state.transferId,
  });
  const refund = { id: state.refundId, livemode: false, amount: 500, currency: "usd", status: "succeeded",
    payment_intent: state.paymentIntentId, charge: state.chargeId,
    transfer_reversal: { id: state.transferReversalId, amount: TRANSFER_AMOUNT_CENTS, transfer: state.transferId } };
  assert.equal(assertRefundProviderEvidence(refund, state).transferReversalId, state.transferReversalId);
  assert.throws(() => assertRefundProviderEvidence({ ...refund, amount: 499 }, state), /provider evidence drifted/);
});

test("local and signed effects, replay, evidence and redaction fail closed", () => {
  const state = fullState();
  const first = assertProofSnapshot(snapshot(), state);
  assert.equal(first.paymentCount, 2);
  assert.equal(assertProofSnapshot(snapshot({
    signedReason: "local_refund_pending_confirmation",
    signedPendingLocalLock: "true",
  }), state).signedReason, "local_refund_pending_confirmation");
  assert.deepEqual(assertReplayUnchanged(first, snapshot(), state), first);
  assert.throws(() => assertReplayUnchanged(first, snapshot({ stock: 2 }), state), /production effects drifted/);
  const cleanup = { accountDeleted: true, applicationRowsRemoved: true, clerkSessionsRevoked: true,
    rateLimitKeysRemoved: true, processedWebhookCount: 1, canaryCount: 1 };
  const evidence = buildEvidence(config, state, cleanup);
  assert.equal(assertEvidence(evidence, config).database.retainedProcessedWebhookLeases, 1);
  assert.match(evidence.stripe.refundSha256, /^[a-f0-9]{64}$/);
  assert.equal(redact("sk_test_secret acct_123 postgres://owner:secret@db Bearer token"),
    "[redacted-stripe-secret] [redacted-stripe-object] [redacted-database-url] Bearer [redacted-token]");
});

test("static operator contract remains test-only and production-configuration read-only", () => {
  const source = readFileSync(new URL(
    "../scripts/order-payment-event-seller-refund-production-proof.mjs",
    import.meta.url,
  ), "utf8");
  const documentation = readFileSync(new URL(
    "../docs/order-payment-event-seller-refund-production-proof.md",
    import.meta.url,
  ), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(source, /validateStripeSecret\(localValues\)/);
  assert.match(source, /provider\.stage !== 4/);
  assert.match(source, /type: "custom"/);
  assert.match(source, /capabilities: \{ transfers: \{ requested: true \} \}/);
  assert.match(source, /"vacationMode"/);
  assert.match(source, /EMAIL_REFUND_ISSUED/);
  assert.match(source, /cleanupExactRows/);
  assert.doesNotMatch(source, /sk_live_/);
  assert.doesNotMatch(source, /webhookEndpoints\.(?:create|update|del)/);
  assert.doesNotMatch(source, /vercel\s+(?:deploy|env|promote|remove)/i);
  assert.match(documentation, /does\s+not\s+authorize execution/i);
  assert.match(documentation, /Do not\s+bundle those authorities/i);
  assert.equal(
    manifest.scripts["ops:order-payment-event-seller-refund-production-proof"],
    "node scripts/order-payment-event-seller-refund-production-proof.mjs",
  );
});
