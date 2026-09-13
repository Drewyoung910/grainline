import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CANARY_ABORT_CONFIRMATION,
  CANARY_PREPARATION_CONFIRMATION,
  CONFIRMATION,
  abortDisposableCanary,
  assertAvailableUsdBalance,
  assertCleanupSnapshot,
  assertDeliverySnapshot,
  assertDisposableCanaryState,
  assertGitState,
  assertReplayUnchanged,
  assertState,
  disposableDatabaseIdentity,
  hasRequiredPayoutFailureBank,
  parseDatabaseUrls,
  parseGitHubCiRun,
  parseVercelDeployment,
  prepareDisposableCanary,
  redact,
  validateConfiguration,
  validateStripeSecret,
} from "../scripts/seller-payout-event-linked-production-proof.mjs";
import {
  PLATFORM_REVIEWED_EVENTS,
  V2_REVIEWED_EVENTS,
} from "../scripts/stripe-connect-provider-cutover.mjs";
import { buildCanaryAccountParams } from "../scripts/stripe-connect-signed-payout-proof.mjs";

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
    SELLER_PAYOUT_LINKED_PROOF_CANARY_PATH:
      `/Users/drewyoung/grainline-rollout-evidence/seller-payout-event-linked-canary-${COMMIT}.json`,
    SELLER_PAYOUT_LINKED_PROOF_VERCEL_PROJECT_DIRECTORY: "/Users/drewyoung/grainline",
    ...overrides,
  };
}

