import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PLATFORM_PREDECESSOR_EVENTS,
  PLATFORM_REVIEWED_EVENTS,
  V2_PREDECESSOR_EVENTS,
  V2_REVIEWED_EVENTS,
  assertBootstrapEvidence,
  assertDeploymentEvidence,
  classifyConnectEndpoint,
  classifyPlatformEndpoint,
  classifyProviderStage,
  classifyV2Destination,
  parseStripeConnectCutoverConfig,
  runStripeConnectProviderCutover,
} from "../scripts/stripe-connect-provider-cutover.mjs";

const COMMIT = "a".repeat(40);
const CI_RUN = "31332163585";
const DEPLOYMENT_ID = "dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP";
const PLATFORM_URL = "https://thegrainline.com/api/stripe/webhook";
const BOOTSTRAP_URL =
  "https://thegrainline.com/api/stripe/webhook/connect-bootstrap-disabled";
const CONNECT_URL = "https://thegrainline.com/api/stripe/webhook/connect";
const V2_URL = "https://thegrainline.com/api/stripe/webhook/v2";
const CONNECT_ID = "we_test_connect";
const CONNECT_DIGEST = createHash("sha256").update(CONNECT_ID).digest("hex");

function baseEnv(overrides = {}) {
  return {
    STRIPE_CONNECT_CUTOVER_MODE: "cutover",
    STRIPE_CONNECT_CUTOVER_CONFIRM: "execute-test-connect-provider-cutover",
    STRIPE_CONNECT_CUTOVER_EXPECTED_COMMIT: COMMIT,
    STRIPE_CONNECT_CUTOVER_CI_RUN_ID: CI_RUN,
    STRIPE_CONNECT_CUTOVER_DEPLOYMENT_ID: DEPLOYMENT_ID,
    STRIPE_CONNECT_CUTOVER_VERCEL_PROJECT_DIRECTORY: "/reviewed/grainline",
    STRIPE_CONNECT_CUTOVER_EVIDENCE_PATH:
      `archive/stripe-connect-provider-cutover-test-${COMMIT}.json`,
    STRIPE_SECRET_KEY: "sk_test_fixture_not_a_secret",
    ...overrides,
  };
}

function platform(reviewed = false) {
  return {
    enabled_events: reviewed ? PLATFORM_REVIEWED_EVENTS : PLATFORM_PREDECESSOR_EVENTS,
    id: "we_platform",
    livemode: false,
    status: "enabled",
    url: PLATFORM_URL,
  };
}

function connect(state = "bootstrap-disabled", id = CONNECT_ID) {
  return {
    enabled_events: ["payout.failed"],
    id,
    livemode: false,
    status: state === "canonical-enabled" ? "enabled" : "disabled",
    url: state === "bootstrap-disabled" ? BOOTSTRAP_URL : CONNECT_URL,
  };
}

function v2(reviewed = false) {
  return {
    enabled_events: reviewed ? V2_REVIEWED_EVENTS : V2_PREDECESSOR_EVENTS,
    event_payload: "thin",
    events_from: ["other_accounts"],
    id: "ed_v2",
    livemode: false,
    status: "enabled",
    type: "webhook_endpoint",
    webhook_endpoint: { url: V2_URL },
  };
}

function bootstrapEvidence() {
  return {
    phase: "stripe-connect-disabled-bootstrap",
    status: "passed",
    mode: "test",
    commit: "eda20f6f18d08d194b0a44a7414510e3c3a9ef58",
    stripe: {
      endpointIdSha256:
        "ad8e20cc2af6c378350f4a181252df03eb34a2a15571ad162a21fb2d90063357",
      url: BOOTSTRAP_URL,
      status: "disabled",
      livemode: false,
      enabledEvents: ["payout.failed"],
      connectedAccountSourceRequestedAtCreation: true,
      signingSecretPersistedInEvidence: false,
    },
  };
}

function deploymentEvidence() {
  return {
    phase: "stripe-connect-compatible-production-deployment",
    status: "passed",
    commit: "69c14c0618ea7ab9c74756422273d17d66db7efa",
    deployment: {
      id: DEPLOYMENT_ID,
      readyState: "READY",
      target: "production",
    },
    http: {
      canonicalHomepageStatus: 200,
      canonicalHealthStatus: 200,
    },
    stripe: {
      endpointIdSha256:
        "ad8e20cc2af6c378350f4a181252df03eb34a2a15571ad162a21fb2d90063357",
      status: "disabled",
      url: BOOTSTRAP_URL,
    },
  };
}

