import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONFIRMATION,
  RECONCILIATION_CONFIRMATION,
  CHECKOUT_SESSION_EXPANDS,
  CONNECTED_ACCOUNT_CONTROLLER,
  CONNECTED_ACCOUNT_MARKER_KEY,
  DISPOSABLE_SELLER_CONTROLLER_SUMMARY,
  FAILED_PROOF_REVIEW_NOTE,
  MAX_EXPIRED_CHECKOUT_ATTEMPTS,
  PRICE_CENTS,
  SELLER_TRANSFER_CENTS,
  STRIPE_METADATA_KEY_MAX_LENGTH,
  assertCheckoutResponse,
  assertCheckoutAttemptHistory,
  assertAbortCleanupStage,
  assertCompletedSession,
  assertConnectedAccount,
  assertDeliverySnapshot,
  assertEvidence,
  assertExpiredPaymentRenewal,
  assertExpiredPaymentSnapshot,
  assertOnboardingLink,
  assertOnboardingRecord,
  assertManualReconciliationDeliverySnapshot,
  assertManualReconciliationProvider,
  assertPreparedSnapshot,
  assertRefund,
  assertReconciliationEvidence,
  assertReconciliationProofState,
  assertReconciliationState,
  assertReplayUnchanged,
  assertStripeMetadataKeys,
  assertState,
  buildConnectedAccountLinkParams,
  buildConnectedAccountParams,
  buildEvidence,
  buildReconciliationEvidence,
  buildPaymentPage,
  createInitialState,
  exactRefundCreationEvent,
  exactRefundEvent,
  isCheckoutClientSecretForSession,
  redact,
  readOnboardingRecord,
  reconciliationUsesPreviousOperatorBinding,
  removeOnboardingRecord,
  requiredExistingReversalForOperatorRebind,
  validateConfiguration,
  validateProviderCredentials,
  writeOnboardingRecord,
} from "../scripts/order-payment-event-blocked-checkout-production-proof.mjs";

const COMMIT = "a".repeat(40);
const SOURCE = "b".repeat(40);
const CI = 32820000001;
const DEPLOYMENT = "dpl_BlockedCheckoutProof";
const RECOVERY_SOURCE = "d".repeat(40);
const RECOVERY_CI = CI + 2;
const RECOVERY_DEPLOYMENT = "dpl_BlockedCheckoutRecovery";
const PREVIOUS_OPERATOR = "e".repeat(40);
const PREVIOUS_OPERATOR_CI = CI + 3;
const config = Object.freeze({
  expectedCommit: COMMIT,
  deployedSourceCommit: SOURCE,
  mainCiRunId: CI,
  deploymentId: DEPLOYMENT,
});

function environment(overrides = {}) {
  return {
    ORDER_PAYMENT_BLOCKED_CHECKOUT_CONFIRM: CONFIRMATION,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_EXPECTED_COMMIT: COMMIT,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_DEPLOYED_SOURCE_COMMIT: SOURCE,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_MAIN_CI_RUN_ID: String(CI),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_DEPLOYMENT_ID: DEPLOYMENT,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "prepare",
    ...overrides,
  };
}

