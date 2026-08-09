#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSensitiveProductionVariable,
} from "./stripe-connect-webhook-bootstrap.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "Drewyoung910/grainline";
const STRIPE_API_VERSION = "2026-02-25.clover";
const VERCEL_CLI_VERSION = "58.9.0";
const PLATFORM_URL = "https://thegrainline.com/api/stripe/webhook";
const CONNECT_BOOTSTRAP_URL =
  "https://thegrainline.com/api/stripe/webhook/connect-bootstrap-disabled";
const CONNECT_CANONICAL_URL =
  "https://thegrainline.com/api/stripe/webhook/connect";
const V2_URL = "https://thegrainline.com/api/stripe/webhook/v2";
const HEALTH_URL = "https://thegrainline.com/api/health";
const BOOTSTRAP_EVIDENCE = path.join(
  ROOT_DIR,
  "archive/stripe-connect-disabled-bootstrap-test-20260809-eda20f6f.json",
);
const DEPLOYMENT_EVIDENCE = path.join(
  ROOT_DIR,
  "archive/stripe-connect-compatible-production-deployment-20260809.json",
);
const REVIEWED_CONNECT_ENDPOINT_DIGEST =
  "ad8e20cc2af6c378350f4a181252df03eb34a2a15571ad162a21fb2d90063357";
const REVIEWED_BOOTSTRAP_COMMIT =
  "eda20f6f18d08d194b0a44a7414510e3c3a9ef58";
const REVIEWED_DEPLOYMENT_COMMIT =
  "69c14c0618ea7ab9c74756422273d17d66db7efa";
const VERCEL_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  projectName: "grainline",
});

export const PLATFORM_PREDECESSOR_EVENTS = Object.freeze([
  "charge.succeeded",
  "charge.updated",
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.created",
  "payment_intent.succeeded",
].sort());

export const PLATFORM_REVIEWED_EVENTS = Object.freeze([
  "charge.dispute.closed",
  "charge.dispute.created",
  "charge.dispute.funds_reinstated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.updated",
  "charge.refunded",
  "checkout.session.async_payment_failed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "checkout.session.expired",
].sort());

export const V2_PREDECESSOR_EVENTS = Object.freeze([
  "v2.core.account.closed",
  "v2.core.account.created",
  "v2.core.account.updated",
  "v2.core.account[configuration.customer].capability_status_updated",
  "v2.core.account[configuration.customer].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[defaults].updated",
  "v2.core.account[identity].updated",
  "v2.core.account[requirements].updated",
  "v2.core.account_person.created",
  "v2.core.account_person.deleted",
  "v2.core.account_person.updated",
].sort());

export const V2_REVIEWED_EVENTS = Object.freeze(
  V2_PREDECESSOR_EVENTS.filter((event) =>
    !event.startsWith("v2.core.account_person.")
  ),
);

const CONNECT_EVENTS = Object.freeze(["payout.failed"]);
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const STRIPE_SECRET_PATTERN =
  /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]");
}

function safeError(error) {
  return redact(error instanceof Error ? error.message || error.name : error);
}

