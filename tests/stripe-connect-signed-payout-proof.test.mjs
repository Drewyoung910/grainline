import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PLATFORM_REVIEWED_EVENTS,
  V2_REVIEWED_EVENTS,
} from "../scripts/stripe-connect-provider-cutover.mjs";
import { STRIPE_CONNECT_CONTROLLER_SUMMARY } from "../src/lib/stripeConnectV2State.ts";
import {
  assertCanaryAccount,
  assertCutoverEvidence,
  assertFailedPayout,
  assertOnlyReviewedEvidenceIsUntracked,
  assertPayoutEvent,
  assertPreparationEvidence,
  buildCanaryAccountParams,
  buildCanaryAccountLinkParams,
  parseStripeConnectPayoutProofConfig,
  runStripeConnectSignedPayoutProof,
} from "../scripts/stripe-connect-signed-payout-proof.mjs";

const COMMIT = "b".repeat(40);
const CI_RUN = "31340000001";
const CUTOVER_COMMIT = "a".repeat(40);
const CUTOVER_CI_RUN = "31339275512";
const DEPLOYMENT_ID = "dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP";
const CONNECT_URL = "https://thegrainline.com/api/stripe/webhook/connect";
const V2_URL = "https://thegrainline.com/api/stripe/webhook/v2";
const ACCOUNT_ID = "acct_disposable_test";
const PAYOUT_ID = "po_disposable_test";
const EVENT_ID = "evt_disposable_test";
const CONNECT_ID = "we_disposable_test";
const CONNECT_DIGEST = createHash("sha256").update(CONNECT_ID).digest("hex");
const ATTEMPT_ID = "12345678-1234-4abc-8def-1234567890ab";
const DATABASE_URL =
  "postgresql://grainline_app_runtime:fixture@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function baseEnv(mode = "prepare", overrides = {}) {
  return {
    STRIPE_CONNECT_PAYOUT_PROOF_MODE: mode,
    STRIPE_CONNECT_PAYOUT_PROOF_CONFIRM: mode === "prepare"
      ? "create-disposable-test-payout-failure"
      : "enable-and-prove-signed-test-payout-failure",
    STRIPE_CONNECT_PAYOUT_PROOF_EXPECTED_COMMIT: COMMIT,
    STRIPE_CONNECT_PAYOUT_PROOF_CI_RUN_ID: CI_RUN,
    STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_COMMIT: CUTOVER_COMMIT,
    STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_CI_RUN_ID: CUTOVER_CI_RUN,
    STRIPE_CONNECT_PAYOUT_PROOF_DEPLOYMENT_ID: DEPLOYMENT_ID,
    STRIPE_CONNECT_PAYOUT_PROOF_VERCEL_PROJECT_DIRECTORY: "/reviewed/grainline",
    STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_EVIDENCE_PATH:
      `archive/stripe-connect-provider-cutover-test-${COMMIT}.json`,
    STRIPE_CONNECT_PAYOUT_PROOF_EVIDENCE_PATH:
      `archive/stripe-connect-payout-${mode}-test-${COMMIT}.json`,
    ...(mode === "prove" ? {
      STRIPE_CONNECT_PAYOUT_PROOF_PREPARATION_EVIDENCE_PATH:
        `archive/stripe-connect-payout-prepare-test-${COMMIT}.json`,
    } : {}),
    STRIPE_CONNECT_PAYOUT_HANDOFF_PATH:
      `/private/tmp/grainline-stripe-connect-payout-${mode}-${COMMIT}.json`,
    STRIPE_SECRET_KEY: "sk_test_fixture_not_a_secret",
    ...(mode === "prove" ? { DATABASE_URL } : {}),
    ...overrides,
  };
}

function marker(config) {
  return createHash("sha256").update([
    "grainline-stripe-connect-payout-canary-v1",
    config.expectedCommit,
    config.ciRunId,
    config.deploymentId,
  ].join(":")).digest("hex");
}

function canaryController() {
  return {
    fees: { payer: "application" },
    losses: { payments: "application" },
    requirement_collection: "stripe",
    stripe_dashboard: { type: "express" },
  };
}

function controllerSummary(controller) {
  return [
    `dashboard:${controller.stripe_dashboard.type}`,
    `fees:${controller.fees.payer}`,
    `losses:${controller.losses.payments}`,
    `requirements:${controller.requirement_collection}`,
  ].join("|");
}

function cutoverEvidence(config) {
  return {
    phase: "stripe-connect-provider-cutover",
    status: "passed",
    mode: "test",
    commit: config.cutoverCommit,
    ciRunId: config.cutoverCiRunId,
    deploymentId: config.deploymentId,
    providerStage: 3,
    stripe: {
      connectUrl: CONNECT_URL,
      connectStatus: "disabled",
      connectEvents: ["payout.failed"],
      platformEvents: PLATFORM_REVIEWED_EVENTS,
      v2Events: V2_REVIEWED_EVENTS,
      connectedAccountSourceAttestedByRetainedCreationEvidence: true,
    },
    secretsChanged: false,
  };
}

