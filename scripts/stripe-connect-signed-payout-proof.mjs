#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  PLATFORM_REVIEWED_EVENTS,
  V2_REVIEWED_EVENTS,
  readProviderState,
} from "./stripe-connect-provider-cutover.mjs";
import { assertSensitiveProductionVariable } from "./stripe-connect-webhook-bootstrap.mjs";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "Drewyoung910/grainline";
const STRIPE_API_VERSION = "2026-02-25.clover";
const VERCEL_CLI_VERSION = "58.9.0";
const STRIPE_CLI_VERSION = "1.39.0";
const CONNECT_URL = "https://thegrainline.com/api/stripe/webhook/connect";
const HEALTH_URL = "https://thegrainline.com/api/health";
const REQUIRED_FAILURE_CODE = "no_account";
const CANARY_AMOUNT_CENTS = 100;
const FUNDING_CHARGE_CENTS = 500;
const MAX_EVENT_AGE_SECONDS = 24 * 60 * 60;
const VERCEL_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  projectName: "grainline",
});
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const STRIPE_SECRET_PATTERN =
  /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const STRIPE_OBJECT_ID_PATTERN =
  /\b(?:acct|ba|ch|ed|evt|pi|po|re|seti|tr|we)_[A-Za-z0-9_]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(STRIPE_OBJECT_ID_PATTERN, "[redacted-stripe-object]")
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

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function repoEvidencePath(env, name) {
  const raw = required(env, name);
  if (raw.includes("\0")) throw new Error(`${name} contains a null byte`);
  const resolved = path.resolve(ROOT_DIR, raw);
  if (
    !resolved.startsWith(`${path.join(ROOT_DIR, "archive")}${path.sep}`)
    || path.extname(resolved) !== ".json"
  ) {
    throw new Error(`${name} must be one JSON file under archive/`);
  }
  return resolved;
}

function handoffPath(env) {
  const resolved = path.resolve(required(env, "STRIPE_CONNECT_PAYOUT_HANDOFF_PATH"));
  const allowedRoots = [path.resolve(os.tmpdir()), path.resolve("/private/tmp")];
  if (
    !allowedRoots.some((root) => resolved.startsWith(`${root}${path.sep}`))
    || !path.basename(resolved).startsWith("grainline-stripe-connect-payout-")
    || path.extname(resolved) !== ".json"
  ) {
    throw new Error("payout handoff must be a named JSON file inside the system temporary directory");
  }
  return resolved;
}

export function parseStripeConnectPayoutProofConfig(env = process.env) {
  const mode = required(env, "STRIPE_CONNECT_PAYOUT_PROOF_MODE");
  if (!new Set(["prepare", "prove"]).has(mode)) {
    throw new Error("STRIPE_CONNECT_PAYOUT_PROOF_MODE must be prepare or prove");
  }
  const expectedConfirmation = mode === "prepare"
    ? "create-disposable-test-payout-failure"
    : "enable-and-prove-signed-test-payout-failure";
  if (env.STRIPE_CONNECT_PAYOUT_PROOF_CONFIRM !== expectedConfirmation) {
    throw new Error(`STRIPE_CONNECT_PAYOUT_PROOF_CONFIRM=${expectedConfirmation} is required`);
  }
  const secretKey = required(env, "STRIPE_SECRET_KEY");
  if (!/^sk_test_[A-Za-z0-9_]+$/.test(secretKey)) {
    throw new Error("signed payout proof requires an explicit Stripe test key");
  }
  const expectedCommit = required(env, "STRIPE_CONNECT_PAYOUT_PROOF_EXPECTED_COMMIT");
  const ciRunId = required(env, "STRIPE_CONNECT_PAYOUT_PROOF_CI_RUN_ID");
  const cutoverCommit = required(env, "STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_COMMIT");
  const cutoverCiRunId = required(env, "STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_CI_RUN_ID");
  const deploymentId = required(env, "STRIPE_CONNECT_PAYOUT_PROOF_DEPLOYMENT_ID");
  if (!COMMIT_PATTERN.test(expectedCommit)) throw new Error("expected commit is invalid");
  if (!RUN_ID_PATTERN.test(ciRunId)) throw new Error("CI run ID is invalid");
  if (!COMMIT_PATTERN.test(cutoverCommit)) throw new Error("cutover commit is invalid");
  if (!RUN_ID_PATTERN.test(cutoverCiRunId)) throw new Error("cutover CI run ID is invalid");
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) throw new Error("deployment ID is invalid");

  const resolvedHandoffPath = handoffPath(env);
  const cutoverEvidencePath = repoEvidencePath(
    env,
    "STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_EVIDENCE_PATH",
  );
  const finalEvidencePath = repoEvidencePath(
    env,
    "STRIPE_CONNECT_PAYOUT_PROOF_EVIDENCE_PATH",
  );
  const preparationEvidencePath = mode === "prepare"
    ? finalEvidencePath
    : repoEvidencePath(
      env,
      "STRIPE_CONNECT_PAYOUT_PROOF_PREPARATION_EVIDENCE_PATH",
    );
  const config = {
    ciRunId,
    cutoverCiRunId,
    cutoverCommit,
    cutoverEvidencePath,
    deploymentId,
    evidencePath: finalEvidencePath,
    expectedCommit,
    handoffPath: resolvedHandoffPath,
    mode,
    preparationAttemptPath: `${resolvedHandoffPath}.attempt`,
    preparationEvidencePath,
    secretKey,
    stripeCliPath: path.resolve(
      env.STRIPE_CONNECT_PAYOUT_PROOF_STRIPE_CLI_PATH || "/opt/homebrew/bin/stripe",
    ),
    vercelProjectDirectory: path.resolve(
      required(env, "STRIPE_CONNECT_PAYOUT_PROOF_VERCEL_PROJECT_DIRECTORY"),
    ),
  };
  if (
    config.evidencePath === config.cutoverEvidencePath
    || config.preparationEvidencePath === config.cutoverEvidencePath
    || (mode === "prove" && config.evidencePath === config.preparationEvidencePath)
  ) {
    throw new Error("payout proof evidence paths must be distinct from their predecessors");
  }

  if (mode === "prepare") {
    if (
      existsSync(config.handoffPath)
      && !existsSync(config.preparationAttemptPath)
    ) {
      throw new Error("payout handoff exists without its preparation attempt");
    }
    if (existsSync(config.evidencePath)) throw new Error("payout preparation evidence already exists");
  } else {
    assertDeterministicPostgresEnvironment(env, "Stripe Connect signed payout proof");
    const privileged = privilegedDatabaseEnvironmentKeys(env);
    if (privileged.length > 0) {
      throw new Error(`signed payout proof rejects privileged database keys: ${privileged.join(", ")}`);
    }
    const aliases = unreviewedPostgresUrlEnvironmentKeys(env);
    if (aliases.length > 0) {
      throw new Error(`signed payout proof rejects aliased PostgreSQL URLs: ${aliases.join(", ")}`);
    }
    const databaseUrl = required(env, "DATABASE_URL");
    const runtimeGuard = assertVercelRuntimeDatabaseIsolation({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: databaseUrl,
      RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
      NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
      PGOPTIONS: env.PGOPTIONS,
    });
    Object.assign(config, { databaseUrl, runtimeGuard });
  }
  return Object.freeze(config);
}