function childProcessEnvironment(extra = {}) {
  const environment = {};
  for (const key of [
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TMPDIR",
    "USER",
  ]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function evidencePath(env) {
  const raw = required(env, "STRIPE_CONNECT_CUTOVER_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("evidence path contains a null byte");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (
    !resolved.startsWith(`${path.join(ROOT_DIR, "archive")}${path.sep}`)
    || path.extname(resolved) !== ".json"
  ) {
    throw new Error("cutover evidence must be one JSON file under archive/");
  }
  return resolved;
}

export function parseStripeConnectCutoverConfig(env = process.env) {
  const mode = required(env, "STRIPE_CONNECT_CUTOVER_MODE");
  if (!new Set(["preflight", "cutover"]).has(mode)) {
    throw new Error("STRIPE_CONNECT_CUTOVER_MODE must be preflight or cutover");
  }
  const expectedConfirmation = mode === "preflight"
    ? "inspect-test-connect-provider-cutover"
    : "execute-test-connect-provider-cutover";
  if (env.STRIPE_CONNECT_CUTOVER_CONFIRM !== expectedConfirmation) {
    throw new Error(`STRIPE_CONNECT_CUTOVER_CONFIRM=${expectedConfirmation} is required`);
  }
  const secretKey = required(env, "STRIPE_SECRET_KEY");
  if (!/^sk_test_[A-Za-z0-9_]+$/.test(secretKey)) {
    throw new Error("the current cutover release requires an explicit Stripe test key");
  }
  const expectedCommit = required(env, "STRIPE_CONNECT_CUTOVER_EXPECTED_COMMIT");
  const ciRunId = required(env, "STRIPE_CONNECT_CUTOVER_CI_RUN_ID");
  const deploymentId = required(env, "STRIPE_CONNECT_CUTOVER_DEPLOYMENT_ID");
  if (!COMMIT_PATTERN.test(expectedCommit)) {
    throw new Error("expected commit must be a lowercase full SHA");
  }
  if (!RUN_ID_PATTERN.test(ciRunId)) {
    throw new Error("CI run ID must be a positive integer");
  }
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) {
    throw new Error("deployment ID is invalid");
  }
  const vercelProjectDirectory = path.resolve(
    required(env, "STRIPE_CONNECT_CUTOVER_VERCEL_PROJECT_DIRECTORY"),
  );
  return Object.freeze({
    ciRunId,
    deploymentId,
    evidencePath: mode === "cutover" ? evidencePath(env) : null,
    expectedCommit,
    mode,
    secretKey,
    vercelProjectDirectory,
  });
}

function sorted(values) {
  return [...new Set(values ?? [])].sort();
}

function sameValues(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(expected);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function assertUnique(rows, label) {
  if (rows.length !== 1) {
    throw new Error(`${label} expected exactly one provider object, received ${rows.length}`);
  }
  return rows[0];
}

function assertClassicBase(endpoint, url, label) {
  if (
    !endpoint
    || typeof endpoint.id !== "string"
    || endpoint.url !== url
    || endpoint.livemode !== false
  ) {
    throw new Error(`${label} identity or test-mode posture drifted`);
  }
}

export function classifyPlatformEndpoint(endpoint) {
  assertClassicBase(endpoint, PLATFORM_URL, "platform webhook");
  if (endpoint.status !== "enabled") {
    throw new Error("platform webhook must remain enabled");
  }
  if (sameValues(endpoint.enabled_events, PLATFORM_PREDECESSOR_EVENTS)) return "predecessor";
  if (sameValues(endpoint.enabled_events, PLATFORM_REVIEWED_EVENTS)) return "reviewed";
  throw new Error("platform webhook event set is neither predecessor nor reviewed");
}

export function classifyConnectEndpoint(
  endpoint,
  reviewedDigest = REVIEWED_CONNECT_ENDPOINT_DIGEST,
) {
  if (endpoint?.livemode !== false || typeof endpoint?.id !== "string") {
    throw new Error("Connect webhook identity or test-mode posture drifted");
  }
  if (sha256(endpoint.id) !== reviewedDigest) {
    throw new Error("Connect webhook ID does not match retained bootstrap evidence");
  }
  if (!sameValues(endpoint.enabled_events, CONNECT_EVENTS)) {
    throw new Error("Connect webhook event set drifted from payout.failed");
  }
  if (endpoint.url === CONNECT_BOOTSTRAP_URL && endpoint.status === "disabled") {
    return "bootstrap-disabled";
  }
  if (endpoint.url === CONNECT_CANONICAL_URL && endpoint.status === "disabled") {
    return "canonical-disabled";
  }
  if (endpoint.url === CONNECT_CANONICAL_URL && endpoint.status === "enabled") {
    return "canonical-enabled";
  }
  throw new Error("Connect webhook is outside the exact restart-safe states");
}

export function classifyV2Destination(destination) {
  if (
    !destination
    || typeof destination.id !== "string"
    || destination.type !== "webhook_endpoint"
    || destination.webhook_endpoint?.url !== V2_URL
    || destination.status !== "enabled"
    || destination.livemode !== false
    || destination.event_payload !== "thin"
    || !sameValues(destination.events_from, ["other_accounts"])
  ) {
    throw new Error("v2 Connect destination topology drifted");
  }
  if (sameValues(destination.enabled_events, V2_PREDECESSOR_EVENTS)) return "predecessor";
  if (sameValues(destination.enabled_events, V2_REVIEWED_EVENTS)) return "reviewed";
  throw new Error("v2 Connect destination event set is neither predecessor nor reviewed");
}

export function classifyProviderStage(
  { platform, connect, v2 },
  reviewedConnectDigest = REVIEWED_CONNECT_ENDPOINT_DIGEST,
) {
  const key = [
    classifyPlatformEndpoint(platform),
    classifyV2Destination(v2),
    classifyConnectEndpoint(connect, reviewedConnectDigest),
  ].join("|");
  const stages = new Map([
    ["predecessor|predecessor|bootstrap-disabled", 0],
    ["reviewed|predecessor|bootstrap-disabled", 1],
    ["reviewed|reviewed|bootstrap-disabled", 2],
    ["reviewed|reviewed|canonical-disabled", 3],
    ["reviewed|reviewed|canonical-enabled", 4],
  ]);
  if (!stages.has(key)) {
    throw new Error(`provider objects form an illegal cutover state: ${key}`);
  }
  return stages.get(key);
}

async function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") {
    return listPromise.autoPagingToArray({ limit: 1000 });
  }
  const rows = [];
  for await (const row of listPromise) rows.push(row);
  return rows;
}

