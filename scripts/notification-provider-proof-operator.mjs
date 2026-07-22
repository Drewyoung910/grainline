#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";

export const PROVIDER_PROOF_BRANCH = "codex/rls-notification-provider-proof-20260722";
export const REVIEWED_GITHUB_REPOSITORY = "Drewyoung910/grainline";
export const REVIEWED_VERCEL_PROJECT_ID = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
export const REVIEWED_VERCEL_TEAM_ID = "team_wvQeQHZGwCSwinC1uB7xbpjr";
export const REVIEWED_VERCEL_PROJECT_NAME = "grainline";
export const REVIEWED_PRODUCTION_DEPLOYMENT_ID = "dpl_6Y6C3NT81zbhLc6eHJAveCH1Ave8";
export const REVIEWED_NEON_PROJECT_ID = "icy-unit-96812898";
export const REVIEWED_NEON_ORG_ID = "org-raspy-frost-18952075";
export const REVIEWED_PRODUCTION_BRANCH_ID = "br-hidden-mouse-aaugn2wr";
export const REVIEWED_STAGING_BRANCH_ID = "br-sweet-dawn-aa58p53g";
export const REVIEWED_STAGING_BRANCH_NAME = "rls-staging-20260716";
export const REVIEWED_STAGING_ENDPOINT_ID = "ep-bold-recipe-aavx4plv";
export const REVIEWED_DATABASE_NAME = "neondb";
export const REVIEWED_DATABASE_REGION = "westus3.azure";
export const REVIEWED_NEON_REGION_ID = "azure-westus3";
export const REVIEWED_OWNER_ROLE = "neondb_owner";
export const REVIEWED_RUNTIME_ROLE = "grainline_app_runtime";
export const REVIEWED_EXECUTION_REGION = "sfo1";
export const PROVIDER_PROOF_STATE_PATH =
  "/private/tmp/grainline-notification-provider-proof-state-20260722.json";
export const PROVIDER_BYPASS_STATE_PATH =
  "/private/tmp/grainline-notification-provider-bypass-20260722.json";
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";

const REVIEWED_NEON_CLI_PATH =
  "/Users/drewyoung/.npm/_npx/74274893b9fe65d3/node_modules/neonctl/dist/cli.js";
const REVIEWED_NEON_CLI_VERSION = "2.35.1";
const REVIEWED_NEON_CREDENTIAL_PATH =
  "/Users/drewyoung/.config/neonctl/credentials.json";
const VERCEL_AUTH_PATH =
  "/Users/drewyoung/Library/Application Support/com.vercel.cli/auth.json";
const GATE_SCRIPT_PATH = path.resolve("scripts/rls-context-acceptance-gate.mjs");
const MAX_API_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const CLEANUP_CONFIRMATION = "delete-disposable-preview-and-staging";
const ABORT_CONFIRMATION = "delete-failed-disposable-preview-and-staging";

export const PROVIDER_ENVIRONMENT_VALUES = Object.freeze({
  RLS_CONTEXT_GATE_CONFIRM: "staging-only",
  RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "production-runtime",
  RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION: REVIEWED_EXECUTION_REGION,
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: REVIEWED_DATABASE_REGION,
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: REVIEWED_STAGING_ENDPOINT_ID,
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME: REVIEWED_DATABASE_NAME,
  RLS_CONTEXT_GATE_RUNTIME_ROLE: REVIEWED_RUNTIME_ROLE,
  RLS_CONTEXT_GATE_REQUESTS: "500",
  RLS_CONTEXT_GATE_WARMUP_REQUESTS: "50",
  RLS_CONTEXT_GATE_TURNOVER_REQUESTS: "64",
  RLS_CONTEXT_GATE_TARGET_CONCURRENCY: "8",
  RLS_CONTEXT_GATE_BURST_CONCURRENCY: "16",
  RLS_CONTEXT_GATE_POOL_SIZE: "16",
  RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS: "10000",
  RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS: "30000",
  RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS: "35000",
  RLS_CONTEXT_GATE_TX_TIMEOUT_MS: "5000",
  RLS_CONTEXT_GATE_SCHEMA: "grainline_rls_canary",
  RLS_CONTEXT_GATE_TABLE: "context_canary",
});

export const PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "RLS_CONTEXT_GATE_DATABASE_URL",
  "RLS_CONTEXT_GATE_TRIGGER_SECRET",
  "RLS_CONTEXT_GATE_RUN_ID",
  "RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA",
  ...Object.keys(PROVIDER_ENVIRONMENT_VALUES),
]);

export const FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "DIRECT_URL",
  "RLS_CONTEXT_GATE_ADMIN_DATABASE_URL",
  "RLS_CONTEXT_GATE_EVIDENCE_PATH",
  "RLS_CONTEXT_GATE_PREPARE",
  "RLS_CONTEXT_GATE_ROLLBACK_PROBE",
  "RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE",
  "RLS_CONTEXT_GATE_ALLOW_NON_POOLER",
  "RLS_CONTEXT_GATE_ALLOW_CUSTOM_USER_IDS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "PGOPTIONS",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanEnvironment(env = process.env) {
  const child = { ...env, CI: "1", NO_COLOR: "1" };
  for (const [key, value] of Object.entries(child)) {
    if (
      key === "DATABASE_URL"
      || key === "DIRECT_URL"
      || key === "VERCEL_AUTOMATION_BYPASS_SECRET"
      || key === "RLS_CONTEXT_GATE_TRIGGER_SECRET"
      || /^PG[A-Z0-9_]*$/.test(key)
      || /(?:^|_)(?:DIRECT_URL|DATABASE_URL|DB_ADMIN_URL)$/.test(key)
      || (typeof value === "string" && /^postgres(?:ql)?:\/\//i.test(value.trim()))
    ) {
      delete child[key];
    }
  }
  return child;
}