function state(stage = "delivery-confirmed", overrides = {}) {
  return {
    version: 1,
    stage,
    expectedCommit: COMMIT,
    deployedSourceCommit: SOURCE,
    mainCiRunId: CI,
    deploymentId: DEPLOYMENT,
    attemptId: "11111111-1111-4111-8111-111111111111",
    startedAt: "2026-08-25T00:00:00.000Z",
    buyerId: "opebc_buyer_canary",
    buyerClerkId: "user_canary",
    buyerEmail: "canary@example.com",
    originalNotificationPreferences: { EMAIL_REFUND_ISSUED: true },
    originalTermsAcceptedAt: "2026-06-14T00:00:00.000Z",
    originalTermsVersion: "2026-06-14",
    originalAgeAttestedAt: "2026-06-14T00:00:00.000Z",
    sellerUserId: "opebc_11111111111111111111111111111111_seller_user",
    sellerClerkId: "opebc_11111111111111111111111111111111_seller_clerk",
    sellerProfileId: "opebc_11111111111111111111111111111111_seller",
    sellerEmail: "opebc_11111111111111111111111111111111_seller@example.invalid",
    listingId: "opebc_11111111111111111111111111111111_listing",
    stripeAccountId: "acct_blockedproof",
    stripeSessionId: "cs_test_blockedproof",
    stripeClientSecret: "cs_test_blockedproof_secret_private",
    checkoutLockKey: "checkout:single:opebc_buyer_canary:listing:opebc_11111111111111111111111111111111_listing",
    reservationId: "reservation-proof",
    priorExpiredCheckoutCount: 0,
    checkoutEventId: "evt_checkoutproof",
    orderId: "order-proof",
    orderItemId: "item-proof",
    paymentIntentId: "pi_blockedproof",
    chargeId: "ch_blockedproof",
    transferId: "tr_blockedproof",
    chargeAmountCents: 540,
    refundId: "re_blockedproof",
    refundAmountCents: 540,
    transferReversalId: "trr_blockedproof",
    refundEventId: "evt_refundproof",
    localPaymentEventId: "payment-local",
    signedPaymentEventId: "payment-signed",
    notificationId: "notification-proof",
    emailOutboxId: "outbox-proof",
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  const value = state();
  return {
    order_id: value.orderId,
    order_refund_id: value.refundId,
    order_refund_amount: value.refundAmountCents,
    payment_intent_id: value.paymentIntentId,
    charge_id: value.chargeId,
    transfer_id: value.transferId,
    buyer_id: value.buyerId,
    seller_id: value.sellerProfileId,
    items_subtotal: PRICE_CENTS,
    shipping_amount: 0,
    tax_amount: 40,
    review_needed: true,
    review_note: "Seller entered vacation mode before payment completion. Order was held for staff review.",
    claim_cleared: true,
    claim_generation: "1",
    item_count: 1,
    item_id: value.orderItemId,
    payment_count: 2,
    local_payment_id: value.localPaymentEventId,
    signed_payment_id: value.signedPaymentEventId,
    signed_reason: "local_refund_confirmed",
    local_buyer_refund: "540",
    local_transfer_amount: "475",
    local_reversal_id: value.transferReversalId,
    signed_latest_refund: value.refundId,
    signed_total_refunded: "540",
    checkout_webhook_count: 1,
    checkout_generation: "1",
    refund_webhook_count: 1,
    refund_generation: "1",
    reservation_status: "COMPLETED",
    stock: 1,
    listing_status: "ACTIVE",
    vacation_mode: true,
    notification_count: 1,
    notification_id: value.notificationId,
    wrong_notification_count: 0,
    outbox_count: 1,
    outbox_id: value.emailOutboxId,
    wrong_outbox_count: 0,
    checkout_audit_count: 1,
    local_audit_count: 1,
    signed_audit_count: 1,
    ...overrides,
  };
}

test("configuration and restart state fail closed", () => {
  const parsed = validateConfiguration(environment(), "/repo");
  assert.equal(parsed.expectedCommit, COMMIT);
  assert.equal(parsed.command, "prepare");
  assert.equal(parsed.applicationDeployedSourceCommit, SOURCE);
  assert.equal(parsed.applicationMainCiRunId, CI);
  assert.equal(parsed.applicationDeploymentId, DEPLOYMENT);
  assert.equal(validateConfiguration(environment({ ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "onboard" }), "/repo").command,
    "onboard");
  assert.equal(validateConfiguration(environment({ ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "renew" }), "/repo").command,
    "renew");
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "reconcile",
  }), "/repo"), /RECONCILIATION_CONFIRM|reconciliation confirmation/);
  assert.equal(validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "reconcile",
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_CONFIRM: RECONCILIATION_CONFIRMATION,
  }), "/repo").command, "reconcile");
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_BLOCKED_CHECKOUT_CONFIRM: "wrong" })), /confirmation is invalid/);
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "run" })), /command is invalid/);
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_COMMIT: "c".repeat(40),
  })), /commit and CI must be supplied together/);
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_COMMIT: "c".repeat(40),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_CI_RUN_ID: String(CI),
  })), /must replace both commit and CI bindings/);
  const recovery = validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_COMMIT: "c".repeat(40),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_CI_RUN_ID: String(CI + 1),
  }), "/repo");
  assert.equal(recovery.expectedCommit, COMMIT);
  assert.equal(recovery.mainCiRunId, CI);
  assert.equal(recovery.operatorCommit, "c".repeat(40));
  assert.equal(recovery.operatorCiRunId, CI + 1);
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "reconcile",
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_CONFIRM: RECONCILIATION_CONFIRMATION,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_COMMIT: "c".repeat(40),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_CI_RUN_ID: String(CI + 1),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_PREVIOUS_OPERATOR_COMMIT: PREVIOUS_OPERATOR,
  })), /previous operator commit and CI must be supplied together/);
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_PREVIOUS_OPERATOR_COMMIT: PREVIOUS_OPERATOR,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_PREVIOUS_OPERATOR_CI_RUN_ID: String(PREVIOUS_OPERATOR_CI),
  })), /previous operator binding is reconcile-only/);
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "reconcile",
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_CONFIRM: RECONCILIATION_CONFIRMATION,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_COMMIT: "c".repeat(40),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_CI_RUN_ID: String(CI + 1),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_PREVIOUS_OPERATOR_COMMIT: "c".repeat(40),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_PREVIOUS_OPERATOR_CI_RUN_ID: String(PREVIOUS_OPERATOR_CI),
  })), /must replace both current operator commit and CI bindings/);
  const reconciliationRebind = validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "reconcile",
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_CONFIRM: RECONCILIATION_CONFIRMATION,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_COMMIT: "c".repeat(40),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_CI_RUN_ID: String(CI + 1),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_PREVIOUS_OPERATOR_COMMIT: PREVIOUS_OPERATOR,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECONCILIATION_PREVIOUS_OPERATOR_CI_RUN_ID: String(PREVIOUS_OPERATOR_CI),
  }), "/repo");
  assert.equal(reconciliationRebind.reconciliationPreviousOperatorCommit, PREVIOUS_OPERATOR);
  assert.equal(reconciliationRebind.reconciliationPreviousOperatorCiRunId, PREVIOUS_OPERATOR_CI);
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECOVERY_DEPLOYED_SOURCE_COMMIT: RECOVERY_SOURCE,
  })), /commit, CI and deployment must be supplied together/);
  assert.throws(() => validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECOVERY_DEPLOYED_SOURCE_COMMIT: SOURCE,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECOVERY_MAIN_CI_RUN_ID: String(RECOVERY_CI),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECOVERY_DEPLOYMENT_ID: RECOVERY_DEPLOYMENT,
  })), /must replace commit, CI and deployment bindings/);
  const applicationRecovery = validateConfiguration(environment({
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECOVERY_DEPLOYED_SOURCE_COMMIT: RECOVERY_SOURCE,
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECOVERY_MAIN_CI_RUN_ID: String(RECOVERY_CI),
    ORDER_PAYMENT_BLOCKED_CHECKOUT_RECOVERY_DEPLOYMENT_ID: RECOVERY_DEPLOYMENT,
  }), "/repo");
  assert.equal(applicationRecovery.expectedCommit, COMMIT);
  assert.equal(applicationRecovery.deployedSourceCommit, SOURCE);
  assert.equal(applicationRecovery.mainCiRunId, CI);
  assert.equal(applicationRecovery.deploymentId, DEPLOYMENT);
  assert.equal(applicationRecovery.applicationDeployedSourceCommit, RECOVERY_SOURCE);
  assert.equal(applicationRecovery.applicationMainCiRunId, RECOVERY_CI);
  assert.equal(applicationRecovery.applicationDeploymentId, RECOVERY_DEPLOYMENT);
  assert.match(recovery.statePath, new RegExp(`state-${COMMIT.slice(0, 12)}\\.json$`));
  assert.match(recovery.onboardingPath, new RegExp(`onboarding-${COMMIT.slice(0, 12)}\\.json$`));
  assert.match(recovery.reconciliationPath, new RegExp(`reconciliation-state-${COMMIT.slice(0, 12)}\\.json$`));
  assert.match(recovery.reconciliationEvidencePath, new RegExp(`reconciliation-${COMMIT.slice(0, 12)}\\.json$`));
  const initial = createInitialState(config, {
    id: "opebc_buyer_canary", clerkId: "user_canary", email: "canary@example.com",
    notificationPreferences: {}, termsAcceptedAt: "2026-08-25T12:34:56.123456",
    termsVersion: "2026-06-14", ageAttestedAt: "2026-08-25T12:35:01.654321",
  });
  assert.equal(initial.stage, "reserved");
  assert.equal(initial.originalTermsAcceptedAt, "2026-08-25T12:34:56.123456");
  assert.equal(initial.originalAgeAttestedAt, "2026-08-25T12:35:01.654321");
  assert.equal(assertState(state(), config).stage, "delivery-confirmed");
  assert.equal(assertState({ ...state(), stripeClientSecret: "cs_test_blockedproof_secret_encoded%2Fvalue" }, config)
    .stripeClientSecret, "cs_test_blockedproof_secret_encoded%2Fvalue");
  assert.throws(() => assertState({ ...state(), stripeClientSecret: "cs_test_blockedproof_secret_encoded%2Gvalue" }, config),
    /client secret is invalid/);
  assert.throws(() => assertState({ ...state(), priorExpiredCheckoutCount: MAX_EXPIRED_CHECKOUT_ATTEMPTS + 1 }, config),
    /prior expired Checkout count is invalid/);
  assert.throws(() => assertState({ ...state(), unknown: true }, config), /unknown field/);
  assert.throws(() => assertState(state("delivery-confirmed", { refundEventId: null }), config), /refundEventId is missing/);
  assert.throws(() => assertState(state("delivery-confirmed", { originalNotificationPreferences: [] }), config), /preference snapshot drifted/);
  assert.throws(() => assertState(state("delivery-confirmed", { originalTermsAcceptedAt: "not-a-date" }), config), /timestamp snapshot drifted/);
  assert.throws(() => assertState(state("delivery-confirmed", { sellerProfileId: "real-seller-id" }), config), /disposable fixture identity/);
});

