import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CONFIRMATION,
  assertAvailableUsdBalance,
  assertCleanupSnapshot,
  assertDeliverySnapshot,
  assertGitState,
  assertReplayUnchanged,
  assertSelectedSeller,
  assertState,
  hasRequiredPayoutFailureBank,
  parseDatabaseUrls,
  parseGitHubCiRun,
  validateConfiguration,
  validateStripeSecret,
} from "../scripts/seller-payout-event-linked-production-proof.mjs";

const COMMIT = "a".repeat(40);
const DEPLOYED_SOURCE_COMMIT = "b".repeat(40);
const CI_RUN_ID = 31999999999;
const DEPLOYMENT_ID = "dpl_LinkedPayoutProof123";
const config = {
  deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
  deploymentId: DEPLOYMENT_ID,
  expectedCommit: COMMIT,
  mainCiRunId: CI_RUN_ID,
};

function environment(overrides = {}) {
  return {
    SELLER_PAYOUT_LINKED_PROOF_CONFIRM: CONFIRMATION,
    SELLER_PAYOUT_LINKED_PROOF_EXPECTED_COMMIT: COMMIT,
    SELLER_PAYOUT_LINKED_PROOF_DEPLOYED_SOURCE_COMMIT: DEPLOYED_SOURCE_COMMIT,
    SELLER_PAYOUT_LINKED_PROOF_CI_RUN_ID: String(CI_RUN_ID),
    SELLER_PAYOUT_LINKED_PROOF_DEPLOYMENT_ID: DEPLOYMENT_ID,
    SELLER_PAYOUT_LINKED_PROOF_EVIDENCE_PATH:
      `/Users/drewyoung/grainline-rollout-evidence/seller-payout-event-linked-production-proof-${COMMIT}.json`,
    SELLER_PAYOUT_LINKED_PROOF_VERCEL_PROJECT_DIRECTORY: "/Users/drewyoung/grainline",
    ...overrides,
  };
}

function delivery(overrides = {}) {
  return {
    sellerCount: 1,
    webhookCount: 1,
    payoutCount: 1,
    notificationCount: 1,
    webhookType: "payout.failed",
    webhookProcessed: true,
    webhookErrorClear: true,
    claimGeneration: "1",
    webhookUpdatedEpoch: "1786840000.123",
    payoutEventId: "payout-row-proof",
    payoutUpdatedEpoch: "1786840000.456",
    notificationId: "notification-proof",
    notificationDedupKey: "d".repeat(32),
    latestProjectionId: "payout-row-proof",
    runtimeNotificationCount: 1,
    ...overrides,
  };
}

function state(stage, overrides = {}) {
  const value = {
    phase: "seller-payout-event-linked-production-proof-state",
    stage,
    commit: COMMIT,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    ciRunId: CI_RUN_ID,
    deploymentId: DEPLOYMENT_ID,
    attemptId: "11111111-1111-4111-8111-111111111111",
    startedSeconds: 1786840000,
    sellerId: "seller-proof",
    sellerUserId: "user-proof",
    stripeAccountId: "acct_proof",
    ...overrides,
  };
  const order = ["charged", "payout-created", "event-ready", "delivered"];
  if (order.includes(stage) || ["replayed", "cleanup-started", "cleaned"].includes(stage)) {
    value.chargeId = "ch_proof";
  }
  if (["payout-created", "event-ready", "delivered", "replayed", "cleanup-started", "cleaned"].includes(stage)) {
    value.payoutId = "po_proof";
  }
  if (["event-ready", "delivered", "replayed", "cleanup-started", "cleaned"].includes(stage)) {
    value.eventId = "evt_proof";
    value.eventCreated = "1786840001";
  }
  if (["delivered", "replayed", "cleanup-started", "cleaned"].includes(stage)) {
    value.payoutEventId = "payout-row-proof";
    value.notificationId = "notification-proof";
  }
  return value;
}