function assertPrivateRegularFile(filePath, label) {
  const file = lstatSync(filePath);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file`);
  }
  return file;
}

function assertPrivateEvidenceDirectory() {
  const directory = lstatSync(EVIDENCE_DIRECTORY);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
    throw new Error("rollout evidence directory must be a private real directory");
  }
}

function writePrivateJson(filePath, payload) {
  if (existsSync(filePath)) throw new Error(`refusing to overwrite ${filePath}`);
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  assertPrivateRegularFile(filePath, path.basename(filePath));
}

function replacePrivateState(payload) {
  const nextPath = `${PROVIDER_PROOF_STATE_PATH}.next`;
  if (existsSync(nextPath)) throw new Error("stale provider proof state update exists");
  writePrivateJson(nextPath, payload);
  renameSync(nextPath, PROVIDER_PROOF_STATE_PATH);
  chmodSync(PROVIDER_PROOF_STATE_PATH, 0o600);
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${label} did not contain an object`);
  }
  return payload;
}

function readProviderState() {
  const state = readPrivateJson(PROVIDER_PROOF_STATE_PATH, "provider proof state");
  if (
    state.branch !== PROVIDER_PROOF_BRANCH
    || state.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || state.teamId !== REVIEWED_VERCEL_TEAM_ID
    || state.neonBranchId !== REVIEWED_STAGING_BRANCH_ID
    || state.neonEndpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || !/^[a-f0-9]{40}$/.test(state.commitSha)
    || !/^[A-Za-z0-9._:-]{32,128}$/.test(state.runId)
    || !/^[A-Za-z0-9_-]{32,256}$/.test(state.triggerSecret)
  ) {
    throw new Error("provider proof state does not match the reviewed target");
  }
  validateDatabaseUrl(state.runtimeDatabaseUrl, { pooled: true, role: REVIEWED_RUNTIME_ROLE });
  validateDatabaseUrl(state.adminDatabaseUrl, { pooled: false, role: REVIEWED_OWNER_ROLE });
  return state;
}

function readBypassState() {
  const state = readPrivateJson(PROVIDER_BYPASS_STATE_PATH, "provider bypass state");
  if (
    state.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || state.teamId !== REVIEWED_VERCEL_TEAM_ID
    || !/^[A-Za-z0-9_-]{24,256}$/.test(state.bypassSecret)
    || !/^[a-f0-9]{64}$/.test(state.oldSecretSha256)
    || !/^[a-f0-9]{64}$/.test(state.newSecretSha256)
    || sha256(state.bypassSecret) !== state.newSecretSha256
  ) {
    throw new Error("provider bypass state does not match the reviewed project");
  }
  return state;
}

function reviewedCliPackage(cliPath, expectedName, expectedVersion) {
  const packagePath = path.resolve(path.dirname(cliPath), "..", "package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  if (metadata.name !== expectedName || metadata.version !== expectedVersion) {
    throw new Error(`${expectedName} CLI package does not match the reviewed version`);
  }
}

function assertReviewedNeonCli() {
  reviewedCliPackage(REVIEWED_NEON_CLI_PATH, "neonctl", REVIEWED_NEON_CLI_VERSION);
  assertPrivateRegularFile(REVIEWED_NEON_CREDENTIAL_PATH, "Neon credential file");
}

function runNeonApi(pathname, method = "GET") {
  assertReviewedNeonCli();
  const result = spawnSync(
    process.execPath,
    [
      REVIEWED_NEON_CLI_PATH,
      "api",
      pathname,
      "--method",
      method,
      "--output",
      "json",
      "--no-color",
      "--no-analytics",
    ],
    {
      encoding: "utf8",
      env: cleanEnvironment(),
      maxBuffer: MAX_API_BYTES,
      timeout: 60_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`reviewed Neon ${method} request failed`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("reviewed Neon response was not valid JSON");
  }
}

function readVercelAuthToken() {
  const auth = readPrivateJson(VERCEL_AUTH_PATH, "Vercel auth file");
  if (typeof auth.token !== "string" || auth.token.length < 20 || auth.token.length > 1024) {
    throw new Error("Vercel auth token does not have the reviewed shape");
  }
  return auth.token;
}

async function boundedJsonResponse(response, limit = MAX_API_BYTES) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > limit) {
    throw new Error("provider response exceeded the reviewed size bound");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("provider response was not valid JSON");
  }
}

async function vercelApi(pathname, { body, expectedStatuses = [200], method = "GET", query = {} } = {}) {
  const target = new URL(`https://api.vercel.com${pathname}`);
  target.searchParams.set("teamId", REVIEWED_VERCEL_TEAM_ID);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
  const response = await fetch(target, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${readVercelAuthToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await boundedJsonResponse(response);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`Vercel ${method} request failed with HTTP ${response.status}`);
  }
  return { payload, status: response.status };
}