test("abort cleanup accepts only unambiguous persisted checkpoints", () => {
  assert.equal(assertAbortCleanupStage({ stage: "reserved" }), "reserved");
  assert.equal(assertAbortCleanupStage({ stage: "account-created" }), "account-created");
  assert.equal(assertAbortCleanupStage({ stage: "seller-blocked" }), "seller-blocked");
  for (const stage of [
    "account-create-pending",
    "fixtures-create-pending",
    "fixtures-created",
    "checkout-create-pending",
    "checkout-created",
  ]) {
    assert.throws(
      () => assertAbortCleanupStage({ stage }),
      /must resume prepare to a persisted cleanup checkpoint/,
    );
  }
  assert.throws(
    () => assertAbortCleanupStage({ stage: "payment-completed" }),
    /paid state must be completed with verify/,
  );
  assert.throws(
    () => assertAbortCleanupStage({ stage: "unknown" }),
    /abort state is invalid/,
  );
});

test("disposable connected account is transfer-only and marker-bound", () => {
  const pending = state("reserved", {
    stripeAccountId: null, stripeSessionId: null, stripeClientSecret: null, checkoutLockKey: null, reservationId: null,
    checkoutEventId: null, orderId: null, orderItemId: null, paymentIntentId: null, chargeId: null,
    transferId: null, chargeAmountCents: null, refundId: null, refundAmountCents: null,
    transferReversalId: null, refundEventId: null, localPaymentEventId: null, signedPaymentEventId: null,
    notificationId: null, emailOutboxId: null,
  });
  const params = buildConnectedAccountParams(config, pending, new Date("2026-08-25T00:00:00Z"));
  assert.deepEqual(params.capabilities, { transfers: { requested: true } });
  assert.equal(params.capabilities.card_payments, undefined);
  assert.equal(Object.hasOwn(params, "type"), false);
  assert.equal(Object.hasOwn(params, "business_type"), false);
  assert.equal(Object.hasOwn(params, "individual"), false);
  assert.equal(Object.hasOwn(params, "tos_acceptance"), false);
  assert.deepEqual(params.controller, CONNECTED_ACCOUNT_CONTROLLER);
  assert.deepEqual(params.controller, {
    fees: { payer: "application" },
    losses: { payments: "application" },
    requirement_collection: "stripe",
    stripe_dashboard: { type: "express" },
  });
  assert.equal(DISPOSABLE_SELLER_CONTROLLER_SUMMARY,
    "dashboard:express|fees:application|losses:application|requirements:stripe");
  assert.deepEqual(Object.keys(params.metadata), [CONNECTED_ACCOUNT_MARKER_KEY]);
  assert.ok(CONNECTED_ACCOUNT_MARKER_KEY.length <= STRIPE_METADATA_KEY_MAX_LENGTH);
  assert.equal(assertState({ ...pending, stage: "account-create-pending" }, config).stage, "account-create-pending");
  assert.throws(() => assertStripeMetadataKeys({ ["x".repeat(STRIPE_METADATA_KEY_MAX_LENGTH + 1)]: "value" }), /provider limits/);
  const account = { id: "acct_proof", deleted: false, livemode: false, country: "US", default_currency: "usd",
    controller: CONNECTED_ACCOUNT_CONTROLLER, capabilities: { transfers: "active" }, metadata: params.metadata };
  assert.equal(assertConnectedAccount(account, config, pending).id, "acct_proof");
  assert.equal(assertConnectedAccount({ ...account, capabilities: { transfers: "pending" } }, config, pending,
    { requireTransferActive: false }).id, "acct_proof");
  assert.throws(() => assertConnectedAccount({ ...account, capabilities: { transfers: "pending" } }, config, pending), /account drifted/);
  assert.throws(() => assertConnectedAccount({ ...account, controller: {
    ...CONNECTED_ACCOUNT_CONTROLLER, requirement_collection: "application",
  } }, config, pending), /"requirementsCollector":"application"/);
  assert.throws(() => assertConnectedAccount({ ...account, livemode: true }, config, pending), /account drifted/);
});