function delivery(overrides = {}) {
  return {
    userCount: 1,
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
  const attemptId = "11111111-1111-4111-8111-111111111111";
  const identity = disposableDatabaseIdentity(attemptId);
  const value = {
    phase: "seller-payout-event-linked-production-proof-state",
    stage,
    commit: COMMIT,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    ciRunId: CI_RUN_ID,
    deploymentId: DEPLOYMENT_ID,
    attemptId,
    startedSeconds: 1786840000,
    disposableCanary: true,
    canaryMarker: "f".repeat(64),
    canaryClerkId: identity.clerkId,
    canaryEmail: identity.email,
    sellerId: identity.sellerId,
    sellerUserId: identity.userId,
    stripeAccountId: "acct_proof",
    ...overrides,
  };
  const order = ["charged", "payout-created", "event-ready", "delivered"];
  if (order.includes(stage) || ["replayed", "cleanup-started", "db-cleaned", "cleaned"].includes(stage)) {
    value.chargeId = "ch_proof";
  }
  if (["payout-created", "event-ready", "delivered", "replayed", "cleanup-started", "db-cleaned", "cleaned"].includes(stage)) {
    value.payoutId = "po_proof";
  }
  if (["event-ready", "delivered", "replayed", "cleanup-started", "db-cleaned", "cleaned"].includes(stage)) {
    value.eventId = "evt_proof";
    value.eventCreated = "1786840001";
  }
  if (["delivered", "replayed", "cleanup-started", "db-cleaned", "cleaned"].includes(stage)) {
    value.payoutEventId = "payout-row-proof";
    value.notificationId = "notification-proof";
  }
  if (stage === "cleaned") value.disposableAccountRemoved = true;
  return value;
}

function providerDependencies(config, { accountReady = false } = {}) {
  const connectId = "we_disposable_linked_test";
  const marker = buildCanaryAccountParams({
    preparationCommit: config.expectedCommit,
    preparationCiRunId: config.mainCiRunId,
    deploymentId: config.deploymentId,
  }).metadata.grainline_provider_canary;
  const account = () => ({
    id: "acct_disposable_linked_test",
    charges_enabled: accountReady,
    payouts_enabled: accountReady,
    controller: {
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "stripe",
      stripe_dashboard: { type: "express" },
    },
    external_accounts: { data: accountReady ? [{
      currency: "usd",
      default_for_currency: true,
      last4: "1116",
      object: "bank_account",
    }] : [] },
    metadata: { grainline_provider_canary: marker },
  });
  return {
    marker,
    reviewedConnectEndpointDigest: createHash("sha256").update(connectId).digest("hex"),
    listClassicEndpoints: async () => [{
      enabled_events: PLATFORM_REVIEWED_EVENTS,
      id: "we_platform",
      livemode: false,
      status: "enabled",
      url: "https://thegrainline.com/api/stripe/webhook",
    }, {
      enabled_events: ["payout.failed"],
      id: connectId,
      livemode: false,
      status: "enabled",
      url: "https://thegrainline.com/api/stripe/webhook/connect",
    }],
    listV2Destinations: async () => [{
      enabled_events: V2_REVIEWED_EVENTS,
      event_payload: "thin",
      events_from: ["other_accounts"],
      id: "ed_v2",
      livemode: false,
      status: "enabled",
      type: "webhook_endpoint",
      webhook_endpoint: { url: "https://thegrainline.com/api/stripe/webhook/v2" },
    }],
    createCanaryAccount: async () => account(),
    createOnboardingAccountLink: async (_accountId, generation) => ({
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      object: "account_link",
      url: `https://connect.stripe.com/setup/test/${generation}`,
    }),
    retrieveAccount: async () => account(),
    deleteAccount: async () => ({ deleted: true, id: "acct_disposable_linked_test" }),
  };
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

  it("separates disposable canary preparation, proof, and abort confirmations", () => {
    const prepared = validateConfiguration(environment({
      SELLER_PAYOUT_LINKED_PROOF_MODE: "prepare-canary",
      SELLER_PAYOUT_LINKED_PROOF_CONFIRM: CANARY_PREPARATION_CONFIRMATION,
    }));
    assert.equal(prepared.mode, "prepare-canary");
    const aborted = validateConfiguration(environment({
      SELLER_PAYOUT_LINKED_PROOF_MODE: "abort-canary",
      SELLER_PAYOUT_LINKED_PROOF_CONFIRM: CANARY_ABORT_CONFIRMATION,
    }));
    assert.equal(aborted.mode, "abort-canary");
    assert.throws(
      () => validateConfiguration(environment({
        SELLER_PAYOUT_LINKED_PROOF_MODE: "prepare-canary",
        SELLER_PAYOUT_LINKED_PROOF_CONFIRM: CONFIRMATION,
      })),
      /confirmation is invalid/,
    );
    assert.throws(
      () => validateConfiguration(environment({ SELLER_PAYOUT_LINKED_PROOF_MODE: "unknown" })),
      /mode is invalid/,
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

  it("redacts provider secrets, objects, onboarding links, and disposable identities", () => {
    const identity = disposableDatabaseIdentity("11111111-1111-4111-8111-111111111111");
    const output = redact([
      "sk_test_secret",
      "acct_sensitive",
      "https://connect.stripe.com/setup/s/acct_sensitive/token",
      identity.userId,
      identity.sellerId,
      identity.clerkId,
      identity.email,
    ].join(" "));
    for (const forbidden of [
      "sk_test_secret",
      "acct_sensitive",
      "/setup/s/",
      identity.userId,
      identity.sellerId,
      identity.clerkId,
      identity.email,
    ]) assert.equal(output.includes(forbidden), false);
  });

  it("binds the exact Vercel API deployment source and canonical aliases", () => {
    const deployment = {
      alias: [
        "thegrainline.com",
        "www.thegrainline.com",
        "grainline.vercel.app",
      ],
      id: DEPLOYMENT_ID,
      meta: { gitCommitSha: DEPLOYED_SOURCE_COMMIT },
      readyState: "READY",
      target: "production",
    };
    assert.equal(
      parseVercelDeployment(deployment, config).deployedSourceCommit,
      DEPLOYED_SOURCE_COMMIT,
    );
    parseVercelDeployment({
      ...deployment,
      alias: undefined,
      aliases: deployment.alias,
    }, config);
    parseVercelDeployment(`Vercel CLI\n${JSON.stringify(deployment)}`, config);
    assert.throws(
      () => parseVercelDeployment("Vercel CLI returned no document", config),
      /response was not JSON/,
    );
    assert.throws(
      () => parseVercelDeployment("Vercel CLI\n{invalid", config),
      /response was not valid JSON/,
    );
    for (const drift of [
      { ...deployment, meta: {} },
      { ...deployment, meta: { gitCommitSha: "c".repeat(40) } },
      { ...deployment, alias: deployment.alias.slice(1) },
      { ...deployment, readyState: "BUILDING" },
      { ...deployment, target: "preview" },
    ]) {
      assert.throws(
        () => parseVercelDeployment(drift, config),
        /deployment identity drifted/,
      );
    }
  });

  it("requires the documented payout-failure bank and settled test balance", () => {
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

  it("prepares and aborts only one release-bound disposable Express canary", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "grainline-linked-canary-test-"));
    const localConfig = {
      ...config,
      canaryPath: path.join(directory, "canary.json"),
      statePath: path.join(directory, "proof-state.json"),
    };
    try {
      const firstDeps = providerDependencies(localConfig);
      const first = await prepareDisposableCanary(localConfig, firstDeps);
      assert.equal(first.status, "onboarding-required");
      const onboarding = assertDisposableCanaryState(
        JSON.parse(readFileSync(localConfig.canaryPath, "utf8")),
        localConfig,
      );
      assert.equal(onboarding.stage, "onboarding-required");
      assert.equal(onboarding.accountLinkGeneration, 1);
      assert.equal(onboarding.marker, firstDeps.marker);

      const second = await prepareDisposableCanary(
        localConfig,
        providerDependencies(localConfig, { accountReady: true }),
      );
      assert.equal(second.status, "prepared");
      const prepared = assertDisposableCanaryState(
        JSON.parse(readFileSync(localConfig.canaryPath, "utf8")),
        localConfig,
      );
      assert.equal(prepared.stage, "prepared");
      assert.equal(Object.hasOwn(prepared, "accountLinkUrl"), false);

      const aborted = await abortDisposableCanary(
        localConfig,
        providerDependencies(localConfig, { accountReady: true }),
      );
      assert.equal(aborted.status, "aborted");
      assert.equal(
        await abortDisposableCanary(
          localConfig,
          providerDependencies(localConfig, { accountReady: true }),
        ).then((result) => result.status),
        "already-absent",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
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
      "fixture-reserved",
      "selected",
      "charged",
      "payout-created",
      "event-ready",
      "delivered",
      "replayed",
      "cleanup-started",
      "db-cleaned",
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
      userCount: 0,
      sellerCount: 0,
      webhookCount: 1,
      webhookProcessed: true,
      payoutCount: 0,
      notificationCount: 0,
    }), {
      userCount: 0,
      sellerCount: 0,
      webhookCount: 1,
      webhookProcessed: true,
      payoutCount: 0,
      notificationCount: 0,
    });
    assert.throws(
      () => assertCleanupSnapshot({
        userCount: 0,
        sellerCount: 0,
        webhookCount: 1,
        webhookProcessed: true,
        payoutCount: 0,
        notificationCount: 1,
      }),
      /cleanup did not reach the reviewed state/,
    );
  });

  it("keeps destructive SQL exact, deletes only canary identities, and retains webhook evidence", () => {
    const source = readFileSync(
      "scripts/seller-payout-event-linked-production-proof.mjs",
      "utf8",
    );
    assert.match(source, /DELETE FROM public\."Notification" WHERE id = \$1 RETURNING id/);
    assert.match(source, /DELETE FROM public\."SellerPayoutEvent" WHERE id = \$1 RETURNING id/);
    assert.match(source, /DELETE FROM public\."SellerProfile" WHERE id = \$1 RETURNING id/);
    assert.match(source, /DELETE FROM public\."User" WHERE id = \$1 RETURNING id/);
    assert.doesNotMatch(source, /DELETE FROM public\."StripeWebhookEvent"/);
    assert.match(source, /stage: "cleanup-started"/);
    assert.match(source, /stage: "cleaned"/);
    assert.match(source, /stage: "db-cleaned"/);
    assert.match(source, /"clerkId" = \$2 AND email = \$3/);
    assert.match(source, /assertNoForeignKeyDependents\(owner, 'public\."SellerProfile"'/);
    assert.match(source, /assertNoForeignKeyDependents\(owner, 'public\."User"'/);
    assert.match(source, /hasRequiredPayoutFailureBank\(externalAccounts\)/);
    assert.match(source, /assertAvailableUsdBalance\(balance\)/);
  });
});