export async function readProviderState(deps) {
  const classic = await deps.listClassicEndpoints();
  const platform = assertUnique(
    classic.filter((row) => row?.url === PLATFORM_URL),
    "platform webhook",
  );
  const connect = assertUnique(
    classic.filter((row) =>
      row?.url === CONNECT_BOOTSTRAP_URL || row?.url === CONNECT_CANONICAL_URL
    ),
    "classic Connect webhook",
  );
  const v2 = assertUnique(
    (await deps.listV2Destinations()).filter((row) =>
      row?.webhook_endpoint?.url === V2_URL
    ),
    "v2 Connect destination",
  );
  return Object.freeze({
    connect,
    platform,
    stage: classifyProviderStage(
      { connect, platform, v2 },
      deps.reviewedConnectEndpointDigest ?? REVIEWED_CONNECT_ENDPOINT_DIGEST,
    ),
    v2,
  });
}

function normalizeVercelProject(project) {
  for (const [key, expected] of Object.entries(VERCEL_PROJECT)) {
    if (project?.[key] !== expected) {
      throw new Error("linked Vercel project is not the reviewed Grainline project");
    }
  }
}

function assertExactCiRun(run, config) {
  if (
    run?.conclusion !== "success"
    || run?.event !== "push"
    || run?.headBranch !== "main"
    || run?.headSha !== config.expectedCommit
    || run?.workflowName !== "CI"
  ) {
    throw new Error("GitHub run is not successful exact-main CI for the reviewed commit");
  }
}

export function assertBootstrapEvidence(payload) {
  if (
    payload?.phase !== "stripe-connect-disabled-bootstrap"
    || payload?.status !== "passed"
    || payload?.mode !== "test"
    || payload?.commit !== REVIEWED_BOOTSTRAP_COMMIT
    || payload?.stripe?.endpointIdSha256 !== REVIEWED_CONNECT_ENDPOINT_DIGEST
    || payload?.stripe?.url !== CONNECT_BOOTSTRAP_URL
    || payload?.stripe?.status !== "disabled"
    || payload?.stripe?.livemode !== false
    || !sameValues(payload?.stripe?.enabledEvents, CONNECT_EVENTS)
    || payload?.stripe?.connectedAccountSourceRequestedAtCreation !== true
    || payload?.stripe?.signingSecretPersistedInEvidence !== false
  ) {
    throw new Error("retained Connect bootstrap evidence drifted");
  }
}

export function assertDeploymentEvidence(payload, config) {
  if (
    payload?.phase !== "stripe-connect-compatible-production-deployment"
    || payload?.status !== "passed"
    || payload?.commit !== REVIEWED_DEPLOYMENT_COMMIT
    || payload?.deployment?.id !== config.deploymentId
    || payload?.deployment?.readyState !== "READY"
    || payload?.deployment?.target !== "production"
    || payload?.http?.canonicalHomepageStatus !== 200
    || payload?.http?.canonicalHealthStatus !== 200
    || payload?.stripe?.endpointIdSha256 !== REVIEWED_CONNECT_ENDPOINT_DIGEST
    || payload?.stripe?.status !== "disabled"
    || payload?.stripe?.url !== CONNECT_BOOTSTRAP_URL
  ) {
    throw new Error("retained compatible production deployment evidence drifted");
  }
}