test("hosted onboarding is production-shaped, attempt-bound, and freshness-checked", () => {
  assert.deepEqual(buildConnectedAccountLinkParams("acct_proof"), {
    account: "acct_proof",
    collection_options: { fields: "eventually_due" },
    refresh_url: "https://thegrainline.com/?blocked_checkout_canary=refresh",
    return_url: "https://thegrainline.com/?blocked_checkout_canary=return",
    type: "account_onboarding",
  });
  assert.throws(() => buildConnectedAccountLinkParams("acct_invalid/value"), /exact account ID/);
  const link = {
    object: "account_link",
    url: "https://connect.stripe.com/setup/test_link",
    expires_at: Math.floor(Date.now() / 1000) + 600,
  };
  assert.equal(assertOnboardingLink(link).url, link.url);
  assert.throws(() => assertOnboardingLink({ ...link, url: "https://example.com/setup/test_link" }), /outside the reviewed boundary/);
  assert.throws(() => assertOnboardingLink({ ...link, expires_at: 1 }), /outside the reviewed boundary/);
  const accountCreated = state("account-created", {
    stripeSessionId: null, stripeClientSecret: null, checkoutLockKey: null, reservationId: null,
    checkoutEventId: null, orderId: null, orderItemId: null, paymentIntentId: null, chargeId: null,
    transferId: null, chargeAmountCents: null, refundId: null, refundAmountCents: null,
    transferReversalId: null, refundEventId: null, localPaymentEventId: null, signedPaymentEventId: null,
    notificationId: null, emailOutboxId: null,
  });
  const record = {
    version: 1,
    phase: "order-payment-event-blocked-checkout-onboarding",
    status: "onboarding-required",
    expectedCommit: COMMIT,
    deploymentId: DEPLOYMENT,
    attemptId: accountCreated.attemptId,
    stripeAccountId: accountCreated.stripeAccountId,
    accountLinkUrl: link.url,
    accountLinkExpiresAt: link.expires_at,
  };
  assert.equal(assertOnboardingRecord(record, config, accountCreated).stripeAccountId, accountCreated.stripeAccountId);
  assert.throws(() => assertOnboardingRecord({ ...record, attemptId: "22222222-2222-4222-8222-222222222222" },
    config, accountCreated), /does not bind/);
  assert.throws(() => assertOnboardingRecord({ ...record, accountLinkExpiresAt: 1 }, config, accountCreated),
    /outside the reviewed boundary/);
});

test("hosted-onboarding handoff is mode 0600, replaceable, and exactly removable", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grainline-blocked-onboarding-test-"));
  try {
    const onboardingPath = path.join(directory, "onboarding.json");
    const fileConfig = { ...config, onboardingPath };
    const accountCreated = state("account-created", {
      stripeSessionId: null, stripeClientSecret: null, checkoutLockKey: null, reservationId: null,
      checkoutEventId: null, orderId: null, orderItemId: null, paymentIntentId: null, chargeId: null,
      transferId: null, chargeAmountCents: null, refundId: null, refundAmountCents: null,
      transferReversalId: null, refundEventId: null, localPaymentEventId: null, signedPaymentEventId: null,
      notificationId: null, emailOutboxId: null,
    });
    const first = { object: "account_link", url: "https://connect.stripe.com/setup/first",
      expires_at: Math.floor(Date.now() / 1000) + 600 };
    writeOnboardingRecord(fileConfig, accountCreated, first);
    assert.equal(statSync(onboardingPath).mode & 0o777, 0o600);
    assert.equal(readOnboardingRecord(fileConfig, accountCreated).accountLinkUrl, first.url);
    const second = { ...first, url: "https://connect.stripe.com/setup/second", expires_at: first.expires_at + 60 };
    writeOnboardingRecord(fileConfig, accountCreated, second);
    assert.equal(readOnboardingRecord(fileConfig, accountCreated).accountLinkUrl, second.url);
    removeOnboardingRecord(fileConfig, accountCreated);
    assert.equal(existsSync(onboardingPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("provider credentials are pinned to test Stripe, live Grainline Clerk, and HTTPS Redis", () => {
  const values = {
    STRIPE_SECRET_KEY: "sk_test_example",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_example",
    CLERK_SECRET_KEY: "sk_live_example",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudGhlZ3JhaW5saW5lLmNvbSQ",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "a".repeat(32),
  };
  assert.equal(validateProviderCredentials(values).publishableKey, values.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  assert.throws(() => validateProviderCredentials({ ...values, STRIPE_SECRET_KEY: "sk_live_forbidden" }), /non-test Stripe secret/);
  assert.throws(() => validateProviderCredentials({ ...values, CLERK_SECRET_KEY: "sk_test_wrong" }), /live Clerk pair/);
  assert.throws(() => validateProviderCredentials({ ...values, UPSTASH_REDIS_REST_URL: "http://example.invalid" }), /Redis credentials/);
});

test("embedded page, route result, prepared state and Stripe effects are exact", () => {
  assert.deepEqual(CHECKOUT_SESSION_EXPANDS, ["payment_intent.latest_charge.transfer"]);
  assert.equal(Math.max(...CHECKOUT_SESSION_EXPANDS.map((value) => value.split(".").length)), 3);
  assert.equal(CHECKOUT_SESSION_EXPANDS.some((value) => value.includes("refunds")), false);
  const page = buildPaymentPage("pk_test_public", "cs_test_session", "cs_test_session_secret_private");
  assert.match(page, /https:\/\/js\.stripe\.com\/v3\//);
  assert.match(page, /initEmbeddedCheckout/);
  assert.match(page, /4242 4242 4242 4242/);
  const encodedPage = buildPaymentPage(
    "pk_test_public",
    "cs_test_session",
    "cs_test_session_secret_payload%2Fencoded%25value",
  );
  assert.match(encodedPage, /payload%2Fencoded%25value/);
  assert.throws(() => buildPaymentPage(
    "pk_live_forbidden", "cs_test_session", "cs_test_session_secret_private",
  ), /test publishable key/);
  assert.throws(() => buildPaymentPage(
    "pk_test_public", "cs_test_other", "cs_test_session_secret_payload%2Fencoded",
  ), /session-bound test client secret/);
  assert.throws(() => buildPaymentPage(
    "pk_test_public", "cs_test_session", "cs_test_session_secret_payload%2Ginvalid",
  ), /session-bound test client secret/);
  assert.throws(() => buildPaymentPage(
    "pk_test_public", "cs_test_session", `cs_test_session_secret_${"a".repeat(1024)}`,
  ), /session-bound test client secret/);
  assert.deepEqual(assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_private",
  } }), { sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_private" });
  assert.deepEqual(assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_payload%2Fencoded%25value",
  } }), { sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_payload%2Fencoded%25value" });
  assert.throws(() => assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: "cs_test_other_secret_payload%2Fencoded",
  } }), /route response drifted/);
  assert.throws(() => assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_payload%2Ginvalid",
  } }), /route response drifted/);
  assert.throws(() => assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: `cs_test_session_secret_${"a".repeat(1024)}`,
  } }), /route response drifted/);
  assert.throws(() => assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_payload\nforged",
  } }), /route response drifted/);
  assert.throws(() => assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_payload",
  } }, "cs_test_different"), /route response drifted/);
  const value = state();
  assert.equal(assertPreparedSnapshot({
    stock: 0, listing_status: "ACTIVE", vacation_mode: true, orders: 0,
    reservation_id: value.reservationId, reservation_status: "SESSION_CREATED", checkout_lock_key: value.checkoutLockKey,
    reservation_buyer: value.buyerId, reservation_seller: value.sellerProfileId,
  }, value).reservationId, value.reservationId);
  const transfer = { id: value.transferId, amount: SELLER_TRANSFER_CENTS, destination: value.stripeAccountId };
  const charge = { id: value.chargeId, amount: 540, currency: "usd", paid: true, livemode: false, transfer };
  const paymentIntent = { id: value.paymentIntentId, latest_charge: charge };
  const session = { id: value.stripeSessionId, livemode: false, status: "complete", payment_status: "paid", currency: "usd",
    amount_total: 540, metadata: { buyerId: value.buyerId, sellerId: value.sellerProfileId,
      listingId: value.listingId, checkoutLockKey: value.checkoutLockKey }, payment_intent: paymentIntent };
  assert.equal(assertCompletedSession(session, value).chargeAmountCents, 540);
  const refund = { id: value.refundId, object: "refund", amount: 540, currency: "usd", status: "succeeded",
    payment_intent: value.paymentIntentId, charge: value.chargeId,
    transfer_reversal: { id: value.transferReversalId, amount: SELLER_TRANSFER_CENTS, transfer: value.transferId } };
  assert.equal(assertRefund(refund, value).transferReversalId, value.transferReversalId);
});