function preparationEvidence(config) {
  return {
    phase: "stripe-connect-disposable-payout-preparation",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    ciRunId: config.ciRunId,
    deploymentId: config.deploymentId,
    stripe: {
      accountIdSha256: createHash("sha256").update(ACCOUNT_ID).digest("hex"),
      payoutIdSha256: createHash("sha256").update(PAYOUT_ID).digest("hex"),
      eventIdSha256: createHash("sha256").update(EVENT_ID).digest("hex"),
      preparationAttemptIdSha256:
        createHash("sha256").update(ATTEMPT_ID).digest("hex"),
      eventType: "payout.failed",
      failureCode: "no_account",
      livemode: false,
      disposableAccountCleanupPending: true,
    },
    rawProviderIdsPersistedInEvidence: false,
    secretsPersistedInEvidence: false,
    connectEndpointEnabled: false,
  };
}

function preparationAttempt(config, overrides = {}) {
  return {
    phase: "stripe-connect-disposable-payout-attempt",
    status: "pending",
    commit: config.expectedCommit,
    ciRunId: config.ciRunId,
    deploymentId: config.deploymentId,
    attemptId: ATTEMPT_ID,
    startedSeconds: Math.floor(Date.now() / 1000) - 5,
    stripeAccountId: ACCOUNT_ID,
    ...overrides,
  };
}

function platform() {
  return {
    enabled_events: PLATFORM_REVIEWED_EVENTS,
    id: "we_platform",
    livemode: false,
    status: "enabled",
    url: "https://thegrainline.com/api/stripe/webhook",
  };
}

function v2() {
  return {
    enabled_events: V2_REVIEWED_EVENTS,
    event_payload: "thin",
    events_from: ["other_accounts"],
    id: "ed_v2",
    livemode: false,
    status: "enabled",
    type: "webhook_endpoint",
    webhook_endpoint: { url: V2_URL },
  };
}

function baseDependencies(config, stage = 3) {
  let enabled = stage === 4;
  let attempt = preparationAttempt(
    config,
    config.mode === "prepare" ? { stripeAccountId: undefined } : {},
  );
  const calls = [];
  return {
    calls,
    reviewedConnectEndpointDigest: CONNECT_DIGEST,
    currentGitState: async () => ({ head: COMMIT, status: "" }),
    ciRun: async () => ({
      conclusion: "success",
      event: "push",
      headBranch: "main",
      headSha: COMMIT,
      workflowName: "CI",
    }),
    readVercelProject: async () => ({
      orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
      projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
      projectName: "grainline",
    }),
    listVercelEnvironment: async () => ({
      envs: [{
        gitBranch: null,
        key: "STRIPE_CONNECT_WEBHOOK_SECRET",
        target: ["production"],
        type: "sensitive",
      }],
    }),
    readCutoverEvidence: async () => cutoverEvidence(config),
    readPreparationEvidence: async () => preparationEvidence(config),
    readPreparationAttempt: async () => attempt,
    reserveOrResumePreparationAttempt: async () => attempt,
    updatePreparationAttempt: async (_config, previous, patch) => {
      attempt = { ...previous, ...patch };
      return attempt;
    },
    removePreparationAttempt: async () => { attempt = null; },
    readHomepage: async () => ({
      body: `<script src="/app.js?dpl=${DEPLOYMENT_ID}"></script>`,
      status: 200,
    }),
    readHealth: async () => ({ body: { ok: true }, status: 200 }),
    listClassicEndpoints: async () => [
      platform(),
      {
        enabled_events: ["payout.failed"],
        id: CONNECT_ID,
        livemode: false,
        status: enabled ? "enabled" : "disabled",
        url: CONNECT_URL,
      },
    ],
    listV2Destinations: async () => [v2()],
    updateConnect: async (_id, params) => {
      enabled = !params.disabled;
      calls.push(enabled ? "connect:enable" : "connect:disable");
    },
    updateHandoff: async () => {},
  };
}

function failedPayout(accountId = ACCOUNT_ID) {
  return {
    amount: 100,
    currency: "usd",
    failure_code: "no_account",
    id: PAYOUT_ID,
    livemode: false,
    metadata: {
      grainline_provider_account_sha256:
        createHash("sha256").update(accountId).digest("hex"),
    },
    status: "failed",
  };
}

function payoutEvent(created = Math.floor(Date.now() / 1000)) {
  return {
    account: ACCOUNT_ID,
    created,
    data: { object: failedPayout() },
    id: EVENT_ID,
    livemode: false,
    type: "payout.failed",
  };
}

function preparedHandoff(config, created = Math.floor(Date.now() / 1000)) {
  return {
    phase: "stripe-connect-disposable-payout-handoff",
    status: "prepared",
    commit: config.expectedCommit,
    ciRunId: config.ciRunId,
    deploymentId: config.deploymentId,
    marker: marker(config),
    preparationAttemptId: ATTEMPT_ID,
    stripeAccountId: ACCOUNT_ID,
    payoutId: PAYOUT_ID,
    eventId: EVENT_ID,
    eventCreated: created,
  };
}

function beforeRuntime() {
  return {
    seller_count: 0,
    payout_projection_count: 0,
    webhook_count: 0,
    webhook_type: null,
    claim_generation: null,
    processed: null,
    error_clear: null,
    updated_epoch: null,
  };
}

function afterRuntime() {
  return {
    seller_count: 0,
    payout_projection_count: 0,
    webhook_count: 1,
    webhook_type: "payout.failed",
    claim_generation: "1",
    processed: true,
    error_clear: true,
    updated_epoch: "1786300000.123",
  };
}