async function assertPublicDeployment(deps, config) {
  const homepage = await deps.readHomepage();
  if (homepage.status !== 200 || !homepage.body.includes(`dpl=${config.deploymentId}`)) {
    throw new Error("canonical homepage is not bound to the reviewed deployment");
  }
  const health = await deps.readHealth();
  if (health.status !== 200 || health.body?.ok !== true) {
    throw new Error("canonical health route is not healthy");
  }
}

function defaultCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT_DIR,
    encoding: "utf8",
    env: options.env ?? childProcessEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${options.label ?? command} failed with exit ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

async function fetchCiRun(config) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "grainline-stripe-connect-cutover",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/actions/runs/${config.ciRunId}`,
    { headers, redirect: "error", signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`GitHub CI lookup failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (Number(payload?.id) !== Number(config.ciRunId) || payload?.repository?.full_name !== REPOSITORY) {
    throw new Error("GitHub CI lookup returned a different run or repository");
  }
  return {
    conclusion: payload.conclusion,
    event: payload.event,
    headBranch: payload.head_branch,
    headSha: payload.head_sha,
    workflowName: payload.name,
  };
}

function createLocalDependencies(config) {
  return {
    currentGitState() {
      const run = (args) => execFileSync("git", args, {
        cwd: ROOT_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return {
        head: run(["rev-parse", "HEAD"]),
        status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
      };
    },
    ciRun: () => fetchCiRun(config),
    readBootstrapEvidence: () => JSON.parse(readFileSync(BOOTSTRAP_EVIDENCE, "utf8")),
    readDeploymentEvidence: () => JSON.parse(readFileSync(DEPLOYMENT_EVIDENCE, "utf8")),
    readVercelProject: () => JSON.parse(readFileSync(
      path.join(config.vercelProjectDirectory, ".vercel", "project.json"),
      "utf8",
    )),
    listVercelEnvironment: () => JSON.parse(defaultCommand(
      "npx",
      [
        "--yes",
        `vercel@${VERCEL_CLI_VERSION}`,
        "env",
        "ls",
        "production",
        "--json",
        "--cwd",
        config.vercelProjectDirectory,
        "--no-color",
      ],
      {
        env: childProcessEnvironment({
          ...(process.env.VERCEL_TOKEN
            ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN }
            : {}),
        }),
        label: "Vercel production environment lookup",
      },
    )),
    async readHomepage() {
      const response = await fetch(PLATFORM_URL.replace("/api/stripe/webhook", "/"), {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      return { body: await response.text(), status: response.status };
    },
    async readHealth() {
      const response = await fetch(HEALTH_URL, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      return { body: await response.json(), status: response.status };
    },
  };
}

async function createStripeDependencies(config) {
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION });
  const invocationId = randomUUID();
  const options = (stage) => ({
    idempotencyKey:
      `grainline-connect-cutover-${config.expectedCommit}-${invocationId}-${stage}`,
  });
  return {
    listClassicEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    listV2Destinations: () => listAll(stripe.v2.core.eventDestinations.list({
      include: ["webhook_endpoint.url"],
      limit: 100,
    })),
    updatePlatform: (id, events, stage) => stripe.webhookEndpoints.update(
      id,
      { enabled_events: events },
      options(stage),
    ),
    updateV2: (id, events, stage) => stripe.v2.core.eventDestinations.update(
      id,
      { enabled_events: events, include: ["webhook_endpoint.url"] },
      options(stage),
    ),
    updateConnect: (id, params, stage) => stripe.webhookEndpoints.update(
      id,
      params,
      options(stage),
    ),
  };
}

function pendingContract(config) {
  return {
    phase: "stripe-connect-provider-cutover",
    status: "pending",
    mode: "test",
    commit: config.expectedCommit,
    ciRunId: config.ciRunId,
    deploymentId: config.deploymentId,
  };
}

function reserveOrResumeEvidence(config) {
  const pendingPath = `${config.evidencePath}.pending`;
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  if (existsSync(config.evidencePath)) throw new Error("final cutover evidence already exists");
  const expected = pendingContract(config);
  if (existsSync(pendingPath)) {
    if ((statSync(pendingPath).mode & 0o777) !== 0o600) {
      throw new Error("pending cutover evidence is not mode 0600");
    }
    const actual = JSON.parse(readFileSync(pendingPath, "utf8"));
    for (const [key, value] of Object.entries(expected)) {
      if (actual?.[key] !== value) throw new Error("pending cutover evidence belongs to another release");
    }
    return pendingPath;
  }
  writeFileSync(pendingPath, `${JSON.stringify(expected, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(pendingPath, 0o600);
  return pendingPath;
}

function updatePending(pendingPath, config, stage) {
  writeFileSync(pendingPath, `${JSON.stringify({
    ...pendingContract(config),
    observedStage: stage,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(pendingPath, 0o600);
}

function finalizeEvidence(pendingPath, config, state) {
  const payload = {
    generatedAt: new Date().toISOString(),
    phase: "stripe-connect-provider-cutover",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    ciRunId: config.ciRunId,
    deploymentId: config.deploymentId,
    providerStage: state.stage,
    stripe: {
      platformEndpointIdSha256: sha256(state.platform.id),
      platformUrl: PLATFORM_URL,
      platformEvents: PLATFORM_REVIEWED_EVENTS,
      connectEndpointIdSha256: sha256(state.connect.id),
      connectUrl: CONNECT_CANONICAL_URL,
      connectStatus: "disabled",
      connectEvents: CONNECT_EVENTS,
      connectedAccountSourceAttestedByRetainedCreationEvidence: true,
      v2DestinationIdSha256: sha256(state.v2.id),
      v2Url: V2_URL,
      v2Status: "enabled",
      v2Payload: "thin",
      v2EventsFrom: ["other_accounts"],
      v2Events: V2_REVIEWED_EVENTS,
    },
    secretsChanged: false,
    migrationsRun: false,
    rlsChanged: false,
    grantsChanged: false,
    nextBoundary: "enable only inside the provider-authenticated payout.failed delivery and exact retry proof",
  };
  writeFileSync(pendingPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(pendingPath, 0o600);
  renameSync(pendingPath, config.evidencePath);
  return Object.freeze(payload);
}

async function convergeForward(
  deps,
  config,
  pendingPath,
  writePending = updatePending,
) {
  let state = await readProviderState(deps);
  writePending(pendingPath, config, state.stage);
  if (state.stage === 0) {
    await deps.updatePlatform(
      state.platform.id,
      PLATFORM_REVIEWED_EVENTS,
      "platform-reviewed",
    );
    state = await readProviderState(deps);
    if (state.stage !== 1) throw new Error("platform event convergence did not reach stage 1");
    writePending(pendingPath, config, state.stage);
  }
  if (state.stage === 1) {
    await deps.updateV2(state.v2.id, V2_REVIEWED_EVENTS, "v2-reviewed");
    state = await readProviderState(deps);
    if (state.stage !== 2) throw new Error("v2 event convergence did not reach stage 2");
    writePending(pendingPath, config, state.stage);
  }
  if (state.stage === 2) {
    await deps.updateConnect(
      state.connect.id,
      { disabled: true, enabled_events: CONNECT_EVENTS, url: CONNECT_CANONICAL_URL },
      "connect-canonical-disabled",
    );
    state = await readProviderState(deps);
    if (state.stage !== 3) throw new Error("Connect URL convergence did not reach stage 3");
    writePending(pendingPath, config, state.stage);
  }
  if (state.stage !== 3) {
    throw new Error("provider configuration staging did not reach disabled canonical stage 3");
  }
  return state;
}

async function rollbackToPredecessor(deps) {
  const failures = [];
  let state;
  try {
    state = await readProviderState(deps);
  } catch (error) {
    return [`provider rollback could not classify current state: ${safeError(error)}`];
  }
  try {
    if (state.stage >= 3) {
      await deps.updateConnect(
        state.connect.id,
        { disabled: true, enabled_events: CONNECT_EVENTS, url: CONNECT_BOOTSTRAP_URL },
        "rollback-connect-bootstrap-disabled",
      );
    }
  } catch (error) {
    failures.push(`Connect rollback: ${safeError(error)}`);
  }
  try {
    state = await readProviderState(deps);
    if (state.stage >= 2) {
      await deps.updateV2(
        state.v2.id,
        V2_PREDECESSOR_EVENTS,
        "rollback-v2-predecessor",
      );
    }
  } catch (error) {
    failures.push(`v2 rollback: ${safeError(error)}`);
  }
  try {
    state = await readProviderState(deps);
    if (state.stage >= 1) {
      await deps.updatePlatform(
        state.platform.id,
        PLATFORM_PREDECESSOR_EVENTS,
        "rollback-platform-predecessor",
      );
    }
  } catch (error) {
    failures.push(`platform rollback: ${safeError(error)}`);
  }
  try {
    state = await readProviderState(deps);
    if (state.stage !== 0) throw new Error(`rollback ended at stage ${state.stage}`);
  } catch (error) {
    failures.push(`final rollback verification: ${safeError(error)}`);
  }
  return failures;
}

function mergeDependencies(defaults, overrides) {
  return { ...defaults, ...overrides };
}

export async function runStripeConnectProviderCutover({
  env = process.env,
  dependencies = {},
} = {}) {
  const config = parseStripeConnectCutoverConfig(env);
  const local = mergeDependencies(createLocalDependencies(config), dependencies);
  const git = await local.currentGitState();
  if (git?.head !== config.expectedCommit || git?.status !== "") {
    throw new Error("provider cutover requires the exact clean reviewed commit");
  }
  assertExactCiRun(await local.ciRun(), config);
  normalizeVercelProject(await local.readVercelProject());
  assertSensitiveProductionVariable(await local.listVercelEnvironment());
  assertBootstrapEvidence(await local.readBootstrapEvidence());
  assertDeploymentEvidence(await local.readDeploymentEvidence(), config);
  await assertPublicDeployment(local, config);

  const stripeDefaults = dependencies.listClassicEndpoints
    ? {}
    : await createStripeDependencies(config);
  const deps = mergeDependencies(mergeDependencies(local, stripeDefaults), dependencies);
  const initial = await readProviderState(deps);
  if (config.mode === "preflight") {
    if (initial.stage !== 0) {
      throw new Error(`read-only cutover preflight requires predecessor stage 0, received ${initial.stage}`);
    }
    return Object.freeze({
      ciRunId: config.ciRunId,
      commit: config.expectedCommit,
      deploymentId: config.deploymentId,
      mode: "preflight",
      providerStage: initial.stage,
      status: "passed",
    });
  }

  if (initial.stage === 4) {
    throw new Error("signed provider delivery is already enabled; staging will not roll it back");
  }

  const reserve = dependencies.reserveOrResumeEvidence ?? reserveOrResumeEvidence;
  const finish = dependencies.finalizeEvidence ?? finalizeEvidence;
  const pendingPath = reserve(config);
  try {
    await convergeForward(
      deps,
      config,
      pendingPath,
      dependencies.updatePending ?? updatePending,
    );
    assertSensitiveProductionVariable(await deps.listVercelEnvironment());
    await assertPublicDeployment(deps, config);
    const finalState = await readProviderState(deps);
    if (finalState.stage !== 3) {
      throw new Error("provider topology drifted before cutover evidence finalization");
    }
    return finish(pendingPath, config, finalState);
  } catch (error) {
    const rollbackFailures = await rollbackToPredecessor(deps);
    if (rollbackFailures.length === 0 && existsSync(pendingPath)) unlinkSync(pendingPath);
    const suffix = rollbackFailures.length === 0
      ? "; provider rollback completed"
      : `; provider rollback incomplete: ${rollbackFailures.join("; ")}`;
    throw new Error(`${safeError(error)}${suffix}`);
  }
}

async function main() {
  try {
    const result = await runStripeConnectProviderCutover();
    process.stdout.write(`${JSON.stringify({
      ciRunId: result.ciRunId,
      commit: result.commit,
      deploymentId: result.deploymentId,
      phase: result.mode === "preflight"
        ? "stripe-connect-provider-cutover-preflight"
        : result.phase,
      providerStage: result.providerStage,
      status: result.status,
    })}\n`);
  } catch (error) {
    process.stderr.write(`Stripe Connect provider cutover failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
