import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CONFIRMATION,
  REFUND_AMOUNT_CENTS,
  TRANSFER_AMOUNT_CENTS,
  acquireAdminPinInput,
  assertConnectedAccount,
  assertEvidence,
  assertPayment,
  assertProofSnapshot,
  assertRefundProviderEvidence,
  assertReplayUnchanged,
  assertState,
  buildConnectedAccountParams,
  buildEvidence,
  buildStripeProofMetadata,
  classifyFixtureSnapshot,
  createInitialState,
  extractAdminPinCookie,
  findSingleRefundEvent,
  readGitState,
  validateConfiguration,
} from "../scripts/order-payment-event-case-refund-production-proof.mjs";

const commit = (character) => character.repeat(40);
const evidenceDigest = "e".repeat(64);
const environment = {
  ORDER_PAYMENT_CASE_REFUND_COMMAND: "run",
  ORDER_PAYMENT_CASE_REFUND_EXPECTED_COMMIT: commit("a"),
  ORDER_PAYMENT_CASE_REFUND_DEPLOYED_SOURCE_COMMIT: commit("b"),
  ORDER_PAYMENT_CASE_REFUND_DEPLOYMENT_ID: "dpl_CaseRefundProof123",
  ORDER_PAYMENT_CASE_REFUND_MAIN_CI_RUN_ID: "33270000000",
  ORDER_PAYMENT_CASE_REFUND_STRIPE_CLI_PATH: "/usr/local/bin/stripe",
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_ATTEMPT_COMMIT: commit("c"),
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_OPERATOR_COMMIT: commit("d"),
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_SIGNED_COMMIT: commit("f"),
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_ATTEMPT_CI_RUN_ID: "33231868504",
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_OPERATOR_CI_RUN_ID: "33265745679",
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_SIGNED_CI_RUN_ID: "33228466974",
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_EVIDENCE_PATH: "/private/evidence.json",
  ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_EVIDENCE_SHA256: evidenceDigest,
  ORDER_PAYMENT_CASE_REFUND_CONFIRM: CONFIRMATION,
};

function configuration() {
  return validateConfiguration(environment, "/private/tmp/grainline-proof");
}

function baseState() {
  return createInitialState(configuration(), {
    userId: "canary-user",
    clerkId: "user_canary123",
  });
}

function providerState() {
  return assertState({
    ...baseState(),
    stage: "refund-returned",
    stripeAccountId: "acct_case123",
    paymentIntentId: "pi_case123",
    chargeId: "ch_case123",
    transferId: "tr_case123",
    refundId: "re_case123",
    transferReversalId: "trr_case123",
  }, configuration());
}

function provenState() {
  return assertState({
    ...providerState(),
    stage: "signed-confirmed",
    signedEventId: "evt_case123",
    localPaymentEventId: "ope_case_local",
    signedPaymentEventId: "ope_case_signed",
    claimId: "case_resolution_claim_123",
    resolutionMessageId: "case_resolution_message_case_resolution_claim_123",
    buyerNotificationId: "notification_buyer_123",
    sellerNotificationId: "notification_seller_123",
    emailOutboxId: "email_outbox_123",
  }, configuration());
}

function proofSnapshot() {
  const state = provenState();
  return {
    paymentCount: 2,
    localPaymentEventId: state.localPaymentEventId,
    signedPaymentEventId: state.signedPaymentEventId,
    signedReason: "local_refund_confirmed",
    localClaimId: state.claimId,
    localTransferReversalId: state.transferReversalId,
    localTransferReversalAmount: String(TRANSFER_AMOUNT_CENTS),
    signedLatestRefundId: state.refundId,
    signedTotalRefunded: String(REFUND_AMOUNT_CENTS),
    refundObjectCount: 2,
    webhookCount: 1,
    webhookGeneration: "1",
    orderRefundId: state.refundId,
    orderRefundAmount: REFUND_AMOUNT_CENTS,
    orderLeaseCleared: true,
    reviewNeeded: true,
    stock: 1,
    listingStatus: "ACTIVE",
    caseStatus: "RESOLVED",
    caseResolution: "REFUND_FULL",
    caseRefundAmount: REFUND_AMOUNT_CENTS,
    caseRefundId: state.refundId,
    caseResolvedBy: state.staffUserId,
    claimId: state.claimId,
    claimStatus: "FINALIZED",
    claimPaymentEventId: state.localPaymentEventId,
    resolutionMessageId: state.resolutionMessageId,
    buyerNotificationCount: 1,
    buyerNotificationId: state.buyerNotificationId,
    sellerNotificationCount: 1,
    sellerNotificationId: state.sellerNotificationId,
    outboxCount: 1,
    emailOutboxId: state.emailOutboxId,
    adminAuditCount: 1,
    localAuditCount: 1,
    signedAuditCount: 1,
  };
}