test("configuration is exact-main, test-mode and runtime-role bound", () => {
  const prepare = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  assert.equal(prepare.mode, "prepare");
  const prove = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  assert.equal(prove.runtimeGuard.runtimeRole, "grainline_app_runtime");
  assert.throws(
    () => parseStripeConnectPayoutProofConfig(baseEnv("prepare", {
      STRIPE_SECRET_KEY: "sk_live_no",
    })),
    /requires an explicit Stripe test key/,
  );
  assert.throws(
    () => parseStripeConnectPayoutProofConfig(baseEnv("prove", {
      DIRECT_URL: DATABASE_URL,
    })),
    /rejects privileged database keys/,
  );
  assert.throws(
    () => parseStripeConnectPayoutProofConfig(baseEnv("prove", {
      STRIPE_CONNECT_PAYOUT_PROOF_EVIDENCE_PATH:
        `archive/stripe-connect-provider-cutover-test-${COMMIT}.json`,
    })),
    /evidence paths must be distinct/,
  );
});

test("proof mode rejects an unfinished hosted-onboarding record", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grainline-payout-proof-config-"));
  const handoffPath = path.join(directory, "grainline-stripe-connect-payout-proof.json");
  try {
    writeFileSync(`${handoffPath}.onboarding`, "{}\n", { encoding: "utf8", mode: 0o600 });
    assert.throws(
      () => parseStripeConnectPayoutProofConfig(baseEnv("prove", {
        STRIPE_CONNECT_PAYOUT_HANDOFF_PATH: handoffPath,
      })),
      /cannot start while hosted onboarding is incomplete/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("cutover evidence remains bound to disabled canonical stage 3", () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  assert.notEqual(config.cutoverCommit, config.expectedCommit);
  assert.notEqual(config.cutoverCiRunId, config.ciRunId);
  assert.doesNotThrow(() => assertCutoverEvidence(cutoverEvidence(config), config));
  assert.throws(
    () => assertCutoverEvidence({
      ...cutoverEvidence(config),
      commit: config.expectedCommit,
    }, config),
    /disabled-canonical predecessor/,
  );
  assert.throws(
    () => assertCutoverEvidence({
      ...cutoverEvidence(config),
      providerStage: 4,
    }, config),
    /disabled-canonical predecessor/,
  );
});

test("only exact generated evidence may coexist with the reviewed commit", () => {
  const prepare = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  assert.doesNotThrow(() => assertOnlyReviewedEvidenceIsUntracked(
    `?? archive/stripe-connect-provider-cutover-test-${COMMIT}.json`,
    prepare,
  ));
  assert.throws(
    () => assertOnlyReviewedEvidenceIsUntracked(" M scripts/stripe-connect-signed-payout-proof.mjs", prepare),
    /outside reviewed evidence files/,
  );

  const prove = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  assert.doesNotThrow(() => assertOnlyReviewedEvidenceIsUntracked([
    `?? archive/stripe-connect-provider-cutover-test-${COMMIT}.json`,
    `?? archive/stripe-connect-payout-prepare-test-${COMMIT}.json`,
  ].join("\n"), prove));
  assert.throws(
    () => assertOnlyReviewedEvidenceIsUntracked("?? archive/unbound-evidence.json", prove),
    /outside reviewed evidence files/,
  );
});

test("preparation evidence is source-bound and rejects a different handoff", () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const created = Math.floor(Date.now() / 1000);
  const handoff = preparedHandoff(config, created);
  assert.doesNotThrow(() => assertPreparationEvidence(
    preparationEvidence(config),
    config,
    handoff,
  ));
  assert.throws(
    () => assertPreparationEvidence(preparationEvidence(config), config, {
      ...handoff,
      eventId: "evt_other",
    }),
    /does not bind the temporary handoff/,
  );
});

test("canary source derives its marker and uses the documented failing bank", () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const params = buildCanaryAccountParams(config, new Date("2026-08-09T00:00:00Z"));
  assert.equal(Object.hasOwn(params, "type"), false);
  assert.equal(Object.hasOwn(params, "business_type"), false);
  assert.equal(Object.hasOwn(params, "individual"), false);
  assert.equal(Object.hasOwn(params, "tos_acceptance"), false);
  assert.deepEqual(params.controller, canaryController());
  assert.equal(controllerSummary(params.controller), STRIPE_CONNECT_CONTROLLER_SUMMARY);
  assert.equal(params.external_account.routing_number, "110000000");
  assert.equal(params.external_account.account_number, "000111111116");
  assert.equal(params.settings.payouts.schedule.interval, "manual");
  assert.equal(params.metadata.grainline_provider_canary, marker(config));
});

test("hosted onboarding link is production-shaped and collects all due fields", () => {
  assert.deepEqual(buildCanaryAccountLinkParams(ACCOUNT_ID), {
    account: ACCOUNT_ID,
    collection_options: { fields: "eventually_due" },
    refresh_url: "https://thegrainline.com/?stripe_connect_canary=refresh",
    return_url: "https://thegrainline.com/?stripe_connect_canary=return",
    type: "account_onboarding",
  });
  assert.throws(
    () => buildCanaryAccountLinkParams(""),
    /account ID is required/,
  );
});