function markerFor(config) {
  return sha256([
    "grainline-stripe-connect-payout-canary-v1",
    config.expectedCommit,
    config.ciRunId,
    config.deploymentId,
  ].join(":"));
}

function evidenceStatusPath(target) {
  return path.relative(ROOT_DIR, target).split(path.sep).join("/");
}

export function assertOnlyReviewedEvidenceIsUntracked(status, config) {
  const allowed = new Set([
    config.cutoverEvidencePath,
    ...(config.mode === "prove"
      ? [config.preparationEvidencePath, config.evidencePath]
      : []),
  ].map((target) => `?? ${evidenceStatusPath(target)}`));
  const entries = String(status ?? "")
    .split("\n")
    .map((entry) => entry.trimEnd())
    .filter(Boolean);
  const unexpected = entries.filter((entry) => !allowed.has(entry));
  if (unexpected.length > 0) {
    throw new Error("signed payout proof worktree contains changes outside reviewed evidence files");
  }
}

function assertExactGitAndCi(git, ci, config) {
  if (git?.head !== config.expectedCommit) {
    throw new Error("signed payout proof requires the exact clean reviewed commit");
  }
  assertOnlyReviewedEvidenceIsUntracked(git?.status, config);
  if (
    ci?.conclusion !== "success"
    || ci?.event !== "push"
    || ci?.headBranch !== "main"
    || ci?.headSha !== config.expectedCommit
    || ci?.workflowName !== "CI"
  ) {
    throw new Error("signed payout proof requires successful exact-main CI");
  }
}

export function assertCutoverEvidence(payload, config) {
  if (
    payload?.phase !== "stripe-connect-provider-cutover"
    || payload?.status !== "passed"
    || payload?.mode !== "test"
    || payload?.commit !== config.cutoverCommit
    || String(payload?.ciRunId) !== String(config.cutoverCiRunId)
    || payload?.deploymentId !== config.deploymentId
    || payload?.providerStage !== 3
    || payload?.stripe?.connectUrl !== CONNECT_URL
    || payload?.stripe?.connectStatus !== "disabled"
    || JSON.stringify(payload?.stripe?.connectEvents) !== JSON.stringify(["payout.failed"])
    || JSON.stringify(payload?.stripe?.platformEvents) !== JSON.stringify(PLATFORM_REVIEWED_EVENTS)
    || JSON.stringify(payload?.stripe?.v2Events) !== JSON.stringify(V2_REVIEWED_EVENTS)
    || payload?.stripe?.connectedAccountSourceAttestedByRetainedCreationEvidence !== true
    || payload?.secretsChanged !== false
  ) {
    throw new Error("provider cutover evidence is not the exact disabled-canonical predecessor");
  }
}

export function assertPreparationEvidence(
  payload,
  config,
  handoff = null,
  preparationAttempt = null,
) {
  const hex = /^[a-f0-9]{64}$/;
  if (
    payload?.phase !== "stripe-connect-disposable-payout-preparation"
    || payload?.status !== "passed"
    || payload?.mode !== "test"
    || payload?.commit !== config.expectedCommit
    || String(payload?.ciRunId) !== String(config.ciRunId)
    || payload?.deploymentId !== config.deploymentId
    || payload?.stripe?.eventType !== "payout.failed"
    || payload?.stripe?.failureCode !== REQUIRED_FAILURE_CODE
    || payload?.stripe?.livemode !== false
    || payload?.stripe?.disposableAccountCleanupPending !== true
    || !hex.test(payload?.stripe?.accountIdSha256 ?? "")
    || !hex.test(payload?.stripe?.payoutIdSha256 ?? "")
    || !hex.test(payload?.stripe?.eventIdSha256 ?? "")
    || !hex.test(payload?.stripe?.preparationAttemptIdSha256 ?? "")
    || payload?.rawProviderIdsPersistedInEvidence !== false
    || payload?.secretsPersistedInEvidence !== false
    || payload?.connectEndpointEnabled !== false
  ) {
    throw new Error("payout preparation evidence is not the exact reviewed predecessor");
  }
  if (handoff && (
    payload.stripe.accountIdSha256 !== sha256(handoff.stripeAccountId)
    || payload.stripe.payoutIdSha256 !== sha256(handoff.payoutId)
    || payload.stripe.eventIdSha256 !== sha256(handoff.eventId)
    || payload.stripe.preparationAttemptIdSha256
      !== sha256(handoff.preparationAttemptId)
  )) {
    throw new Error("payout preparation evidence does not bind the temporary handoff");
  }
  if (preparationAttempt && (
    payload.stripe.preparationAttemptIdSha256
      !== sha256(preparationAttempt.attemptId)
    || payload.stripe.accountIdSha256
      !== sha256(preparationAttempt.stripeAccountId)
  )) {
    throw new Error("payout preparation evidence does not bind the durable attempt");
  }
  return Object.freeze(payload);
}

