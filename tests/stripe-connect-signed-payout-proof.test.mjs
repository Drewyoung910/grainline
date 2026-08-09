import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PLATFORM_REVIEWED_EVENTS,
  V2_REVIEWED_EVENTS,
} from "../scripts/stripe-connect-provider-cutover.mjs";
import {
  assertCanaryAccount,
  assertCutoverEvidence,
  assertFailedPayout,
  assertPayoutEvent,
  buildCanaryAccountParams,
  parseStripeConnectPayoutProofConfig,
  runStripeConnectSignedPayoutProof,
} from "../scripts/stripe-connect-signed-payout-proof.mjs";

const COMMIT = "b".repeat(40);
const CI_RUN = "31340000001";
const DEPLOYMENT_ID = "dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP";
const CONNECT_URL = "https://thegrainline.com/api/stripe/webhook/connect";
const V2_URL = "https://thegrainline.com/api/stripe/webhook/v2";
const ACCOUNT_ID = "acct_disposable_test";
const PAYOUT_ID = "po_disposable_test";
const EVENT_ID = "evt_disposable_test";
const CONNECT_ID = "we_disposable_test";
const CONNECT_DIGEST = createHash("sha256").update(CONNECT_ID).digest("hex");
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
    STRIPE_CONNECT_PAYOUT_PROOF_DEPLOYMENT_ID: DEPLOYMENT_ID,
    STRIPE_CONNECT_PAYOUT_PROOF_VERCEL_PROJECT_DIRECTORY: "/reviewed/grainline",
    STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_EVIDENCE_PATH:
      `archive/stripe-connect-provider-cutover-test-${COMMIT}.json`,
    STRIPE_CONNECT_PAYOUT_PROOF_EVIDENCE_PATH:
      `archive/stripe-connect-payout-${mode}-test-${COMMIT}.json`,
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

function cutoverEvidence(config) {
  return {
    phase: "stripe-connect-provider-cutover",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    ciRunId: config.ciRunId,
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
    /must not overwrite provider cutover evidence/,
  );
});

test("cutover evidence remains bound to disabled canonical stage 3", () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  assert.doesNotThrow(() => assertCutoverEvidence(cutoverEvidence(config), config));
  assert.throws(
    () => assertCutoverEvidence({
      ...cutoverEvidence(config),
      providerStage: 4,
    }, config),
    /disabled-canonical predecessor/,
  );
});

test("canary source derives its marker and uses the documented failing bank", () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const params = buildCanaryAccountParams(config, new Date("2026-08-09T00:00:00Z"));
  assert.equal(params.type, "custom");
  assert.equal(params.external_account.routing_number, "110000000");
  assert.equal(params.external_account.account_number, "000111111116");
  assert.equal(params.settings.payouts.schedule.interval, "manual");
  assert.equal(params.metadata.grainline_provider_canary, marker(config));
});

test("source validators reject account, payout and event mismatches", () => {
  const config = parseStripeConnectPayoutProofConfig(baseEnv("prepare"));
  const account = {
    id: ACCOUNT_ID,
    livemode: false,
    metadata: { grainline_provider_canary: marker(config) },
  };
  assert.equal(assertCanaryAccount(account, config).id, ACCOUNT_ID);
  assert.equal(assertFailedPayout(failedPayout(), ACCOUNT_ID).id, PAYOUT_ID);
  const created = Math.floor(Date.now() / 1000);
  assert.equal(assertPayoutEvent(payoutEvent(created), ACCOUNT_ID, PAYOUT_ID, created).id, EVENT_ID);
  assert.throws(
    () => assertCanaryAccount({ ...account, livemode: true }, config),
    /identity or metadata drifted/,
  );
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
  assert.doesNotMatch(source, /connect-enable-disable/);
  assert.doesNotMatch(source, /cliEnvironment\s*=\s*\{\s*\.\.\.process\.env/);
});