test("source validators reject account, payout and event mismatches", () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const account = {
    controller: canaryController(),
    id: ACCOUNT_ID,
    metadata: { grainline_provider_canary: marker(config) },
  };
  assert.equal(assertCanaryAccount(account, config).id, ACCOUNT_ID);
  assert.equal(assertCanaryAccount({ ...account, livemode: false }, config).id, ACCOUNT_ID);
  assert.equal(assertFailedPayout(failedPayout(), ACCOUNT_ID).id, PAYOUT_ID);
  const created = Math.floor(Date.now() / 1000);
  assert.equal(assertPayoutEvent(payoutEvent(created), ACCOUNT_ID, PAYOUT_ID, created).id, EVENT_ID);
  assert.throws(
    () => assertCanaryAccount({ ...account, livemode: true }, config),
    /identity, metadata or controller drifted/,
  );
  assert.throws(
    () => assertCanaryAccount({ ...account, livemode: null }, config),
    /identity, metadata or controller drifted/,
  );
  let controllerError;
  try {
    assertCanaryAccount({
      ...account,
      controller: { ...canaryController(), requirement_collection: "application" },
    }, config);
  } catch (error) {
    controllerError = error;
  }
  assert.ok(controllerError instanceof Error);
  assert.match(controllerError.message, /"requirementsCollector":"application"/);
  assert.match(controllerError.message, /"livemodePresent":false/);
  assert.match(controllerError.message, /"markerMatches":true/);
  assert.doesNotMatch(controllerError.message, /acct_disposable_test/);
  assert.doesNotMatch(controllerError.message, /grainline_provider_canary/);
  assert.throws(
    () => assertFailedPayout({ ...failedPayout(), failure_code: "account_closed" }, ACCOUNT_ID),
    /exact failed state/,
  );
  assert.throws(
    () => assertPayoutEvent({ ...payoutEvent(created), account: "acct_other" }, ACCOUNT_ID, PAYOUT_ID, created),
    /does not match the disposable source/,
  );
});

test("prepare creates one disposable source and writes only sanitized durable evidence", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const deps = baseDependencies(config, 3);
  let account;
  let payoutParams;
  let handoff;
  let evidence;
  const created = Math.floor(Date.now() / 1000);
  const result = await runStripeConnectSignedPayoutProof({
    env: baseEnv("prepare"),
    dependencies: {
      ...deps,
      createCanaryAccount: async (params) => {
        account = {
          charges_enabled: true,
          controller: canaryController(),
          id: ACCOUNT_ID,
          livemode: false,
          metadata: params.metadata,
          payouts_enabled: true,
        };
        return account;
      },
      retrieveAccount: async () => account,
      createFundingCharge: async () => ({
        livemode: false,
        paid: true,
        status: "succeeded",
      }),
      retrieveBalance: async () => ({ available: [{ amount: 500, currency: "usd" }] }),
      createPayout: async (_accountId, params) => {
        payoutParams = params;
        return { id: PAYOUT_ID, livemode: false };
      },
      retrievePayout: async () => ({
        ...failedPayout(),
        metadata: payoutParams.metadata,
      }),
      listPayoutFailedEvents: async () => [payoutEvent(created)],
      writeHandoff: async (_path, payload) => { handoff = payload; },
      finalizeEvidence: async (_path, payload) => { evidence = payload; },
    },
  });
  assert.equal(result.status, "passed");
  assert.equal(handoff.stripeAccountId, ACCOUNT_ID);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /acct_disposable|po_disposable|evt_disposable|sk_test/);
  assert.equal(evidence.stripe.disposableAccountCleanupPending, true);
  assert.deepEqual(deps.calls, []);
});

test("prepare pauses at a mode-0600 hosted-onboarding handoff without funding", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const deps = baseDependencies(config, 3);
  let account;
  let onboarding;
  let fundingCalls = 0;
  let payoutCalls = 0;
  let deleted = false;
  const result = await runStripeConnectSignedPayoutProof({
    env: baseEnv("prepare"),
    dependencies: {
      ...deps,
      createCanaryAccount: async (params) => {
        account = {
          charges_enabled: false,
          controller: canaryController(),
          id: ACCOUNT_ID,
          metadata: params.metadata,
          payouts_enabled: false,
        };
        return account;
      },
      retrieveAccount: async () => account,
      createOnboardingAccountLink: async (params) => {
        assert.deepEqual(params, buildCanaryAccountLinkParams(ACCOUNT_ID));
        return {
          expires_at: Math.floor(Date.now() / 1000) + 300,
          object: "account_link",
          url: "https://connect.stripe.com/setup/c/test_canary/one_time_token",
        };
      },
      writeOnboardingRecord: async (_config, payload) => { onboarding = payload; },
      createFundingCharge: async () => { fundingCalls += 1; },
      createPayout: async () => { payoutCalls += 1; },
      deleteAccount: async () => { deleted = true; },
    },
  });
  assert.equal(result.status, "onboarding-required");
  assert.equal(result.connectEndpointEnabled, false);
  assert.equal(fundingCalls, 0);
  assert.equal(payoutCalls, 0);
  assert.equal(deleted, false);
  assert.equal(onboarding.stripeAccountId, ACCOUNT_ID);
  assert.equal(onboarding.preparationAttemptId, ATTEMPT_ID);
  assert.match(onboarding.accountLinkUrl, /^https:\/\/connect\.stripe\.com\/setup\//);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /acct_disposable|connect\.stripe\.com|sk_test/);
  assert.deepEqual(deps.calls, []);
});