function normalizeProject(project) {
  for (const [key, expected] of Object.entries(VERCEL_PROJECT)) {
    if (project?.[key] !== expected) throw new Error("Vercel project identity drifted");
  }
}

async function assertPublicDeployment(deps, config) {
  const homepage = await deps.readHomepage();
  if (homepage.status !== 200 || !homepage.body.includes(`dpl=${config.deploymentId}`)) {
    throw new Error("canonical homepage is not the reviewed compatible deployment");
  }
  const health = await deps.readHealth();
  if (health.status !== 200 || health.body?.ok !== true) {
    throw new Error("canonical health route is not healthy");
  }
}

export function buildCanaryAccountParams(config, now = new Date()) {
  return {
    business_profile: {
      mcc: "5712",
      name: "Grainline Provider Canary",
      product_description: "Disposable Stripe test-mode webhook delivery proof",
      url: "https://thegrainline.com",
    },
    business_type: "individual",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    controller: {
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "application",
      stripe_dashboard: { type: "none" },
    },
    country: "US",
    default_currency: "usd",
    email: "provider-canary@thegrainline.com",
    external_account: {
      account_holder_name: "Grainline Provider Canary",
      account_holder_type: "individual",
      account_number: "000111111116",
      country: "US",
      currency: "usd",
      object: "bank_account",
      routing_number: "110000000",
    },
    individual: {
      address: {
        city: "Chicago",
        country: "US",
        line1: "address_full_match",
        postal_code: "60601",
        state: "IL",
      },
      dob: { day: 1, month: 1, year: 1901 },
      email: "provider-canary@thegrainline.com",
      first_name: "Grainline",
      last_name: "Canary",
      phone: "0000000000",
      ssn_last_4: "0000",
    },
    metadata: { grainline_provider_canary: markerFor(config) },
    settings: { payouts: { schedule: { interval: "manual" } } },
    tos_acceptance: {
      date: Math.floor(now.getTime() / 1000),
      ip: "127.0.0.1",
    },
  };
}

export function assertCanaryAccount(account, config) {
  if (
    !account
    || typeof account.id !== "string"
    || account.livemode !== false
    || account.deleted === true
    || account.metadata?.grainline_provider_canary !== markerFor(config)
    || account.controller?.fees?.payer !== "application"
    || account.controller?.losses?.payments !== "application"
    || account.controller?.requirement_collection !== "application"
    || account.controller?.stripe_dashboard?.type !== "none"
  ) {
    throw new Error("disposable Stripe account identity, metadata or controller drifted");
  }
  return account;
}

export function assertFailedPayout(payout, accountId) {
  if (
    !payout
    || typeof payout.id !== "string"
    || payout.livemode !== false
    || payout.status !== "failed"
    || payout.failure_code !== REQUIRED_FAILURE_CODE
    || payout.amount !== CANARY_AMOUNT_CENTS
    || payout.currency !== "usd"
  ) {
    throw new Error("disposable Stripe payout did not reach the exact failed state");
  }
  if (payout.metadata?.grainline_provider_account_sha256 !== sha256(accountId)) {
    throw new Error("disposable Stripe payout metadata does not bind the account");
  }
  return payout;
}

export function assertPayoutEvent(event, accountId, payoutId, createdAfterSeconds) {
  const object = event?.data?.object;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !event
    || typeof event.id !== "string"
    || event.type !== "payout.failed"
    || event.livemode !== false
    || event.account !== accountId
    || object?.id !== payoutId
    || object?.status !== "failed"
    || object?.failure_code !== REQUIRED_FAILURE_CODE
    || !Number.isSafeInteger(event.created)
    || event.created < createdAfterSeconds
    || event.created > nowSeconds + 60
    || nowSeconds - event.created > MAX_EVENT_AGE_SECONDS
  ) {
    throw new Error("Stripe payout.failed event does not match the disposable source");
  }
  return event;
}

function writeExclusiveJson(target, payload) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(target, 0o600);
}

function finalizeJson(target, payload) {
  const pending = `${target}.pending`;
  if (existsSync(pending)) {
    if ((statSync(pending).mode & 0o777) !== 0o600) {
      throw new Error("pending payout proof record is not mode 0600");
    }
    const previous = JSON.parse(readFileSync(pending, "utf8"));
    for (const key of ["phase", "commit", "ciRunId", "deploymentId"]) {
      if (String(previous?.[key]) !== String(payload?.[key])) {
        throw new Error("pending payout proof record belongs to another release");
      }
    }
    unlinkSync(pending);
  }
  writeExclusiveJson(pending, payload);
  renameSync(pending, target);
}

function writeOrVerifyPreparedHandoff(config, payload) {
  if (!existsSync(config.handoffPath)) {
    writeExclusiveJson(config.handoffPath, payload);
    return payload;
  }
  const existing = readHandoff(config);
  if (
    existing.status !== "prepared"
    || JSON.stringify(existing) !== JSON.stringify(payload)
  ) {
    throw new Error("existing payout handoff does not match the resumed preparation");
  }
  return existing;
}

function assertPreparationAttempt(payload, config) {
  if (
    payload?.phase !== "stripe-connect-disposable-payout-attempt"
    || payload?.status !== "pending"
    || payload?.commit !== config.expectedCommit
    || String(payload?.ciRunId) !== String(config.ciRunId)
    || payload?.deploymentId !== config.deploymentId
    || !/^[a-f0-9-]{36}$/.test(payload?.attemptId ?? "")
    || !Number.isSafeInteger(payload?.startedSeconds)
    || payload.startedSeconds <= 0
    || (
      payload?.stripeAccountId !== undefined
      && typeof payload.stripeAccountId !== "string"
    )
  ) {
    throw new Error("payout preparation attempt belongs to another or incomplete release");
  }
  return Object.freeze(payload);
}

