#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  REVIEWED_DATABASE_NAME,
  REVIEWED_DATABASE_REGION,
  REVIEWED_ENDPOINT_ID,
  REVIEWED_OWNER_ROLE,
  REVIEWED_RUNTIME_ROLE,
  REVIEWED_VERCEL_CLI_PATH,
  REVIEWED_VERCEL_PROJECT,
  assertReviewedVercelCli,
  assertReviewedVercelProject,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  MIGRATION_DIGEST_VARIABLE_NAME,
  MIGRATION_SECRET_NAME,
  REVIEWED_GITHUB_REPOSITORY,
  loadSeparationLocalDatabaseEnvironment,
  readGithubMigrationState,
  updateGithubMigrationCredential,
  updateSeparationLocalDirectUrl,
} from "./runtime-db-credential-separation-operator.mjs";
import {
  buildNeonRuntimePoolerUrl,
  buildNeonOwnerDirectUrl,
  readReviewedNeonOperation,
  readReviewedNeonOwnerRoleMetadata,
  readReviewedNeonRuntimeRoleMetadata,
  resetReviewedNeonOwnerPassword,
  resetReviewedNeonRuntimePassword,
  revealReviewedNeonOwnerPassword,
  revealReviewedNeonRuntimePassword,
  verifyReviewedNeonTarget,
  waitForReviewedNeonOperations,
} from "./neon-owner-password-control.mjs";
import {
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import {
  STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
  parseStripeWebhookEventForcePostflightConfig,
  runStripeWebhookEventForcePostflight,
} from "./stripe-webhook-event-force-production-postflight.mjs";

const { Client } = pg;

export const RECOVERY_CONFIRMATION =
  "rotate-only-runtime-and-owner-then-prove-stripe-force";
export const FORCE_RELEASE_COMMIT =
  "ea19fa0ace85dd61868667022c45afb3cf3218fa";
export const FORCE_MAIN_CI_RUN_ID = 31716577153;
export const FORCE_MIGRATION_RUN_ID = 31717354633;
export const DEPLOYED_SOURCE_COMMIT =
  "69c14c0618ea7ab9c74756422273d17d66db7efa";
export const PRIOR_DEPLOYMENT_ID = "dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP";
export const PRIOR_DEPLOYMENT_URL =
  "grainline-luhwmzddm-drew-youngs-projects.vercel.app";
export const REVIEWED_VERCEL_SCOPE = "drew-youngs-projects";
export const RECOVERY_STATE_PATH =
  "/Users/drewyoung/grainline/.env.database-credential-recovery-20260813.json";
export const RECOVERY_EVIDENCE_PATH =
  "/Users/drewyoung/grainline-rollout-evidence/database-credential-recovery-20260813.json";
export const FORCE_POSTFLIGHT_EVIDENCE_PATH =
  "/Users/drewyoung/grainline-rollout-evidence/stripe-webhook-event-force-production-postflight-ea19fa0ace85dd61868667022c45afb3cf3218fa.json";
export const DEPLOY_SOURCE_DIRECTORY =
  "/private/tmp/grainline-database-credential-production-source-20260813";
export const FORCE_POSTFLIGHT_DIRECTORY =
  "/private/tmp/grainline-stripe-force-postflight-ea19fa0a-recovery";
export const RECOVERY_RELEASE_MANIFEST_PATH =
  "docs/database-credential-recovery-release.json";

const LOCAL_RUNTIME_PATH = "/Users/drewyoung/grainline/.env.local";
const LEGACY_ENV_PATH = "/Users/drewyoung/grainline/.env";
const GH_PATH = "/opt/homebrew/bin/gh";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RECOVERY_STAGES = Object.freeze([
  "preflight",
  "runtime-reset-started",
  "runtime-reset-finished",
  "runtime-provider-updated",
  "runtime-deployment-ready",
  "runtime-deployment-promoted",
  "runtime-verified",
  "owner-reset-started",
  "owner-reset-finished",
  "owner-consumers-updated",
  "owner-verified",
  "local-converged",
  "postflight-passed",
  "complete",
]);
const TERMINAL_NEON_STATUSES = new Set(["finished", "skipped"]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactPrivateFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) throw new Error(`${label} must be a mode-0600 regular file owned by the operator`);
  return stat;
}

function writeAtomicPrivate(filePath, source, { replace = false } = {}) {
  const temporaryPath = `${filePath}.tmp`;
  if (existsSync(temporaryPath) || (!replace && existsSync(filePath))) {
    throw new Error("private recovery destination is not fresh");
  }
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, source, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, 0o600);
  exactPrivateFile(filePath, "private recovery file");
}