function localDependencies() {
  return {
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
    readBootstrapEvidence: async () => bootstrapEvidence(),
    readDeploymentEvidence: async () => deploymentEvidence(),
    readHomepage: async () => ({
      body: `<script src="/_next/app.js?dpl=${DEPLOYMENT_ID}"></script>`,
      status: 200,
    }),
    readHealth: async () => ({ body: { ok: true }, status: 200 }),
  };
}

function mutableProvider(initialStage = 0, options = {}) {
  const calls = [];
  let platformRow = platform(initialStage >= 1);
  let v2Row = v2(initialStage >= 2);
  let connectRow = connect(
    initialStage >= 4
      ? "canonical-enabled"
      : initialStage >= 3
        ? "canonical-disabled"
        : "bootstrap-disabled",
  );
  return {
    calls,
    reviewedConnectEndpointDigest: CONNECT_DIGEST,
    listClassicEndpoints: async () => [platformRow, connectRow],
    listV2Destinations: async () => [v2Row],
    updatePlatform: async (id, events) => {
      assert.equal(id, platformRow.id);
      calls.push(`platform:${events === PLATFORM_REVIEWED_EVENTS ? "reviewed" : "predecessor"}`);
      if (options.failPlatform) throw new Error("platform transport failed");
      platformRow = { ...platformRow, enabled_events: [...events] };
    },
    updateV2: async (id, events) => {
      assert.equal(id, v2Row.id);
      calls.push(`v2:${events === V2_REVIEWED_EVENTS ? "reviewed" : "predecessor"}`);
      if (options.failV2 && events === V2_REVIEWED_EVENTS) throw new Error("v2 transport failed");
      v2Row = { ...v2Row, enabled_events: [...events] };
    },
    updateConnect: async (id, params, stage) => {
      assert.equal(id, connectRow.id);
      calls.push(`connect:${stage}`);
      connectRow = {
        ...connectRow,
        enabled_events: [...params.enabled_events],
        status: params.disabled ? "disabled" : "enabled",
        url: params.url,
      };
      if (options.failCanonical && stage === "connect-canonical-disabled") {
        throw new Error("canonical transport ended after request");
      }
    },
  };
}

test("configuration is test-mode, exact-main and explicit-confirmation bound", () => {
  const config = parseStripeConnectCutoverConfig(baseEnv());
  assert.equal(config.mode, "cutover");
  assert.equal(config.deploymentId, DEPLOYMENT_ID);
  assert.throws(
    () => parseStripeConnectCutoverConfig(baseEnv({ STRIPE_SECRET_KEY: "sk_live_no" })),
    /requires an explicit Stripe test key/,
  );
  assert.throws(
    () => parseStripeConnectCutoverConfig(baseEnv({ STRIPE_CONNECT_CUTOVER_CONFIRM: "yes" })),
    /execute-test-connect-provider-cutover/,
  );
  assert.throws(
    () => parseStripeConnectCutoverConfig(baseEnv({
      STRIPE_CONNECT_CUTOVER_EVIDENCE_PATH: "../outside.json",
    })),
    /under archive/,
  );
});

test("retained bootstrap and deployment evidence remain exact", () => {
  const config = parseStripeConnectCutoverConfig(baseEnv());
  assert.doesNotThrow(() => assertBootstrapEvidence(bootstrapEvidence()));
  assert.doesNotThrow(() => assertDeploymentEvidence(deploymentEvidence(), config));
  assert.throws(
    () => assertBootstrapEvidence({ ...bootstrapEvidence(), mode: "live" }),
    /bootstrap evidence drifted/,
  );
  assert.throws(
    () => assertDeploymentEvidence({
      ...deploymentEvidence(),
      deployment: { ...deploymentEvidence().deployment, id: "dpl_other" },
    }, config),
    /deployment evidence drifted/,
  );
});

test("only the five monotonic provider stages classify", () => {
  const stages = [
    [platform(false), v2(false), connect("bootstrap-disabled")],
    [platform(true), v2(false), connect("bootstrap-disabled")],
    [platform(true), v2(true), connect("bootstrap-disabled")],
    [platform(true), v2(true), connect("canonical-disabled")],
    [platform(true), v2(true), connect("canonical-enabled")],
  ];
  stages.forEach(([platformRow, v2Row, connectRow], index) => {
    assert.equal(classifyProviderStage({
      platform: platformRow,
      v2: v2Row,
      connect: connectRow,
    }, CONNECT_DIGEST), index);
  });
  assert.throws(
    () => classifyProviderStage({
      platform: platform(false),
      v2: v2(true),
      connect: connect("bootstrap-disabled"),
    }, CONNECT_DIGEST),
    /illegal cutover state/,
  );
});

