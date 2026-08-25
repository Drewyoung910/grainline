import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONFIRMATION,
  DISPUTE_AMOUNT_CENTS,
  EVIDENCE_DIRECTORY,
  REFUND_AMOUNT_CENTS,
  assertCleanupSnapshot,
  assertDeliverySnapshot,
  assertPendingStateTransition,
  assertReplayUnchanged,
  assertState,
  buildEvidence,
  disposableDatabaseIdentity,
  redact,
  shouldReadApplicationDelivery,
  validateConfiguration,
} from "../scripts/order-payment-event-signed-production-proof.mjs";

const COMMIT = "a".repeat(40);
const DEPLOYED_SOURCE_COMMIT = "b".repeat(40);
const CI_RUN_ID = 32809999999;
const DEPLOYMENT_ID = "dpl_OrderPaymentSignedProof123";
const config = Object.freeze({
  deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
  deploymentId: DEPLOYMENT_ID,
  expectedCommit: COMMIT,
  mainCiRunId: CI_RUN_ID,
});

function environment(overrides = {}) {
  return {
    ORDER_PAYMENT_SIGNED_PROOF_CONFIRM: CONFIRMATION,
    ORDER_PAYMENT_SIGNED_PROOF_EXPECTED_COMMIT: COMMIT,
    ORDER_PAYMENT_SIGNED_PROOF_DEPLOYED_SOURCE_COMMIT: DEPLOYED_SOURCE_COMMIT,
    ORDER_PAYMENT_SIGNED_PROOF_CI_RUN_ID: String(CI_RUN_ID),
    ORDER_PAYMENT_SIGNED_PROOF_DEPLOYMENT_ID: DEPLOYMENT_ID,
    ORDER_PAYMENT_SIGNED_PROOF_EVIDENCE_PATH:
      `${EVIDENCE_DIRECTORY}/order-payment-event-signed-production-proof-${COMMIT}.json`,
    ORDER_PAYMENT_SIGNED_PROOF_VERCEL_PROJECT_DIRECTORY: "/Users/drewyoung/grainline",
    ...overrides,
  };
}

function state(stage, overrides = {}) {
  const attemptId = "11111111-1111-4111-8111-111111111111";
  const value = {
    phase: "order-payment-event-signed-production-proof-state",
    stage,
    commit: COMMIT,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    ciRunId: CI_RUN_ID,
    deploymentId: DEPLOYMENT_ID,
    attemptId,
    startedSeconds: 1787700000,
    ...disposableDatabaseIdentity(attemptId),
  };
  const index = [
    "reserved",
    "refund-charge-created",
    "refund-fixture-created",
    "refund-created",
    "refund-event-ready",
    "refund-delivered",
    "refund-replay-pending",
    "refund-replayed",
    "dispute-charge-created",
    "all-fixtures-created",
    "dispute-event-ready",
    "dispute-delivery-resend-pending",
    "dispute-delivered",
    "dispute-replay-pending",
    "dispute-replayed",
    "cleanup-started",
    "cleaned",
  ].indexOf(stage);
  const reached = (target) => index >= [
    "reserved",
    "refund-charge-created",
    "refund-fixture-created",
    "refund-created",
    "refund-event-ready",
    "refund-delivered",
    "refund-replay-pending",
    "refund-replayed",
    "dispute-charge-created",
    "all-fixtures-created",
    "dispute-event-ready",
    "dispute-delivery-resend-pending",
    "dispute-delivered",
    "dispute-replay-pending",
    "dispute-replayed",
    "cleanup-started",
    "cleaned",
  ].indexOf(target);
  if (reached("refund-charge-created")) Object.assign(value, {
    refundPaymentIntentId: "pi_refund_proof",
    refundChargeId: "ch_refund_proof",
  });
  if (reached("refund-created")) value.refundId = "re_refund_proof";
  if (reached("refund-event-ready")) value.refundEventId = "evt_refund_proof";
  if (reached("refund-delivered")) value.refundPaymentEventId = "ope_refund_proof";
  if (reached("dispute-charge-created")) Object.assign(value, {
    disputePaymentIntentId: "pi_dispute_proof",
    disputeChargeId: "ch_dispute_proof",
  });
  if (reached("dispute-event-ready")) Object.assign(value, {
    disputeId: "dp_dispute_proof",
    disputeEventId: "evt_dispute_proof",
  });
  if (reached("dispute-delivered")) Object.assign(value, {
    disputePaymentEventId: "ope_dispute_proof",
    caseId: "case_dispute_proof",
    notificationId: "notification_dispute_proof",
  });
  return { ...value, ...overrides };
}