test("Checkout attempt history accepts only bounded exact terminal rows and one active retry", () => {
  const value = state("checkout-create-pending", {
    stripeSessionId: null, stripeClientSecret: null, checkoutLockKey: null, reservationId: null,
    checkoutEventId: null, orderId: null, orderItemId: null, paymentIntentId: null, chargeId: null,
    transferId: null, chargeAmountCents: null, refundId: null, refundAmountCents: null,
    transferReversalId: null, refundEventId: null, localPaymentEventId: null, signedPaymentEventId: null,
    notificationId: null, emailOutboxId: null,
  });
  const row = (index, status = "RESTORED") => ({
    id: `reservation-${index}`,
    checkout_lock_key: `checkout:single:${value.buyerId}:listing:${value.listingId}`,
    payload_hash: `${index}`.repeat(32),
    buyer_id: value.buyerId,
    seller_id: value.sellerProfileId,
    stripe_session_id: `cs_test_attempt_${index}`,
    status,
    reserved_items: [{ listingId: value.listingId, quantity: 1, sellerId: value.sellerProfileId }],
    restored_at: status === "RESTORED" ? "2026-08-25T01:00:00.000Z" : null,
    restore_reason: status === "RESTORED" ? "stripe_session_expired" : null,
    repair_generation: "0",
    repair_claimed_at: null,
    repair_claim_kind: null,
    last_repair_error: null,
    last_repair_attempt_at: null,
  });
  const session = (index, status = "expired") => ({
    id: `cs_test_attempt_${index}`,
    livemode: false,
    ui_mode: "embedded",
    status,
    payment_status: "unpaid",
    payment_intent: null,
    client_secret: status === "open" ? `cs_test_attempt_${index}_secret_value%2Fencoded` : null,
    metadata: {
      buyerId: value.buyerId,
      sellerId: value.sellerProfileId,
      listingId: value.listingId,
      checkoutLockKey: `checkout:single:${value.buyerId}:listing:${value.listingId}`,
    },
  });
  const terminalRows = [row(1), row(2)];
  const terminalSessions = [session(1), session(2)];
  assert.deepEqual(assertCheckoutAttemptHistory(terminalRows, terminalSessions, value), {
    active: null,
    terminalCount: 2,
    terminalReservationIds: ["reservation-1", "reservation-2"],
    terminalSessionIds: ["cs_test_attempt_1", "cs_test_attempt_2"],
  });
  const activeHistory = assertCheckoutAttemptHistory(
    [...terminalRows, row(3, "SESSION_CREATED")],
    [...terminalSessions, session(3, "open")],
    value,
  );
  assert.equal(activeHistory.terminalCount, 2);
  assert.equal(activeHistory.active.sessionId, "cs_test_attempt_3");
  assert.equal(isCheckoutClientSecretForSession(activeHistory.active.sessionId, activeHistory.active.clientSecret), true);
  assert.throws(() => assertCheckoutAttemptHistory(
    [...terminalRows, row(3, "SESSION_CREATED"), row(4, "SESSION_CREATED")],
    [...terminalSessions, session(3, "open"), session(4, "open")],
    value,
  ), /active Checkout attempt drifted/);
  assert.throws(() => assertCheckoutAttemptHistory(
    terminalRows,
    [{ ...session(1), payment_status: "paid" }, session(2)],
    value,
  ), /historical Stripe Session drifted/);
  assert.throws(() => assertCheckoutAttemptHistory(
    terminalRows,
    [{ ...session(1), metadata: { ...session(1).metadata, sellerId: "wrong" } }, session(2)],
    value,
  ), /historical Stripe Session drifted/);
  assert.throws(() => assertCheckoutAttemptHistory(
    terminalRows.map((candidate, index) => index === 0 ? { ...candidate, restore_reason: "wrong" } : candidate),
    terminalSessions,
    value,
  ), /terminal Checkout attempt drifted/);
  const excessiveRows = Array.from({ length: MAX_EXPIRED_CHECKOUT_ATTEMPTS + 1 }, (_, index) => row(index + 1));
  const excessiveSessions = Array.from({ length: MAX_EXPIRED_CHECKOUT_ATTEMPTS + 1 }, (_, index) => session(index + 1));
  assert.throws(() => assertCheckoutAttemptHistory(excessiveRows, excessiveSessions, value), /cardinality drifted/);
});