function reserveOrResumePreparationAttempt(config) {
  if (existsSync(config.preparationAttemptPath)) {
    if ((statSync(config.preparationAttemptPath).mode & 0o777) !== 0o600) {
      throw new Error("payout preparation attempt is not mode 0600");
    }
    return assertPreparationAttempt(
      JSON.parse(readFileSync(config.preparationAttemptPath, "utf8")),
      config,
    );
  }
  const payload = {
    phase: "stripe-connect-disposable-payout-attempt",
    status: "pending",
    commit: config.expectedCommit,
    ciRunId: config.ciRunId,
    deploymentId: config.deploymentId,
    attemptId: randomUUID(),
    startedSeconds: Math.floor(Date.now() / 1000) - 5,
  };
  writeExclusiveJson(config.preparationAttemptPath, payload);
  return assertPreparationAttempt(payload, config);
}

function readPreparationAttempt(config, { required: isRequired = true } = {}) {
  if (!existsSync(config.preparationAttemptPath)) {
    if (isRequired) throw new Error("payout preparation attempt does not exist");
    return null;
  }
  if ((statSync(config.preparationAttemptPath).mode & 0o777) !== 0o600) {
    throw new Error("payout preparation attempt is not mode 0600");
  }
  return assertPreparationAttempt(
    JSON.parse(readFileSync(config.preparationAttemptPath, "utf8")),
    config,
  );
}

function updatePreparationAttempt(config, previous, patch) {
  assertPreparationAttempt(previous, config);
  const payload = assertPreparationAttempt({ ...previous, ...patch }, config);
  finalizeJson(config.preparationAttemptPath, payload);
  return payload;
}

function removePreparationAttempt(config) {
  if (existsSync(config.preparationAttemptPath)) unlinkSync(config.preparationAttemptPath);
}

function readHandoff(config) {
  if (!existsSync(config.handoffPath)) throw new Error("payout handoff does not exist");
  if ((statSync(config.handoffPath).mode & 0o777) !== 0o600) {
    throw new Error("payout handoff is not mode 0600");
  }
  const payload = JSON.parse(readFileSync(config.handoffPath, "utf8"));
  const prepared = payload?.status === "prepared";
  const deliveryVerified = payload?.status === "delivery-verified"
    && payload?.delivery?.claimGeneration === 1
    && typeof payload?.delivery?.updatedEpoch === "string"
    && payload.delivery.updatedEpoch.length > 0;
  if (
    payload?.phase !== "stripe-connect-disposable-payout-handoff"
    || (!prepared && !deliveryVerified)
    || payload?.commit !== config.expectedCommit
    || String(payload?.ciRunId) !== String(config.ciRunId)
    || payload?.deploymentId !== config.deploymentId
    || payload?.marker !== markerFor(config)
    || !/^[a-f0-9-]{36}$/.test(payload?.preparationAttemptId ?? "")
    || typeof payload?.stripeAccountId !== "string"
    || typeof payload?.payoutId !== "string"
    || typeof payload?.eventId !== "string"
    || !Number.isSafeInteger(payload?.eventCreated)
  ) {
    throw new Error("payout handoff belongs to another or incomplete release");
  }
  return payload;
}

function assertFinalProofEvidence(payload, config, handoff = null) {
  const hex = /^[a-f0-9]{64}$/;
  if (
    payload?.phase !== "stripe-connect-signed-payout-proof"
    || payload?.status !== "passed"
    || payload?.mode !== "test"
    || payload?.commit !== config.expectedCommit
    || String(payload?.ciRunId) !== String(config.ciRunId)
    || payload?.deploymentId !== config.deploymentId
    || payload?.providerStage !== 4
    || payload?.stripe?.eventType !== "payout.failed"
    || payload?.stripe?.failureCode !== REQUIRED_FAILURE_CODE
    || payload?.stripe?.connectUrl !== CONNECT_URL
    || payload?.stripe?.connectStatus !== "enabled"
    || payload?.stripe?.exactRetrySent !== true
    || payload?.stripe?.disposableAccountDeleted !== true
    || !hex.test(payload?.stripe?.accountIdSha256 ?? "")
    || !hex.test(payload?.stripe?.payoutIdSha256 ?? "")
    || !hex.test(payload?.stripe?.eventIdSha256 ?? "")
    || !hex.test(payload?.stripe?.connectEndpointIdSha256 ?? "")
    || payload?.database?.runtimeRole !== REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role
    || payload?.database?.sellerMatchCount !== 0
    || payload?.database?.payoutProjectionCount !== 0
    || payload?.database?.webhookLeaseCount !== 1
    || payload?.database?.claimGeneration !== 1
    || payload?.database?.processed !== true
    || payload?.database?.exactRetryLeftLeaseUnchanged !== true
    || payload?.rawProviderIdsPersistedInEvidence !== false
    || payload?.secretsPersistedInEvidence !== false
  ) {
    throw new Error("signed payout proof evidence is not the exact completed release");
  }
  if (handoff && (
    payload.stripe.accountIdSha256 !== sha256(handoff.stripeAccountId)
    || payload.stripe.payoutIdSha256 !== sha256(handoff.payoutId)
    || payload.stripe.eventIdSha256 !== sha256(handoff.eventId)
  )) {
    throw new Error("completed proof evidence does not bind the temporary handoff");
  }
  return Object.freeze(payload);
}