export function validateDatabaseUrl(value, { pooled, role }) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error("database URL must be a non-empty exact string");
  }
  const parsed = new URL(value);
  const identity = parseGuardedNeonDatabaseIdentity(value, "provider proof database URL");
  const expectedHost = `${REVIEWED_STAGING_ENDPOINT_ID}${pooled ? "-pooler" : ""}.${REVIEWED_DATABASE_REGION}.neon.tech`;
  if (
    parsed.hostname !== expectedHost
    || parsed.port !== "5432"
    || parsed.pathname !== `/${REVIEWED_DATABASE_NAME}`
    || parsed.username !== role
    || !parsed.password
    || identity.endpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || identity.databaseName !== REVIEWED_DATABASE_NAME
    || identity.region !== REVIEWED_DATABASE_REGION
    || identity.username !== role
    || identity.isPooler !== pooled
    || identity.port !== "5432"
    || parsed.searchParams.size !== 2
    || parsed.searchParams.get("sslmode") !== "verify-full"
    || parsed.searchParams.get("channel_binding") !== "require"
  ) {
    throw new Error("database URL does not match the reviewed staging identity");
  }
  return value;
}

export function buildStagingDatabaseUrl(role, password, { pooled }) {
  if (
    ![REVIEWED_OWNER_ROLE, REVIEWED_RUNTIME_ROLE].includes(role)
    || typeof password !== "string"
    || !/^[A-Za-z0-9_-]{16,128}$/.test(password)
  ) {
    throw new Error("Neon role or password did not have the reviewed shape");
  }
  const host = `${REVIEWED_STAGING_ENDPOINT_ID}${pooled ? "-pooler" : ""}.${REVIEWED_DATABASE_REGION}.neon.tech`;
  const target = new URL(
    `postgresql://${role}:placeholder@${host}:5432/${REVIEWED_DATABASE_NAME}`
      + "?sslmode=verify-full&channel_binding=require",
  );
  target.password = password;
  return validateDatabaseUrl(target.toString(), { pooled, role });
}

async function verifyNeonStagingTarget() {
  if (REVIEWED_STAGING_BRANCH_ID === REVIEWED_PRODUCTION_BRANCH_ID) {
    throw new Error("staging and production Neon branch ids must differ");
  }
  const project = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}`)?.project;
  const branch = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}`,
  )?.branch;
  const endpoints = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/endpoints`)?.endpoints;
  const roles = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}/roles`,
  )?.roles;
  const databases = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}/databases`,
  )?.databases;
  const endpoint = Array.isArray(endpoints)
    ? endpoints.find((candidate) => candidate?.id === REVIEWED_STAGING_ENDPOINT_ID)
    : null;
  const roleNames = Array.isArray(roles) ? roles.map((role) => role?.name).sort() : [];
  const database = Array.isArray(databases)
    ? databases.find((candidate) => candidate?.name === REVIEWED_DATABASE_NAME)
    : null;
  if (
    project?.id !== REVIEWED_NEON_PROJECT_ID
    || project.org_id !== REVIEWED_NEON_ORG_ID
    || project.region_id !== REVIEWED_NEON_REGION_ID
    || branch?.id !== REVIEWED_STAGING_BRANCH_ID
    || branch.name !== REVIEWED_STAGING_BRANCH_NAME
    || branch.parent_id !== REVIEWED_PRODUCTION_BRANCH_ID
    || branch.primary !== false
    || branch.default !== false
    || branch.current_state !== "ready"
    || endpoint?.branch_id !== REVIEWED_STAGING_BRANCH_ID
    || endpoint.region_id !== REVIEWED_NEON_REGION_ID
    || endpoint.type !== "read_write"
    || endpoint.disabled !== false
    || !["idle", "active"].includes(endpoint.current_state)
    || JSON.stringify(roleNames) !== JSON.stringify([REVIEWED_RUNTIME_ROLE, REVIEWED_OWNER_ROLE].sort())
    || roles.some((role) => role?.branch_id !== REVIEWED_STAGING_BRANCH_ID || role?.authentication_method !== "password")
    || database?.branch_id !== REVIEWED_STAGING_BRANCH_ID
    || database.owner_name !== REVIEWED_OWNER_ROLE
  ) {
    throw new Error("Neon staging target metadata drifted from the reviewed non-production identity");
  }
  return { branch, endpoint };
}

function revealNeonRolePassword(role) {
  const password = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}`
      + `/branches/${REVIEWED_STAGING_BRANCH_ID}`
      + `/roles/${role}/reveal_password`,
  )?.password;
  if (typeof password !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(password)) {
    throw new Error("Neon role reveal did not return a bounded password");
  }
  return password;
}

function gitResult(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: cleanEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) throw new Error("Git proof precondition failed");
  return result.stdout.trim();
}

function assertExactCleanCommit(expectedCommitSha) {
  const branch = gitResult(["branch", "--show-current"]);
  const commitSha = gitResult(["rev-parse", "HEAD"]);
  const status = gitResult(["status", "--porcelain"]);
  if (
    branch !== PROVIDER_PROOF_BRANCH
    || status !== ""
    || !/^[a-f0-9]{40}$/.test(commitSha)
    || (expectedCommitSha && commitSha !== expectedCommitSha)
  ) {
    throw new Error("provider proof must run from the exact clean disposable branch commit");
  }
  return commitSha;
}