test("expired seller-blocked payment renewal accepts only the exact bounded successor", () => {
  const value = state("seller-blocked", { priorExpiredCheckoutCount: 2 });
  const current = {
    active: {
      clientSecret: value.stripeClientSecret,
      reservationId: value.reservationId,
      sessionId: value.stripeSessionId,
    },
    terminalCount: 2,
    terminalReservationIds: ["reservation-1", "reservation-2"],
    terminalSessionIds: ["cs_test_attempt_1", "cs_test_attempt_2"],
  };
  assert.equal(assertExpiredPaymentRenewal(current, value).mode, "current");
  const expired = {
    active: null,
    terminalCount: 3,
    terminalReservationIds: ["reservation-1", "reservation-2", value.reservationId],
    terminalSessionIds: ["cs_test_attempt_1", "cs_test_attempt_2", value.stripeSessionId],
  };
  assert.equal(assertExpiredPaymentRenewal(expired, value).mode, "create-replacement");
  const replacement = {
    ...expired,
    active: {
      clientSecret: "cs_test_replacement_secret_payload%2Fencoded",
      reservationId: "reservation-replacement",
      sessionId: "cs_test_replacement",
    },
  };
  assert.equal(assertExpiredPaymentRenewal(replacement, value).mode, "resume-replacement");
  assert.throws(() => assertExpiredPaymentRenewal({
    ...expired,
    terminalSessionIds: ["cs_test_attempt_1", "cs_test_attempt_2", "cs_test_wrong"],
  }, value), /expired payment attempt drifted/);
  assert.throws(() => assertExpiredPaymentRenewal({ ...expired, terminalCount: 4 }, value), /payment renewal state drifted/);
  assert.throws(() => assertExpiredPaymentRenewal({
    ...expired,
    terminalReservationIds: [value.reservationId, value.reservationId, value.reservationId],
  }, value), /payment renewal state drifted/);
  assert.throws(() => assertExpiredPaymentRenewal({
    ...replacement,
    active: { ...replacement.active, reservationId: value.reservationId },
  }, value), /expired payment attempt drifted/);
  const expiredSnapshot = {
    stock: 1,
    listing_status: "ACTIVE",
    vacation_mode: true,
    orders: 0,
    reservation_id: value.reservationId,
    reservation_status: "RESTORED",
    checkout_lock_key: value.checkoutLockKey,
    reservation_buyer: value.buyerId,
    reservation_seller: value.sellerProfileId,
  };
  assert.equal(assertExpiredPaymentSnapshot(expiredSnapshot, value, true).reservationId, value.reservationId);
  assert.equal(assertExpiredPaymentSnapshot({ ...expiredSnapshot, vacation_mode: false }, value, false).reservationId,
    value.reservationId);
  assert.throws(() => assertExpiredPaymentSnapshot({ ...expiredSnapshot, stock: 0 }, value, true),
    /expired payment database state drifted/);
  assert.throws(() => assertExpiredPaymentSnapshot({ ...expiredSnapshot, reservation_status: "SESSION_CREATED" }, value, true),
    /expired payment database state drifted/);
});

test("delivery, exact replay, evidence, and redaction reject drift", () => {
  const value = state();
  assert.equal(redact("https://connect.stripe.com/setup/test_secret_path?key=value"), "[redacted-onboarding-url]");
  const delivered = assertDeliverySnapshot(snapshot(), value);
  assert.equal(delivered.wrongNotificationCount, 0);
  assert.deepEqual(assertReplayUnchanged(delivered, snapshot(), value), delivered);
  assert.throws(() => assertDeliverySnapshot(snapshot({ wrong_notification_count: 1 }), value), /delivery effects drifted/);
  assert.throws(() => assertReplayUnchanged(delivered, snapshot({ checkout_generation: "2" }), value), /delivery effects drifted/);
  const cleanup = { accountDeleted: true, applicationRowsRemoved: true, canaryCount: 1,
    clerkSessionsRevoked: true, processedWebhookCount: 2, redisKeysRemoved: true };
  const evidence = buildEvidence(config, value, cleanup);
  assert.equal(assertEvidence(evidence, config).stripe.genuineSignedEventsDelivered, 2);
  const recoveryConfig = { ...config, operatorCommit: "c".repeat(40), operatorCiRunId: CI + 1 };
  const recoveryEvidence = buildEvidence(recoveryConfig, value, cleanup);
  assert.equal(assertEvidence(recoveryEvidence, recoveryConfig).commit, COMMIT);
  assert.equal(recoveryEvidence.operatorCommit, "c".repeat(40));
  assert.equal(recoveryEvidence.operatorCiRunId, CI + 1);
  assert.throws(() => assertEvidence({ ...recoveryEvidence, operatorCommit: "d".repeat(40) }, recoveryConfig), /evidence drifted/);
  const applicationRecoveryConfig = {
    ...recoveryConfig,
    applicationDeployedSourceCommit: RECOVERY_SOURCE,
    applicationMainCiRunId: RECOVERY_CI,
    applicationDeploymentId: RECOVERY_DEPLOYMENT,
  };
  const applicationRecoveryEvidence = buildEvidence(applicationRecoveryConfig, value, cleanup);
  assert.deepEqual(applicationRecoveryEvidence.initialApplicationBinding, {
    deployedSourceCommit: SOURCE,
    ciRunId: CI,
    deploymentId: DEPLOYMENT,
  });
  assert.equal(applicationRecoveryEvidence.deployedSourceCommit, RECOVERY_SOURCE);
  assert.equal(applicationRecoveryEvidence.ciRunId, RECOVERY_CI);
  assert.equal(applicationRecoveryEvidence.deploymentId, RECOVERY_DEPLOYMENT);
  assert.equal(assertEvidence(applicationRecoveryEvidence, applicationRecoveryConfig).deploymentId, RECOVERY_DEPLOYMENT);
  assert.throws(() => assertEvidence({
    ...applicationRecoveryEvidence,
    initialApplicationBinding: { ...applicationRecoveryEvidence.initialApplicationBinding, deploymentId: "dpl_wrong" },
  }, applicationRecoveryConfig), /evidence drifted/);
  assert.equal(redact("sk_test_secret cs_test_x_secret_y acct_123 postgres://u:p@db Bearer token"),
    "[redacted-stripe-secret] [redacted-stripe-secret] [redacted-stripe-object] [redacted-database-url] Bearer [redacted-token]");
  assert.equal(redact("cs_test_x_secret_payload%2Fencoded%25value"), "[redacted-stripe-secret]");
});

