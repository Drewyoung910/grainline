import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONNECTED_ACCOUNT_CONTROLLER,
  CONFIRMATION,
  REFUND_AMOUNT_CENTS,
  STRIPE_METADATA_KEY_MAX_LENGTH,
  STRIPE_PROOF_METADATA_KEY,
  TRANSFER_AMOUNT_CENTS,
  assertConnectedAccount,
  assertDeletedConnectedAccountAbsence,
  assertEvidence,
  assertExecutionBindings,
  assertOnboardingLink,
  assertOnboardingRecord,
  assertPayment,
  assertProofSnapshot,
  assertRefundProviderEvidence,
  assertReplayUnchanged,
  assertSignedPredecessorEvidence,
  assertState,
  buildConnectedAccountLinkParams,
  buildConnectedAccountParams,
  buildEvidence,
  buildStripeProofMetadata,
  createAndRecoverDestinationPayment,
  createInitialState,
  deleteDisposableAccount,
  findSingleRefundEvent,
  listAccountsBounded,
  openHostedOnboarding,
  readOnboardingRecord,
  redact,
  removeOnboardingRecord,
  validateConfiguration,
  writeOnboardingRecord,
} from "../scripts/order-payment-event-seller-refund-production-proof.mjs";

const COMMIT = "a".repeat(40);
const SOURCE = "b".repeat(40);
const SIGNED = "c".repeat(40);
const OPERATOR = "d".repeat(40);
const CI = 32810000001;
const SIGNED_CI = 32810000002;
const OPERATOR_CI = 32810000003;
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

function successfulCi(commit, runId) {
  return {
    databaseId: runId,
    headSha: commit,
    conclusion: "success",
    status: "completed",
    workflowName: "CI",
    headBranch: "main",
    event: "push",
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
  assert.equal(parsed.operatorCommit, COMMIT);
  assert.equal(parsed.operatorCiRunId, CI);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.signedProofCommit, SIGNED);
  assert.equal(parsed.signedProofCiRunId, SIGNED_CI);
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_SELLER_REFUND_CONFIRM: "wrong" })), /confirmation is invalid/);
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_SELLER_REFUND_SIGNED_PROOF_COMMIT: "bad" })), /commit input is invalid/);
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_SELLER_REFUND_OPERATOR_COMMIT: OPERATOR })), /must be supplied together/);
  assert.equal(validateConfiguration(environment({ ORDER_PAYMENT_SELLER_REFUND_COMMAND: "onboard" })).command, "onboard");
  assert.throws(() => validateConfiguration(environment({ ORDER_PAYMENT_SELLER_REFUND_COMMAND: "abort" })), /command is invalid/);
  const restarted = validateConfiguration(environment({
    ORDER_PAYMENT_SELLER_REFUND_OPERATOR_COMMIT: OPERATOR,
    ORDER_PAYMENT_SELLER_REFUND_OPERATOR_CI_RUN_ID: String(OPERATOR_CI),
  }), "/repo");
  assert.equal(restarted.expectedCommit, COMMIT);
  assert.equal(restarted.operatorCommit, OPERATOR);
  assert.equal(restarted.operatorCiRunId, OPERATOR_CI);
  assert.deepEqual(assertExecutionBindings(
    { branch: "main", head: OPERATOR, status: "" },
    successfulCi(COMMIT, CI),
    successfulCi(OPERATOR, OPERATOR_CI),
    restarted,
  ), {
    attemptCommit: COMMIT,
    attemptCiRunId: CI,
    operatorCommit: OPERATOR,
    operatorCiRunId: OPERATOR_CI,
  });
  assert.throws(() => assertExecutionBindings(
    { branch: "main", head: COMMIT, status: "" },
    successfulCi(COMMIT, CI),
    successfulCi(OPERATOR, OPERATOR_CI),
    restarted,
  ), /requires exact clean reviewed main/);
  assert.throws(() => assertExecutionBindings(
    { branch: "main", head: OPERATOR, status: "" },
    successfulCi(COMMIT, CI),
    successfulCi(COMMIT, OPERATOR_CI),
    restarted,
  ), /exact-main CI binding did not pass/);
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
  assert.deepEqual(params.controller, CONNECTED_ACCOUNT_CONTROLLER);
  assert.equal(params.type, undefined);
  assert.equal(params.business_type, undefined);
  assert.equal(params.individual, undefined);
  assert.equal(params.tos_acceptance, undefined);
  assert.equal(STRIPE_PROOF_METADATA_KEY.length <= STRIPE_METADATA_KEY_MAX_LENGTH, true);
  assert.deepEqual(params.metadata, buildStripeProofMetadata(config, state));
  assert.equal(params.metadata.grainline_order_payment_seller_refund_proof, undefined);
  const account = { id: "acct_proof", deleted: false, livemode: false, country: "US", default_currency: "usd",
    controller: CONNECTED_ACCOUNT_CONTROLLER,
    capabilities: { transfers: "active" }, metadata: params.metadata };
  assert.equal(assertConnectedAccount(account, config, state).id, "acct_proof");
  const pending = { ...account, capabilities: { transfers: "pending" } };
  assert.equal(assertConnectedAccount(pending, config, state, { requireTransferActive: false }).id, "acct_proof");
  assert.throws(() => assertConnectedAccount(pending, config, state), /connected account drifted/);
  assert.throws(() => assertConnectedAccount({ ...account, livemode: true }, config, state), /connected account drifted/);
  assert.throws(() => assertConnectedAccount({ ...account, controller: {
    ...CONNECTED_ACCOUNT_CONTROLLER,
    requirement_collection: "application",
  } }, config, state), /connected account drifted/);
});