function delivery(overrides = {}) {
  return {
    userCount: 2,
    sellerCount: 1,
    listingCount: 2,
    orderCount: 2,
    itemCount: 2,
    refundWebhookCount: 1,
    refundProcessed: true,
    refundErrorClear: true,
    refundGeneration: "1",
    refundWebhookEpoch: "1787700001.1",
    refundPaymentCount: 1,
    refundPaymentEventId: "ope_refund_proof",
    refundAuditCount: 1,
    orderRefundId: "re_refund_proof",
    orderRefundAmount: REFUND_AMOUNT_CENTS,
    refundReviewNeeded: true,
    disputeWebhookCount: 1,
    disputeProcessed: true,
    disputeErrorClear: true,
    disputeGeneration: "2",
    disputeWebhookEpoch: "1787700002.2",
    disputePaymentCount: 1,
    disputePaymentEventId: "ope_dispute_proof",
    caseApplicationCount: 1,
    caseId: "case_dispute_proof",
    caseCount: 1,
    notificationCount: 1,
    notificationId: "notification_dispute_proof",
    disputeAuditCount: 1,
    caseAuditCount: 1,
    disputeReviewNeeded: true,
    ...overrides,
  };
}

test("signed production proof requires an exact release binding", () => {
  const parsed = validateConfiguration(environment());
  assert.equal(parsed.expectedCommit, COMMIT);
  assert.equal(parsed.deployedSourceCommit, DEPLOYED_SOURCE_COMMIT);
  assert.equal(parsed.mainCiRunId, CI_RUN_ID);
  assert.equal(parsed.deploymentId, DEPLOYMENT_ID);
  assert.match(parsed.statePath, new RegExp(`${COMMIT}\\.json$`));
  assert.throws(
    () => validateConfiguration(environment({ ORDER_PAYMENT_SIGNED_PROOF_CONFIRM: "wrong" })),
    /confirmation is invalid/,
  );
  assert.throws(
    () => validateConfiguration(environment({ ORDER_PAYMENT_SIGNED_PROOF_EXPECTED_COMMIT: "bad" })),
    /expected commit is invalid/,
  );
  assert.throws(
    () => validateConfiguration(environment({ ORDER_PAYMENT_SIGNED_PROOF_DEPLOYMENT_ID: "bad" })),
    /deployment ID is invalid/,
  );
  assert.throws(
    () => validateConfiguration(environment({
      ORDER_PAYMENT_SIGNED_PROOF_EVIDENCE_PATH: `${EVIDENCE_DIRECTORY}/wrong.json`,
    })),
    /evidence path is not fresh and exact/,
  );
});

test("deterministic fixture identities and restart stages fail closed", () => {
  const identity = disposableDatabaseIdentity("11111111-1111-4111-8111-111111111111");
  assert.equal(identity.buyerId, "opeb_11111111111141118111111111111111");
  assert.equal(identity.refundOrderId, "opeo_11111111111141118111111111111111_refund");
  assert.equal(assertState(state("cleaned"), config).stage, "cleaned");
  assert.throws(
    () => assertState(state("cleaned", { notificationId: "" }), config),
    /state notificationId is missing/,
  );
  assert.throws(
    () => assertState(state("cleaned", { refundOrderId: "collision" }), config),
    /fixture identity drifted/,
  );
  assert.throws(
    () => assertState(state("unknown"), config),
    /recovery state drifted/,
  );
  assert.throws(
    () => assertState(state("reserved", { unreviewed: true }), config),
    /unknown field/,
  );
});

test("post-cleanup recovery never requires deleted application rows", () => {
  const cleaned = state("cleaned");
  assert.equal(shouldReadApplicationDelivery("dispute-delivered"), true);
  assert.equal(shouldReadApplicationDelivery("dispute-replay-pending"), true);
  assert.equal(shouldReadApplicationDelivery("dispute-replayed"), true);
  assert.equal(shouldReadApplicationDelivery("cleanup-started"), false);
  assert.equal(shouldReadApplicationDelivery("cleaned"), false);
  const evidence = buildEvidence(config, cleaned, {
    userCount: 0,
    sellerCount: 0,
    listingCount: 0,
    orderCount: 0,
    itemCount: 0,
    paymentCount: 0,
    caseCount: 0,
    notificationCount: 0,
    webhookCount: 2,
    processedWebhookCount: 2,
  }, { stage: 4 });
  assert.match(evidence.database.refundPaymentEventSha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.database.disputePaymentEventSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.database.temporaryApplicationRowsRemoved, true);
});

test("crash-left pending state accepts only one adjacent sealed transition", () => {
  const current = state("refund-delivered");
  const pending = state("refund-replay-pending");
  assert.equal(assertPendingStateTransition(current, pending, config).stage, "refund-replay-pending");
  assert.throws(
    () => assertPendingStateTransition(current, state("refund-replayed"), config),
    /not the exact next stage/,
  );
  assert.throws(
    () => assertPendingStateTransition(current, {
      ...pending,
      refundPaymentEventId: "ope_forged",
    }, config),
    /changed sealed prior data/,
  );
});