function parseAssignment(source, key) {
  const matches = source.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`));
  if (matches.length !== 1) throw new Error(`${key} assignment count is invalid`);
  const raw = matches[0].slice(key.length + 1);
  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith("'") && raw.endsWith("'"))
  ) return raw.slice(1, -1);
  if (raw === "" || /\s/.test(raw)) throw new Error(`${key} assignment is invalid`);
  return raw;
}

export function parseRecoveryConfig(env = process.env) {
  if (env.DATABASE_CREDENTIAL_RECOVERY_CONFIRM !== RECOVERY_CONFIRMATION) {
    throw new Error("database credential recovery confirmation is invalid");
  }
  if (
    typeof env.DATABASE_URL === "string"
    || privilegedDatabaseEnvironmentKeys(env).length > 0
    || unreviewedPostgresUrlEnvironmentKeys(env).length > 0
  ) throw new Error("database credential recovery rejects ambient PostgreSQL credentials");
  const operatorCommit = required(env, "DATABASE_CREDENTIAL_RECOVERY_OPERATOR_COMMIT");
  if (!COMMIT_PATTERN.test(operatorCommit)) {
    throw new Error("database credential recovery operator commit is invalid");
  }
  const operatorCiRunId = Number(required(
    env,
    "DATABASE_CREDENTIAL_RECOVERY_OPERATOR_CI_RUN_ID",
  ));
  if (!Number.isSafeInteger(operatorCiRunId) || operatorCiRunId <= 0) {
    throw new Error("database credential recovery operator CI run is invalid");
  }
  return Object.freeze({ operatorCiRunId, operatorCommit });
}

export function assertExactGitState(state, expectedCommit) {
  if (state?.head !== expectedCommit || state.status !== "") {
    throw new Error("database credential recovery requires the exact clean operator commit");
  }
  return Object.freeze({ clean: true, head: state.head });
}

export function readRecoveryReleaseManifest(cwd = process.cwd()) {
  const filePath = path.join(cwd, RECOVERY_RELEASE_MANIFEST_PATH);
  if (!existsSync(filePath)) {
    throw new Error("database credential recovery release manifest is missing");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("database credential recovery release manifest is invalid JSON");
  }
  if (
    manifest?.schemaVersion !== 1
    || !COMMIT_PATTERN.test(manifest.implementationCommit)
    || !/^[0-9a-f]{64}$/.test(manifest.operatorSourceSha256)
    || manifest.deployedSourceCommit !== DEPLOYED_SOURCE_COMMIT
    || manifest.forceReleaseCommit !== FORCE_RELEASE_COMMIT
    || manifest.forceMainCiRunId !== FORCE_MAIN_CI_RUN_ID
    || manifest.forceMigrationRunId !== FORCE_MIGRATION_RUN_ID
  ) throw new Error("database credential recovery release manifest drifted");
  return Object.freeze({ ...manifest });
}

export function assertRecoveryReleaseGitState(state, config, manifest, operatorSource) {
  if (
    state?.head !== config.operatorCommit
    || state.status !== ""
    || state.parents?.length !== 1
    || state.parents[0] !== manifest.implementationCommit
    || JSON.stringify(state.changedPaths) !== JSON.stringify([
      RECOVERY_RELEASE_MANIFEST_PATH,
    ])
    || sha256(operatorSource) !== manifest.operatorSourceSha256
  ) throw new Error("database credential recovery release commit is not exact");
  return Object.freeze({
    clean: true,
    head: state.head,
    implementationCommit: manifest.implementationCommit,
    operatorSourceSha256: manifest.operatorSourceSha256,
  });
}

function readGitState(cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const parentLine = run(["rev-list", "--parents", "-n", "1", "HEAD"])
    .split(/\s+/);
  return Object.freeze({
    head: parentLine[0],
    parents: parentLine.slice(1),
    changedPaths: run([
      "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD",
    ]).split(/\r?\n/).filter(Boolean).sort(),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

function safeChildEnvironment(extra = {}) {
  const child = {};
  for (const key of [
    "HOME", "LANG", "LC_ALL", "NODE_EXTRA_CA_CERTS", "PATH",
    "SSL_CERT_DIR", "SSL_CERT_FILE", "TMPDIR", "USER",
  ]) {
    if (typeof process.env[key] === "string") child[key] = process.env[key];
  }
  return { ...child, ...extra };
}

function runProvider(command, args, { cwd, input, json = false, timeout = 45_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: safeChildEnvironment(),
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("credential recovery provider command failed");
  }
  if (!json) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("credential recovery provider response was not valid JSON");
  }
}

export function normalizeRecoveryVercelState(
  projectPayload,
  sharedPayload = { data: [], pagination: { count: 0, next: null } },
) {
  const records = Array.isArray(projectPayload?.envs) ? projectPayload.envs : [];
  const sharedRecords = sharedPayload?.data;
  if (
    !Array.isArray(sharedRecords)
    || sharedPayload?.pagination?.next !== null
    || sharedPayload?.pagination?.count !== sharedRecords.length
  ) throw new Error("Vercel shared environment inventory is incomplete");
  const productionRecord = (key) => records.filter((entry) => (
    entry?.key === key
    && entry.type === "sensitive"
    && JSON.stringify(entry.target) === JSON.stringify(["production"])
    && (entry.gitBranch === null || entry.gitBranch === undefined)
  ));
  if (
    productionRecord("DATABASE_URL").length !== 1
    || productionRecord("RUNTIME_DB_ROLE").length !== 1
  ) throw new Error("Vercel production runtime credential structure drifted");
  const projectPrivilegedKeys = records
    .map((entry) => entry?.key)
    .filter((key) => privilegedDatabaseEnvironmentKeys({ [key]: true }).length > 0)
    .sort();
  const linkedSharedDatabaseKeys = sharedRecords
    .filter((entry) => (
      Array.isArray(entry?.projectId)
      && entry.projectId.includes(REVIEWED_VERCEL_PROJECT.projectId)
      && (
        entry.key === "DATABASE_URL"
        || entry.key === "RUNTIME_DB_ROLE"
        || privilegedDatabaseEnvironmentKeys({ [entry.key]: true }).length > 0
      )
    ))
    .map((entry) => entry.key)
    .sort();
  if (projectPrivilegedKeys.length > 0 || linkedSharedDatabaseKeys.length > 0) {
    throw new Error("Vercel regained a privileged or shared database credential");
  }
  return Object.freeze({
    stage: "runtime-only",
    presentPrivilegedKeys: [],
    projectPrivilegedKeys,
    sharedPrivilegedLinks: [],
    linkedSharedDatabaseKeys,
  });
}

function readRecoveryVercelState() {
  const projectEnvironment = runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "env", "ls", "--format", "json", "--no-color",
  ], { cwd: "/Users/drewyoung/grainline", json: true });
  const sharedEnvironment = runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "api", "/v1/env", "--raw", "--scope", REVIEWED_VERCEL_SCOPE,
    "--no-color",
  ], { cwd: "/Users/drewyoung/grainline", json: true });
  return normalizeRecoveryVercelState(projectEnvironment, sharedEnvironment);
}

export function normalizeGithubRun(run, expected) {
  if (
    run?.id !== expected.id
    || run.name !== expected.name
    || run.event !== expected.event
    || run.head_sha !== expected.headSha
    || run.status !== "completed"
    || run.conclusion !== "success"
  ) throw new Error("reviewed GitHub Actions run drifted");
  return Object.freeze({
    id: run.id,
    name: run.name,
    headSha: run.head_sha,
    conclusion: run.conclusion,
  });
}

function readGithubRun(id, name, headSha, event) {
  return normalizeGithubRun(runProvider(GH_PATH, [
    "api",
    `repos/${REVIEWED_GITHUB_REPOSITORY}/actions/runs/${id}`,
  ], { json: true }), { id, name, headSha, event });
}

export function normalizePriorDeployment(deployment) {
  const aliases = Array.isArray(deployment?.alias) ? deployment.alias : [];
  if (
    deployment?.id !== PRIOR_DEPLOYMENT_ID
    || deployment.projectId !== REVIEWED_VERCEL_PROJECT.projectId
    || deployment.readyState !== "READY"
    || deployment.target !== "production"
    || deployment.source !== "cli"
    || deployment.url !== PRIOR_DEPLOYMENT_URL
    || deployment.meta?.gitCommitSha !== DEPLOYED_SOURCE_COMMIT
    || deployment.meta.gitCommitRef !== "HEAD"
    || !["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app"]
      .every((alias) => aliases.includes(alias))
  ) throw new Error("current production deployment drifted from the recovery boundary");
  return Object.freeze({
    id: deployment.id,
    sourceCommit: deployment.meta.gitCommitSha,
    url: deployment.url,
  });
}

function readDeployment(deploymentId) {
  return runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "api",
    `/v13/deployments/${deploymentId}`,
    "--raw",
    "--scope",
    REVIEWED_VERCEL_SCOPE,
    "--no-color",
  ], { cwd: "/Users/drewyoung/grainline", json: true });
}

export function recoveryDeploymentMarker(stateCreatedAt) {
  if (!Number.isFinite(Date.parse(stateCreatedAt))) {
    throw new Error("replacement deployment marker timestamp is invalid");
  }
  return sha256(`grainline-database-credential-recovery:${stateCreatedAt}`);
}

export function normalizeCandidateDeployment(deployment, stateCreatedAt) {
  if (
    deployment?.projectId !== REVIEWED_VERCEL_PROJECT.projectId
    || deployment.readyState !== "READY"
    || deployment.target !== "production"
    || typeof deployment.id !== "string"
    || !/^dpl_[A-Za-z0-9]+$/.test(deployment.id)
    || deployment.id === PRIOR_DEPLOYMENT_ID
    || deployment.source !== "cli"
    || deployment.meta?.gitCommitSha !== DEPLOYED_SOURCE_COMMIT
    || deployment.meta.gitCommitRef !== "HEAD"
    || deployment.meta.grainlineCredentialRecovery
      !== recoveryDeploymentMarker(stateCreatedAt)
    || typeof deployment.url !== "string"
    || !deployment.url.endsWith(".vercel.app")
  ) throw new Error("replacement deployment does not match the exact reviewed source");
  return Object.freeze({ id: deployment.id, url: deployment.url });
}

export function normalizeReplacementDeploymentInventory(payload, stateCreatedAt) {
  const createdAfter = Date.parse(stateCreatedAt);
  const marker = recoveryDeploymentMarker(stateCreatedAt);
  const deployments = payload?.deployments;
  if (
    !Number.isFinite(createdAfter)
    || !Array.isArray(deployments)
    || deployments.length >= 100
    || (payload?.pagination?.count !== undefined
      && payload.pagination.count !== deployments.length)
  ) throw new Error("replacement deployment inventory is incomplete");
  const ids = deployments.filter((deployment) => {
    const id = deployment?.id ?? deployment?.uid;
    const createdAt = deployment?.createdAt ?? deployment?.created;
    return (
      typeof id === "string"
      && /^dpl_[A-Za-z0-9]+$/.test(id)
      && id !== PRIOR_DEPLOYMENT_ID
      && deployment?.projectId === REVIEWED_VERCEL_PROJECT.projectId
      && deployment.target === "production"
      && deployment.meta?.gitCommitSha === DEPLOYED_SOURCE_COMMIT
      && deployment.meta.gitCommitRef === "HEAD"
      && deployment.meta.grainlineCredentialRecovery === marker
      && Number.isFinite(createdAt)
      && createdAt >= createdAfter
    );
  }).map((deployment) => deployment.id ?? deployment.uid);
  if (ids.length > 1 || new Set(ids).size !== ids.length) {
    throw new Error("replacement deployment inventory is ambiguous");
  }
  return Object.freeze([...ids]);
}

function listReplacementDeploymentIds(stateCreatedAt) {
  const createdAfter = Date.parse(stateCreatedAt);
  const payload = runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "api",
    `/v6/deployments?projectId=${encodeURIComponent(
      REVIEWED_VERCEL_PROJECT.projectId,
    )}&target=production&limit=100&since=${createdAfter}`,
    "--raw",
    "--scope",
    REVIEWED_VERCEL_SCOPE,
    "--no-color",
  ], { cwd: DEPLOY_SOURCE_DIRECTORY, json: true });
  return normalizeReplacementDeploymentInventory(payload, stateCreatedAt);
}

async function waitForCandidateDeployment(deploymentId, stateCreatedAt) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const deployment = readDeployment(deploymentId);
    if (deployment?.readyState === "READY") {
      return normalizeCandidateDeployment(deployment, stateCreatedAt);
    }
    if (["ERROR", "CANCELED"].includes(deployment?.readyState)) {
      throw new Error("replacement deployment entered a terminal failure state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("replacement deployment did not become ready in time");
}

function exactRuntimeUrlFromLocal() {
  exactPrivateFile(LOCAL_RUNTIME_PATH, "local runtime environment");
  const url = parseAssignment(readFileSync(LOCAL_RUNTIME_PATH, "utf8"), "DATABASE_URL");
  assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: url,
    RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
  });
  return url;
}

function exactOwnerUrlFromLocal() {
  return loadSeparationLocalDatabaseEnvironment({}).DIRECT_URL;
}

export function freshRecoveryState(runtimeUrl, ownerUrl, config = {
  operatorCommit: "a".repeat(40),
  operatorCiRunId: 1,
}) {
  return Object.freeze({
    version: 2,
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    forceReleaseCommit: FORCE_RELEASE_COMMIT,
    stage: "preflight",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    priorRuntimeUrl: runtimeUrl,
    nextRuntimeUrl: null,
    runtimeOperations: [],
    replacementDeployment: null,
    priorOwnerUrl: ownerUrl,
    nextOwnerUrl: null,
    ownerOperations: [],
  });
}

export function validateRecoveryState(value) {
  const stageIndex = RECOVERY_STAGES.indexOf(value?.stage);
  if (
    value?.version !== 2
    || stageIndex < 0
    || !COMMIT_PATTERN.test(value.operatorCommit)
    || !Number.isSafeInteger(value.operatorCiRunId)
    || value.operatorCiRunId <= 0
    || value.deployedSourceCommit !== DEPLOYED_SOURCE_COMMIT
    || value.forceReleaseCommit !== FORCE_RELEASE_COMMIT
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isFinite(Date.parse(value.updatedAt))
    || typeof value.priorRuntimeUrl !== "string"
    || typeof value.priorOwnerUrl !== "string"
    || !Array.isArray(value.runtimeOperations)
    || !Array.isArray(value.ownerOperations)
  ) throw new Error("private credential recovery state is invalid");
  assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: value.priorRuntimeUrl,
    RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
  });
  buildNeonOwnerDirectUrl(
    value.priorOwnerUrl,
    decodeURIComponent(new URL(value.priorOwnerUrl).password),
  );
  if (value.nextRuntimeUrl !== null) {
    assertVercelRuntimeDatabaseIsolation({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: value.nextRuntimeUrl,
      RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
    });
  }
  if (value.nextOwnerUrl !== null) {
    buildNeonOwnerDirectUrl(
      value.nextOwnerUrl,
      decodeURIComponent(new URL(value.nextOwnerUrl).password),
    );
  }
  for (const key of [
    "runtimeRoleUpdatedAtBefore",
    "runtimeRoleUpdatedAtAfter",
    "ownerRoleUpdatedAtBefore",
    "ownerRoleUpdatedAtAfter",
  ]) {
    if (value[key] !== undefined && !Number.isFinite(Date.parse(value[key]))) {
      throw new Error("private credential recovery role timestamp is invalid");
    }
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    throw new Error("private credential recovery timestamps moved backward");
  }
  const runtimeFinished = RECOVERY_STAGES.indexOf("runtime-reset-finished");
  if (stageIndex >= runtimeFinished) {
    if (
      value.nextRuntimeUrl === null
      || value.nextRuntimeUrl === value.priorRuntimeUrl
      || typeof value.runtimeRoleUpdatedAtBefore !== "string"
      || typeof value.runtimeRoleUpdatedAtAfter !== "string"
      || Date.parse(value.runtimeRoleUpdatedAtAfter)
        <= Date.parse(value.runtimeRoleUpdatedAtBefore)
    ) throw new Error("private runtime credential recovery state is incomplete");
  }
  const deploymentReady = RECOVERY_STAGES.indexOf("runtime-deployment-ready");
  if (stageIndex >= deploymentReady) {
    if (
      typeof value.replacementDeployment?.id !== "string"
      || !/^dpl_[A-Za-z0-9]+$/.test(value.replacementDeployment.id)
      || value.replacementDeployment.id === PRIOR_DEPLOYMENT_ID
      || typeof value.replacementDeployment.url !== "string"
      || !value.replacementDeployment.url.endsWith(".vercel.app")
    ) throw new Error("private replacement deployment state is incomplete");
  }
  const ownerFinished = RECOVERY_STAGES.indexOf("owner-reset-finished");
  if (stageIndex >= ownerFinished) {
    if (
      value.nextOwnerUrl === null
      || value.nextOwnerUrl === value.priorOwnerUrl
      || typeof value.ownerRoleUpdatedAtBefore !== "string"
      || typeof value.ownerRoleUpdatedAtAfter !== "string"
      || Date.parse(value.ownerRoleUpdatedAtAfter)
        <= Date.parse(value.ownerRoleUpdatedAtBefore)
    ) throw new Error("private owner credential recovery state is incomplete");
  }
  return Object.freeze({ ...value });
}

function assertRecoveryStateRelease(state, config) {
  if (
    state.operatorCommit !== config.operatorCommit
    || state.operatorCiRunId !== config.operatorCiRunId
  ) throw new Error("private credential recovery state belongs to another release");
  return state;
}

function readRecoveryState() {
  exactPrivateFile(RECOVERY_STATE_PATH, "private credential recovery state");
  return validateRecoveryState(JSON.parse(readFileSync(RECOVERY_STATE_PATH, "utf8")));
}

function writeRecoveryState(state, stage, patch = {}) {
  const currentIndex = RECOVERY_STAGES.indexOf(state.stage);
  const nextIndex = RECOVERY_STAGES.indexOf(stage);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
    throw new Error("credential recovery stage transition is not restart-safe");
  }
  const next = validateRecoveryState({
    ...state,
    ...patch,
    stage,
    updatedAt: new Date().toISOString(),
  });
  writeAtomicPrivate(
    RECOVERY_STATE_PATH,
    `${JSON.stringify(next, null, 2)}\n`,
    { replace: existsSync(RECOVERY_STATE_PATH) },
  );
  return next;
}

export function classifyCredentialProbe(error) {
  if (error?.code === "28P01") return "rejected";
  throw new Error("credential probe failed without definitive password rejection");
}

async function proveDatabaseIdentity(connectionString, role, { expectForce = false } = {}) {
  const client = new Client({
    connectionString,
    application_name: "grainline-database-credential-recovery",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  try {
    const identity = (await client.query(`
      SELECT current_database() AS database_name,
             CURRENT_USER AS current_user_name,
             SESSION_USER AS session_user_name,
             role.rolsuper,
             role.rolbypassrls,
             role.rolinherit,
             role.rolcanlogin,
             role.rolcreatedb,
             role.rolcreaterole,
             role.rolreplication
        FROM pg_catalog.pg_roles AS role
       WHERE role.rolname = CURRENT_USER
    `)).rows[0];
    assert.equal(identity?.database_name, REVIEWED_DATABASE_NAME);
    assert.equal(identity.current_user_name, role);
    assert.equal(identity.session_user_name, role);
    assert.equal(identity.rolcanlogin, true);
    if (role === REVIEWED_RUNTIME_ROLE) {
      assert.equal(identity.rolsuper, false);
      assert.equal(identity.rolbypassrls, false);
      assert.equal(identity.rolinherit, false);
      assert.equal(identity.rolcreatedb, false);
      assert.equal(identity.rolcreaterole, false);
      assert.equal(identity.rolreplication, false);
      if (expectForce) {
        const table = (await client.query(`
          SELECT relrowsecurity, relforcerowsecurity
            FROM pg_catalog.pg_class
           WHERE oid = 'public."StripeWebhookEvent"'::regclass
        `)).rows[0];
        assert.deepEqual(table, { relrowsecurity: true, relforcerowsecurity: true });
      }
    } else {
      assert.equal(identity.rolsuper, false);
      assert.equal(identity.rolbypassrls, true);
    }
    return Object.freeze({ databaseName: identity.database_name, role });
  } finally {
    await client.end();
  }
}

async function expectCredentialRejected(connectionString) {
  try {
    await proveDatabaseIdentity(connectionString, decodeURIComponent(new URL(connectionString).username));
  } catch (error) {
    return classifyCredentialProbe(error) === "rejected";
  }
  throw new Error("superseded database password still authenticates");
}

function updateVercelRuntimeCredential(runtimeUrl) {
  runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "env", "update", "DATABASE_URL", "production",
    "--sensitive", "--yes", "--scope", REVIEWED_VERCEL_SCOPE, "--no-color",
  ], { cwd: "/Users/drewyoung/grainline", input: `${runtimeUrl}\n` });
}

function createReplacementDeployment(stateCreatedAt) {
  const marker = recoveryDeploymentMarker(stateCreatedAt);
  const output = runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "deploy", DEPLOY_SOURCE_DIRECTORY,
    "--prod", "--skip-domain", "--force", "--yes",
    "--project", REVIEWED_VERCEL_PROJECT.projectName,
    "--scope", REVIEWED_VERCEL_SCOPE,
    "--meta", `gitCommitSha=${DEPLOYED_SOURCE_COMMIT}`,
    "--meta", "gitCommitRef=HEAD",
    "--meta", `grainlineCredentialRecovery=${marker}`,
    "--no-color",
  ], { cwd: DEPLOY_SOURCE_DIRECTORY, timeout: 15 * 60_000 });
  const deploymentUrl = output.split(/\r?\n/).find((line) => (
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(line.trim())
  ))?.trim();
  if (!deploymentUrl) throw new Error("replacement deployment URL was not returned");
  return normalizeCandidateDeployment(
    readDeployment(new URL(deploymentUrl).hostname),
    stateCreatedAt,
  );
}

function promoteReplacementDeployment(deployment, stateCreatedAt) {
  const canonicalAliases = [
    "thegrainline.com",
    "www.thegrainline.com",
    "grainline.vercel.app",
  ];
  const before = readDeployment(deployment.id);
  const beforeAliases = Array.isArray(before.alias) ? before.alias : [];
  const canonicalBefore = canonicalAliases.filter((alias) => (
    beforeAliases.includes(alias)
  ));
  if (canonicalBefore.length > 0 && canonicalBefore.length < canonicalAliases.length) {
    throw new Error("replacement deployment has a partial canonical alias state");
  }
  if (canonicalBefore.length === canonicalAliases.length) {
    return normalizeCandidateDeployment(before, stateCreatedAt);
  }
  runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "promote", deployment.id,
    "--yes", "--scope", REVIEWED_VERCEL_SCOPE, "--no-color",
  ], { cwd: DEPLOY_SOURCE_DIRECTORY, timeout: 5 * 60_000 });
  const promoted = readDeployment(deployment.id);
  const aliases = Array.isArray(promoted.alias) ? promoted.alias : [];
  if (!canonicalAliases.every((alias) => aliases.includes(alias))) {
    throw new Error("replacement deployment did not receive all canonical aliases");
  }
  return normalizeCandidateDeployment(promoted, stateCreatedAt);
}

async function readLiveRoutes() {
  const results = [];
  for (const route of ["/", "/api/health"]) {
    const response = await fetch(new URL(route, "https://thegrainline.com"), {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    results.push({
      route,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
    });
    await response.body?.cancel();
  }
  if (
    results[0]?.status !== 200
    || !results[0].contentType.startsWith("text/html")
    || results[1]?.status !== 200
    || !results[1].contentType.startsWith("application/json")
  ) throw new Error("production route smoke failed after credential promotion");
  return Object.freeze(results);
}

function replaceLocalRuntimeUrl(runtimeUrl) {
  exactPrivateFile(LOCAL_RUNTIME_PATH, "local runtime environment");
  const source = readFileSync(LOCAL_RUNTIME_PATH, "utf8");
  const lines = source.split(/\r?\n/);
  const matches = lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith("DATABASE_URL="));
  if (matches.length !== 1) throw new Error("local DATABASE_URL assignment count drifted");
  lines[matches[0].index] = `DATABASE_URL="${runtimeUrl}"`;
  writeAtomicPrivate(LOCAL_RUNTIME_PATH, lines.join(source.includes("\r\n") ? "\r\n" : "\n"), {
    replace: true,
  });
}

function removeLegacyDatabaseAssignments() {
  if (!existsSync(LEGACY_ENV_PATH)) return Object.freeze({ changed: false, removed: [] });
  exactPrivateFile(LEGACY_ENV_PATH, "legacy environment");
  const source = readFileSync(LEGACY_ENV_PATH, "utf8");
  const removed = [];
  const lines = source.split(/\r?\n/).filter((line) => {
    const key = line.slice(0, line.indexOf("="));
    if (["DATABASE_URL", "DIRECT_URL"].includes(key)) {
      removed.push(key);
      return false;
    }
    return true;
  });
  if (removed.length > 0) {
    writeAtomicPrivate(LEGACY_ENV_PATH, lines.join(source.includes("\r\n") ? "\r\n" : "\n"), {
      replace: true,
    });
  }
  return Object.freeze({ changed: removed.length > 0, removed: removed.sort() });
}

function sanitizedEvidence(config, state, liveRoutes) {
  return Object.freeze({
    schemaVersion: 1,
    operation: "database-credential-exposure-recovery",
    status: "passed",
    acceptanceEligible: true,
    issueCount: 0,
    completedAt: new Date().toISOString(),
    operator: { commit: config.operatorCommit, ciRunId: config.operatorCiRunId },
    stripeForce: {
      releaseCommit: FORCE_RELEASE_COMMIT,
      mainCiRunId: FORCE_MAIN_CI_RUN_ID,
      migrationRunId: FORCE_MIGRATION_RUN_ID,
      postflightEvidence: path.basename(FORCE_POSTFLIGHT_EVIDENCE_PATH),
    },
    deployment: {
      priorId: PRIOR_DEPLOYMENT_ID,
      replacementId: state.replacementDeployment.id,
      sourceCommit: DEPLOYED_SOURCE_COMMIT,
      canonicalRoutes: liveRoutes,
    },
    credentials: {
      runtime: {
        role: REVIEWED_RUNTIME_ROLE,
        priorSha256: sha256(state.priorRuntimeUrl),
        replacementSha256: sha256(state.nextRuntimeUrl),
        priorRejected: true,
        replacementVerified: true,
      },
      owner: {
        role: REVIEWED_OWNER_ROLE,
        priorSha256: sha256(state.priorOwnerUrl),
        replacementSha256: sha256(state.nextOwnerUrl),
        priorRejected: true,
        replacementVerified: true,
      },
    },
    productionChangedByRecovery: [
      "neon_runtime_password",
      "vercel_production_database_url",
      "vercel_exact_source_redeployment",
      "neon_owner_password",
      "github_production_migration_secret_and_digest",
    ],
    migrationsApplied: [],
    providerScopeOutsideRecoveryChanged: false,
  });
}

function readExactPrivateJson(filePath, label) {
  exactPrivateFile(filePath, label);
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return value;
}

export function validateForcePostflightEvidence(value, runtimeUrl) {
  if (
    value?.schemaVersion !== 1
    || value.operation !== "stripe-webhook-event-force-production-postflight"
    || value.source?.clean !== true
    || value.source.commit !== FORCE_RELEASE_COMMIT
    || value.target?.databaseName !== REVIEWED_DATABASE_NAME
    || value.target.databaseUrlSha256 !== sha256(runtimeUrl)
    || value.target.endpointId !== REVIEWED_ENDPOINT_ID
    || value.target.region !== REVIEWED_DATABASE_REGION
    || value.target.role !== REVIEWED_RUNTIME_ROLE
    || value.runs?.mainCiRunId !== FORCE_MAIN_CI_RUN_ID
    || value.runs.migrationRunId !== FORCE_MIGRATION_RUN_ID
    || value.proof?.postflightReadOnly !== true
    || value.proof.rlsEnabled !== true
    || value.proof.rlsForced !== true
    || value.proof.publicAuthority !== false
    || value.proof.runtimeTableOrColumnAuthority !== false
    || value.productionChangedByPostflight !== false
    || value.status !== "passed"
    || !Number.isFinite(Date.parse(value.completedAt))
  ) throw new Error("existing StripeWebhookEvent FORCE postflight evidence is invalid");
  return Object.freeze({ ...value });
}

function normalizedCanonicalRoutes(value) {
  if (
    !Array.isArray(value)
    || value.length !== 2
    || value[0]?.route !== "/"
    || value[0].status !== 200
    || typeof value[0].contentType !== "string"
    || !value[0].contentType.startsWith("text/html")
    || value[1]?.route !== "/api/health"
    || value[1].status !== 200
    || typeof value[1].contentType !== "string"
    || !value[1].contentType.startsWith("application/json")
  ) throw new Error("existing recovery route evidence is invalid");
  return Object.freeze(value.map((route) => Object.freeze({ ...route })));
}

export function validateRecoveryEvidence(value, config, state) {
  const routes = normalizedCanonicalRoutes(value?.deployment?.canonicalRoutes);
  if (
    value?.schemaVersion !== 1
    || value.operation !== "database-credential-exposure-recovery"
    || value.status !== "passed"
    || value.acceptanceEligible !== true
    || value.issueCount !== 0
    || !Number.isFinite(Date.parse(value.completedAt))
    || value.operator?.commit !== config.operatorCommit
    || value.operator.ciRunId !== config.operatorCiRunId
    || value.stripeForce?.releaseCommit !== FORCE_RELEASE_COMMIT
    || value.stripeForce.mainCiRunId !== FORCE_MAIN_CI_RUN_ID
    || value.stripeForce.migrationRunId !== FORCE_MIGRATION_RUN_ID
    || value.stripeForce.postflightEvidence
      !== path.basename(FORCE_POSTFLIGHT_EVIDENCE_PATH)
    || value.deployment.priorId !== PRIOR_DEPLOYMENT_ID
    || value.deployment.replacementId !== state.replacementDeployment.id
    || value.deployment.sourceCommit !== DEPLOYED_SOURCE_COMMIT
    || value.credentials?.runtime?.role !== REVIEWED_RUNTIME_ROLE
    || value.credentials.runtime.priorSha256 !== sha256(state.priorRuntimeUrl)
    || value.credentials.runtime.replacementSha256 !== sha256(state.nextRuntimeUrl)
    || value.credentials.runtime.priorRejected !== true
    || value.credentials.runtime.replacementVerified !== true
    || value.credentials?.owner?.role !== REVIEWED_OWNER_ROLE
    || value.credentials.owner.priorSha256 !== sha256(state.priorOwnerUrl)
    || value.credentials.owner.replacementSha256 !== sha256(state.nextOwnerUrl)
    || value.credentials.owner.priorRejected !== true
    || value.credentials.owner.replacementVerified !== true
    || JSON.stringify(value.productionChangedByRecovery) !== JSON.stringify([
      "neon_runtime_password",
      "vercel_production_database_url",
      "vercel_exact_source_redeployment",
      "neon_owner_password",
      "github_production_migration_secret_and_digest",
    ])
    || JSON.stringify(value.migrationsApplied) !== "[]"
    || value.providerScopeOutsideRecoveryChanged !== false
  ) throw new Error("existing database credential recovery evidence is invalid");
  return Object.freeze({ evidence: Object.freeze({ ...value }), routes });
}

function allOperationsFinished(operations) {
  return operations.length > 0
    && operations.every((operation) => TERMINAL_NEON_STATUSES.has(operation.status));
}

async function reconcileReset(state, role, dependencies) {
  const runtime = role === REVIEWED_RUNTIME_ROLE;
  const priorUrl = runtime ? state.priorRuntimeUrl : state.priorOwnerUrl;
  const nextKey = runtime ? "nextRuntimeUrl" : "nextOwnerUrl";
  const operationsKey = runtime ? "runtimeOperations" : "ownerOperations";
  let operations = state[operationsKey];
  if (operations.length > 0 && !allOperationsFinished(operations)) {
    operations = await dependencies.waitForNeonOperations(operations);
  }
  const revealedPassword = runtime
    ? dependencies.revealRuntimePassword()
    : dependencies.revealOwnerPassword();
  const revealedUrl = runtime
    ? buildNeonRuntimePoolerUrl(revealedPassword)
    : buildNeonOwnerDirectUrl(priorUrl, revealedPassword);
  if (state[nextKey] !== null && revealedUrl !== state[nextKey]) {
    throw new Error("Neon revealed a credential outside the private restart state");
  }
  if (state[nextKey] === null && revealedUrl === priorUrl) return { outcome: "not-reset", state };
  if (state[nextKey] === null && operations.length === 0) {
    const beforeKey = runtime
      ? "runtimeRoleUpdatedAtBefore"
      : "ownerRoleUpdatedAtBefore";
    const metadata = runtime
      ? dependencies.readRuntimeMetadata()
      : dependencies.readOwnerMetadata();
    if (
      typeof state[beforeKey] !== "string"
      || Date.parse(metadata.updatedAt) <= Date.parse(state[beforeKey])
    ) {
      throw new Error("Neon revealed a changed password without an advanced role timestamp");
    }
  }
  return { outcome: "reset-finished", state: { ...state, [nextKey]: revealedUrl, [operationsKey]: operations } };
}

export async function runCredentialRecovery(config, overrides = {}) {
  const dependencies = {
    readGitState,
    readGithubRun,
    readGithubState: readGithubMigrationState,
    updateGithubCredential: updateGithubMigrationCredential,
    readVercelState: readRecoveryVercelState,
    updateVercelRuntimeCredential,
    readDeployment,
    listReplacementDeploymentIds,
    waitForCandidateDeployment,
    createReplacementDeployment,
    promoteReplacementDeployment,
    verifyNeonTarget: verifyReviewedNeonTarget,
    readOwnerMetadata: readReviewedNeonOwnerRoleMetadata,
    readRuntimeMetadata: readReviewedNeonRuntimeRoleMetadata,
    resetRuntimePassword: resetReviewedNeonRuntimePassword,
    resetOwnerPassword: resetReviewedNeonOwnerPassword,
    revealRuntimePassword: revealReviewedNeonRuntimePassword,
    revealOwnerPassword: revealReviewedNeonOwnerPassword,
    readNeonOperation: readReviewedNeonOperation,
    waitForNeonOperations: waitForReviewedNeonOperations,
    proveDatabaseIdentity,
    expectCredentialRejected,
    readLiveRoutes,
    updateLocalOwnerUrl: updateSeparationLocalDirectUrl,
    replaceLocalRuntimeUrl,
    removeLegacyDatabaseAssignments,
    runForcePostflight: async (runtimeUrl) => {
      const originalCwd = process.cwd();
      process.chdir(FORCE_POSTFLIGHT_DIRECTORY);
      try {
        return await runStripeWebhookEventForcePostflight(
          parseStripeWebhookEventForcePostflightConfig({
        DATABASE_URL: runtimeUrl,
        STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_CONFIRM:
          STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
        STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH:
          FORCE_POSTFLIGHT_EVIDENCE_PATH,
        STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID:
          String(FORCE_MAIN_CI_RUN_ID),
        STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_MIGRATION_RUN_ID:
          String(FORCE_MIGRATION_RUN_ID),
        STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_RELEASE_COMMIT:
          FORCE_RELEASE_COMMIT,
          }),
        );
      } finally {
        process.chdir(originalCwd);
      }
    },
    ...overrides,
  };

  const manifest = readRecoveryReleaseManifest();
  const operatorSource = readFileSync(
    path.resolve("scripts/database-credential-exposure-recovery.mjs"),
    "utf8",
  );
  assertRecoveryReleaseGitState(
    dependencies.readGitState(),
    config,
    manifest,
    operatorSource,
  );
  assertExactGitState(
    dependencies.readGitState(DEPLOY_SOURCE_DIRECTORY),
    DEPLOYED_SOURCE_COMMIT,
  );
  assertExactGitState(
    dependencies.readGitState(FORCE_POSTFLIGHT_DIRECTORY),
    FORCE_RELEASE_COMMIT,
  );
  dependencies.readGithubRun(
    config.operatorCiRunId,
    "CI",
    config.operatorCommit,
    "push",
  );
  dependencies.readGithubRun(
    FORCE_MAIN_CI_RUN_ID,
    "CI",
    FORCE_RELEASE_COMMIT,
    "push",
  );
  dependencies.readGithubRun(
    FORCE_MIGRATION_RUN_ID,
    "Production Migrations",
    FORCE_RELEASE_COMMIT,
    "workflow_dispatch",
  );
  assertReviewedVercelCli();
  assertReviewedVercelProject("/Users/drewyoung/grainline");
  assertReviewedVercelProject(DEPLOY_SOURCE_DIRECTORY);
  dependencies.verifyNeonTarget();
  const vercel = dependencies.readVercelState();
  if (
    vercel.stage !== "runtime-only"
    || vercel.presentPrivilegedKeys.length !== 0
    || vercel.projectPrivilegedKeys.length !== 0
    || vercel.sharedPrivilegedLinks.length !== 0
  ) throw new Error("Vercel database isolation drifted before recovery");
  const github = dependencies.readGithubState();
  if (
    github.protectionVerified !== true
    || github.migrationSecret?.name !== MIGRATION_SECRET_NAME
    || github.digestVariable?.name !== MIGRATION_DIGEST_VARIABLE_NAME
  ) throw new Error("GitHub Production migration credential metadata drifted");

  let state;
  if (existsSync(RECOVERY_STATE_PATH)) {
    state = assertRecoveryStateRelease(readRecoveryState(), config);
  } else {
    normalizePriorDeployment(dependencies.readDeployment(PRIOR_DEPLOYMENT_ID));
    const runtimeUrl = exactRuntimeUrlFromLocal();
    const ownerUrl = exactOwnerUrlFromLocal();
    const runtimeMetadata = dependencies.readRuntimeMetadata();
    const ownerMetadata = dependencies.readOwnerMetadata();
    await dependencies.proveDatabaseIdentity(runtimeUrl, REVIEWED_RUNTIME_ROLE, { expectForce: true });
    await dependencies.proveDatabaseIdentity(ownerUrl, REVIEWED_OWNER_ROLE);
    state = {
      ...freshRecoveryState(runtimeUrl, ownerUrl, config),
      runtimeRoleUpdatedAtBefore: runtimeMetadata.updatedAt,
      ownerRoleUpdatedAtBefore: ownerMetadata.updatedAt,
    };
    writeAtomicPrivate(RECOVERY_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  }

  if (state.stage === "preflight" || state.stage === "runtime-reset-started") {
    if (state.stage === "preflight") {
      state = writeRecoveryState(state, "runtime-reset-started");
      const reset = dependencies.resetRuntimePassword();
      state = { ...state,
        nextRuntimeUrl: buildNeonRuntimePoolerUrl(reset.password),
        runtimeOperations: reset.operations,
      };
      writeAtomicPrivate(RECOVERY_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { replace: true });
    }
    const reconciliation = await reconcileReset(state, REVIEWED_RUNTIME_ROLE, dependencies);
    if (reconciliation.outcome !== "reset-finished") {
      throw new Error("runtime reset did not start; refusing to replay automatically");
    }
    const runtimeMetadata = dependencies.readRuntimeMetadata();
    if (
      typeof state.runtimeRoleUpdatedAtBefore !== "string"
      || Date.parse(runtimeMetadata.updatedAt) <= Date.parse(state.runtimeRoleUpdatedAtBefore)
    ) throw new Error("runtime role timestamp did not advance after reset");
    state = writeRecoveryState(reconciliation.state, "runtime-reset-finished", {
      runtimeRoleUpdatedAtAfter: runtimeMetadata.updatedAt,
    });
  }
  if (state.stage === "runtime-reset-finished") {
    dependencies.updateVercelRuntimeCredential(state.nextRuntimeUrl);
    state = writeRecoveryState(state, "runtime-provider-updated");
  }
  if (state.stage === "runtime-provider-updated") {
    const discovered = dependencies.listReplacementDeploymentIds(state.createdAt);
    if (!Array.isArray(discovered) || discovered.length > 1) {
      throw new Error("replacement deployment inventory is ambiguous");
    }
    const deployment = discovered.length === 1
      ? await dependencies.waitForCandidateDeployment(discovered[0], state.createdAt)
      : dependencies.createReplacementDeployment(state.createdAt);
    state = writeRecoveryState(state, "runtime-deployment-ready", {
      replacementDeployment: deployment,
    });
  }
  if (state.stage === "runtime-deployment-ready") {
    dependencies.promoteReplacementDeployment(
      state.replacementDeployment,
      state.createdAt,
    );
    state = writeRecoveryState(state, "runtime-deployment-promoted");
  }
  let liveRoutes = [];
  if (state.stage === "runtime-deployment-promoted") {
    await dependencies.proveDatabaseIdentity(
      state.nextRuntimeUrl,
      REVIEWED_RUNTIME_ROLE,
      { expectForce: true },
    );
    await dependencies.expectCredentialRejected(state.priorRuntimeUrl);
    liveRoutes = await dependencies.readLiveRoutes();
    state = writeRecoveryState(state, "runtime-verified");
  }
  if (state.stage === "runtime-verified" || state.stage === "owner-reset-started") {
    if (state.stage === "runtime-verified") {
      state = writeRecoveryState(state, "owner-reset-started");
      const reset = dependencies.resetOwnerPassword();
      state = { ...state,
        nextOwnerUrl: buildNeonOwnerDirectUrl(state.priorOwnerUrl, reset.password),
        ownerOperations: reset.operations,
      };
      writeAtomicPrivate(RECOVERY_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { replace: true });
    }
    const reconciliation = await reconcileReset(state, REVIEWED_OWNER_ROLE, dependencies);
    if (reconciliation.outcome !== "reset-finished") {
      throw new Error("owner reset did not start; refusing to replay automatically");
    }
    const ownerMetadata = dependencies.readOwnerMetadata();
    if (
      typeof state.ownerRoleUpdatedAtBefore !== "string"
      || Date.parse(ownerMetadata.updatedAt) <= Date.parse(state.ownerRoleUpdatedAtBefore)
    ) throw new Error("owner role timestamp did not advance after reset");
    state = writeRecoveryState(reconciliation.state, "owner-reset-finished", {
      ownerRoleUpdatedAtAfter: ownerMetadata.updatedAt,
    });
  }
  if (state.stage === "owner-reset-finished") {
    const digest = sha256(state.nextOwnerUrl);
    dependencies.updateGithubCredential(state.nextOwnerUrl, digest);
    dependencies.updateLocalOwnerUrl(state.nextOwnerUrl);
    state = writeRecoveryState(state, "owner-consumers-updated");
  }
  if (state.stage === "owner-consumers-updated") {
    await dependencies.proveDatabaseIdentity(state.nextOwnerUrl, REVIEWED_OWNER_ROLE);
    await dependencies.expectCredentialRejected(state.priorOwnerUrl);
    const githubAfter = dependencies.readGithubState();
    if (
      githubAfter.migrationSecret?.name !== MIGRATION_SECRET_NAME
      || githubAfter.digestVariable?.value !== sha256(state.nextOwnerUrl)
    ) throw new Error("GitHub owner credential consumers did not converge");
    state = writeRecoveryState(state, "owner-verified");
  }
  if (state.stage === "owner-verified") {
    dependencies.replaceLocalRuntimeUrl(state.nextRuntimeUrl);
    dependencies.removeLegacyDatabaseAssignments();
    state = writeRecoveryState(state, "local-converged");
  }
  if (state.stage === "local-converged") {
    if (existsSync(FORCE_POSTFLIGHT_EVIDENCE_PATH)) {
      validateForcePostflightEvidence(
        readExactPrivateJson(
          FORCE_POSTFLIGHT_EVIDENCE_PATH,
          "StripeWebhookEvent FORCE postflight evidence",
        ),
        state.nextRuntimeUrl,
      );
    } else {
      await dependencies.runForcePostflight(state.nextRuntimeUrl);
      validateForcePostflightEvidence(
        readExactPrivateJson(
          FORCE_POSTFLIGHT_EVIDENCE_PATH,
          "StripeWebhookEvent FORCE postflight evidence",
        ),
        state.nextRuntimeUrl,
      );
    }
    state = writeRecoveryState(state, "postflight-passed");
  }
  if (state.stage === "postflight-passed") {
    if (existsSync(RECOVERY_EVIDENCE_PATH)) {
      const accepted = validateRecoveryEvidence(
        readExactPrivateJson(
          RECOVERY_EVIDENCE_PATH,
          "database credential recovery evidence",
        ),
        config,
        state,
      );
      liveRoutes = accepted.routes;
    } else {
      if (liveRoutes.length === 0) liveRoutes = await dependencies.readLiveRoutes();
      const evidence = sanitizedEvidence(config, state, liveRoutes);
      writeAtomicPrivate(RECOVERY_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
      validateRecoveryEvidence(evidence, config, state);
    }
    state = writeRecoveryState(state, "complete");
  }
  if (state.stage !== "complete") throw new Error("credential recovery stopped before completion");
  validateForcePostflightEvidence(
    readExactPrivateJson(
      FORCE_POSTFLIGHT_EVIDENCE_PATH,
      "StripeWebhookEvent FORCE postflight evidence",
    ),
    state.nextRuntimeUrl,
  );
  validateRecoveryEvidence(
    readExactPrivateJson(
      RECOVERY_EVIDENCE_PATH,
      "database credential recovery evidence",
    ),
    config,
    state,
  );
  unlinkSync(RECOVERY_STATE_PATH);
  return Object.freeze({
    status: "passed",
    acceptanceEligible: true,
    runtimeOldCredentialRejected: true,
    ownerOldCredentialRejected: true,
    replacementDeploymentId: state.replacementDeployment.id,
    forcePostflightPassed: true,
  });
}

async function main() {
  try {
    const result = await runCredentialRecovery(parseRecoveryConfig());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "Database credential exposure recovery stopped fail-closed; inspect the private restart state.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