test("hosted-onboarding handoff is mode 0600 and an expired link can be replaced", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grainline-payout-onboarding-test-"));
  const handoffPath = path.join(directory, "grainline-stripe-connect-payout-hosted.json");
  const env = baseEnv("prepare", { STRIPE_CONNECT_PAYOUT_HANDOFF_PATH: handoffPath });
  const config = parseStripeConnectPayoutProofConfig(env);
  const deps = baseDependencies(config, 3);
  let account;
  let linkNumber = 0;
  try {
    const dependencies = {
      ...deps,
      createCanaryAccount: async (params) => {
        account = {
          charges_enabled: false,
          controller: canaryController(),
          id: ACCOUNT_ID,
          metadata: params.metadata,
          payouts_enabled: false,
        };
        return account;
      },
      retrieveAccount: async () => account,
      createOnboardingAccountLink: async () => {
        linkNumber += 1;
        return {
          expires_at: Math.floor(Date.now() / 1000) + 300,
          object: "account_link",
          url: `https://connect.stripe.com/setup/c/test_canary/link_${linkNumber}`,
        };
      },
    };
    const first = await runStripeConnectSignedPayoutProof({ env, dependencies });
    assert.equal(first.status, "onboarding-required");
    const onboardingPath = `${handoffPath}.onboarding`;
    assert.equal(statSync(onboardingPath).mode & 0o777, 0o600);
    const firstRecord = JSON.parse(readFileSync(onboardingPath, "utf8"));
    assert.match(firstRecord.accountLinkUrl, /link_1$/);
    writeFileSync(
      `${handoffPath}.attempt`,
      `${JSON.stringify(preparationAttempt(config), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    chmodSync(`${handoffPath}.attempt`, 0o600);

    const expired = {
      ...firstRecord,
      accountLinkExpiresAt: Math.floor(Date.now() / 1000) - 1,
    };
    writeFileSync(onboardingPath, `${JSON.stringify(expired, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(onboardingPath, 0o600);
    const second = await runStripeConnectSignedPayoutProof({ env, dependencies });
    assert.equal(second.status, "onboarding-required");
    const secondRecord = JSON.parse(readFileSync(onboardingPath, "utf8"));
    assert.match(secondRecord.accountLinkUrl, /link_2$/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("hosted-onboarding URL is redacted if a local persistence error echoes it", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const deps = baseDependencies(config, 3);
  let account;
  await assert.rejects(
    runStripeConnectSignedPayoutProof({
      env: baseEnv("prepare"),
      dependencies: {
        ...deps,
        createCanaryAccount: async (params) => {
          account = {
            charges_enabled: false,
            controller: canaryController(),
            id: ACCOUNT_ID,
            metadata: params.metadata,
            payouts_enabled: false,
          };
          return account;
        },
        retrieveAccount: async () => account,
        createOnboardingAccountLink: async () => ({
          expires_at: Math.floor(Date.now() / 1000) + 300,
          object: "account_link",
          url: "https://connect.stripe.com/setup/c/test_canary/one_time_token",
        }),
        writeOnboardingRecord: async () => {
          throw new Error(
            "write failed https://connect.stripe.com/setup/c/test_canary/one_time_token",
          );
        },
        deleteAccount: async () => ({ deleted: true, id: ACCOUNT_ID }),
      },
    }),
    (error) => {
      assert.match(error.message, /\[redacted-stripe-account-link\]/);
      assert.doesNotMatch(error.message, /one_time_token/);
      assert.match(error.message, /disposable account cleanup completed/);
      return true;
    },
  );
});

test("prepare resumes the same account after hosted onboarding and removes only its link", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const deps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  let onboardingRemoved = false;
  let evidence;
  const resumedAttempt = preparationAttempt(config, { startedSeconds: created - 5 });
  await runStripeConnectSignedPayoutProof({
    env: baseEnv("prepare"),
    dependencies: {
      ...deps,
      reserveOrResumePreparationAttempt: async () => resumedAttempt,
      createCanaryAccount: async () => { throw new Error("must resume the existing account"); },
      retrieveAccount: async () => ({
        charges_enabled: true,
        controller: canaryController(),
        id: ACCOUNT_ID,
        metadata: { grainline_provider_canary: marker(config) },
        payouts_enabled: true,
      }),
      readOnboardingRecord: async () => ({
        phase: "stripe-connect-disposable-payout-onboarding-handoff",
        status: "onboarding-required",
        commit: config.expectedCommit,
        ciRunId: config.ciRunId,
        deploymentId: config.deploymentId,
        marker: marker(config),
        preparationAttemptId: ATTEMPT_ID,
        stripeAccountId: ACCOUNT_ID,
        accountLinkUrl: "https://connect.stripe.com/setup/c/test_canary/one_time_token",
        accountLinkExpiresAt: Math.floor(Date.now() / 1000) + 300,
      }),
      removeOnboardingRecord: async () => { onboardingRemoved = true; },
      createFundingCharge: async () => ({ livemode: false, paid: true, status: "succeeded" }),
      retrieveBalance: async () => ({ available: [{ amount: 500, currency: "usd" }] }),
      createPayout: async () => ({ id: PAYOUT_ID, livemode: false }),
      retrievePayout: async () => failedPayout(),
      listPayoutFailedEvents: async () => [payoutEvent(created)],
      writeHandoff: async () => {},
      finalizeEvidence: async (_path, payload) => { evidence = payload; },
    },
  });
  assert.equal(onboardingRemoved, true);
  assert.equal(evidence.status, "passed");
});

test("prepare resumes the durable attempt instead of recreating a deleted-key source", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const deps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  let createCount = 0;
  let evidence;
  const resumedAttempt = preparationAttempt(config, { startedSeconds: created - 5 });
  await runStripeConnectSignedPayoutProof({
    env: baseEnv("prepare"),
    dependencies: {
      ...deps,
      reserveOrResumePreparationAttempt: async () => resumedAttempt,
      createCanaryAccount: async () => {
        createCount += 1;
        throw new Error("resumed attempt must not create another account");
      },
      retrieveAccount: async () => ({
        charges_enabled: true,
        controller: canaryController(),
        id: ACCOUNT_ID,
        livemode: false,
        metadata: { grainline_provider_canary: marker(config) },
        payouts_enabled: true,
      }),
      createFundingCharge: async () => ({ livemode: false, paid: true, status: "succeeded" }),
      retrieveBalance: async () => ({ available: [{ amount: 500, currency: "usd" }] }),
      createPayout: async () => ({ id: PAYOUT_ID, livemode: false }),
      retrievePayout: async () => failedPayout(),
      listPayoutFailedEvents: async () => [payoutEvent(created)],
      writeHandoff: async () => {},
      finalizeEvidence: async (_path, payload) => { evidence = payload; },
    },
  });
  assert.equal(createCount, 0);
  assert.equal(evidence.status, "passed");
});

test("failed account cleanup preserves the durable attempt for exact recovery", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const deps = baseDependencies(config, 3);
  let attemptRemoved = false;
  await assert.rejects(
    runStripeConnectSignedPayoutProof({
      env: baseEnv("prepare"),
      dependencies: {
        ...deps,
        createCanaryAccount: async (params) => ({
          charges_enabled: true,
          controller: canaryController(),
          id: ACCOUNT_ID,
          livemode: false,
          metadata: params.metadata,
          payouts_enabled: true,
        }),
        retrieveAccount: async () => ({
          charges_enabled: true,
          controller: canaryController(),
          id: ACCOUNT_ID,
          livemode: false,
          metadata: { grainline_provider_canary: marker(config) },
          payouts_enabled: true,
        }),
        createFundingCharge: async () => { throw new Error("funding failed"); },
        deleteAccount: async () => { throw new Error("cleanup failed"); },
        removePreparationAttempt: async () => { attemptRemoved = true; },
      },
    }),
    /funding failed; disposable account cleanup incomplete: cleanup failed/,
  );
  assert.equal(attemptRemoved, false);
});

test("prove enables, delivers, retries unchanged, deletes the canary and retains no raw IDs", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const deps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  let runtimeReads = 0;
  let resendCount = 0;
  let removed = false;
  let deleted = false;
  let evidence;
  let updatedHandoff;
  const result = await runStripeConnectSignedPayoutProof({
    env: baseEnv("prove"),
    dependencies: {
      ...deps,
      readHandoff: async () => preparedHandoff(config, created),
      retrieveAccount: async () => ({
        controller: canaryController(),
        id: ACCOUNT_ID,
        livemode: false,
        metadata: { grainline_provider_canary: marker(config) },
      }),
      retrievePayout: async () => failedPayout(),
      retrieveEvent: async () => payoutEvent(created),
      inspectRuntime: async () => runtimeReads++ === 0 ? beforeRuntime() : afterRuntime(),
      resendEvent: async () => { resendCount += 1; },
      delay: async () => {},
      deleteAccount: async () => {
        deleted = true;
        return { deleted: true, id: ACCOUNT_ID };
      },
      updateHandoff: async (_path, payload) => { updatedHandoff = payload; },
      removeHandoff: async () => { removed = true; },
      finalizeEvidence: async (_path, payload) => { evidence = payload; },
    },
  });
  assert.equal(result.status, "passed");
  assert.equal(resendCount, 2);
  assert.equal(deleted, true);
  assert.equal(removed, true);
  assert.equal(updatedHandoff.status, "delivery-verified");
  assert.deepEqual(updatedHandoff.delivery, {
    claimGeneration: 1,
    updatedEpoch: afterRuntime().updated_epoch,
  });
  assert.deepEqual(deps.calls, ["connect:enable"]);
  assert.doesNotMatch(JSON.stringify(evidence), /acct_disposable|po_disposable|evt_disposable|sk_test/);
  assert.equal(evidence.database.exactRetryLeftLeaseUnchanged, true);
});

test("restart from enabled stage and processed row performs only the exact replay", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const deps = baseDependencies(config, 4);
  const created = Math.floor(Date.now() / 1000);
  let resendCount = 0;
  await runStripeConnectSignedPayoutProof({
    env: baseEnv("prove"),
    dependencies: {
      ...deps,
      readHandoff: async () => preparedHandoff(config, created),
      retrieveAccount: async () => ({
        controller: canaryController(),
        id: ACCOUNT_ID,
        livemode: false,
        metadata: { grainline_provider_canary: marker(config) },
      }),
      retrievePayout: async () => failedPayout(),
      retrieveEvent: async () => payoutEvent(created),
      inspectRuntime: async () => afterRuntime(),
      resendEvent: async () => { resendCount += 1; },
      delay: async () => {},
      deleteAccount: async () => ({ deleted: true, id: ACCOUNT_ID }),
      removeHandoff: async () => {},
      finalizeEvidence: async (_path, payload) => payload,
    },
  });
  assert.equal(resendCount, 1);
  assert.deepEqual(deps.calls, []);
});