describe("OrderPaymentEvent staff Case refund production operator", () => {
  it("reports the real repository head using the shared verifier contract", () => {
    const state = readGitState(process.cwd());
    assert.match(state.head, /^[a-f0-9]{40}$/);
    assert.equal(typeof state.branch, "string");
    assert.equal(typeof state.status, "string");
    assert.equal(Object.hasOwn(state, "commit"), false);
  });

  it("pins every execution, deployment, predecessor, evidence and confirmation input", () => {
    const config = configuration();
    assert.equal(config.expectedCommit, environment.ORDER_PAYMENT_CASE_REFUND_EXPECTED_COMMIT);
    assert.equal(config.sellerProofEvidenceSha256, evidenceDigest);
    assert.equal(config.command, "run");
    assert.throws(
      () => validateConfiguration({ ...environment, ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_EVIDENCE_SHA256: "short" }),
      /evidence digest is invalid/,
    );
    assert.throws(
      () => validateConfiguration({ ...environment, ORDER_PAYMENT_CASE_REFUND_CONFIRM: "yes" }),
      /confirmation is invalid/,
    );
  });

  it("binds restart state and only permits forward, complete stages", () => {
    const config = configuration();
    const state = baseState();
    assert.equal(assertState(state, config).stage, "reserved");
    assert.throws(() => assertState({ ...state, deploymentId: "dpl_wrong" }, config), /restart state drifted/);
    assert.throws(() => assertState({ ...state, stage: "signed-confirmed" }, config), /incomplete for account-created/);
    assert.equal(providerState().transferReversalId, "trr_case123");
    assert.equal(provenState().claimId, "case_resolution_claim_123");
    assert.equal(assertState({ ...provenState(), stage: "signed-replay-pending" }, config).stage, "signed-replay-pending");
  });

  it("derives one marker-bound test-mode Express account and exact destination payment", () => {
    const config = configuration();
    const state = baseState();
    const metadata = buildStripeProofMetadata(config, state);
    const params = buildConnectedAccountParams(config, state);
    assert.deepEqual(params.metadata, metadata);
    assert.equal(params.controller.losses.payments, "application");
    assert.equal(params.controller.stripe_dashboard.type, "express");
    const account = {
      id: "acct_case123",
      livemode: false,
      deleted: false,
      metadata,
      country: "US",
      default_currency: "usd",
      controller: params.controller,
      capabilities: { transfers: "active" },
    };
    assert.equal(assertConnectedAccount(account, config, state), account);
    const payment = { id: "pi_case123", livemode: false, status: "succeeded", amount: 500, currency: "usd", latest_charge: "ch_case123" };
    const charge = { id: "ch_case123", livemode: false, paid: true, amount: 500, currency: "usd",
      transfer: { id: "tr_case123", amount: 475, destination: "acct_case123" } };
    assert.deepEqual(assertPayment(payment, charge, "acct_case123"), {
      paymentIntentId: "pi_case123", chargeId: "ch_case123", transferId: "tr_case123",
    });
  });

  it("proves the exact refund, reversal and signed event identity", () => {
    const state = providerState();
    const refund = {
      object: "refund",
      id: state.refundId,
      amount: 500,
      currency: "usd",
      status: "succeeded",
      payment_intent: state.paymentIntentId,
      charge: state.chargeId,
      transfer_reversal: { id: state.transferReversalId, amount: 475, transfer: state.transferId },
    };
    assert.equal(assertRefundProviderEvidence(refund, state).transferReversalId, state.transferReversalId);
    const event = { id: "evt_case123", type: "charge.refunded", livemode: false, data: { object: {
      id: state.chargeId, refunded: true, amount: 500, amount_refunded: 500, currency: "usd",
      payment_intent: state.paymentIntentId, transfer: state.transferId,
    } } };
    assert.equal(findSingleRefundEvent([event], state), event);
    assert.equal(findSingleRefundEvent([event, event], state), null);
  });

  it("fails closed on partial fixtures and accepts only exact absent or complete states", () => {
    const complete = {
      seller_user: 1, buyer_user: 1, seller_profile: 1, listing: 1, order_row: 1,
      order_item: 1, case_row: 1, opening_message: 1, staff: 1,
    };
    assert.equal(classifyFixtureSnapshot(complete), "complete");
    assert.equal(classifyFixtureSnapshot({ ...Object.fromEntries(Object.keys(complete).map((key) => [key, 0])), staff: 1 }), "absent");
    assert.throws(() => classifyFixtureSnapshot({ ...complete, listing: 0 }), /creation was partial/);
  });

  it("pins every database effect and keeps exact route and signed replays stable", () => {
    const state = provenState();
    const first = assertProofSnapshot(proofSnapshot(), state);
    assert.equal(first.stock, 1);
    assert.equal(assertReplayUnchanged(proofSnapshot(), proofSnapshot(), state).claimId, state.claimId);
    assert.throws(
      () => assertProofSnapshot({ ...proofSnapshot(), buyerNotificationCount: 2 }, state),
      /production effects drifted/,
    );
  });

  it("accepts only the exact Admin-PIN cookie and keeps raw PIN input local", async () => {
    assert.equal(
      extractAdminPinCookie({ getSetCookie: () => ["admin-pin-verified=signed; Path=/; HttpOnly"] }),
      "admin-pin-verified=signed",
    );
    assert.throws(() => extractAdminPinCookie({ getSetCookie: () => [] }), /cookie response drifted/);
    assert.equal(await acquireAdminPinInput({ pin: "123456" }), "123456");
    assert.rejects(() => acquireAdminPinInput({ pin: "" }), /PIN input drifted/);
  });

  it("builds sanitized evidence with bounded retained audit telemetry", () => {
    const config = configuration();
    const state = provenState();
    const cleanup = {
      accountDeleted: true,
      applicationRowsRemoved: true,
      clerkSessionsRevoked: true,
      roleRestored: true,
      processedWebhookCount: 1,
      pinAuditCount: 2,
      canaryCount: 1,
    };
    const evidence = assertEvidence(buildEvidence(config, state, cleanup), config);
    assert.equal(evidence.database.retainedAdminPinAuditRows, 2);
    assert.equal(evidence.database.operationalCanaryRoleRestored, true);
    assert.equal(evidence.rateLimitTelemetry, "bounded TTL entries retained");
    assert.equal(JSON.stringify(evidence).includes("admin-pin-verified"), false);
    assert.throws(
      () => assertEvidence(buildEvidence(config, state, { ...cleanup, roleRestored: false }), config),
      /sanitized evidence drifted/,
    );
  });

  it("minimizes temporary staff authority and preserves fail-closed cleanup boundaries", () => {
    const source = readFileSync("scripts/order-payment-event-case-refund-production-proof.mjs", "utf8");
    const pin = source.indexOf("let pin = await acquireAdminPinInput");
    const promote = source.indexOf("await ensureTemporaryStaffRole(owner, state);", pin);
    const verify = source.indexOf("await verifyAdminPin(session.jwt, pin)", promote);
    const restore = source.indexOf("await restoreCanaryRole(owner, state);", verify);
    assert.ok(pin >= 0 && pin < promote && promote < verify && verify < restore);
    assert.match(source, /const callAsTemporaryStaff = async[\s\S]*finally \{[\s\S]*restoreCanaryRole/);
    assert.match(source, /commandName[\s\S]*"restore-canary"/);
    assert.match(source, /deleteExact\(owner,[\s\S]*RETURNING id/);
    assert.doesNotMatch(source, /new Redis|deleteRateLimitKeys|rateLimitKeysRemoved/);
  });
});