function readExistingFinalEvidence(config) {
  if (!existsSync(config.evidencePath)) return null;
  if ((statSync(config.evidencePath).mode & 0o777) !== 0o600) {
    throw new Error("signed payout proof evidence is not mode 0600");
  }
  return assertFinalProofEvidence(
    JSON.parse(readFileSync(config.evidencePath, "utf8")),
    config,
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(getValue, accept, label, { attempts = 24, delayMs = 2500 } = {}) {
  let latest;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await getValue();
    if (accept(latest)) return latest;
    if (attempt + 1 < attempts) await sleep(delayMs);
  }
  throw new Error(`${label} did not reach the reviewed state`);
}

async function preparePayoutCanary({ config, deps, preparationAttempt }) {
  let attempt = assertPreparationAttempt(preparationAttempt, config);
  const startedSeconds = attempt.startedSeconds;
  let accountId = attempt.stripeAccountId;
  try {
    const account = assertCanaryAccount(accountId
      ? await deps.retrieveAccount(accountId)
      : await deps.createCanaryAccount(buildCanaryAccountParams(config)), config);
    accountId = account.id;
    if (!attempt.stripeAccountId) {
      attempt = await (deps.updatePreparationAttempt ?? updatePreparationAttempt)(
        config,
        attempt,
        { stripeAccountId: accountId },
      );
    }
    const readyAccount = await waitFor(
      () => deps.retrieveAccount(accountId),
      (value) => value?.charges_enabled === true && value?.payouts_enabled === true,
      "disposable account capabilities",
    );
    assertCanaryAccount(readyAccount, config);

    const charge = await deps.createFundingCharge(accountId, {
      amount: FUNDING_CHARGE_CENTS,
      currency: "usd",
      description: "Grainline disposable payout webhook proof funding",
      metadata: { grainline_provider_canary: markerFor(config) },
      source: "tok_bypassPending",
    });
    if (charge?.paid !== true || charge?.status !== "succeeded" || charge?.livemode !== false) {
      throw new Error("disposable funding charge did not settle successfully");
    }
    const balance = await deps.retrieveBalance(accountId);
    const availableUsd = (balance?.available ?? [])
      .filter((row) => row?.currency === "usd")
      .reduce((sum, row) => sum + Number(row?.amount ?? 0), 0);
    if (!Number.isSafeInteger(availableUsd) || availableUsd < CANARY_AMOUNT_CENTS) {
      throw new Error("disposable account lacks reviewed available USD balance");
    }

    const createdPayout = await deps.createPayout(accountId, {
      amount: CANARY_AMOUNT_CENTS,
      currency: "usd",
      description: "Grainline disposable signed webhook proof",
      metadata: { grainline_provider_account_sha256: sha256(accountId) },
      method: "standard",
    });
    if (!createdPayout?.id || createdPayout.livemode !== false) {
      throw new Error("Stripe did not create the disposable test payout");
    }
    const payout = assertFailedPayout(await waitFor(
      () => deps.retrievePayout(accountId, createdPayout.id),
      (value) => value?.status === "failed",
      "disposable payout failure",
      { attempts: 60, delayMs: 3000 },
    ), accountId);
    const events = await waitFor(
      () => deps.listPayoutFailedEvents(accountId, startedSeconds),
      (rows) => rows.some((row) => row?.data?.object?.id === payout.id),
      "payout.failed event",
      { attempts: 20, delayMs: 1500 },
    );
    const matches = events.filter((row) => row?.data?.object?.id === payout.id);
    if (matches.length !== 1) throw new Error("payout source produced multiple matching failed events");
    const event = assertPayoutEvent(matches[0], accountId, payout.id, startedSeconds);
    const provider = await readProviderState(deps);
    if (provider.stage !== 3) {
      throw new Error("Connect endpoint did not remain disabled through payout preparation");
    }

    const handoff = {
      phase: "stripe-connect-disposable-payout-handoff",
      status: "prepared",
      commit: config.expectedCommit,
      ciRunId: config.ciRunId,
      deploymentId: config.deploymentId,
      marker: markerFor(config),
      preparationAttemptId: attempt.attemptId,
      stripeAccountId: accountId,
      payoutId: payout.id,
      eventId: event.id,
      eventCreated: event.created,
    };
    await (deps.writeHandoff ?? writeOrVerifyPreparedHandoff)(config, handoff);
    const evidence = {
      generatedAt: new Date().toISOString(),
      phase: "stripe-connect-disposable-payout-preparation",
      status: "passed",
      mode: "test",
      commit: config.expectedCommit,
      ciRunId: config.ciRunId,
      deploymentId: config.deploymentId,
      stripe: {
        accountIdSha256: sha256(accountId),
        payoutIdSha256: sha256(payout.id),
        eventIdSha256: sha256(event.id),
        preparationAttemptIdSha256: sha256(attempt.attemptId),
        eventType: event.type,
        failureCode: payout.failure_code,
        livemode: false,
        disposableAccountCleanupPending: true,
      },
      rawProviderIdsPersistedInEvidence: false,
      secretsPersistedInEvidence: false,
      connectEndpointEnabled: false,
      nextBoundary: "enable the canonical endpoint only inside signed delivery and exact replay proof",
    };
    await (deps.finalizeEvidence ?? finalizeJson)(config.evidencePath, evidence);
    return Object.freeze(evidence);
  } catch (error) {
    const cleanupFailures = [];
    if (accountId) {
      try {
        const deleted = await deps.deleteAccount(accountId);
        if (deleted?.deleted !== true || deleted?.id !== accountId) {
          throw new Error("account deletion response did not match");
        }
      } catch (cleanupError) {
        cleanupFailures.push(safeError(cleanupError));
      }
    }
    if (cleanupFailures.length === 0) {
      if (existsSync(config.handoffPath)) {
        await (deps.removeHandoff ?? unlinkSync)(config.handoffPath);
      }
      await (deps.removePreparationAttempt ?? removePreparationAttempt)(config);
    }
    const suffix = cleanupFailures.length === 0
      ? "; disposable account cleanup completed"
      : `; disposable account cleanup incomplete: ${cleanupFailures.join("; ")}`;
    throw new Error(`${safeError(error)}${suffix}`);
  }
}

async function inspectRuntime(config, ids) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-stripe-connect-signed-payout-proof",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  let open = false;
  try {
    await client.query("BEGIN READ ONLY");
    open = true;
    const identity = await client.query(`
      SELECT
        CURRENT_USER AS current_user_name,
        SESSION_USER AS session_user_name,
        pg_catalog.current_database() AS database_name,
        pg_catalog.current_setting('transaction_read_only') AS read_only,
        role.rolsuper,
        role.rolbypassrls,
        role.rolinherit,
        role.rolcanlogin
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = CURRENT_USER
    `);
    assert.deepEqual(identity.rows, [{
      current_user_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
      session_user_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
      database_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.databaseName,
      read_only: "on",
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcanlogin: true,
    }]);
    const result = await client.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM public."SellerProfile"
          WHERE "stripeAccountId" = $1) AS seller_count,
        (SELECT pg_catalog.count(*)::integer
           FROM public."SellerPayoutEvent"
          WHERE "stripePayoutId" = $2) AS payout_projection_count,
        (SELECT pg_catalog.count(*)::integer
           FROM public."StripeWebhookEvent"
          WHERE id = $3) AS webhook_count,
        (SELECT type
           FROM public."StripeWebhookEvent"
          WHERE id = $3) AS webhook_type,
        (SELECT "claimGeneration"::text
           FROM public."StripeWebhookEvent"
          WHERE id = $3) AS claim_generation,
        (SELECT ("processedAt" IS NOT NULL)
           FROM public."StripeWebhookEvent"
          WHERE id = $3) AS processed,
        (SELECT ("lastError" IS NULL)
           FROM public."StripeWebhookEvent"
          WHERE id = $3) AS error_clear,
        (SELECT extract(
            epoch FROM "updatedAt" AT TIME ZONE 'UTC'
          )::text
           FROM public."StripeWebhookEvent"
          WHERE id = $3) AS updated_epoch
    `, [ids.accountId, ids.payoutId, ids.eventId]);
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze(result.rows[0]);
  } finally {
    if (open) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    await client.end();
  }
}

function assertBeforeDelivery(row) {
  assert.deepEqual(row, {
    seller_count: 0,
    payout_projection_count: 0,
    webhook_count: 0,
    webhook_type: null,
    claim_generation: null,
    processed: null,
    error_clear: null,
    updated_epoch: null,
  });
}

function assertAfterDelivery(row) {
  if (
    row?.seller_count !== 0
    || row?.payout_projection_count !== 0
    || row?.webhook_count !== 1
    || row?.webhook_type !== "payout.failed"
    || row?.claim_generation !== "1"
    || row?.processed !== true
    || row?.error_clear !== true
    || typeof row?.updated_epoch !== "string"
  ) {
    throw new Error("runtime ledger did not record the exact processed payout event");
  }
  return row;
}

async function proveSignedDelivery({
  config,
  deps,
  preparationAttempt,
  preparationEvidence,
}) {
  let finalEvidenceWritten = false;
  try {
    const handoff = await (deps.readHandoff ?? readHandoff)(config);
    assertPreparationEvidence(
      preparationEvidence,
      config,
      handoff,
      preparationAttempt,
    );
    const attempt = assertPreparationAttempt(preparationAttempt, config);
    if (
      attempt.stripeAccountId !== handoff.stripeAccountId
      || attempt.attemptId !== handoff.preparationAttemptId
    ) {
      throw new Error("payout preparation attempt does not bind the temporary handoff");
    }
    const ids = {
      accountId: handoff.stripeAccountId,
      eventId: handoff.eventId,
      payoutId: handoff.payoutId,
    };
    const retrievedAccount = await deps.retrieveAccount(ids.accountId);
    const accountAlreadyDeleted = retrievedAccount?.deleted === true;
    if (accountAlreadyDeleted) {
      if (handoff.status !== "delivery-verified" || retrievedAccount?.id !== ids.accountId) {
        throw new Error("only a delivery-verified handoff may resume after account deletion");
      }
    } else {
      assertCanaryAccount(retrievedAccount, config);
    }

    let payout;
    let event;
    let before;
    if (handoff.status === "prepared") {
      payout = assertFailedPayout(
        await deps.retrievePayout(ids.accountId, ids.payoutId),
        ids.accountId,
      );
      event = assertPayoutEvent(
        await deps.retrieveEvent(ids.accountId, ids.eventId),
        ids.accountId,
        payout.id,
        handoff.eventCreated,
      );
      before = await deps.inspectRuntime(config, ids);
      if (before?.webhook_count === 0) assertBeforeDelivery(before);
      else assertAfterDelivery(before);
    } else {
      payout = {
        failure_code: REQUIRED_FAILURE_CODE,
        id: ids.payoutId,
      };
      event = { id: ids.eventId, type: "payout.failed" };
      before = assertAfterDelivery(await deps.inspectRuntime(config, ids));
      if (
        Number(before.claim_generation) !== handoff.delivery.claimGeneration
        || before.updated_epoch !== handoff.delivery.updatedEpoch
      ) {
        throw new Error("delivery-verified handoff no longer matches the completed lease");
      }
    }

    let provider = await readProviderState(deps);
    if (!new Set([3, 4]).has(provider.stage)) {
      throw new Error("signed proof requires disabled or enabled canonical provider stage");
    }
    if (provider.stage === 3) {
      await deps.updateConnect(provider.connect.id, {
        disabled: false,
        enabled_events: ["payout.failed"],
        url: CONNECT_URL,
      });
      provider = await readProviderState(deps);
      if (provider.stage !== 4) throw new Error("Connect endpoint did not reach enabled stage 4");
    }
    let first;
    if (handoff.status === "delivery-verified") {
      first = before;
    } else {
      if (before?.webhook_count === 0) {
        await deps.resendEvent({
          accountId: ids.accountId,
          endpointId: provider.connect.id,
          eventId: ids.eventId,
          secretKey: config.secretKey,
          stripeCliPath: config.stripeCliPath,
        });
        first = assertAfterDelivery(await waitFor(
          () => deps.inspectRuntime(config, ids),
          (row) => row?.processed === true,
          "first signed payout delivery",
          { attempts: 30, delayMs: 1000 },
        ));
      } else {
        first = assertAfterDelivery(before);
      }

      await deps.resendEvent({
        accountId: ids.accountId,
        endpointId: provider.connect.id,
        eventId: ids.eventId,
        secretKey: config.secretKey,
        stripeCliPath: config.stripeCliPath,
      });
      await (deps.delay ?? sleep)(2000);
      const replay = assertAfterDelivery(await deps.inspectRuntime(config, ids));
      if (
        replay.claim_generation !== first.claim_generation
        || replay.updated_epoch !== first.updated_epoch
      ) {
        throw new Error("exact retry changed the completed webhook lease");
      }
      const verifiedHandoff = {
        ...handoff,
        status: "delivery-verified",
        delivery: {
          claimGeneration: Number(first.claim_generation),
          updatedEpoch: first.updated_epoch,
        },
      };
      await (deps.updateHandoff ?? finalizeJson)(config.handoffPath, verifiedHandoff);
    }
    provider = await readProviderState(deps);
    if (provider.stage !== 4) throw new Error("provider topology drifted during signed proof");

    if (!accountAlreadyDeleted) {
      const deleted = await deps.deleteAccount(ids.accountId);
      if (deleted?.deleted !== true || deleted?.id !== ids.accountId) {
        throw new Error("disposable Stripe account cleanup did not attest deletion");
      }
    }
    const evidence = {
      generatedAt: new Date().toISOString(),
      phase: "stripe-connect-signed-payout-proof",
      status: "passed",
      mode: "test",
      commit: config.expectedCommit,
      ciRunId: config.ciRunId,
      deploymentId: config.deploymentId,
      providerStage: provider.stage,
      stripe: {
        accountIdSha256: sha256(ids.accountId),
        payoutIdSha256: sha256(ids.payoutId),
        eventIdSha256: sha256(ids.eventId),
        eventType: event.type,
        failureCode: payout.failure_code,
        connectEndpointIdSha256: sha256(provider.connect.id),
        connectUrl: CONNECT_URL,
        connectStatus: "enabled",
        exactRetrySent: true,
        disposableAccountDeleted: true,
      },
      database: {
        runtimeRole: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
        sellerMatchCount: 0,
        payoutProjectionCount: 0,
        webhookLeaseCount: 1,
        claimGeneration: Number(first.claim_generation),
        processed: true,
        exactRetryLeftLeaseUnchanged: true,
      },
      rawProviderIdsPersistedInEvidence: false,
      secretsPersistedInEvidence: false,
      nextBoundary: "rerun exact provider topology and aggregate webhook health proofs",
    };
    await (deps.finalizeEvidence ?? finalizeJson)(config.evidencePath, evidence);
    finalEvidenceWritten = true;
    await (deps.removeHandoff ?? unlinkSync)(config.handoffPath);
    await (deps.removePreparationAttempt ?? removePreparationAttempt)(config);
    return Object.freeze(evidence);
  } catch (error) {
    if (finalEvidenceWritten) {
      throw new Error(
        `${safeError(error)}; signed proof evidence is complete and temporary recovery-record cleanup remains`,
      );
    }
    const failures = [];
    try {
      let provider = await readProviderState(deps);
      let disableRequestError = null;
      if (provider.stage === 4) {
        try {
          await deps.updateConnect(provider.connect.id, {
            disabled: true,
            enabled_events: ["payout.failed"],
            url: CONNECT_URL,
          });
        } catch (requestError) {
          disableRequestError = requestError;
        }
        provider = await readProviderState(deps);
      }
      if (provider.stage !== 3) {
        const requestContext = disableRequestError
          ? ` after request error ${safeError(disableRequestError)}`
          : "";
        throw new Error(`disable verification did not reach stage 3${requestContext}`);
      }
    } catch (disableError) {
      failures.push(`Connect disable: ${safeError(disableError)}`);
    }
    const suffix = failures.length === 0
      ? "; Connect endpoint returned to disabled canonical stage 3"
      : `; emergency disable incomplete: ${failures.join("; ")}`;
    throw new Error(`${safeError(error)}${suffix}`);
  }
}

async function fetchCiRun(config) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "grainline-stripe-connect-payout-proof",
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

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd ?? ROOT_DIR,
    encoding: "utf8",
    env: options.env ?? childProcessEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout: options.timeout ?? 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${options.label ?? commandName} failed with exit ${result.status ?? "unknown"}`);
  }
  return result.stdout;
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
    readCutoverEvidence: () => JSON.parse(readFileSync(config.cutoverEvidencePath, "utf8")),
    readVercelProject: () => JSON.parse(readFileSync(
      path.join(config.vercelProjectDirectory, ".vercel", "project.json"),
      "utf8",
    )),
    listVercelEnvironment: () => JSON.parse(command(
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
      const response = await fetch("https://thegrainline.com/", {
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
    inspectRuntime,
    readPreparationEvidence: () => JSON.parse(readFileSync(
      config.preparationEvidencePath,
      "utf8",
    )),
    readPreparationAttempt,
    removePreparationAttempt,
    reserveOrResumePreparationAttempt,
    updatePreparationAttempt,
  };
}

async function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") {
    return listPromise.autoPagingToArray({ limit: 1000 });
  }
  const rows = [];
  for await (const row of listPromise) rows.push(row);
  return rows;
}