test("failed-proof reconciliation stays distinct, exact and restart-safe", () => {
  const value = state("payment-completed", { transferReversalId: null });
  const manualSnapshot = snapshot({
    transfer_id: null,
    review_note: FAILED_PROOF_REVIEW_NOTE,
    signed_reason: "additional_external_refund",
    signed_latest_refund: null,
    listing_status: "SOLD_OUT",
    local_reversal_id: null,
    local_reversal_amount: null,
    local_expected_reversal: "false",
    local_platform_funded_refund: String(value.refundAmountCents),
    local_requires_manual_reconciliation: "true",
    local_requires_manual_follow_up: "false",
  });
  assert.equal(assertManualReconciliationDeliverySnapshot(manualSnapshot, value).transferId, null);
  const source = readFileSync(new URL("../scripts/order-payment-event-blocked-checkout-production-proof.mjs", import.meta.url), "utf8");
  assert.match(source, /cleanupDeliveredRows\(owner, state, "SOLD_OUT"\)/);
  assert.throws(() => assertManualReconciliationDeliverySnapshot({
    ...manualSnapshot,
    local_requires_manual_reconciliation: "false",
  }, value), /database evidence drifted/);
  for (const drift of [
    { review_note: "Seller entered vacation mode before payment completion. Order was held for staff review." },
    { signed_reason: "local_refund_confirmed" },
    { signed_latest_refund: value.refundId },
    { listing_status: "ACTIVE" },
  ]) {
    assert.throws(() => assertManualReconciliationDeliverySnapshot({
      ...manualSnapshot,
      ...drift,
    }, value), /database evidence drifted/);
  }

  const transfer = { id: value.transferId, amount: SELLER_TRANSFER_CENTS, amount_reversed: 0,
    currency: "usd", destination: value.stripeAccountId, livemode: false, reversed: false };
  const charge = { id: value.chargeId, amount: value.chargeAmountCents, currency: "usd", paid: true,
    livemode: false, transfer };
  const session = { id: value.stripeSessionId, livemode: false, status: "complete", payment_status: "paid",
    currency: "usd", amount_total: value.chargeAmountCents,
    metadata: { buyerId: value.buyerId, sellerId: value.sellerProfileId,
      listingId: value.listingId, checkoutLockKey: value.checkoutLockKey },
    payment_intent: { id: value.paymentIntentId, latest_charge: charge } };
  const refund = { id: value.refundId, object: "refund", amount: value.refundAmountCents, currency: "usd",
    status: "succeeded", payment_intent: value.paymentIntentId, charge: value.chargeId,
    transfer_reversal: null, source_transfer_reversal: null };
  assert.equal(assertManualReconciliationProvider({ refund, reversals: [], session, transfer }, value).reversalId, null);

  const reversalId = "trr_manualreconciliation";
  const reversal = { id: reversalId, object: "transfer_reversal", amount: SELLER_TRANSFER_CENTS,
    transfer: value.transferId,
    metadata: { grainline_proof: "blocked_checkout", reconciliation_reason: "transfer_visibility_race",
      attempt_sha256: "bd7662a5eeb41614e720d477abfcb2272e19a8a70a93b7e3bc8560d44ad326e9" } };
  const reversedTransfer = { ...transfer, amount_reversed: SELLER_TRANSFER_CENTS, reversed: true };
  assert.equal(assertManualReconciliationProvider({
    refund, reversals: [reversal], session: { ...session, payment_intent: { id: value.paymentIntentId,
      latest_charge: { ...charge, transfer: reversedTransfer } } }, transfer: reversedTransfer,
  }, value, reversalId).reversalId, reversalId);
  assert.throws(() => assertManualReconciliationProvider({
    refund, reversals: [reversal, { ...reversal, id: "trr_other" }],
    session: { ...session, payment_intent: { id: value.paymentIntentId,
      latest_charge: { ...charge, transfer: reversedTransfer } } }, transfer: reversedTransfer,
  }, value, reversalId), /cardinality drifted/);

  const reconciliation = assertReconciliationState({
    version: 1,
    phase: "order-payment-event-blocked-checkout-transfer-reconciliation",
    stage: "reversal-confirmed",
    expectedCommit: COMMIT,
    operatorCommit: COMMIT,
    operatorCiRunId: CI,
    attemptId: value.attemptId,
    manualTransferReversalId: reversalId,
  }, config, value);
  assert.throws(() => assertReconciliationState({ ...reconciliation, stage: "cleanup-started",
    manualTransferReversalId: null }, config, value), /identity is missing/);
  assert.throws(() => assertReconciliationState({ ...reconciliation, extra: true }, config, value), /unknown field/);
  const rebindConfig = Object.freeze({
    ...config,
    operatorCommit: "c".repeat(40),
    operatorCiRunId: CI + 1,
    reconciliationPreviousOperatorCommit: COMMIT,
    reconciliationPreviousOperatorCiRunId: CI,
  });
  const previousPending = assertReconciliationState({
    ...reconciliation,
    stage: "reversal-pending",
    manualTransferReversalId: null,
  }, rebindConfig, value);
  assert.equal(reconciliationUsesPreviousOperatorBinding(previousPending, rebindConfig), true);
  assert.equal(requiredExistingReversalForOperatorRebind(previousPending, rebindConfig, [reversal]), reversalId);
  assert.throws(
    () => requiredExistingReversalForOperatorRebind(previousPending, rebindConfig, []),
    /requires one existing reversal/,
  );
  assert.throws(
    () => requiredExistingReversalForOperatorRebind(previousPending, rebindConfig, [reversal, { ...reversal, id: "trr_other" }]),
    /requires one existing reversal/,
  );
  assert.throws(
    () => assertReconciliationState(reconciliation, rebindConfig, value),
    /previous operator restart boundary drifted/,
  );
  assert.throws(
    () => assertReconciliationState({ ...previousPending, operatorCommit: PREVIOUS_OPERATOR }, rebindConfig, value),
    /state binding drifted/,
  );
  const currentPending = assertReconciliationState({
    ...previousPending,
    operatorCommit: rebindConfig.operatorCommit,
    operatorCiRunId: rebindConfig.operatorCiRunId,
  }, rebindConfig, value);
  assert.equal(reconciliationUsesPreviousOperatorBinding(currentPending, rebindConfig), false);
  assert.equal(requiredExistingReversalForOperatorRebind(currentPending, rebindConfig, []), null);
  assert.equal(assertReconciliationProofState(value).orderId, value.orderId);
  assert.throws(() => assertReconciliationProofState({ ...value, notificationId: null }), /notificationId is missing/);

  const cleanup = { accountDeleted: true, applicationRowsRemoved: true, canaryCount: 1,
    clerkSessionsRevoked: true, processedWebhookCount: 2, redisKeysRemoved: true };
  const evidence = buildReconciliationEvidence(config, value, reconciliation, cleanup);
  assert.equal(assertReconciliationEvidence(evidence, config).automaticProductionProofPassed, false);
  assert.equal(evidence.freshAutomaticProofRequired, true);
  assert.throws(() => assertReconciliationEvidence({ ...evidence, automaticProductionProofPassed: true }, config),
    /reconciliation evidence drifted/);
});