function gateEnvironment(state, mode) {
  const environment = {
    ...cleanEnvironment(),
    ...PROVIDER_ENVIRONMENT_VALUES,
    RLS_CONTEXT_GATE_DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "diagnostic-only",
  };
  if (mode === "prepare") {
    environment.RLS_CONTEXT_GATE_PREPARE = "1";
    environment.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL = state.adminDatabaseUrl;
    environment.RLS_CONTEXT_GATE_EVIDENCE_PATH = state.setupEvidencePath;
  } else if (mode === "teardown") {
    environment.RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE = "1";
    environment.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL = state.adminDatabaseUrl;
    environment.RLS_CONTEXT_GATE_EVIDENCE_PATH = state.teardownEvidencePath;
  } else {
    throw new Error("unknown owner-only gate mode");
  }
  return environment;
}

function runOwnerOnlyGate(state, mode) {
  const result = spawnSync(process.execPath, [GATE_SCRIPT_PATH], {
    encoding: "utf8",
    env: gateEnvironment(state, mode),
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`owner-only provider ${mode} gate failed`);
  }
  const evidencePath = mode === "prepare" ? state.setupEvidencePath : state.teardownEvidencePath;
  const evidence = readPrivateJson(evidencePath, `${mode} evidence`);
  if (
    evidence.run?.status !== "setup_passed"
    || evidence.result?.issueCount !== 0
    || evidence.locality?.acceptanceEligible !== false
    || evidence.database?.expectedDatabaseEndpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || evidence.database?.expectedDatabaseName !== REVIEWED_DATABASE_NAME
    || evidence.database?.runtimeRole !== REVIEWED_RUNTIME_ROLE
    || evidence.config?.[mode === "prepare" ? "prepare" : "teardownRpcProbe"] !== true
  ) {
    throw new Error(`owner-only provider ${mode} evidence did not pass validation`);
  }
  return evidence;
}

async function branchEnvironmentInventory() {
  const { payload } = await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    {
      query: { gitBranch: PROVIDER_PROOF_BRANCH, target: "preview" },
    },
  );
  if (!Array.isArray(payload.envs)) throw new Error("Vercel environment inventory shape drifted");
  return payload.envs;
}

export function providerEnvironmentEntries(state) {
  const values = {
    DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_TRIGGER_SECRET: state.triggerSecret,
    RLS_CONTEXT_GATE_RUN_ID: state.runId,
    RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA: state.commitSha,
    ...PROVIDER_ENVIRONMENT_VALUES,
  };
  const entries = Object.entries(values).map(([key, value]) => ({
    comment: "Disposable Notification provider proof; remove after counted slots",
    gitBranch: PROVIDER_PROOF_BRANCH,
    key,
    target: ["preview"],
    type: "sensitive",
    value,
  }));
  if (
    entries.length !== 24
    || JSON.stringify(entries.map((entry) => entry.key)) !== JSON.stringify(PROVIDER_ENVIRONMENT_KEYS)
    || entries.some((entry) => FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(entry.key))
  ) {
    throw new Error("provider environment manifest drifted from the reviewed 24-variable shape");
  }
  return entries;
}

function assertExactEnvironmentInventory(inventory) {
  const expected = [...PROVIDER_ENVIRONMENT_KEYS].sort();
  const actual = inventory.map((entry) => entry?.key).sort();
  if (
    inventory.length !== 24
    || JSON.stringify(actual) !== JSON.stringify(expected)
    || inventory.some((entry) => (
      !/^env_[A-Za-z0-9]+$/.test(entry?.id)
      || entry.gitBranch !== PROVIDER_PROOF_BRANCH
      || entry.type !== "sensitive"
      || !Array.isArray(entry.target)
      || entry.target.length !== 1
      || entry.target[0] !== "preview"
      || FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(entry.key)
    ))
  ) {
    throw new Error("Vercel branch environment inventory did not match the exact reviewed manifest");
  }
  return inventory;
}

async function configureProviderEnvironment(state) {
  const before = await branchEnvironmentInventory();
  if (before.length !== 0) {
    throw new Error("disposable provider branch already has environment variables");
  }
  const entries = providerEnvironmentEntries(state);
  const { payload } = await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    {
      body: entries,
      expectedStatuses: [201],
      method: "POST",
    },
  );
  if (Array.isArray(payload.failed) && payload.failed.length > 0) {
    throw new Error("one or more Vercel branch variables failed to create");
  }
  const inventory = assertExactEnvironmentInventory(await branchEnvironmentInventory());
  return inventory.map((entry) => entry.id).sort();
}

async function listDeployments() {
  const { payload } = await vercelApi("/v6/deployments", {
    query: { limit: 100, projectId: REVIEWED_VERCEL_PROJECT_ID },
  });
  if (!Array.isArray(payload.deployments)) throw new Error("Vercel deployment list shape drifted");
  return payload.deployments;
}

async function readDeployment(deploymentId, expectedStatuses = [200]) {
  return vercelApi(`/v13/deployments/${deploymentId}`, { expectedStatuses });
}