test("delivery, replay and cleanup snapshots preserve exact identities", () => {
  const first = assertDeliverySnapshot(delivery(), { refundId: "re_refund_proof" });
  assert.equal(first.orderRefundAmount, REFUND_AMOUNT_CENTS);
  assert.equal(DISPUTE_AMOUNT_CENTS, 500);
  assert.deepEqual(
    assertReplayUnchanged(first, delivery(), { refundId: "re_refund_proof" }),
    first,
  );
  assert.throws(
    () => assertReplayUnchanged(first, delivery({ disputeGeneration: "3" }), {
      refundId: "re_refund_proof",
    }),
    /changed disputeGeneration/,
  );
  assert.throws(
    () => assertDeliverySnapshot(delivery({ notificationCount: 2 }), {
      refundId: "re_refund_proof",
    }),
    /did not reach the exact reviewed state/,
  );
  assert.deepEqual(assertCleanupSnapshot({
    userCount: 0,
    sellerCount: 0,
    listingCount: 0,
    orderCount: 0,
    itemCount: 0,
    paymentCount: 0,
    caseCount: 0,
    notificationCount: 0,
    webhookCount: 2,
    processedWebhookCount: 2,
  }), {
    userCount: 0,
    sellerCount: 0,
    listingCount: 0,
    orderCount: 0,
    itemCount: 0,
    paymentCount: 0,
    caseCount: 0,
    notificationCount: 0,
    webhookCount: 2,
    processedWebhookCount: 2,
  });
  assert.throws(
    () => assertCleanupSnapshot({ webhookCount: 2, processedWebhookCount: 1 }),
    /cleanup did not reach/,
  );
});

test("operator output redaction covers every retained secret and raw identity class", () => {
  const unsafe = [
    "postgresql://role:secret@example.test/db",
    "sk_test_secretvalue",
    "whsec_secretvalue",
    "Bearer opaque.value",
    "evt_rawproof",
    "opeb_11111111111141118111111111111111",
    "order_payment_proof_buyer_11111111111141118111111111111111",
    "order-payment-proof-seller-11111111111141118111111111111111@example.invalid",
  ].join(" ");
  const safe = redact(unsafe);
  for (const fragment of ["postgresql://", "sk_test_", "whsec_", "evt_rawproof", "opeb_", "example.invalid"]) {
    assert.equal(safe.includes(fragment), false);
  }
});

test("static operator contract stays test-only, restart-safe and provider-configuration read-only", () => {
  const source = readFileSync("scripts/order-payment-event-signed-production-proof.mjs", "utf8");
  const documentation = readFileSync("docs/order-payment-event-signed-production-proof.md", "utf8");
  const architecture = readFileSync("docs/architecture.md", "utf8");
  const strategy = readFileSync("STRATEGY.md", "utf8");
  assert.match(source, /pm_card_visa/);
  assert.match(source, /pm_card_createDispute/);
  assert.match(source, /stripe\.events\.list/);
  assert.match(source, /events", "resend"/);
  assert.match(source, /stripe version \$\{STRIPE_CLI_VERSION\}/);
  assert.match(source, /provider\.stage !== 4/);
  assert.match(source, /const githubEnvironment = childEnvironment/);
  assert.match(source, /providerConfigurationChanged: false/);
  assert.match(source, /activationReadyFromThisProofAlone: false/);
  assert.match(source, /requiredResendTransitionsCompleted: 3/);
  assert.match(source, /two processed Stripe test-mode webhook replay leases retained/);
  assert.match(source, /ordinary signed-delivery and observability telemetry retained/);
  assert.match(source, /shouldReadApplicationDelivery\(state\.stage\)/);
  assert.doesNotMatch(source, /STAGES\.indexOf\(state\.stage\) >= STAGES\.indexOf\("dispute-delivered"\)/);
  assert.doesNotMatch(source, /webhookEndpoints\.(create|update|del)\(/);
  assert.doesNotMatch(source, /eventDestinations\.(create|update|del)\(/);
  assert.doesNotMatch(source, /sk_live_/);
  assert.doesNotMatch(source, /DELETE FROM public\."StripeWebhookEvent"/);
  assert.match(documentation, /necessary but explicitly insufficient evidence/);
  assert.match(documentation, /seller-refund, blocked-checkout and staff Case refund live proofs/);
  assert.match(documentation, /every live foreign key/);
  assert.match(architecture, /Provider acceptance is split by authority family/);
  assert.match(strategy, /passing signed-family proof remains explicitly insufficient/);
});