test("refund events bind exact modern Stripe charge and refund identities without embedded charge refunds", () => {
  const value = state("payment-completed", { transferReversalId: null });
  const chargeEvent = {
    id: "evt_charge_refunded",
    type: "charge.refunded",
    livemode: false,
    data: { object: {
      id: value.chargeId,
      refunded: true,
      amount: value.chargeAmountCents,
      amount_refunded: value.refundAmountCents,
      currency: "usd",
      payment_intent: value.paymentIntentId,
      transfer: value.transferId,
    } },
  };
  const creationEvent = {
    id: "evt_refund_created",
    type: "refund.created",
    livemode: false,
    data: { object: {
      id: value.refundId,
      amount: value.refundAmountCents,
      currency: "usd",
      status: "succeeded",
      payment_intent: value.paymentIntentId,
      charge: value.chargeId,
      transfer_reversal: null,
      source_transfer_reversal: null,
    } },
  };

  assert.equal(exactRefundEvent([chargeEvent], value)?.id, chargeEvent.id);
  assert.equal(exactRefundCreationEvent([creationEvent], value)?.id, creationEvent.id);
  assert.equal(exactRefundEvent([{ ...chargeEvent, data: { object: {
    ...chargeEvent.data.object, amount_refunded: value.refundAmountCents - 1,
  } } }], value), null);
  assert.equal(exactRefundCreationEvent([{ ...creationEvent, data: { object: {
    ...creationEvent.data.object, id: "re_wrong",
  } } }], value), null);
  assert.equal(exactRefundEvent([chargeEvent, { ...chargeEvent, id: "evt_duplicate" }], value), null);
  assert.equal(exactRefundCreationEvent([creationEvent, { ...creationEvent, id: "evt_duplicate" }], value), null);
});

test("static operator contract stays test-only, loopback-only, non-activating, and restart-safe", () => {
  const source = readFileSync(new URL("../scripts/order-payment-event-blocked-checkout-production-proof.mjs", import.meta.url), "utf8");
  assert.match(source, /ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND/);
  assert.match(source, /new Set\(\["prepare", "onboard", "renew", "serve", "verify", "reconcile", "cleanup"\]\)/);
  assert.match(source, /controller: CONNECTED_ACCOUNT_CONTROLLER/);
  assert.match(source, /ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND=onboard/);
  assert.match(source, /account-express-stripe-collector-v1/);
  assert.match(source, /createOnboardingLink\(state\.stripeAccountId\)/);
  assert.match(source, /convergeFixtureSellerConnectIdentity\(owner, state\)/);
  assert.match(source, /reopenFixtureSellerForPaymentRenewal\(owner, state, beforeHistory\)/);
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(source, /assertLockedRenewalRows\(await readCheckoutAttemptRows\(owner, state, true\), history, state\)/);
  assert.match(source, /payment renewal failed and the synthetic seller could not be reblocked/);
  assert.match(source, /assertPreparedSnapshot\([\s\S]*replacementSnapshot\.vacation_mode/);
  assert.match(source, /"stripeAccountVersion" IS NULL AND "stripeControllerType"=\$4/);
  assert.doesNotMatch(source, /VALUES \([^\n]*true,'v1','custom'/);
  assert.match(source, /spawnSync\([\s\S]*"\/usr\/bin\/open"[\s\S]*stdio: "ignore"/);
  assert.doesNotMatch(source, /type: "custom"/);
  assert.doesNotMatch(source, /tos_acceptance/);
  assert.match(source, /server\.listen\(config\.port, "127\.0\.0\.1"/);
  assert.match(
    source,
    /servePaymentPage[\s\S]*assertGitState\(readGitState\(config\.cwd\), config\.operatorCommit \?\? config\.expectedCommit\)[\s\S]*verifyGitHubCi\(config\)/,
  );
  assert.match(source, /checkout\.session\.completed/);
  assert.match(source, /charge\.refunded/);
  assert.match(source, /pg_catalog\.to_char\([\s\S]*YYYY-MM-DD"T"HH24:MI:SS\.US/);
  assert.match(source, /BLOCKED_CHECKOUT_REFUND_RECORDED/);
  assert.match(source, /REFUND_ISSUED/);
  assert.match(source, /wrong_notification_count/);
  assert.match(source, /cleanupDeliveredRows/);
  assert.match(source, /assertAbortCleanupStage\(state\)/);
  assert.match(source, /manual-transfer-reconciliation-v1/);
  assert.match(source, /automaticProductionProofPassed: false/);
  assert.match(source, /freshAutomaticProofRequired: true/);
  assert.doesNotMatch(source, /else if \(state\.stage === "account-created"\)[\s\S]{0,300}DELETE FROM public\."SellerProfile"/);
  assert.doesNotMatch(source, /sk_live_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(source, /webhookEndpoints\.(?:create|update|del)/);
  assert.doesNotMatch(source, /\.refunds\?\.data|\.refunds\.data/);
  assert.doesNotMatch(source, /payment_intent\.latest_charge\.refunds\.data\.transfer_reversal/);
  assert.doesNotMatch(source, /vercel\s+(?:deploy|env|promote|remove)/i);
  assert.doesNotMatch(source, /ALTER TABLE[\s\S]*ROW LEVEL SECURITY/i);
  assert.doesNotMatch(source, /prisma migrate|migrate deploy/i);
});