test("restart after verified delivery and account deletion resumes cleanup without another resend", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const deps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  const verified = {
    ...preparedHandoff(config, created),
    status: "delivery-verified",
    delivery: {
      claimGeneration: 1,
      updatedEpoch: afterRuntime().updated_epoch,
    },
  };
  let resendCount = 0;
  let deleteCount = 0;
  let removed = false;
  await runStripeConnectSignedPayoutProof({
    env: baseEnv("prove"),
    dependencies: {
      ...deps,
      readHandoff: async () => verified,
      retrieveAccount: async () => ({ deleted: true, id: ACCOUNT_ID }),
      retrievePayout: async () => { throw new Error("payout must not be re-read"); },
      retrieveEvent: async () => { throw new Error("event must not be re-read"); },
      inspectRuntime: async () => afterRuntime(),
      resendEvent: async () => { resendCount += 1; },
      deleteAccount: async () => { deleteCount += 1; },
      finalizeEvidence: async (_path, payload) => payload,
      removeHandoff: async () => { removed = true; },
    },
  });
  assert.equal(resendCount, 0);
  assert.equal(deleteCount, 0);
  assert.equal(removed, true);
  assert.deepEqual(deps.calls, ["connect:enable"]);
});

test("completed durable evidence resumes without touching Stripe source or database", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const firstDeps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  let evidence;
  await runStripeConnectSignedPayoutProof({
    env: baseEnv("prove"),
    dependencies: {
      ...firstDeps,
      readHandoff: async () => preparedHandoff(config, created),
      retrieveAccount: async () => ({
        controller: canaryController(),
        id: ACCOUNT_ID,
        livemode: false,
        metadata: { grainline_provider_canary: marker(config) },
      }),
      retrievePayout: async () => failedPayout(),
      retrieveEvent: async () => payoutEvent(created),
      inspectRuntime: async () => evidence ? afterRuntime() : afterRuntime(),
      resendEvent: async () => {},
      delay: async () => {},
      deleteAccount: async () => ({ deleted: true, id: ACCOUNT_ID }),
      removeHandoff: async () => {},
      finalizeEvidence: async (_path, payload) => { evidence = payload; },
    },
  });
  const resumeDeps = baseDependencies(config, 4);
  const result = await runStripeConnectSignedPayoutProof({
    env: baseEnv("prove"),
    dependencies: {
      ...resumeDeps,
      readExistingFinalEvidence: async () => evidence,
      retrieveAccount: async () => { throw new Error("source must not be read"); },
      inspectRuntime: async () => { throw new Error("database must not be read"); },
      resendEvent: async () => { throw new Error("event must not be resent"); },
    },
  });
  assert.equal(result, evidence);
  assert.deepEqual(resumeDeps.calls, []);
});