describe("SellerPayoutEvent linked production operator", () => {
  it("requires an explicit exact release binding", () => {
    const parsed = validateConfiguration(environment());
    assert.equal(parsed.expectedCommit, COMMIT);
    assert.equal(parsed.deployedSourceCommit, DEPLOYED_SOURCE_COMMIT);
    assert.equal(parsed.mainCiRunId, CI_RUN_ID);
    assert.equal(parsed.deploymentId, DEPLOYMENT_ID);
    assert.throws(
      () => validateConfiguration(environment({ SELLER_PAYOUT_LINKED_PROOF_CONFIRM: "wrong" })),
      /confirmation is invalid/,
    );
    assert.throws(
      () => validateConfiguration(environment({ SELLER_PAYOUT_LINKED_PROOF_DEPLOYMENT_ID: "bad" })),
      /deployment ID is invalid/,
    );
    assert.throws(
      () => validateConfiguration(environment({
        SELLER_PAYOUT_LINKED_PROOF_DEPLOYED_SOURCE_COMMIT: "bad",
      })),
      /deployed source commit is invalid/,
    );
  });

  it("accepts only the exact owner and pooled runtime database identities", () => {
    const parsed = parseDatabaseUrls(
      {
        DATABASE_URL:
          "postgresql://grainline_app_runtime:runtime-secret@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require",
      },
      {
        DIRECT_URL:
          "postgresql://neondb_owner:owner-secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require",
      },
    );
    assert.match(parsed.runtimeDatabaseUrl, /grainline_app_runtime/);
    assert.match(parsed.ownerDatabaseUrl, /neondb_owner/);
    assert.throws(
      () => parseDatabaseUrls(
        { DATABASE_URL: parsed.ownerDatabaseUrl },
        { DIRECT_URL: parsed.ownerDatabaseUrl },
      ),
      /runtime database identity drifted/,
    );
  });

  it("refuses live-mode Stripe authority and unreviewed GitHub state", () => {
    assert.equal(validateStripeSecret({ STRIPE_SECRET_KEY: "sk_test_fixture" }), "sk_test_fixture");
    assert.throws(
      () => validateStripeSecret({ STRIPE_SECRET_KEY: "sk_live_fixture" }),
      /refuses any non-test Stripe secret/,
    );
    assertGitState({ branch: "main", head: COMMIT, status: "" }, COMMIT);
    assertGitState({ branch: "", head: COMMIT, status: "" }, COMMIT);
    assert.throws(
      () => assertGitState({ branch: "feature", head: COMMIT, status: "" }, COMMIT),
      /exact clean reviewed main/,
    );
    parseGitHubCiRun({
      databaseId: CI_RUN_ID,
      headSha: COMMIT,
      conclusion: "success",
      event: "push",
      headBranch: "main",
      status: "completed",
      workflowName: "CI",
    }, COMMIT, CI_RUN_ID);
    assert.throws(
      () => parseGitHubCiRun({ databaseId: CI_RUN_ID, headSha: COMMIT }, COMMIT, CI_RUN_ID),
      /CI binding did not pass/,
    );
    assert.throws(
      () => parseGitHubCiRun({
        databaseId: CI_RUN_ID,
        headSha: COMMIT,
        conclusion: "success",
        event: "pull_request",
        headBranch: "feature",
        status: "completed",
        workflowName: "CI",
      }, COMMIT, CI_RUN_ID),
      /CI binding did not pass/,
    );
  });

  it("requires a live eligible linked seller without trusting a row alone", () => {
    const seller = assertSelectedSeller({
      sellerId: "seller-proof",
      userId: "user-proof",
      stripeAccountId: "acct_proof",
      databaseEligible: true,
      stripeChargesEnabled: true,
      stripeFailureBankReady: true,
      stripePayoutsEnabled: true,
      stripeDeleted: false,
    });
    assert.equal(seller.stripeAccountId, "acct_proof");
    for (const key of [
      "stripeChargesEnabled",
      "stripeFailureBankReady",
      "stripePayoutsEnabled",
    ]) {
      assert.throws(
        () => assertSelectedSeller({ ...seller, [key]: false }),
        /seller is not exactly eligible/,
      );
    }
    assert.equal(hasRequiredPayoutFailureBank([{
      currency: "usd",
      default_for_currency: true,
      last4: "1116",
      object: "bank_account",
    }]), true);
    for (const drift of [
      [],
      [{ currency: "usd", default_for_currency: false, last4: "1116", object: "bank_account" }],
      [{ currency: "usd", default_for_currency: true, last4: "6789", object: "bank_account" }],
      [{ currency: "usd", default_for_currency: true, last4: "1116", object: "card" }],
    ]) assert.equal(hasRequiredPayoutFailureBank(drift), false);
    assert.equal(assertAvailableUsdBalance({
      available: [{ amount: 25, currency: "eur" }, { amount: 100, currency: "usd" }],
    }), 100);
    assert.throws(
      () => assertAvailableUsdBalance({ available: [{ amount: 99, currency: "usd" }] }),
      /lacks reviewed available USD balance/,
    );
  });

  it("pins the linked delivery and exact retry identities", () => {
    const first = assertDeliverySnapshot(delivery());
    assert.equal(first.payoutCount, 1);
    assertReplayUnchanged(first, delivery());
    for (const change of [
      { claimGeneration: "2" },
      { webhookUpdatedEpoch: "1786840001" },
      { payoutUpdatedEpoch: "1786840001" },
      { notificationDedupKey: "e".repeat(32) },
    ]) {
      assert.throws(
        () => assertReplayUnchanged(first, delivery(change)),
        /exact payout retry changed|delivery did not reach the exact reviewed state/,
      );
    }
    assert.throws(
      () => assertDeliverySnapshot(delivery({ runtimeNotificationCount: 0 })),
      /did not reach the exact reviewed state/,
    );
  });

  it("supports only the reviewed restart stages and exact cleanup outcome", () => {
    for (const stage of [
      "selected",
      "charged",
      "payout-created",
      "event-ready",
      "delivered",
      "replayed",
      "cleanup-started",
      "cleaned",
    ]) assert.equal(assertState(state(stage), config).stage, stage);
    assert.throws(() => assertState(state("unknown"), config), /recovery state drifted/);
    assert.throws(
      () => assertState({ ...state("event-ready"), eventCreated: "not-a-timestamp" }, config),
      /event timestamp drifted/,
    );
    assert.throws(
      () => assertState({ ...state("event-ready"), eventCreated: "1786839999" }, config),
      /event timestamp drifted/,
    );
    assert.deepEqual(assertCleanupSnapshot({
      sellerCount: 1,
      webhookCount: 1,
      webhookProcessed: true,
      payoutCount: 0,
      notificationCount: 0,
    }), {
      sellerCount: 1,
      webhookCount: 1,
      webhookProcessed: true,
      payoutCount: 0,
      notificationCount: 0,
    });
    assert.throws(
      () => assertCleanupSnapshot({
        sellerCount: 1,
        webhookCount: 1,
        webhookProcessed: true,
        payoutCount: 0,
        notificationCount: 1,
      }),
      /cleanup did not reach the reviewed state/,
    );
  });

  it("keeps destructive SQL exact and never deletes seller or webhook evidence", () => {
    const source = readFileSync(
      "scripts/seller-payout-event-linked-production-proof.mjs",
      "utf8",
    );
    assert.match(source, /DELETE FROM public\."Notification" WHERE id = \$1 RETURNING id/);
    assert.match(source, /DELETE FROM public\."SellerPayoutEvent" WHERE id = \$1 RETURNING id/);
    assert.doesNotMatch(source, /DELETE FROM public\."SellerProfile"/);
    assert.doesNotMatch(source, /DELETE FROM public\."StripeWebhookEvent"/);
    assert.match(source, /stage: "cleanup-started"/);
    assert.match(source, /stage: "cleaned"/);
    assert.match(source, /hasRequiredPayoutFailureBank\(externalAccounts\)/);
    assert.match(source, /assertAvailableUsdBalance\(balance\)/);
  });
});