function validateProviderDeploymentIdentity(deployment, state) {
  if (
    deployment?.id !== state.deploymentId
    || deployment.id === REVIEWED_PRODUCTION_DEPLOYMENT_ID
    || deployment.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || deployment.project?.id !== REVIEWED_VERCEL_PROJECT_ID
    || deployment.name !== REVIEWED_VERCEL_PROJECT_NAME
    || deployment.source !== "git"
    || deployment.target !== null
    || deployment.gitSource?.type !== "github"
    || deployment.gitSource.sha !== state.commitSha
    || deployment.gitSource.ref !== PROVIDER_PROOF_BRANCH
    || deployment.meta?.githubCommitSha !== state.commitSha
    || deployment.meta?.githubCommitRef !== PROVIDER_PROOF_BRANCH
    || deployment.meta?.githubCommitOrg !== "Drewyoung910"
    || deployment.meta?.githubCommitRepo !== "grainline"
    || deployment.meta?.githubDeployment !== "1"
    || !Array.isArray(deployment.regions)
    || deployment.regions.length !== 1
    || deployment.regions[0] !== REVIEWED_EXECUTION_REGION
    || deployment.originCacheRegion !== REVIEWED_EXECUTION_REGION
    || deployment.createdIn !== REVIEWED_EXECUTION_REGION
    || deployment.projectSettings?.nodeVersion !== "22.x"
    || typeof deployment.url !== "string"
    || !deployment.url.endsWith(".vercel.app")
  ) {
    throw new Error("Vercel provider deployment did not match the exact Git-integrated Preview identity");
  }
  return deployment;
}

function validateProviderDeployment(deployment, state) {
  validateProviderDeploymentIdentity(deployment, state);
  if (deployment.readyState !== "READY") {
    throw new Error("Vercel provider deployment was not ready");
  }
  return deployment;
}

async function assertProductionDeploymentUnchanged() {
  const { payload } = await readDeployment(REVIEWED_PRODUCTION_DEPLOYMENT_ID);
  if (
    payload?.id !== REVIEWED_PRODUCTION_DEPLOYMENT_ID
    || payload.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || payload.readyState !== "READY"
    || payload.target !== "production"
  ) {
    throw new Error("reviewed production deployment identity or readiness changed");
  }
  return {
    deploymentId: payload.id,
    readyState: payload.readyState,
    target: payload.target,
  };
}

async function currentBypassIsActive(bypassState) {
  const { payload } = await vercelApi(`/v9/projects/${REVIEWED_VERCEL_PROJECT_ID}`);
  const active = Object.keys(payload.protectionBypass ?? {});
  if (active.length !== 1 || active[0] !== bypassState.bypassSecret) {
    throw new Error("rotated Vercel automation bypass is no longer the sole active value");
  }
}

function evidencePath(kind, commitSha, slot) {
  const suffix = slot ? `-slot-${slot}` : "";
  return path.join(
    EVIDENCE_DIRECTORY,
    `notification-provider-proof-${kind}${suffix}-${commitSha.slice(0, 12)}.json`,
  );
}

function assertNoSensitiveEvidence(payload, state, bypassState) {
  const serialized = JSON.stringify(payload);
  for (const value of [
    state.runtimeDatabaseUrl,
    state.adminDatabaseUrl,
    state.triggerSecret,
    state.runId,
    bypassState?.bypassSecret,
  ]) {
    if (value && serialized.includes(value)) {
      throw new Error("sanitized provider evidence retained a temporary secret");
    }
  }
  if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i.test(serialized)) {
    throw new Error("sanitized provider evidence retained database credentials");
  }
}

function validateProviderEvidence(payload, state, runSlot) {
  if (
    payload.run?.status !== "runtime_candidate_passed"
    || payload.run.commitSha !== state.commitSha
    || payload.run.deploymentId !== state.deploymentId
    || payload.result?.issueCount !== 0
    || payload.locality?.runtimeEvidenceCandidate !== true
    || payload.locality?.acceptanceEligible !== false
    || payload.locality?.providerRuntimeMetadataPresent !== true
    || payload.locality?.observedExecutionRegion !== REVIEWED_EXECUTION_REGION
    || payload.locality?.observedDatabaseRegion !== REVIEWED_DATABASE_REGION
    || payload.database?.expectedDatabaseEndpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || payload.database?.expectedDatabaseName !== REVIEWED_DATABASE_NAME
    || payload.database?.runtimeRole !== REVIEWED_RUNTIME_ROLE
    || payload.database?.databaseHost !== `${REVIEWED_STAGING_ENDPOINT_ID}-pooler.${REVIEWED_DATABASE_REGION}.neon.tech`
    || payload.config?.measuredRequests !== 500
    || payload.config?.targetConcurrency !== 8
    || payload.config?.burstConcurrency !== 16
    || payload.config?.poolSize !== 16
    || payload.config?.prismaPoolSize !== 10
    || payload.runner?.runSlot !== runSlot
    || !/^v24\./.test(payload.runner?.nodeVersion)
    || payload.runner?.runIdSha256 !== sha256(state.runId)
  ) {
    throw new Error(`provider slot ${runSlot} did not produce passing counted evidence`);
  }
  return payload;
}

async function invokeProviderSlot(state, bypassState, runSlot) {
  await currentBypassIsActive(bypassState);
  const response = await fetch(
    `https://${state.deploymentUrl}/api/internal/rls-context-gate`,
    {
      body: JSON.stringify({ runSlot, token: state.triggerSecret }),
      headers: {
        "Content-Type": "application/json",
        "x-vercel-protection-bypass": bypassState.bypassSecret,
      },
      method: "POST",
      signal: AbortSignal.timeout(340_000),
    },
  );
  const payload = await boundedJsonResponse(response, MAX_PROVIDER_RESPONSE_BYTES);
  const outputPath = evidencePath("response", state.commitSha, runSlot);
  assertNoSensitiveEvidence(payload, state, bypassState);
  writePrivateJson(outputPath, {
    capturedAt: new Date().toISOString(),
    httpStatus: response.status,
    response: payload,
  });
  if (response.status !== 200) {
    throw new Error(`provider slot ${runSlot} returned HTTP ${response.status}; the slot must not be replayed`);
  }
  validateProviderEvidence(payload, state, runSlot);
  return outputPath;
}