test("replay failure disables the endpoint and preserves the handoff for retry", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const deps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  let resendCount = 0;
  await assert.rejects(
    runStripeConnectSignedPayoutProof({
      env: baseEnv("prove"),
      dependencies: {
        ...deps,
        readHandoff: async () => preparedHandoff(config, created),
        retrieveAccount: async () => ({
          controller: canaryController(),
          id: ACCOUNT_ID,
          livemode: false,
          metadata: { grainline_provider_canary: marker(config) },
        }),
        retrievePayout: async () => failedPayout(),
        retrieveEvent: async () => payoutEvent(created),
        inspectRuntime: async () => resendCount === 0 ? beforeRuntime() : afterRuntime(),
        resendEvent: async () => {
          resendCount += 1;
          if (resendCount === 2) throw new Error("retry transport failed");
        },
        delay: async () => {},
      },
    }),
    /retry transport failed; Connect endpoint returned to disabled canonical stage 3/,
  );
  assert.deepEqual(deps.calls, ["connect:enable", "connect:disable"]);
});

test("ambiguous enable transport failure re-reads and disables the actual provider state", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const deps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  let enabled = false;
  const calls = [];
  await assert.rejects(
    runStripeConnectSignedPayoutProof({
      env: baseEnv("prove"),
      dependencies: {
        ...deps,
        listClassicEndpoints: async () => [
          platform(),
          {
            enabled_events: ["payout.failed"],
            id: CONNECT_ID,
            livemode: false,
            status: enabled ? "enabled" : "disabled",
            url: CONNECT_URL,
          },
        ],
        updateConnect: async (_id, params) => {
          enabled = !params.disabled;
          calls.push(enabled ? "connect:enable" : "connect:disable");
          if (enabled) throw new Error("enable response lost after provider mutation");
        },
        readHandoff: async () => preparedHandoff(config, created),
        retrieveAccount: async () => ({
          controller: canaryController(),
          id: ACCOUNT_ID,
          livemode: false,
          metadata: { grainline_provider_canary: marker(config) },
        }),
        retrievePayout: async () => failedPayout(),
        retrieveEvent: async () => payoutEvent(created),
        inspectRuntime: async () => beforeRuntime(),
      },
    }),
    /enable response lost after provider mutation; Connect endpoint returned to disabled canonical stage 3/,
  );
  assert.equal(enabled, false);
  assert.deepEqual(calls, ["connect:enable", "connect:disable"]);
});

