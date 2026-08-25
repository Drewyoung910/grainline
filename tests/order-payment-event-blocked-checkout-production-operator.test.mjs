import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONFIRMATION,
  PRICE_CENTS,
  SELLER_TRANSFER_CENTS,
  assertCheckoutResponse,
  assertAbortCleanupStage,
  assertCompletedSession,
  assertConnectedAccount,
  assertDeliverySnapshot,
  assertEvidence,
  assertPreparedSnapshot,
  assertRefund,
  assertReplayUnchanged,
  assertState,
  buildConnectedAccountParams,
  buildEvidence,
  buildPaymentPage,
  createInitialState,
  redact,
  validateConfiguration,
  validateProviderCredentials,
} from "../scripts/order-payment-event-blocked-checkout-production-proof.mjs";

const COMMIT = "a".repeat(40);
const SOURCE = "b".repeat(40);
const CI = 32820000001;
const DEPLOYMENT = "dpl_BlockedCheckoutProof";
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
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_BLOCKED_CHECKOUT_CONFIRM: "wrong" })), /confirmation is invalid/);
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND: "run" })), /command is invalid/);
  const initial = createInitialState(config, {
    id: "opebc_buyer_canary", clerkId: "user_canary", email: "canary@example.com",
    notificationPreferences: {}, termsAcceptedAt: "2026-08-25T12:34:56.123456",
    termsVersion: "2026-06-14", ageAttestedAt: "2026-08-25T12:35:01.654321",
  });
  assert.equal(initial.stage, "reserved");
  assert.equal(initial.originalTermsAcceptedAt, "2026-08-25T12:34:56.123456");
  assert.equal(initial.originalAgeAttestedAt, "2026-08-25T12:35:01.654321");
  assert.equal(assertState(state(), config).stage, "delivery-confirmed");
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
  const account = { id: "acct_proof", deleted: false, livemode: false, country: "US", default_currency: "usd",
    type: "custom", capabilities: { transfers: "active" }, metadata: params.metadata };
  assert.equal(assertConnectedAccount(account, config, pending).id, "acct_proof");
  assert.throws(() => assertConnectedAccount({ ...account, capabilities: { transfers: "pending" } }, config, pending), /account drifted/);
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
  const page = buildPaymentPage("pk_test_public", "cs_test_session_secret_private");
  assert.match(page, /https:\/\/js\.stripe\.com\/v3\//);
  assert.match(page, /initEmbeddedCheckout/);
  assert.match(page, /4242 4242 4242 4242/);
  assert.throws(() => buildPaymentPage("pk_live_forbidden", "cs_test_session_secret_private"), /test publishable key/);
  assert.deepEqual(assertCheckoutResponse({ status: 200, body: {
    sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_private",
  } }), { sessionId: "cs_test_session", clientSecret: "cs_test_session_secret_private" });
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
  const refund = { id: value.refundId, livemode: false, amount: 540, currency: "usd", status: "succeeded",
    payment_intent: value.paymentIntentId, charge: value.chargeId,
    transfer_reversal: { id: value.transferReversalId, amount: SELLER_TRANSFER_CENTS, transfer: value.transferId } };
  assert.equal(assertRefund(refund, value).transferReversalId, value.transferReversalId);
});

test("delivery, exact replay, evidence, and redaction reject drift", () => {
  const value = state();
  const delivered = assertDeliverySnapshot(snapshot(), value);
  assert.equal(delivered.wrongNotificationCount, 0);
  assert.deepEqual(assertReplayUnchanged(delivered, snapshot(), value), delivered);
  assert.throws(() => assertDeliverySnapshot(snapshot({ wrong_notification_count: 1 }), value), /delivery effects drifted/);
  assert.throws(() => assertReplayUnchanged(delivered, snapshot({ checkout_generation: "2" }), value), /delivery effects drifted/);
  const cleanup = { accountDeleted: true, applicationRowsRemoved: true, canaryCount: 1,
    clerkSessionsRevoked: true, processedWebhookCount: 2, redisKeysRemoved: true };
  const evidence = buildEvidence(config, value, cleanup);
  assert.equal(assertEvidence(evidence, config).stripe.genuineSignedEventsDelivered, 2);
  assert.equal(redact("sk_test_secret cs_test_x_secret_y acct_123 postgres://u:p@db Bearer token"),
    "[redacted-stripe-secret] [redacted-stripe-secret] [redacted-stripe-object] [redacted-database-url] Bearer [redacted-token]");
});

test("static operator contract stays test-only, loopback-only, non-activating, and restart-safe", () => {
  const source = readFileSync(new URL("../scripts/order-payment-event-blocked-checkout-production-proof.mjs", import.meta.url), "utf8");
  assert.match(source, /ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND/);
  assert.match(source, /new Set\(\["prepare", "serve", "verify", "cleanup"\]\)/);
  assert.match(source, /server\.listen\(config\.port, "127\.0\.0\.1"/);
  assert.match(
    source,
    /servePaymentPage[\s\S]*assertGitState\(readGitState\(config\.cwd\), config\.expectedCommit\)[\s\S]*verifyGitHubCi\(config\)/,
  );
  assert.match(source, /checkout\.session\.completed/);
  assert.match(source, /charge\.refunded/);
  assert.match(source, /pg_catalog\.to_char\([\s\S]*YYYY-MM-DD"T"HH24:MI:SS\.US/);
  assert.match(source, /BLOCKED_CHECKOUT_REFUND_RECORDED/);
  assert.match(source, /REFUND_ISSUED/);
  assert.match(source, /wrong_notification_count/);
  assert.match(source, /cleanupDeliveredRows/);
  assert.match(source, /assertAbortCleanupStage\(state\)/);
  assert.doesNotMatch(source, /else if \(state\.stage === "account-created"\)[\s\S]{0,300}DELETE FROM public\."SellerProfile"/);
  assert.doesNotMatch(source, /sk_live_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(source, /webhookEndpoints\.(?:create|update|del)/);
  assert.doesNotMatch(source, /vercel\s+(?:deploy|env|promote|remove)/i);
  assert.doesNotMatch(source, /ALTER TABLE[\s\S]*ROW LEVEL SECURITY/i);
  assert.doesNotMatch(source, /prisma migrate|migrate deploy/i);
});