async function prepare() {
  if (existsSync(PROVIDER_PROOF_STATE_PATH)) {
    throw new Error("provider proof state already exists; inspect or clean it before preparing again");
  }
  assertPrivateEvidenceDirectory();
  readBypassState();
  const commitSha = assertExactCleanCommit();
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("provider branch environment is not empty before preparation");
  }
  const matchingDeployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH
      || deployment.meta?.githubCommitSha === commitSha,
  );
  if (matchingDeployments.length !== 0) {
    throw new Error("provider branch or commit already has a Vercel deployment before attestation setup");
  }
  await verifyNeonStagingTarget();
  const runtimeDatabaseUrl = buildStagingDatabaseUrl(
    REVIEWED_RUNTIME_ROLE,
    revealNeonRolePassword(REVIEWED_RUNTIME_ROLE),
    { pooled: true },
  );
  const adminDatabaseUrl = buildStagingDatabaseUrl(
    REVIEWED_OWNER_ROLE,
    revealNeonRolePassword(REVIEWED_OWNER_ROLE),
    { pooled: false },
  );
  const runId = `notification-b-${randomUUID()}`;
  const triggerSecret = randomBytes(48).toString("base64url");
  const setupEvidencePath = evidencePath("setup", commitSha);
  if (existsSync(setupEvidencePath)) throw new Error("setup evidence path already exists");
  const state = {
    adminDatabaseUrl,
    branch: PROVIDER_PROOF_BRANCH,
    commitSha,
    createdAt: new Date().toISOString(),
    neonBranchId: REVIEWED_STAGING_BRANCH_ID,
    neonEndpointId: REVIEWED_STAGING_ENDPOINT_ID,
    projectId: REVIEWED_VERCEL_PROJECT_ID,
    runId,
    runtimeDatabaseUrl,
    setupEvidencePath,
    teamId: REVIEWED_VERCEL_TEAM_ID,
    triggerSecret,
  };
  writePrivateJson(PROVIDER_PROOF_STATE_PATH, state);
  runOwnerOnlyGate(state, "prepare");
  replacePrivateState({ ...state, setupCompletedAt: new Date().toISOString() });
  console.log(JSON.stringify({ commitSha, prepared: true, setupEvidenceMode: "0600" }));
}

async function configure() {
  const state = readProviderState();
  assertExactCleanCommit(state.commitSha);
  if (!state.setupCompletedAt || state.configuredAt) {
    throw new Error("provider state is not ready for one-time environment configuration");
  }
  const environmentIds = await configureProviderEnvironment(state);
  replacePrivateState({
    ...state,
    configuredAt: new Date().toISOString(),
    environmentIds,
  });
  console.log(JSON.stringify({ commitSha: state.commitSha, configuredVariables: environmentIds.length }));
}