async function createStripeDependencies(config, preparationAttemptId = null) {
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION });
  const invocationId = randomUUID();
  const sourceOptions = (key, accountId) => {
    if (!preparationAttemptId) {
      throw new Error("payout source mutation requires a durable preparation attempt");
    }
    return {
      idempotencyKey:
        `grainline-connect-payout-${config.expectedCommit}-${config.ciRunId}`
        + `-${preparationAttemptId}-${key}`,
      ...(accountId ? { stripeAccount: accountId } : {}),
    };
  };
  const endpointOptions = (disabled) => ({
    idempotencyKey:
      `grainline-connect-payout-${config.expectedCommit}-${invocationId}`
      + `-${disabled ? "connect-disable" : "connect-enable"}`,
  });
  return {
    listClassicEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    listV2Destinations: () => listAll(stripe.v2.core.eventDestinations.list({
      include: ["webhook_endpoint.url"],
      limit: 100,
    })),
    updateConnect: (id, params) => stripe.webhookEndpoints.update(
      id,
      params,
      endpointOptions(params.disabled === true),
    ),
    createCanaryAccount: (params) => stripe.accounts.create(
      params,
      sourceOptions("account-create"),
    ),
    retrieveAccount: (id) => stripe.accounts.retrieve(id),
    deleteAccount: (id) => stripe.accounts.del(id),
    createFundingCharge: (accountId, params) => stripe.charges.create(
      params,
      sourceOptions("funding-charge", accountId),
    ),
    retrieveBalance: (accountId) => stripe.balance.retrieve({ stripeAccount: accountId }),
    createPayout: (accountId, params) => stripe.payouts.create(
      params,
      sourceOptions("failed-payout", accountId),
    ),
    retrievePayout: (accountId, id) => stripe.payouts.retrieve(
      id,
      { stripeAccount: accountId },
    ),
    listPayoutFailedEvents: (accountId, createdAfter) => listAll(stripe.events.list(
      { created: { gte: createdAfter }, limit: 100, type: "payout.failed" },
      { stripeAccount: accountId },
    )),
    retrieveEvent: (accountId, id) => stripe.events.retrieve(
      id,
      { stripeAccount: accountId },
    ),
    resendEvent({ accountId, endpointId, eventId, secretKey, stripeCliPath }) {
      const cliConfigRoot = mkdtempSync(path.join(os.tmpdir(), "grainline-stripe-cli-"));
      try {
        const cliEnvironment = childProcessEnvironment({
          STRIPE_API_KEY: secretKey,
          XDG_CONFIG_HOME: cliConfigRoot,
        });
        const cliVersion = command(stripeCliPath, ["version"], {
          env: cliEnvironment,
          label: "Stripe CLI version check",
        }).trim();
        if (cliVersion !== `stripe version ${STRIPE_CLI_VERSION}`) {
          throw new Error(`Stripe CLI version drifted from ${STRIPE_CLI_VERSION}`);
        }
        command(stripeCliPath, [
          "events",
          "resend",
          eventId,
          "--webhook-endpoint",
          endpointId,
          "--account",
          accountId,
          "--confirm",
          "--color",
          "off",
        ], {
          env: cliEnvironment,
          label: "Stripe exact event resend",
        });
      } finally {
        rmSync(cliConfigRoot, { force: true, recursive: true });
      }
    },
  };
}