test("hosted onboarding is source-bound, private, expiring and never caller-routed", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grainline-seller-refund-onboarding-"));
  try {
    const state = fullState("account-created", {
      paymentIntentId: null,
      chargeId: null,
      transferId: null,
      refundId: null,
      transferReversalId: null,
      signedEventId: null,
      localPaymentEventId: null,
      signedPaymentEventId: null,
      caseApplicationId: null,
      notificationId: null,
      emailOutboxId: null,
    });
    const scopedConfig = {
      ...config,
      onboardingPath: path.join(directory, "onboarding.json"),
    };
    assert.deepEqual(buildConnectedAccountLinkParams(state.stripeAccountId), {
      account: state.stripeAccountId,
      collection_options: { fields: "eventually_due" },
      refresh_url: "https://thegrainline.com/?seller_refund_canary=refresh",
      return_url: "https://thegrainline.com/?seller_refund_canary=return",
      type: "account_onboarding",
    });
    assert.throws(() => buildConnectedAccountLinkParams("acct_invalid/path"), /exact account ID/);
    const link = {
      object: "account_link",
      url: "https://connect.stripe.com/setup/s/test-proof-token",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    };
    assert.equal(assertOnboardingLink(link).url, link.url);
    assert.throws(
      () => assertOnboardingLink({ ...link, url: "https://example.com/setup/s/test" }),
      /outside the reviewed boundary/,
    );
    assert.throws(
      () => assertOnboardingLink({ ...link, expires_at: 1 }),
      /outside the reviewed boundary/,
    );
    const written = writeOnboardingRecord(scopedConfig, state, link);
    assert.equal(assertOnboardingRecord(written, scopedConfig, state).status, "onboarding-required");
    assert.equal(readOnboardingRecord(scopedConfig, state).stripeAccountId, state.stripeAccountId);
    assert.equal(statSync(scopedConfig.onboardingPath).mode & 0o077, 0);
    assert.throws(
      () => assertOnboardingRecord({
        ...written,
        attemptId: "22222222-2222-4222-8222-222222222222",
      }, scopedConfig, state),
      /does not bind the preserved attempt/,
    );
    removeOnboardingRecord(scopedConfig, state);
    assert.equal(readOnboardingRecord(scopedConfig, state, { required: false }), null);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("hosted onboarding opener verifies the preserved attempt and never returns its URL", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grainline-seller-refund-open-"));
  try {
    const state = fullState("account-created", {
      paymentIntentId: null,
      chargeId: null,
      transferId: null,
      refundId: null,
      transferReversalId: null,
      signedEventId: null,
      localPaymentEventId: null,
      signedPaymentEventId: null,
      caseApplicationId: null,
      notificationId: null,
      emailOutboxId: null,
    });
    const scopedConfig = {
      ...config,
      statePath: path.join(directory, "state.json"),
      onboardingPath: path.join(directory, "onboarding.json"),
      signedEvidencePath: path.join(directory, "signed.json"),
    };
    const signed = {
      phase: "order-payment-event-signed-production-proof",
      status: "passed",
      mode: "test",
      commit: SIGNED,
      ciRunId: SIGNED_CI,
      deployedSourceCommit: SOURCE,
      deploymentId: DEPLOYMENT,
      providerStage: 4,
      stripe: { requiredResendTransitionsCompleted: 3, exactReplayProofs: 2 },
      database: {
        retainedProcessedWebhookLeases: 2,
        temporaryApplicationRowsRemoved: true,
        exactRetriesLeftApplicationIdentitiesUnchanged: true,
      },
      providerConfigurationChanged: false,
      liveMoneyMoved: false,
    };
    writeFileSync(scopedConfig.statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    writeFileSync(scopedConfig.signedEvidencePath, `${JSON.stringify(signed)}\n`, { mode: 0o600 });
    const link = {
      object: "account_link",
      url: "https://connect.stripe.com/setup/s/test-open-token",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    };
    writeOnboardingRecord(scopedConfig, state, link);
    let openedUrl = null;
    const result = openHostedOnboarding(scopedConfig, {
      verifyExecutionBindings() {},
      openUrl(url) {
        openedUrl = url;
        return { status: 0 };
      },
    });
    assert.equal(openedUrl, link.url);
    assert.deepEqual(result, {
      phase: "order-payment-event-seller-refund-production-proof",
      status: "onboarding-opened",
      rawProviderIdsPersistedInOutput: false,
      secretsPersistedInOutput: false,
    });
    assert.doesNotMatch(JSON.stringify(result), /connect\.stripe\.com|test-open-token/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("deleted connected-account restart requires Stripe's exact absence response and a complete account listing", async () => {
  const accountId = "acct_sellerrefundproof";
  const deletedAccess = {
    type: "StripePermissionError",
    code: "account_invalid",
    statusCode: 403,
    rawType: "api_error",
  };
  const listing = (accounts) => ({ accounts, exhausted: true });
  assert.equal(assertDeletedConnectedAccountAbsence(deletedAccess, listing([{ id: "acct_other" }]), accountId), true);
  assert.throws(
    () => assertDeletedConnectedAccountAbsence(deletedAccess, listing([{ id: accountId }]), accountId),
    /absence is not proven/,
  );
  assert.throws(
    () => assertDeletedConnectedAccountAbsence({ ...deletedAccess, code: "permission_denied" }, listing([]), accountId),
    /absence is not proven/,
  );
  assert.throws(
    () => assertDeletedConnectedAccountAbsence(deletedAccess, listing([{ id: "not-an-account" }]), accountId),
    /absence is not proven/,
  );
  assert.throws(
    () => assertDeletedConnectedAccountAbsence(
      deletedAccess,
      listing(Array.from({ length: 1001 }, (_, index) => ({ id: `acct_other_${index}` }))),
      accountId,
    ),
    /absence is not proven/,
  );
  assert.throws(
    () => assertDeletedConnectedAccountAbsence(deletedAccess, { accounts: [], exhausted: false }, accountId),
    /absence is not proven/,
  );
  assert.throws(
    () => assertDeletedConnectedAccountAbsence(deletedAccess, [], accountId),
    /absence is not proven/,
  );

  let deletionAttempted = false;
  const proven = await deleteDisposableAccount({
    async retrieveAccount() { throw deletedAccess; },
    async listAccounts() { return listing([{ id: "acct_other" }]); },
    async retrieveBalance() { throw new Error("balance must not be read after proven deletion"); },
    async deleteAccount() { deletionAttempted = true; },
  }, config, fullState());
  assert.equal(proven, true);
  assert.equal(deletionAttempted, false);

  await assert.rejects(
    deleteDisposableAccount({
      async retrieveAccount() { throw deletedAccess; },
      async listAccounts() { return listing([{ id: accountId }]); },
    }, config, fullState()),
    /absence is not proven/,
  );

  const state = fullState();
  const params = buildConnectedAccountParams(config, state);
  const activeAccount = {
    id: accountId,
    deleted: false,
    livemode: false,
    country: "US",
    default_currency: "usd",
    controller: CONNECTED_ACCOUNT_CONTROLLER,
    capabilities: { transfers: "active" },
    metadata: params.metadata,
  };
  let deletedId = null;
  assert.equal(await deleteDisposableAccount({
    async retrieveAccount() { return activeAccount; },
    async retrieveBalance() { return { available: [{ amount: 0 }], pending: [] }; },
    async deleteAccount(id) { deletedId = id; return { id, deleted: true }; },
  }, config, state), true);
  assert.equal(deletedId, accountId);
  await assert.rejects(
    deleteDisposableAccount({
      async retrieveAccount() { return activeAccount; },
      async retrieveBalance() { return { available: [{ amount: 1 }], pending: [] }; },
    }, config, state),
    /retained a nonzero balance/,
  );
});

test("connected-account listing proves provider exhaustion rather than silently truncating at its bound", async () => {
  const requests = [];
  const pages = [
    { data: [{ id: "acct_first" }], has_more: true },
    { data: [{ id: "acct_second" }], has_more: false },
  ];
  const accounts = await listAccountsBounded(async (params) => {
    requests.push(params);
    return pages.shift();
  }, 2);
  assert.equal(accounts.exhausted, true);
  assert.deepEqual(accounts.accounts.map(({ id }) => id), ["acct_first", "acct_second"]);
  assert.deepEqual(requests, [
    { limit: 100 },
    { limit: 100, starting_after: "acct_first" },
  ]);

  await assert.rejects(
    listAccountsBounded(async () => ({ data: [{ id: "acct_only" }], has_more: true }), 1),
    /did not prove exhaustion/,
  );
  await assert.rejects(
    listAccountsBounded(async () => ({ data: [], has_more: true }), 2),
    /did not prove exhaustion/,
  );
  await assert.rejects(
    listAccountsBounded(async () => ({ data: [{ id: "not-an-account" }], has_more: false }), 2),
    /page drifted/,
  );
});

test("destination payment and provider refund prove exact reversal", () => {
  const state = fullState();
  const payment = { id: state.paymentIntentId, livemode: false, status: "succeeded", amount: 500, currency: "usd", latest_charge: state.chargeId };
  const charge = { id: state.chargeId, livemode: false, paid: true, amount: 500, currency: "usd",
    transfer: { id: state.transferId, amount: TRANSFER_AMOUNT_CENTS, destination: state.stripeAccountId } };
  assert.deepEqual(assertPayment(payment, charge, state.stripeAccountId), {
    paymentIntentId: state.paymentIntentId, chargeId: state.chargeId, transferId: state.transferId,
  });
  const refund = { id: state.refundId, object: "refund", amount: 500, currency: "usd", status: "succeeded",
    payment_intent: state.paymentIntentId, charge: state.chargeId,
    transfer_reversal: { id: state.transferReversalId, amount: TRANSFER_AMOUNT_CENTS, transfer: state.transferId } };
  assert.equal(assertRefundProviderEvidence(refund, state).transferReversalId, state.transferReversalId);
  assert.throws(() => assertRefundProviderEvidence({ ...refund, amount: 499 }, state), /provider evidence drifted/);
});

test("destination payment is re-retrieved after an incomplete create response", async () => {
  const state = fullState();
  const calls = [];
  const identity = await createAndRecoverDestinationPayment({
    async createPayment(accountId) {
      calls.push(["create", accountId]);
      return { id: state.paymentIntentId, status: "succeeded", latest_charge: state.chargeId };
    },
    async retrievePayment(paymentIntentId) {
      calls.push(["retrieve-payment", paymentIntentId]);
      return {
        id: state.paymentIntentId,
        livemode: false,
        status: "succeeded",
        amount: REFUND_AMOUNT_CENTS,
        currency: "usd",
        latest_charge: state.chargeId,
      };
    },
    async retrieveCharge(chargeId) {
      calls.push(["retrieve-charge", chargeId]);
      return {
        id: state.chargeId,
        livemode: false,
        paid: true,
        amount: REFUND_AMOUNT_CENTS,
        currency: "usd",
        transfer: {
          id: state.transferId,
          amount: TRANSFER_AMOUNT_CENTS,
          destination: state.stripeAccountId,
        },
      };
    },
  }, state.stripeAccountId);
  assert.deepEqual(identity, {
    paymentIntentId: state.paymentIntentId,
    chargeId: state.chargeId,
    transferId: state.transferId,
  });
  assert.deepEqual(calls, [
    ["create", state.stripeAccountId],
    ["retrieve-payment", state.paymentIntentId],
    ["retrieve-charge", state.chargeId],
  ]);
});

test("signed refund event uses modern Stripe charge totals rather than the removed embedded refund list", () => {
  const state = fullState();
  const event = {
    id: state.signedEventId,
    type: "charge.refunded",
    livemode: false,
    data: { object: {
      id: state.chargeId,
      refunded: true,
      amount: REFUND_AMOUNT_CENTS,
      amount_refunded: REFUND_AMOUNT_CENTS,
      currency: "usd",
      payment_intent: state.paymentIntentId,
      transfer: state.transferId,
    } },
  };
  assert.equal(findSingleRefundEvent([event], state)?.id, state.signedEventId);
  assert.equal(findSingleRefundEvent([{ ...event, data: { object: {
    ...event.data.object, payment_intent: "pi_wrong",
  } } }], state), null);
  assert.equal(findSingleRefundEvent([event, { ...event, id: "evt_duplicate" }], state), null);
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
  const restartedConfig = { ...config, operatorCommit: OPERATOR, operatorCiRunId: OPERATOR_CI };
  const restartedEvidence = buildEvidence(restartedConfig, state, cleanup);
  assert.equal(assertEvidence(restartedEvidence, restartedConfig).operatorCommit, OPERATOR);
  assert.equal(restartedEvidence.operatorCiRunId, OPERATOR_CI);
  assert.throws(
    () => assertEvidence({ ...restartedEvidence, operatorCommit: COMMIT }, restartedConfig),
    /sanitized evidence drifted/,
  );
  assert.equal(
    redact("sk_test_secret acct_123 postgres://owner:secret@db Bearer token https://connect.stripe.com/setup/s/secret"),
    "[redacted-stripe-secret] [redacted-stripe-object] [redacted-database-url] Bearer [redacted-token] [redacted-onboarding-url]",
  );
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
  const databaseBoundaryStart = source.indexOf("async function verifyDatabaseBoundary");
  const databaseBoundaryEnd = source.indexOf("async function listAll", databaseBoundaryStart);
  assert.ok(databaseBoundaryStart >= 0 && databaseBoundaryEnd > databaseBoundaryStart);
  const databaseBoundary = source.slice(databaseBoundaryStart, databaseBoundaryEnd);
  assert.match(source, /validateStripeSecret\(localValues\)/);
  assert.match(source, /provider\.stage !== 4/);
  assert.match(source, /requirement_collection: "stripe"/);
  assert.match(source, /stripe_dashboard: Object\.freeze\(\{ type: "express" \}\)/);
  assert.match(source, /capabilities: \{ transfers: \{ requested: true \} \}/);
  assert.match(source, /account-v2-express-stripe-collector/);
  assert.match(source, /retrievePayment: \(id\) => stripe\.paymentIntents\.retrieve\(id\)/);
  assert.match(source, /createAndRecoverDestinationPayment\(stripeOps, account\.id\)/);
  assert.match(source, /ORDER_PAYMENT_SELLER_REFUND_COMMAND/);
  assert.match(source, /\/usr\/bin\/open/);
  assert.doesNotMatch(source, /type: "custom"/);
  assert.doesNotMatch(source, /business_type:/);
  assert.doesNotMatch(source, /tos_acceptance:/);
  assert.doesNotMatch(source, /individual:/);
  assert.match(source, /"vacationMode"/);
  assert.match(source, /EMAIL_REFUND_ISSUED/);
  assert.match(source, /cleanupExactRows/);
  assert.match(source, /listAccounts: \(\) => listAccountsBounded\(\(params\) => stripe\.accounts\.list\(params\)\)/);
  assert.match(source, /assertDeletedConnectedAccountAbsence/);
  assert.doesNotMatch(databaseBoundary, /Promise\.all/);
  assert.match(source, /listChargeRefunds: \(chargeId\) => listAll\(stripe\.refunds\.list/);
  assert.doesNotMatch(source, /\.refunds\?\.data|\.refunds\.data/);
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