test("ambiguous disable response is accepted only after a fresh stage-3 provider read", async () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prove"));
  const deps = baseDependencies(config, 3);
  const created = Math.floor(Date.now() / 1000);
  let enabled = false;
  let resendCount = 0;
  const calls = [];
  await assert.rejects(
    runStripeConnectSignedPayoutProof({
      env: baseEnv("prove"),
      dependencies: {
        ...deps,
        listClassicEndpoints: async () => [
          platform(),
          {
            enabled_events: ["payout.failed"],
            id: CONNECT_ID,
            livemode: false,
            status: enabled ? "enabled" : "disabled",
            url: CONNECT_URL,
          },
        ],
        updateConnect: async (_id, params) => {
          enabled = !params.disabled;
          calls.push(enabled ? "connect:enable" : "connect:disable");
          if (!enabled) throw new Error("disable response lost after provider mutation");
        },
        readHandoff: async () => preparedHandoff(config, created),
        retrieveAccount: async () => ({
          controller: canaryController(),
          id: ACCOUNT_ID,
          livemode: false,
          metadata: { grainline_provider_canary: marker(config) },
        }),
        retrievePayout: async () => failedPayout(),
        retrieveEvent: async () => payoutEvent(created),
        inspectRuntime: async () => resendCount === 0 ? beforeRuntime() : afterRuntime(),
        resendEvent: async () => {
          resendCount += 1;
          if (resendCount === 2) throw new Error("retry transport failed");
        },
        delay: async () => {},
      },
    }),
    /retry transport failed; Connect endpoint returned to disabled canonical stage 3/,
  );
  assert.equal(enabled, false);
  assert.deepEqual(calls, ["connect:enable", "connect:disable"]);
});

test("package and durable docs keep preparation, enable and cleanup separate", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["ops:stripe-connect-signed-payout-proof"],
    "node scripts/stripe-connect-signed-payout-proof.mjs",
  );
  const docs = readFileSync("docs/stripe-connect-provider-cutover-operator.md", "utf8");
  const normalizedDocs = docs.replace(/\s+/g, " ");
  assert.match(normalizedDocs, /fresh disposable test connected account/);
  assert.match(docs, /exact retry/);
  assert.match(docs, /disabled canonical stage 3/);
  const source = readFileSync("scripts/stripe-connect-signed-payout-proof.mjs", "utf8");
  assert.match(source, /randomUUID\(\)/);
  assert.match(source, /connect-disable/);
  assert.match(source, /connect-enable/);
  assert.match(source, /preparationAttemptId/);
  assert.match(source, /preparationAttemptIdSha256/);
  assert.match(source, /payout source mutation requires a durable preparation attempt/);
  assert.doesNotMatch(source, /connect-enable-disable/);
  assert.doesNotMatch(
    source,
    /config\.expectedCommit\}-\$\{config\.ciRunId\}-\$\{key\}/,
  );
  assert.doesNotMatch(source, /cliEnvironment\s*=\s*\{\s*\.\.\.process\.env/);
});

test("retained payout preparation evidence remains exact and secret-free", () => {
  const retainedConfig = {
    ciRunId: "31357207924",
    cutoverCiRunId: "31339275512",
    cutoverCommit: "abd49d703ec37349c84b0c70912ffb655faac5e3",
    deploymentId: DEPLOYMENT_ID,
    expectedCommit: "0b718171e71700990bf8f9106ee880b116707bd3",
  };
  const cutoverPath =
    "archive/stripe-connect-provider-cutover-test-20260809-abd49d70.json";
  const preparationPath =
    "archive/stripe-connect-disposable-payout-preparation-test-20260810-0b718171.json";
  const cutoverSource = readFileSync(cutoverPath, "utf8");
  const preparationSource = readFileSync(preparationPath, "utf8");

  assert.equal(
    createHash("sha256").update(cutoverSource).digest("hex"),
    "3e0fd8a53d2f9870e270c5751dc53edbd9868fac956268781ce6c3ef829b41a8",
  );
  assert.equal(
    createHash("sha256").update(preparationSource).digest("hex"),
    "d0b05d3f131eb64ca5b55eee9a283d8089a310ecb8c05cc92e60964cd83f0077",
  );
  assertCutoverEvidence(JSON.parse(cutoverSource), retainedConfig);
  assertPreparationEvidence(JSON.parse(preparationSource), retainedConfig);
  assert.doesNotMatch(
    `${cutoverSource}\n${preparationSource}`,
    /(?:sk_(?:test|live)_|whsec_|acct_|po_|evt_|https:\/\/connect\.stripe\.com\/setup\/)/,
  );
});