async function attest() {
  let state = readProviderState();
  assertExactCleanCommit(state.commitSha);
  if (!state.configuredAt || state.attestedAt) {
    throw new Error("provider state is not ready for one-time deployment attestation");
  }
  let candidate;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const deployments = await listDeployments();
    const matches = deployments.filter(
      (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH
        && deployment.meta?.githubCommitSha === state.commitSha,
    );
    if (matches.length > 1) throw new Error("more than one deployment exists for the attested provider commit");
    if (matches.length === 1) {
      candidate = matches[0];
      if (candidate.uid === REVIEWED_PRODUCTION_DEPLOYMENT_ID) {
        throw new Error("provider deployment unexpectedly matched production");
      }
      if (state.deploymentId && state.deploymentId !== candidate.uid) {
        throw new Error("provider deployment identity changed while awaiting readiness");
      }
      if (!state.deploymentId) {
        state = {
          ...state,
          deploymentId: candidate.uid,
          deploymentUrl: candidate.url,
          deploymentObservedAt: new Date().toISOString(),
        };
        replacePrivateState(state);
      }
      if (["ERROR", "CANCELED"].includes(candidate.readyState ?? candidate.state)) {
        throw new Error("Git-integrated provider Preview failed before readiness");
      }
      if ((candidate.readyState ?? candidate.state) === "READY") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!candidate || (candidate.readyState ?? candidate.state) !== "READY") {
    throw new Error("Git-integrated provider Preview did not become ready in ten minutes");
  }
  const { payload: deployment } = await readDeployment(state.deploymentId);
  validateProviderDeployment(deployment, state);
  const environment = assertExactEnvironmentInventory(await branchEnvironmentInventory());
  const production = await assertProductionDeploymentUnchanged();
  const bypassState = readBypassState();
  await currentBypassIsActive(bypassState);
  const packageNodeEngine = JSON.parse(readFileSync("package.json", "utf8")).engines?.node;
  if (packageNodeEngine !== ">=22") {
    throw new Error("provider proof package Node engine drifted from the reviewed build input");
  }
  const attestation = {
    generatedAt: new Date().toISOString(),
    scope: "synthetic-notification-provider-transport-only",
    project: {
      id: REVIEWED_VERCEL_PROJECT_ID,
      name: REVIEWED_VERCEL_PROJECT_NAME,
      teamId: REVIEWED_VERCEL_TEAM_ID,
    },
    deployment: {
      commitSha: state.commitSha,
      createdIn: deployment.createdIn,
      gitRef: PROVIDER_PROOF_BRANCH,
      id: deployment.id,
      configuredNodeVersion: deployment.projectSettings.nodeVersion,
      packageNodeEngine,
      originCacheRegion: deployment.originCacheRegion,
      readyState: deployment.readyState,
      regions: deployment.regions,
      source: deployment.source,
      url: deployment.url,
    },
    environment: {
      branch: PROVIDER_PROOF_BRANCH,
      forbiddenKeysPresent: environment
        .map((entry) => entry.key)
        .filter((key) => FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(key)),
      keyCount: environment.length,
      keys: environment.map((entry) => entry.key).sort(),
      target: "preview",
      valuesRetained: false,
    },
    neon: {
      branchId: REVIEWED_STAGING_BRANCH_ID,
      branchName: REVIEWED_STAGING_BRANCH_NAME,
      databaseName: REVIEWED_DATABASE_NAME,
      endpointId: REVIEWED_STAGING_ENDPOINT_ID,
      parentBranchId: REVIEWED_PRODUCTION_BRANCH_ID,
      region: REVIEWED_DATABASE_REGION,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
    production,
    automationBypass: {
      exposedValueRevokedBeforeProof: true,
      replacementActive: true,
      replacementRetainedInEvidence: false,
    },
  };
  assertNoSensitiveEvidence(attestation, state, bypassState);
  const attestationPath = evidencePath("attestation", state.commitSha);
  writePrivateJson(attestationPath, attestation);
  replacePrivateState({ ...state, attestationPath, attestedAt: new Date().toISOString() });
  console.log(JSON.stringify({ attested: true, commitSha: state.commitSha, deploymentId: state.deploymentId }));
}

async function invoke(runSlot) {
  const state = readProviderState();
  const bypassState = readBypassState();
  assertExactCleanCommit(state.commitSha);
  if (!state.attestedAt || state.failedSlot) {
    throw new Error("provider state is not eligible for a counted slot");
  }
  if (runSlot === 1 && (state.slot1EvidencePath || state.slot2EvidencePath)) {
    throw new Error("provider slot 1 has already been attempted");
  }
  if (runSlot === 2 && (!state.slot1EvidencePath || state.slot2EvidencePath)) {
    throw new Error("provider slot 2 requires exactly one passing slot 1 and no prior slot 2");
  }
  try {
    const outputPath = await invokeProviderSlot(state, bypassState, runSlot);
    replacePrivateState({
      ...state,
      [`slot${runSlot}CompletedAt`]: new Date().toISOString(),
      [`slot${runSlot}EvidencePath`]: outputPath,
    });
    console.log(JSON.stringify({ countedPass: true, runSlot }));
  } catch (error) {
    replacePrivateState({
      ...state,
      failedAt: new Date().toISOString(),
      failedSlot: runSlot,
    });
    throw error;
  }
}

async function removeProviderEnvironment(state) {
  const inventory = assertExactEnvironmentInventory(await branchEnvironmentInventory());
  const ids = inventory.map((entry) => entry.id).sort();
  if (
    !Array.isArray(state.environmentIds)
    || JSON.stringify([...state.environmentIds].sort()) !== JSON.stringify(ids)
  ) {
    throw new Error("branch environment IDs drifted before cleanup");
  }
  const { payload } = await vercelApi(
    `/v1/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    { body: { ids }, method: "DELETE" },
  );
  if (
    Number(payload.deleted) !== 24
    || !Array.isArray(payload.ids)
    || JSON.stringify([...payload.ids].sort()) !== JSON.stringify(ids)
  ) {
    throw new Error("Vercel did not confirm deletion of all 24 branch variables");
  }
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("Vercel branch environment variables remained after cleanup");
  }
}

async function deleteProviderDeployment(state) {
  if (!state.deploymentId) return false;
  const { payload } = await readDeployment(state.deploymentId);
  validateProviderDeploymentIdentity(payload, state);
  await vercelApi(`/v13/deployments/${state.deploymentId}`, { method: "DELETE" });
  const after = await readDeployment(state.deploymentId, [404]);
  if (after.status !== 404) throw new Error("provider Preview remained after deletion");
  return true;
}

async function deleteNeonStagingBranch() {
  await verifyNeonStagingTarget();
  runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}`,
    "DELETE",
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches;
    if (!Array.isArray(branches)) throw new Error("Neon branch list shape drifted after deletion");
    const stagingPresent = branches.some((branch) => branch?.id === REVIEWED_STAGING_BRANCH_ID);
    const productionPresent = branches.some((branch) => branch?.id === REVIEWED_PRODUCTION_BRANCH_ID);
    if (!productionPresent) throw new Error("production Neon branch disappeared during staging cleanup");
    if (!stagingPresent) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Neon staging branch remained after deletion request");
}

function validateRetainedCountedEvidence(state) {
  for (const [slot, filePath] of [[1, state.slot1EvidencePath], [2, state.slot2EvidencePath]]) {
    const artifact = readPrivateJson(filePath, `provider slot ${slot} evidence`);
    if (artifact.httpStatus !== 200) throw new Error(`provider slot ${slot} evidence was not HTTP 200`);
    validateProviderEvidence(artifact.response, state, slot);
    assertNoSensitiveEvidence(artifact, state, null);
  }
}

async function cleanup({ requireSuccess }) {
  let state = readProviderState();
  const expectedConfirmation = requireSuccess ? CLEANUP_CONFIRMATION : ABORT_CONFIRMATION;
  if (process.env.NOTIFICATION_PROVIDER_PROOF_CLEANUP_CONFIRM !== expectedConfirmation) {
    throw new Error(`NOTIFICATION_PROVIDER_PROOF_CLEANUP_CONFIRM=${expectedConfirmation} is required`);
  }
  if (requireSuccess) validateRetainedCountedEvidence(state);
  if (state.deploymentId) {
    const { payload } = await readDeployment(state.deploymentId);
    if (payload.readyState === "READY") validateProviderDeployment(payload, state);
  }
  let ownerOnlyFixtureTeardownPassed = false;
  if (state.setupCompletedAt) {
    if (!state.teardownEvidencePath) {
      state = {
        ...state,
        teardownEvidencePath: evidencePath("teardown", state.commitSha),
      };
      replacePrivateState(state);
    }
    if (!existsSync(state.teardownEvidencePath)) runOwnerOnlyGate(state, "teardown");
    ownerOnlyFixtureTeardownPassed = true;
  }
  replacePrivateState({
    ...state,
    fixtureTornDownAt: new Date().toISOString(),
    ownerOnlyFixtureTeardownPassed,
  });
  state = readProviderState();
  if (state.configuredAt) await removeProviderEnvironment(state);
  const deploymentDeleted = await deleteProviderDeployment(state);
  const stagingBranchDeleted = await deleteNeonStagingBranch();
  const production = await assertProductionDeploymentUnchanged();
  const cleanupEvidencePath = evidencePath(
    requireSuccess ? "cleanup" : "abort-cleanup",
    state.commitSha,
  );
  const cleanupEvidence = {
    generatedAt: new Date().toISOString(),
    scope: "disposable-notification-provider-proof-cleanup",
    result: requireSuccess ? "proof-cleanup-complete" : "abort-cleanup-complete",
    commitSha: state.commitSha,
    deploymentId: state.deploymentId ?? null,
    deploymentDeleted,
    branchEnvironmentVariablesDeleted: state.configuredAt ? 24 : 0,
    ownerOnlyFixtureTeardownPassed,
    ownerOnlyFixtureTeardownNotRequired: !state.setupCompletedAt,
    neonStagingBranchId: REVIEWED_STAGING_BRANCH_ID,
    neonStagingBranchDeleted: stagingBranchDeleted,
    production,
    temporarySecretFilesDeletedAfterThisArtifact: [
      PROVIDER_PROOF_STATE_PATH,
      PROVIDER_BYPASS_STATE_PATH,
    ],
  };
  assertNoSensitiveEvidence(cleanupEvidence, state, readBypassState());
  writePrivateJson(cleanupEvidencePath, cleanupEvidence);
  unlinkSync(PROVIDER_PROOF_STATE_PATH);
  unlinkSync(PROVIDER_BYPASS_STATE_PATH);
  console.log(JSON.stringify({ cleanupComplete: true, requireSuccess }));
}

async function status() {
  const state = existsSync(PROVIDER_PROOF_STATE_PATH) ? readProviderState() : null;
  const inventory = await branchEnvironmentInventory();
  const deployments = await listDeployments();
  const providerDeployments = deployments.filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches ?? [];
  console.log(JSON.stringify({
    statePresent: Boolean(state),
    state: state ? {
      attested: Boolean(state.attestedAt),
      commitSha: state.commitSha,
      configured: Boolean(state.configuredAt),
      deploymentId: state.deploymentId ?? null,
      failedSlot: state.failedSlot ?? null,
      prepared: Boolean(state.setupCompletedAt),
      slot1Passed: Boolean(state.slot1EvidencePath),
      slot2Passed: Boolean(state.slot2EvidencePath),
    } : null,
    branchEnvironmentVariableCount: inventory.length,
    providerDeployments: providerDeployments.map((deployment) => ({
      id: deployment.uid,
      readyState: deployment.readyState ?? deployment.state,
    })),
    stagingBranchPresent: branches.some((branch) => branch?.id === REVIEWED_STAGING_BRANCH_ID),
    productionBranchPresent: branches.some((branch) => branch?.id === REVIEWED_PRODUCTION_BRANCH_ID),
  }, null, 2));
}

function usage() {
  console.error("Usage: node scripts/notification-provider-proof-operator.mjs <prepare|configure|attest|slot-1|slot-2|cleanup|cleanup-abort|status>");
}

async function main() {
  switch (process.argv[2]) {
    case "prepare":
      await prepare();
      break;
    case "configure":
      await configure();
      break;
    case "attest":
      await attest();
      break;
    case "slot-1":
      await invoke(1);
      break;
    case "slot-2":
      await invoke(2);
      break;
    case "cleanup":
      await cleanup({ requireSuccess: true });
      break;
    case "cleanup-abort":
      await cleanup({ requireSuccess: false });
      break;
    case "status":
      await status();
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "notification provider proof operator failed");
    process.exitCode = 1;
  });
}