test("object classifiers reject expanded events, scope drift and the wrong Connect ID", () => {
  assert.equal(classifyPlatformEndpoint(platform(false)), "predecessor");
  assert.equal(classifyV2Destination(v2(true)), "reviewed");
  assert.equal(
    classifyConnectEndpoint(connect("bootstrap-disabled"), CONNECT_DIGEST),
    "bootstrap-disabled",
  );
  assert.throws(
    () => classifyPlatformEndpoint({
      ...platform(false),
      enabled_events: [...PLATFORM_PREDECESSOR_EVENTS, "*"] ,
    }),
    /neither predecessor nor reviewed/,
  );
  assert.throws(
    () => classifyV2Destination({ ...v2(false), events_from: ["self"] }),
    /topology drifted/,
  );
  assert.throws(
    () => classifyConnectEndpoint(connect("bootstrap-disabled", CONNECT_ID)),
    /does not match retained bootstrap evidence/,
  );
});

test("read-only preflight proves predecessor state without provider writes", async () => {
  const provider = mutableProvider(0);
  const result = await runStripeConnectProviderCutover({
    env: baseEnv({
      STRIPE_CONNECT_CUTOVER_MODE: "preflight",
      STRIPE_CONNECT_CUTOVER_CONFIRM: "inspect-test-connect-provider-cutover",
    }),
    dependencies: { ...localDependencies(), ...provider },
  });
  assert.equal(result.status, "passed");
  assert.equal(result.providerStage, 0);
  assert.deepEqual(provider.calls, []);
});

test("cutover reaches all stages in order and emits only hashed identities", async () => {
  const provider = mutableProvider(0);
  const journal = [];
  let evidence;
  const result = await runStripeConnectProviderCutover({
    env: baseEnv(),
    dependencies: {
      ...localDependencies(),
      ...provider,
      reserveOrResumeEvidence: () => "/tmp/test-cutover.pending",
      updatePending: (_path, _config, stage) => journal.push(stage),
      finalizeEvidence: (_pending, config, state) => {
        evidence = {
          phase: "stripe-connect-provider-cutover",
          status: "passed",
          commit: config.expectedCommit,
          providerStage: state.stage,
          platformDigest: "hashed",
          connectDigest: "hashed",
          v2Digest: "hashed",
        };
        return evidence;
      },
    },
  });
  assert.equal(result.providerStage, 3);
  assert.deepEqual(journal, [0, 1, 2, 3]);
  assert.deepEqual(provider.calls, [
    "platform:reviewed",
    "v2:reviewed",
    "connect:connect-canonical-disabled",
  ]);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /we_platform|we_1Rs|ed_v2|sk_test|whsec/);
});

test("restart from stage 2 skips completed writes and converges forward", async () => {
  const provider = mutableProvider(2);
  await runStripeConnectProviderCutover({
    env: baseEnv(),
    dependencies: {
      ...localDependencies(),
      ...provider,
      reserveOrResumeEvidence: () => "/tmp/test-cutover-resume.pending",
      updatePending: () => {},
      finalizeEvidence: (_pending, _config, state) => ({ status: "passed", providerStage: state.stage }),
    },
  });
  assert.deepEqual(provider.calls, [
    "connect:connect-canonical-disabled",
  ]);
});

test("ambiguous canonical update failure rolls exact provider state back in reverse order", async () => {
  const provider = mutableProvider(0, { failCanonical: true });
  await assert.rejects(
    runStripeConnectProviderCutover({
      env: baseEnv(),
      dependencies: {
        ...localDependencies(),
        ...provider,
        reserveOrResumeEvidence: () => "/tmp/nonexistent-cutover.pending",
        updatePending: () => {},
      },
    }),
    /canonical transport ended after request; provider rollback completed/,
  );
  assert.deepEqual(provider.calls, [
    "platform:reviewed",
    "v2:reviewed",
    "connect:connect-canonical-disabled",
    "connect:rollback-connect-bootstrap-disabled",
    "v2:predecessor",
    "platform:predecessor",
  ]);
});

test("durable records retain the signed-delivery boundary", () => {
  const topology = readFileSync("docs/stripe-webhook-provider-topology-audit.md", "utf8");
  assert.match(
    topology.replace(/\s+/g, " "),
    /provider-authenticated delivery plus exact[- ]retry/,
  );
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["ops:stripe-connect-provider-cutover"],
    "node scripts/stripe-connect-provider-cutover.mjs",
  );
  const source = readFileSync("scripts/stripe-connect-provider-cutover.mjs", "utf8");
  assert.match(source, /randomUUID\(\)/);
  assert.match(source, /options\(stage\)/);
  assert.match(source, /rollback-v2-predecessor/);
  assert.match(source, /rollback-platform-predecessor/);
  assert.doesNotMatch(source, /options\("(?:platform|v2)-events"\)/);
  assert.doesNotMatch(source, /env:\s*process\.env/);
});