export async function runStripeConnectSignedPayoutProof({
  env = process.env,
  dependencies = {},
} = {}) {
  const config = parseStripeConnectPayoutProofConfig(env);
  const local = { ...createLocalDependencies(config), ...dependencies };
  assertExactGitAndCi(await local.currentGitState(), await local.ciRun(), config);
  normalizeProject(await local.readVercelProject());
  assertSensitiveProductionVariable(await local.listVercelEnvironment());
  assertCutoverEvidence(await local.readCutoverEvidence(), config);
  const preparationEvidence = config.mode === "prove"
    ? assertPreparationEvidence(await local.readPreparationEvidence(), config)
    : null;
  await assertPublicDeployment(local, config);

  const preparationAttempt = config.mode === "prepare"
    ? await local.reserveOrResumePreparationAttempt(config)
    : null;

  const stripeDefaults = dependencies.listClassicEndpoints
    ? {}
    : await createStripeDependencies(config, preparationAttempt?.attemptId);
  const deps = { ...local, ...stripeDefaults, ...dependencies };
  const provider = await readProviderState(deps);
  const allowedStages = config.mode === "prepare" ? new Set([3]) : new Set([3, 4]);
  if (!allowedStages.has(provider.stage)) {
    throw new Error(
      `signed payout proof mode ${config.mode} received illegal provider stage ${provider.stage}`,
    );
  }
  if (config.mode === "prove") {
    const completedPayload = await (
      deps.readExistingFinalEvidence ?? readExistingFinalEvidence
    )(config);
    if (completedPayload) {
      const completed = assertFinalProofEvidence(completedPayload, config);
      if (
        completed.stripe.accountIdSha256 !== preparationEvidence.stripe.accountIdSha256
        || completed.stripe.payoutIdSha256 !== preparationEvidence.stripe.payoutIdSha256
        || completed.stripe.eventIdSha256 !== preparationEvidence.stripe.eventIdSha256
      ) {
        throw new Error("completed signed proof evidence does not bind preparation evidence");
      }
      if (provider.stage !== 4) {
        throw new Error("completed signed proof evidence requires enabled provider stage 4");
      }
      if (existsSync(config.handoffPath)) {
        const handoff = await (deps.readHandoff ?? readHandoff)(config);
        assertFinalProofEvidence(completed, config, handoff);
        await (deps.removeHandoff ?? unlinkSync)(config.handoffPath);
      }
      const remainingAttempt = await (
        deps.readPreparationAttempt ?? readPreparationAttempt
      )(config, { required: false });
      if (remainingAttempt) {
        if (
          !remainingAttempt.stripeAccountId
          || sha256(remainingAttempt.stripeAccountId)
            !== completed.stripe.accountIdSha256
        ) {
          throw new Error("completed proof does not bind the remaining preparation attempt");
        }
        await (deps.removePreparationAttempt ?? removePreparationAttempt)(config);
      }
      return completed;
    }
  }
  return config.mode === "prepare"
    ? preparePayoutCanary({ config, deps, preparationAttempt })
    : proveSignedDelivery({
      config,
      deps,
      preparationAttempt: await (
        deps.readPreparationAttempt ?? readPreparationAttempt
      )(config),
      preparationEvidence,
    });
}

async function main() {
  try {
    const result = await runStripeConnectSignedPayoutProof();
    process.stdout.write(`${JSON.stringify({
      ciRunId: result.ciRunId,
      commit: result.commit,
      deploymentId: result.deploymentId,
      phase: result.phase,
      status: result.status,
    })}\n`);
  } catch (error) {
    process.stderr.write(`Stripe Connect signed payout proof failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
