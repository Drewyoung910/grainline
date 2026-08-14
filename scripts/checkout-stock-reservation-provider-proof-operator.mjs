#!/usr/bin/env node
// CHECKOUT_STOCK_RESERVATION_PROVIDER_RUNNER_ONLY
// Disposable, restart-aware provider proof operator for CSR-A23. This file and
// its Preview route are forbidden from the production release tree.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";

const { Client } = pg;

export const PROVIDER_PROOF_BRANCH =
  "agent/checkout-stock-reservation-provider-proof-20260813";
export const REVIEWED_VERCEL_PROJECT_ID = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
export const REVIEWED_VERCEL_TEAM_ID = "team_wvQeQHZGwCSwinC1uB7xbpjr";
export const REVIEWED_VERCEL_PROJECT_NAME = "grainline";
export const REVIEWED_PRODUCTION_DEPLOYMENT_ID = "dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6";
export const REVIEWED_PRODUCTION_SOURCE_SHA =
  "69c14c0618ea7ab9c74756422273d17d66db7efa";
export const REVIEWED_PRODUCTION_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
]);
export const REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID =
  "dpl_E181fsRcJ4w8fjJXA2uf1adiVxYL";
export const REVIEWED_BOOTSTRAP_FAILED_SOURCE_SHA =
  "835ca22605a16ee120a0914a85dfa2a97901e206";
export const REVIEWED_NEON_PROJECT_ID = "icy-unit-96812898";
export const REVIEWED_NEON_ORG_ID = "org-raspy-frost-18952075";
export const REVIEWED_PRODUCTION_BRANCH_ID = "br-hidden-mouse-aaugn2wr";
export const REVIEWED_STAGING_BRANCH_NAME =
  "checkout-reservation-provider-20260813";
export const REVIEWED_DATABASE_NAME = "neondb";
export const REVIEWED_DATABASE_REGION = "westus3.azure";
export const REVIEWED_NEON_REGION_ID = "azure-westus3";
export const REVIEWED_OWNER_ROLE = "neondb_owner";
export const REVIEWED_RUNTIME_ROLE = "grainline_app_runtime";
export const REVIEWED_EXECUTION_REGION = "sfo1";
export const PROVIDER_PROOF_STATE_PATH =
  "/private/tmp/grainline-checkout-reservation-provider-proof-20260813.json";
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";

const VERCEL_AUTH_PATH =
  "/Users/drewyoung/Library/Application Support/com.vercel.cli/auth.json";
const NEON_CREDENTIAL_PATH = "/Users/drewyoung/.config/neonctl/credentials.json";
const EXPECTED_NEON_CLI_VERSION = "2.35.1";
const EXPECTED_TSX_VERSION = "4.21.0";
const MAX_API_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_BYTES = 512 * 1024;
const PREPARE_CONFIRMATION = "create-disposable-checkout-reservation-provider-proof";
const CLEANUP_CONFIRMATION = "delete-disposable-checkout-reservation-provider-proof";
const ABORT_CONFIRMATION = "delete-failed-checkout-reservation-provider-proof";
const BOOTSTRAP_PREVIEW_CLEANUP_CONFIRMATION =
  "delete-failed-checkout-reservation-bootstrap-preview";

export const PROVIDER_ENVIRONMENT_BASE = Object.freeze({
  CHECKOUT_RESERVATION_PROVIDER_BURST_CONCURRENCY: "10",
  CHECKOUT_RESERVATION_PROVIDER_REQUESTS: "80",
  CHECKOUT_RESERVATION_PROVIDER_TARGET_CONCURRENCY: "8",
  CHECKOUT_RESERVATION_PROVIDER_WARMUP_REQUESTS: "10",
  RLS_CONTEXT_GATE_BURST_CONCURRENCY: "16",
  RLS_CONTEXT_GATE_CONFIRM: "staging-only",
  RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS: "10000",
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME: REVIEWED_DATABASE_NAME,
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: REVIEWED_DATABASE_REGION,
  RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION: REVIEWED_EXECUTION_REGION,
  RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "production-runtime",
  RLS_CONTEXT_GATE_POOL_SIZE: "16",
  RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS: "35000",
  RLS_CONTEXT_GATE_REQUESTS: "500",
  RLS_CONTEXT_GATE_RUNTIME_ROLE: REVIEWED_RUNTIME_ROLE,
  RLS_CONTEXT_GATE_SCHEMA: "grainline_rls_canary",
  RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS: "30000",
  RLS_CONTEXT_GATE_TABLE: "context_canary",
  RLS_CONTEXT_GATE_TARGET_CONCURRENCY: "8",
  RLS_CONTEXT_GATE_TURNOVER_REQUESTS: "64",
  RLS_CONTEXT_GATE_TX_TIMEOUT_MS: "5000",
  RLS_CONTEXT_GATE_WARMUP_REQUESTS: "50",
});

export const FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "DIRECT_URL",
  "PRODUCTION_MIGRATION_DIRECT_URL",
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

export const PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "RLS_CONTEXT_GATE_DATABASE_URL",
  "RLS_CONTEXT_GATE_TRIGGER_SECRET",
  "RLS_CONTEXT_GATE_RUN_ID",
  "RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA",
  "RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID",
  ...Object.keys(PROVIDER_ENVIRONMENT_BASE),
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
      || key === "PRODUCTION_MIGRATION_DIRECT_URL"
      || key === "RLS_CONTEXT_GATE_TRIGGER_SECRET"
      || /^PG[A-Z0-9_]*$/.test(key)
      || /(?:^|_)(?:DIRECT_URL|DATABASE_URL|DB_ADMIN_URL)$/.test(key)
      || (typeof value === "string" && /^postgres(?:ql)?:\/\//iu.test(value.trim()))
    ) delete child[key];
  }
  return child;
}

function assertPrivateRegularFile(filePath, label) {
  const file = lstatSync(filePath);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a mode-0600 regular file`);
  }
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
    writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  assertPrivateRegularFile(filePath, path.basename(filePath));
}

function replaceState(payload) {
  const nextPath = `${PROVIDER_PROOF_STATE_PATH}.next`;
  writePrivateJson(nextPath, payload);
  renameSync(nextPath, PROVIDER_PROOF_STATE_PATH);
  chmodSync(PROVIDER_PROOF_STATE_PATH, 0o600);
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain an object`);
  }
  return parsed;
}

export function validateProviderState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("provider proof state must contain an object");
  }
  const creationUncertain = state.phase === "creation-attempted";
  if (
    state.branch !== PROVIDER_PROOF_BRANCH
    || state.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || state.teamId !== REVIEWED_VERCEL_TEAM_ID
    || state.neonProjectId !== REVIEWED_NEON_PROJECT_ID
    || state.parentBranchId !== REVIEWED_PRODUCTION_BRANCH_ID
    || (
      creationUncertain
        ? state.neonBranchId !== "" || state.neonEndpointId !== ""
        : !/^br-[a-z0-9-]+$/u.test(state.neonBranchId)
          || !/^ep-[a-z0-9-]+$/u.test(state.neonEndpointId)
    )
    || !/^[a-f0-9]{40}$/u.test(state.commitSha)
    || !/^[A-Za-z0-9._:-]{32,128}$/u.test(state.runId)
    || !/^[A-Za-z0-9_-]{32,256}$/u.test(state.triggerSecret)
    || !["creation-attempted", "neon-created", "credentials-ready"].includes(state.phase)
    || (
      !["", undefined].includes(state.bypassSecret)
      && !/^[A-Za-z0-9_-]{24,256}$/u.test(state.bypassSecret)
    )
  ) throw new Error("provider proof state does not match the reviewed target");
  if (state.phase !== "credentials-ready") {
    if (state.runtimeDatabaseUrl !== "" || state.adminDatabaseUrl !== "") {
      throw new Error("partial provider state unexpectedly contains database URLs");
    }
  } else {
    validateDatabaseUrl(state.runtimeDatabaseUrl, state, {
      pooled: true,
      role: REVIEWED_RUNTIME_ROLE,
    });
    validateDatabaseUrl(state.adminDatabaseUrl, state, {
      pooled: false,
      role: REVIEWED_OWNER_ROLE,
    });
  }
  return state;
}

function readState() {
  return validateProviderState(
    readPrivateJson(PROVIDER_PROOF_STATE_PATH, "provider proof state"),
  );
}

function assertCredentialReadyState(state) {
  if (state.phase !== "credentials-ready") {
    throw new Error("provider proof credentials are not ready");
  }
  return state;
}

function findReviewedPackage(packageName, relativeCliPath, expectedVersion) {
  const npxRoot = "/Users/drewyoung/.npm/_npx";
  const matches = [];
  for (const entry of readdirSync(npxRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(npxRoot, entry.name, "node_modules", packageName);
    const metadataPath = path.join(root, "package.json");
    const cliPath = path.join(root, relativeCliPath);
    if (!existsSync(metadataPath) || !existsSync(cliPath)) continue;
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (metadata.name === packageName && metadata.version === expectedVersion) {
      matches.push(cliPath);
    }
  }
  if (matches.length === 0) throw new Error(`${packageName}@${expectedVersion} is unavailable`);
  return matches.sort().at(-1);
}

function neonCliPath() {
  assertPrivateRegularFile(NEON_CREDENTIAL_PATH, "Neon credential file");
  return findReviewedPackage("neonctl", "dist/cli.js", EXPECTED_NEON_CLI_VERSION);
}

function tsxCliPath() {
  return findReviewedPackage("tsx", "dist/cli.mjs", EXPECTED_TSX_VERSION);
}

function runNeonApi(pathname, { body, method = "GET" } = {}) {
  const args = [
    neonCliPath(),
    "api",
    pathname,
    "--method",
    method,
    "--output",
    "json",
    "--no-color",
    "--no-analytics",
  ];
  if (body !== undefined) args.push("--data", JSON.stringify(body));
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: cleanEnvironment(),
    maxBuffer: MAX_API_BYTES,
    timeout: 60_000,
  });
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

async function boundedJsonResponse(response, maxBytes = MAX_API_BYTES) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("provider response exceeded the reviewed bound");
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

function assertExactCleanCommit(expectedSha) {
  const branch = gitResult(["branch", "--show-current"]);
  const commitSha = gitResult(["rev-parse", "HEAD"]);
  const status = gitResult(["status", "--porcelain"]);
  if (
    branch !== PROVIDER_PROOF_BRANCH
    || status !== ""
    || !/^[a-f0-9]{40}$/u.test(commitSha)
    || (expectedSha && expectedSha !== commitSha)
  ) throw new Error("provider proof requires the exact clean temporary branch commit");
  return commitSha;
}

function assertBootstrapDeploymentDisabled() {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  if (
    config?.git?.deploymentEnabled?.[PROVIDER_PROOF_BRANCH] !== false
    || config.git.deploymentEnabled.main !== false
  ) throw new Error("provider bootstrap requires Git deployment disabled for main and the proof branch");
}

export function validateDatabaseUrl(value, state, { pooled, role }) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error("database URL must be an exact non-empty string");
  }
  const parsed = new URL(value);
  const identity = parseGuardedNeonDatabaseIdentity(value, "provider proof database URL");
  const expectedHost = `${state.neonEndpointId}${pooled ? "-pooler" : ""}.${REVIEWED_DATABASE_REGION}.neon.tech`;
  if (
    parsed.hostname !== expectedHost
    || parsed.port !== "5432"
    || parsed.pathname !== `/${REVIEWED_DATABASE_NAME}`
    || parsed.username !== role
    || !parsed.password
    || identity.endpointId !== state.neonEndpointId
    || identity.databaseName !== REVIEWED_DATABASE_NAME
    || identity.region !== REVIEWED_DATABASE_REGION
    || identity.username !== role
    || identity.isPooler !== pooled
    || identity.port !== "5432"
    || parsed.searchParams.size !== 2
    || parsed.searchParams.get("sslmode") !== "verify-full"
    || parsed.searchParams.get("channel_binding") !== "require"
  ) throw new Error("database URL does not match the disposable child identity");
  return value;
}

function buildDatabaseUrl(state, role, password, { pooled }) {
  if (typeof password !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(password)) {
    throw new Error("Neon password did not have the reviewed shape");
  }
  const host = `${state.neonEndpointId}${pooled ? "-pooler" : ""}.${REVIEWED_DATABASE_REGION}.neon.tech`;
  const target = new URL(
    `postgresql://${role}:placeholder@${host}:5432/${REVIEWED_DATABASE_NAME}?sslmode=verify-full&channel_binding=require`,
  );
  target.password = password;
  return validateDatabaseUrl(target.toString(), state, { pooled, role });
}

function revealRolePassword(state, role) {
  const result = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${state.neonBranchId}/roles/${role}/reveal_password`,
  );
  const password = result?.password;
  if (typeof password !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(password)) {
    throw new Error("Neon role reveal did not return a bounded password");
  }
  return password;
}

export function validateProductionNeonBoundary(project, production) {
  if (
    project?.id !== REVIEWED_NEON_PROJECT_ID
    || project.org_id !== REVIEWED_NEON_ORG_ID
    || project.region_id !== REVIEWED_NEON_REGION_ID
    || production?.id !== REVIEWED_PRODUCTION_BRANCH_ID
    || production.primary !== true
    || production.default !== true
    || production.protected !== true
    || production.current_state !== "ready"
  ) throw new Error("production Neon identity drifted before disposable preparation");
  return Object.freeze({
    branchId: production.id,
    protected: production.protected,
  });
}

async function verifyProductionBoundaries() {
  const project = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}`)?.project;
  const production = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_PRODUCTION_BRANCH_ID}`,
  )?.branch;
  const neon = validateProductionNeonBoundary(project, production);
  const { payload: deployment } = await vercelApi(
    `/v13/deployments/${REVIEWED_PRODUCTION_DEPLOYMENT_ID}`,
  );
  if (
    deployment?.id !== REVIEWED_PRODUCTION_DEPLOYMENT_ID
    || deployment.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || deployment.readyState !== "READY"
    || deployment.target !== "production"
    || deployment.source !== "cli"
  ) throw new Error("production Vercel deployment drifted from the reviewed boundary");
  const aliases = [];
  for (const alias of REVIEWED_PRODUCTION_ALIASES) {
    const { payload: aliasDeployment } = await vercelApi(`/v13/deployments/${alias}`);
    if (
      aliasDeployment?.id !== REVIEWED_PRODUCTION_DEPLOYMENT_ID
      || aliasDeployment.projectId !== REVIEWED_VERCEL_PROJECT_ID
      || aliasDeployment.readyState !== "READY"
      || aliasDeployment.target !== "production"
    ) throw new Error(`production alias ${alias} drifted from the reviewed deployment`);
    aliases.push(alias);
  }
  return Object.freeze({
    aliases,
    deploymentId: deployment.id,
    neon,
    providerSource: deployment.source,
    sourceProvenance: "accepted-release-record",
    sourceSha: REVIEWED_PRODUCTION_SOURCE_SHA,
  });
}

async function verifyDisposableNeon(state, { requireReady = true } = {}) {
  const branch = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${state.neonBranchId}`,
  )?.branch;
  const endpoints = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/endpoints`)?.endpoints;
  const roles = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${state.neonBranchId}/roles`,
  )?.roles;
  const databases = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${state.neonBranchId}/databases`,
  )?.databases;
  const endpoint = Array.isArray(endpoints)
    ? endpoints.find((candidate) => candidate?.id === state.neonEndpointId)
    : null;
  const roleNames = Array.isArray(roles) ? roles.map((role) => role?.name).sort() : [];
  const database = Array.isArray(databases)
    ? databases.find((candidate) => candidate?.name === REVIEWED_DATABASE_NAME)
    : null;
  if (
    state.neonBranchId === REVIEWED_PRODUCTION_BRANCH_ID
    || branch?.id !== state.neonBranchId
    || branch.name !== REVIEWED_STAGING_BRANCH_NAME
    || branch.parent_id !== REVIEWED_PRODUCTION_BRANCH_ID
    || branch.primary !== false
    || branch.default !== false
    || branch.protected !== false
    || requireReady && branch.current_state !== "ready"
    || endpoint?.branch_id !== state.neonBranchId
    || endpoint.region_id !== REVIEWED_NEON_REGION_ID
    || endpoint.type !== "read_write"
    || requireReady && !["idle", "active"].includes(endpoint.current_state)
    || requireReady && JSON.stringify(roleNames) !== JSON.stringify(
      [REVIEWED_OWNER_ROLE, REVIEWED_RUNTIME_ROLE].sort(),
    )
    || requireReady && database?.branch_id !== state.neonBranchId
    || requireReady && database.owner_name !== REVIEWED_OWNER_ROLE
  ) throw new Error("disposable Neon child drifted from the exact reviewed shape");
  return { branch, endpoint };
}

async function resolveAttemptedDisposableNeon(state, created = null) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches;
    const endpoints = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/endpoints`)?.endpoints;
    if (!Array.isArray(branches) || !Array.isArray(endpoints)) {
      throw new Error("Neon creation recovery inventory shape drifted");
    }
    const matches = branches.filter((branch) => (
      branch?.name === REVIEWED_STAGING_BRANCH_NAME
      && branch.parent_id === REVIEWED_PRODUCTION_BRANCH_ID
      && branch.id !== REVIEWED_PRODUCTION_BRANCH_ID
      && branch.primary === false
      && branch.default === false
    ));
    if (matches.length > 1) {
      throw new Error("more than one exact disposable Neon child exists");
    }
    if (matches.length === 1) {
      const endpointMatches = endpoints.filter((endpoint) => (
        endpoint?.branch_id === matches[0].id
        && endpoint.type === "read_write"
        && endpoint.region_id === REVIEWED_NEON_REGION_ID
      ));
      if (endpointMatches.length > 1) {
        throw new Error("more than one exact disposable Neon endpoint exists");
      }
      if (endpointMatches.length === 1) {
        if (
          (created?.branch?.id && created.branch.id !== matches[0].id)
          || (
            created?.endpoints?.[0]?.id
            && created.endpoints[0].id !== endpointMatches[0].id
          )
        ) throw new Error("Neon creation response disagreed with recovered child identity");
        return {
          ...state,
          neonBranchId: matches[0].id,
          neonEndpointId: endpointMatches[0].id,
          phase: "neon-created",
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("exact disposable Neon child could not be resolved after creation attempt");
}

function attemptedDisposableBranchAbsent() {
  const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches;
  if (!Array.isArray(branches)) throw new Error("Neon branch list shape drifted");
  if (!branches.some((branch) => branch?.id === REVIEWED_PRODUCTION_BRANCH_ID)) {
    throw new Error("production Neon branch disappeared during creation recovery");
  }
  const matches = branches.filter((branch) => branch?.name === REVIEWED_STAGING_BRANCH_NAME);
  if (matches.length !== 0) {
    throw new Error("an unresolved disposable Neon branch still exists");
  }
  return true;
}

async function waitForDisposableNeon(state) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const branch = runNeonApi(
      `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${state.neonBranchId}`,
    )?.branch;
    const endpoints = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/endpoints`)?.endpoints;
    const endpoint = Array.isArray(endpoints)
      ? endpoints.find((candidate) => candidate?.id === state.neonEndpointId)
      : null;
    if (branch?.current_state === "ready" && ["idle", "active"].includes(endpoint?.current_state)) {
      return verifyDisposableNeon(state);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("disposable Neon child did not become ready in two minutes");
}

async function deleteDisposableNeon(state) {
  await verifyDisposableNeon(state, { requireReady: false });
  runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${state.neonBranchId}`,
    { method: "DELETE" },
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches;
    if (!Array.isArray(branches)) throw new Error("Neon branch list shape drifted after cleanup");
    if (!branches.some((branch) => branch?.id === REVIEWED_PRODUCTION_BRANCH_ID)) {
      throw new Error("production Neon branch disappeared during cleanup");
    }
    if (!branches.some((branch) => branch?.id === state.neonBranchId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("disposable Neon branch remained after deletion");
}

function evidencePath(kind, commitSha, slot) {
  const suffix = slot ? `-slot-${slot}` : "";
  return path.join(
    EVIDENCE_DIRECTORY,
    `checkout-reservation-provider-${kind}${suffix}-${commitSha.slice(0, 12)}.json`,
  );
}

function assertEvidencePathsAbsent(paths) {
  for (const filePath of paths) {
    if (existsSync(filePath)) {
      throw new Error(`refusing to overwrite existing provider evidence ${filePath}`);
    }
  }
}

function assertNoSensitiveEvidence(payload, state) {
  const serialized = JSON.stringify(payload);
  for (const secret of [
    state.runtimeDatabaseUrl,
    state.adminDatabaseUrl,
    state.triggerSecret,
    state.runId,
    state.bypassSecret,
    state.runtimeDatabaseUrl ? new URL(state.runtimeDatabaseUrl).password : "",
    state.adminDatabaseUrl ? new URL(state.adminDatabaseUrl).password : "",
  ]) {
    if (secret && serialized.includes(secret)) {
      throw new Error("sanitized evidence retained a temporary secret");
    }
  }
  if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/iu.test(serialized)) {
    throw new Error("sanitized evidence retained database credentials");
  }
}

function gateEnvironment(state, mode) {
  const env = {
    ...cleanEnvironment(),
    ...PROVIDER_ENVIRONMENT_BASE,
    RLS_CONTEXT_GATE_DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: state.neonEndpointId,
    RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "diagnostic-only",
  };
  if (mode === "prepare") {
    env.RLS_CONTEXT_GATE_PREPARE = "1";
    env.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL = state.adminDatabaseUrl;
    env.RLS_CONTEXT_GATE_EVIDENCE_PATH = state.setupEvidencePath;
  } else if (mode === "teardown") {
    env.RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE = "1";
    env.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL = state.adminDatabaseUrl;
    env.RLS_CONTEXT_GATE_EVIDENCE_PATH = state.teardownEvidencePath;
  } else throw new Error("unknown owner gate mode");
  return env;
}

function runOwnerGate(state, mode) {
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/rls-context-acceptance-gate.mjs")],
    {
      encoding: "utf8",
      env: gateEnvironment(state, mode),
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10 * 60_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`owner-only provider ${mode} gate failed`);
  }
  const evidence = readPrivateJson(
    mode === "prepare" ? state.setupEvidencePath : state.teardownEvidencePath,
    `${mode} evidence`,
  );
  if (
    evidence.run?.status !== "setup_passed"
    || evidence.result?.issueCount !== 0
    || evidence.locality?.acceptanceEligible !== false
    || evidence.database?.expectedDatabaseEndpointId !== state.neonEndpointId
    || evidence.database?.expectedDatabaseName !== REVIEWED_DATABASE_NAME
    || evidence.database?.runtimeRole !== REVIEWED_RUNTIME_ROLE
    || evidence.config?.[mode === "prepare" ? "prepare" : "teardownRpcProbe"] !== true
  ) throw new Error(`owner-only provider ${mode} evidence did not pass`);
  return evidence;
}

async function executeFixtureSql(state, filePath, applicationName) {
  const source = readFileSync(filePath, "utf8").replace(/^\\set[^\n]*\n/u, "");
  const client = new Client({
    application_name: applicationName,
    connectionString: state.adminDatabaseUrl,
  });
  await client.connect();
  try {
    await client.query(source);
  } finally {
    await client.end();
  }
}

async function setupFixtures(state) {
  await executeFixtureSql(
    state,
    "scripts/checkout-stock-reservation-provider-fixtures-setup.sql",
    "checkout-reservation-provider-setup",
  );
}

async function teardownFixtures(state) {
  await executeFixtureSql(
    state,
    "scripts/checkout-stock-reservation-provider-fixtures-teardown.sql",
    "checkout-reservation-provider-teardown",
  );
}

function runLocalPreflight(state) {
  const result = spawnSync(
    process.execPath,
    [tsxCliPath(), path.resolve("scripts/checkout-stock-reservation-provider-local-preflight.ts")],
    {
      encoding: "utf8",
      env: {
        ...cleanEnvironment(),
        DATABASE_URL: state.runtimeDatabaseUrl,
        NODE_ENV: "production",
        RLS_CONTEXT_GATE_CONFIRM: "staging-only",
        CHECKOUT_RESERVATION_PROVIDER_RUN_SLOT: "1",
        ...Object.fromEntries(
          Object.entries(PROVIDER_ENVIRONMENT_BASE).filter(([key]) => (
            key.startsWith("CHECKOUT_RESERVATION_PROVIDER_")
          )),
        ),
      },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10 * 60_000,
    },
  );
  let payload;
  try {
    payload = JSON.parse(String(result.stdout).trim().split(/\r?\n/u).filter(Boolean).at(-1));
  } catch {
    payload = { status: "failed", error: { message: "invalid local output" } };
  }
  assertNoSensitiveEvidence(payload, state);
  writePrivateJson(state.localEvidencePath, {
    capturedAt: new Date().toISOString(),
    exitStatus: result.status,
    result: payload,
  });
  if (
    result.error
    || result.status !== 0
    || payload.status !== "passed"
    || payload.issueCount !== 0
    || payload.result?.issueCount !== 0
  ) throw new Error("local checkout reservation provider preflight failed");
}

function automationBypassSecrets(project) {
  const inventory = project?.protectionBypass ?? {};
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new Error("Vercel protection-bypass inventory shape drifted");
  }
  return Object.entries(inventory)
    .filter(([, metadata]) => metadata?.scope === "automation-bypass")
    .map(([secret]) => secret)
    .sort();
}

async function currentBypassSecrets() {
  const { payload } = await vercelApi(`/v9/projects/${REVIEWED_VERCEL_PROJECT_ID}`);
  return automationBypassSecrets(payload);
}

async function createBypassSecret() {
  if ((await currentBypassSecrets()).length !== 0) {
    throw new Error("provider proof requires zero preexisting automation bypass secrets");
  }
  await vercelApi(
    `/v1/projects/${REVIEWED_VERCEL_PROJECT_ID}/protection-bypass`,
    { body: { generate: {} }, method: "PATCH" },
  );
  const after = await currentBypassSecrets();
  if (after.length !== 1 || !/^[A-Za-z0-9_-]{24,256}$/u.test(after[0])) {
    throw new Error("generated Vercel automation bypass did not have the exact shape");
  }
  return after[0];
}

async function revokeBypassSecret(state) {
  const current = await currentBypassSecrets();
  if (current.length === 0) return true;
  const reviewedSecret = state.bypassSecret || (
    state.bypassCreationAttemptedAt && current.length === 1 ? current[0] : ""
  );
  if (current.length !== 1 || current[0] !== reviewedSecret) {
    throw new Error("automation bypass inventory drifted before cleanup");
  }
  await vercelApi(
    `/v1/projects/${REVIEWED_VERCEL_PROJECT_ID}/protection-bypass`,
    {
      body: { revoke: { regenerate: false, secret: reviewedSecret } },
      method: "PATCH",
    },
  );
  if ((await currentBypassSecrets()).length !== 0) {
    throw new Error("automation bypass remained after cleanup");
  }
  return true;
}

async function branchEnvironmentInventory() {
  const { payload } = await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    { query: { gitBranch: PROVIDER_PROOF_BRANCH, target: "preview" } },
  );
  if (!Array.isArray(payload.envs)) throw new Error("Vercel environment shape drifted");
  return payload.envs;
}

export function providerEnvironmentEntries(state) {
  const values = {
    DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_TRIGGER_SECRET: state.triggerSecret,
    RLS_CONTEXT_GATE_RUN_ID: state.runId,
    RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA: state.commitSha,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: state.neonEndpointId,
    ...PROVIDER_ENVIRONMENT_BASE,
  };
  const entries = Object.entries(values).map(([key, value]) => ({
    comment: "Disposable CSR-A23 provider proof; delete after two counted slots",
    gitBranch: PROVIDER_PROOF_BRANCH,
    key,
    target: ["preview"],
    type: "sensitive",
    value,
  }));
  if (
    entries.length !== PROVIDER_ENVIRONMENT_KEYS.length
    || JSON.stringify(entries.map((entry) => entry.key)) !== JSON.stringify(PROVIDER_ENVIRONMENT_KEYS)
    || new Set(entries.map((entry) => entry.key)).size !== entries.length
    || entries.some((entry) => FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(entry.key))
  ) throw new Error("provider environment manifest is not the exact reviewed set");
  return entries;
}

function assertReviewedEnvironmentSubset(inventory, state) {
  const expected = new Set(providerEnvironmentEntries(state).map((entry) => entry.key));
  if (
    inventory.some((entry) => (
      !expected.has(entry?.key)
      || !/^[A-Za-z0-9_-]{8,128}$/u.test(entry?.id)
      || entry.gitBranch !== PROVIDER_PROOF_BRANCH
      || entry.type !== "sensitive"
      || !Array.isArray(entry.target)
      || entry.target.length !== 1
      || entry.target[0] !== "preview"
    ))
    || new Set(inventory.map((entry) => entry.key)).size !== inventory.length
  ) throw new Error("Vercel branch environment contains an unreviewed partial manifest");
  return inventory;
}

function assertExactEnvironmentInventory(inventory, state) {
  assertReviewedEnvironmentSubset(inventory, state);
  const expected = providerEnvironmentEntries(state).map((entry) => entry.key).sort();
  const actual = inventory.map((entry) => entry?.key).sort();
  if (
    inventory.length !== expected.length
    || JSON.stringify(actual) !== JSON.stringify(expected)
    || inventory.some((entry) => (
      !/^[A-Za-z0-9_-]{8,128}$/u.test(entry?.id)
      || entry.gitBranch !== PROVIDER_PROOF_BRANCH
      || entry.type !== "sensitive"
      || !Array.isArray(entry.target)
      || entry.target.length !== 1
      || entry.target[0] !== "preview"
    ))
  ) throw new Error("Vercel branch environment does not match the exact manifest");
  return inventory;
}

async function listDeployments() {
  const { payload } = await vercelApi("/v6/deployments", {
    query: { limit: 100, projectId: REVIEWED_VERCEL_PROJECT_ID },
  });
  if (!Array.isArray(payload.deployments)) throw new Error("Vercel deployments shape drifted");
  return payload.deployments;
}

async function readDeployment(deploymentId, expectedStatuses = [200]) {
  return vercelApi(`/v13/deployments/${deploymentId}`, { expectedStatuses });
}

async function cleanupBootstrapPreview() {
  if (
    process.env.CHECKOUT_RESERVATION_PROVIDER_BOOTSTRAP_CLEANUP_CONFIRM
      !== BOOTSTRAP_PREVIEW_CLEANUP_CONFIRMATION
  ) {
    throw new Error(
      `CHECKOUT_RESERVATION_PROVIDER_BOOTSTRAP_CLEANUP_CONFIRM=${BOOTSTRAP_PREVIEW_CLEANUP_CONFIRMATION} is required`,
    );
  }
  if (existsSync(PROVIDER_PROOF_STATE_PATH)) {
    throw new Error("provider proof state exists; bootstrap Preview cleanup is no longer allowed");
  }
  assertExactCleanCommit();
  assertBootstrapDeploymentDisabled();
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("provider branch variables exist before bootstrap Preview cleanup");
  }
  if ((await currentBypassSecrets()).length !== 0) {
    throw new Error("automation bypass exists before bootstrap Preview cleanup");
  }
  const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches;
  if (
    !Array.isArray(branches)
    || branches.some((branch) => branch?.name === REVIEWED_STAGING_BRANCH_NAME)
  ) throw new Error("disposable Neon child exists before bootstrap Preview cleanup");
  const { payload: deployment } = await readDeployment(REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID);
  if (
    deployment?.id !== REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID
    || deployment.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || deployment.name !== REVIEWED_VERCEL_PROJECT_NAME
    || deployment.readyState !== "ERROR"
    || deployment.source !== "git"
    || deployment.target !== null
    || deployment.gitSource?.type !== "github"
    || deployment.gitSource.sha !== REVIEWED_BOOTSTRAP_FAILED_SOURCE_SHA
    || deployment.gitSource.ref !== PROVIDER_PROOF_BRANCH
    || deployment.meta?.githubCommitSha !== REVIEWED_BOOTSTRAP_FAILED_SOURCE_SHA
    || deployment.meta?.githubCommitRef !== PROVIDER_PROOF_BRANCH
  ) throw new Error("failed bootstrap Preview drifted from the exact deletion target");
  await verifyProductionBoundaries();
  await vercelApi(`/v13/deployments/${REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID}`, {
    method: "DELETE",
  });
  if ((await readDeployment(REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID, [404])).status !== 404) {
    throw new Error("failed bootstrap Preview remained after deletion");
  }
  await verifyProductionBoundaries();
  console.log(JSON.stringify({
    bootstrapPreviewDeleted: true,
    deploymentId: REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID,
  }));
}

function validateDeploymentIdentity(deployment, state) {
  if (
    deployment?.id !== state.deploymentId
    || deployment.id === REVIEWED_PRODUCTION_DEPLOYMENT_ID
    || deployment.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || deployment.name !== REVIEWED_VERCEL_PROJECT_NAME
    || deployment.source !== "git"
    || deployment.target !== null
    || deployment.gitSource?.type !== "github"
    || deployment.gitSource.sha !== state.commitSha
    || deployment.gitSource.ref !== PROVIDER_PROOF_BRANCH
    || deployment.meta?.githubCommitSha !== state.commitSha
    || deployment.meta?.githubCommitRef !== PROVIDER_PROOF_BRANCH
    || !Array.isArray(deployment.regions)
    || deployment.regions.length !== 1
    || deployment.regions[0] !== REVIEWED_EXECUTION_REGION
    || deployment.createdIn !== REVIEWED_EXECUTION_REGION
    || typeof deployment.url !== "string"
    || !deployment.url.endsWith(".vercel.app")
  ) throw new Error("Vercel Preview did not match the exact Git provider identity");
  return deployment;
}

function providerWorkloadPairPassed(pair, label, concurrency) {
  const baseline = pair?.baseline;
  const candidate = pair?.candidate;
  const metrics = [
    baseline?.meanMs,
    baseline?.p95Ms,
    baseline?.maxMs,
    candidate?.meanMs,
    candidate?.p95Ms,
    candidate?.maxMs,
  ];
  return Boolean(
    baseline?.label === `${label}_baseline`
    && candidate?.label === `${label}_candidate`
    && baseline.requests === 80
    && candidate.requests === 80
    && baseline.concurrency === concurrency
    && candidate.concurrency === concurrency
    && baseline.errorCount === 0
    && candidate.errorCount === 0
    && metrics.every((value) => Number.isFinite(value) && value >= 0)
    && candidate.p95Ms <= 750
    && candidate.maxMs <= 3_000
    && candidate.meanMs <= Math.max(baseline.meanMs * 4, baseline.meanMs + 100)
    && candidate.p95Ms <= Math.max(baseline.p95Ms * 4, baseline.p95Ms + 150)
  );
}

export function validateProviderEvidence(payload, state, runSlot) {
  const target = payload.result?.workloads?.target;
  const burst = payload.result?.workloads?.burst;
  const sameListingWait = payload.result?.sameListingWait;
  if (
    payload.proofMode !== "provider-runtime-checkout-reservation-candidate"
    || payload.status !== "passed"
    || payload.run?.status !== "runtime_candidate_passed"
    || payload.run?.commitSha !== state.commitSha
    || payload.run?.deploymentId !== state.deploymentId
    || payload.result?.issueCount !== 0
    || payload.result?.catalog?.currentUser !== REVIEWED_RUNTIME_ROLE
    || payload.result?.catalog?.fixtureListings !== 20
    || payload.result?.catalog?.minimumStock !== 10_000
    || payload.result?.catalog?.activeReservations !== 0
    || sameListingWait?.passed !== true
    || sameListingWait.waitedForLock !== true
    || !Number.isFinite(sameListingWait.durationMs)
    || sameListingWait.durationMs < 100
    || sameListingWait.durationMs > 2_000
    || !providerWorkloadPairPassed(
      target,
      "same_seller_different_listing_target",
      8,
    )
    || !providerWorkloadPairPassed(
      burst,
      "same_seller_different_listing_burst",
      10,
    )
    || payload.config?.measuredRequests !== 80
    || payload.config?.targetConcurrency !== 8
    || payload.config?.burstConcurrency !== 10
    || payload.config?.warmupRequests !== 10
    || payload.config?.prismaPoolSize !== 10
    || payload.database?.expectedDatabaseEndpointId !== state.neonEndpointId
    || payload.database?.expectedDatabaseName !== REVIEWED_DATABASE_NAME
    || payload.database?.databaseHost
      !== `${state.neonEndpointId}-pooler.${REVIEWED_DATABASE_REGION}.neon.tech`
    || payload.database?.runtimeRole !== REVIEWED_RUNTIME_ROLE
    || payload.locality?.observedExecutionRegion !== REVIEWED_EXECUTION_REGION
    || payload.locality?.observedDatabaseRegion !== REVIEWED_DATABASE_REGION
    || payload.locality?.providerRuntimeMetadataPresent !== true
    || payload.runner?.runSlot !== runSlot
    || payload.runner?.runIdSha256 !== sha256(state.runId)
    || !/^v24\./u.test(payload.runner?.nodeVersion)
  ) throw new Error(`provider slot ${runSlot} did not produce accepted evidence`);
  return payload;
}

async function prepare() {
  if (process.env.CHECKOUT_RESERVATION_PROVIDER_CONFIRM !== PREPARE_CONFIRMATION) {
    throw new Error(`CHECKOUT_RESERVATION_PROVIDER_CONFIRM=${PREPARE_CONFIRMATION} is required`);
  }
  if (existsSync(PROVIDER_PROOF_STATE_PATH)) {
    throw new Error("provider proof state already exists");
  }
  if (existsSync(`${PROVIDER_PROOF_STATE_PATH}.next`)) {
    throw new Error("stale provider proof next-state file exists");
  }
  assertPrivateEvidenceDirectory();
  const commitSha = assertExactCleanCommit();
  assertBootstrapDeploymentDisabled();
  assertEvidencePathsAbsent([
    evidencePath("setup", commitSha),
    evidencePath("local-preflight", commitSha),
    evidencePath("teardown", commitSha),
    evidencePath("attestation", commitSha),
    evidencePath("response", commitSha, 1),
    evidencePath("response", commitSha, 2),
    evidencePath("cleanup", commitSha),
    evidencePath("abort-cleanup", commitSha),
  ]);
  const production = await verifyProductionBoundaries();
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("provider branch already has Vercel variables");
  }
  const existingDeployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  if (existingDeployments.length !== 0) {
    throw new Error("provider branch already has a Vercel deployment");
  }
  const branchList = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches;
  if (!Array.isArray(branchList) || branchList.some((branch) => branch?.name === REVIEWED_STAGING_BRANCH_NAME)) {
    throw new Error("disposable Neon branch name is unavailable");
  }
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let state = {
    adminDatabaseUrl: "",
    branch: PROVIDER_PROOF_BRANCH,
    bypassSecret: "",
    commitSha,
    createdAt: new Date().toISOString(),
    expiresAt,
    localEvidencePath: evidencePath("local-preflight", commitSha),
    neonBranchId: "",
    neonEndpointId: "",
    neonProjectId: REVIEWED_NEON_PROJECT_ID,
    parentBranchId: REVIEWED_PRODUCTION_BRANCH_ID,
    phase: "creation-attempted",
    projectId: REVIEWED_VERCEL_PROJECT_ID,
    production,
    runId: `checkout-reservation-${randomUUID()}`,
    runtimeDatabaseUrl: "",
    setupEvidencePath: evidencePath("setup", commitSha),
    teamId: REVIEWED_VERCEL_TEAM_ID,
    triggerSecret: randomBytes(48).toString("base64url"),
  };
  writePrivateJson(PROVIDER_PROOF_STATE_PATH, state);
  let created;
  try {
    created = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`, {
      body: {
        branch: {
          expires_at: expiresAt,
          name: REVIEWED_STAGING_BRANCH_NAME,
          parent_id: REVIEWED_PRODUCTION_BRANCH_ID,
        },
        endpoints: [{ type: "read_write" }],
      },
      method: "POST",
    });
  } catch (error) {
    try {
      state = await resolveAttemptedDisposableNeon(state);
      replaceState(state);
    } catch {
      throw error;
    }
  }
  if (state.phase === "creation-attempted") {
    state = await resolveAttemptedDisposableNeon(state, created);
    replaceState(state);
  }
  try {
    await waitForDisposableNeon(state);
    const ownerPassword = revealRolePassword(state, REVIEWED_OWNER_ROLE);
    const runtimePassword = revealRolePassword(state, REVIEWED_RUNTIME_ROLE);
    state = {
      ...state,
      adminDatabaseUrl: buildDatabaseUrl(state, REVIEWED_OWNER_ROLE, ownerPassword, { pooled: false }),
      phase: "credentials-ready",
      runtimeDatabaseUrl: buildDatabaseUrl(state, REVIEWED_RUNTIME_ROLE, runtimePassword, { pooled: true }),
    };
    replaceState(state);
  } catch (error) {
    try {
      await deleteDisposableNeon(state);
      unlinkSync(PROVIDER_PROOF_STATE_PATH);
    } catch {
      // Keep the mode-0600 partial state so cleanup-abort can delete only the
      // exact recorded child after an operator reviews the failed rollback.
    }
    throw error;
  }
  state = {
    ...state,
    bypassCreationAttemptedAt: new Date().toISOString(),
  };
  replaceState(state);
  const bypassSecret = await createBypassSecret();
  state = { ...state, bypassSecret };
  try {
    replaceState(state);
  } catch (error) {
    await revokeBypassSecret(state).catch(() => {});
    throw error;
  }
  runOwnerGate(state, "prepare");
  state = { ...state, gatePreparedAt: new Date().toISOString() };
  replaceState(state);
  await setupFixtures(state);
  state = { ...state, fixturesPreparedAt: new Date().toISOString() };
  replaceState(state);
  runLocalPreflight(state);
  state = { ...state, localPreflightAt: new Date().toISOString() };
  replaceState(state);
  await teardownFixtures(state);
  state = { ...state, fixturesResetAt: new Date().toISOString() };
  replaceState(state);
  await setupFixtures(state);
  replaceState({
    ...state,
    fixturesFinalizedAt: new Date().toISOString(),
    preparedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({
    commitSha,
    expiresAt,
    neonBranchId: state.neonBranchId,
    neonEndpointId: state.neonEndpointId,
    prepared: true,
  }));
}

async function configure() {
  const state = assertCredentialReadyState(readState());
  assertExactCleanCommit(state.commitSha);
  if (!state.preparedAt || state.configuredAt) throw new Error("state is not ready for configuration");
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("provider branch environment is not empty");
  }
  const attempting = {
    ...state,
    configurationAttemptedAt: new Date().toISOString(),
  };
  replaceState(attempting);
  const { payload } = await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    {
      body: providerEnvironmentEntries(attempting),
      expectedStatuses: [201],
      method: "POST",
    },
  );
  if (Array.isArray(payload.failed) && payload.failed.length > 0) {
    throw new Error("one or more Vercel variables failed to create");
  }
  const inventory = assertExactEnvironmentInventory(
    await branchEnvironmentInventory(),
    attempting,
  );
  replaceState({
    ...attempting,
    configuredAt: new Date().toISOString(),
    environmentIds: inventory.map((entry) => entry.id).sort(),
  });
  console.log(JSON.stringify({ configured: true, variableCount: inventory.length }));
}

async function rebind() {
  const state = assertCredentialReadyState(readState());
  const commitSha = assertExactCleanCommit();
  if (!state.configuredAt || state.attestedAt || commitSha === state.commitSha) {
    throw new Error("state is not eligible for exact-commit rebinding");
  }
  assertEvidencePathsAbsent([
    evidencePath("attestation", commitSha),
    evidencePath("response", commitSha, 1),
    evidencePath("response", commitSha, 2),
    evidencePath("cleanup", commitSha),
    evidencePath("abort-cleanup", commitSha),
  ]);
  const inventory = assertExactEnvironmentInventory(await branchEnvironmentInventory(), state);
  const allowed = inventory.find((entry) => entry.key === "RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA");
  if (!allowed) throw new Error("allowed commit variable is absent");
  const existing = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitSha === commitSha,
  );
  if (existing.length !== 0) throw new Error("new commit already has a deployment before rebinding");
  await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env/${allowed.id}`,
    {
      body: {
        gitBranch: PROVIDER_PROOF_BRANCH,
        target: ["preview"],
        type: "sensitive",
        value: commitSha,
      },
      method: "PATCH",
    },
  );
  const rebound = { ...state, commitSha };
  assertExactEnvironmentInventory(await branchEnvironmentInventory(), rebound);
  replaceState({
    ...rebound,
    priorCommitSha: state.commitSha,
    reboundAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ commitSha, rebound: true }));
}

async function attest() {
  let state = assertCredentialReadyState(readState());
  assertExactCleanCommit(state.commitSha);
  if (!state.configuredAt || state.attestedAt) throw new Error("state is not ready for attestation");
  let candidate;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const matches = (await listDeployments()).filter(
      (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH
        && deployment.meta?.githubCommitSha === state.commitSha,
    );
    if (matches.length > 1) throw new Error("more than one exact Preview deployment exists");
    if (matches.length === 1) {
      candidate = matches[0];
      if (!state.deploymentId) {
        state = {
          ...state,
          deploymentId: candidate.uid,
          deploymentUrl: candidate.url,
        };
        replaceState(state);
      }
      if (["ERROR", "CANCELED"].includes(candidate.readyState ?? candidate.state)) {
        throw new Error("exact Git Preview failed before readiness");
      }
      if ((candidate.readyState ?? candidate.state) === "READY") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!candidate || (candidate.readyState ?? candidate.state) !== "READY") {
    throw new Error("exact Git Preview did not become ready in ten minutes");
  }
  const { payload: deployment } = await readDeployment(state.deploymentId);
  validateDeploymentIdentity(deployment, state);
  if (deployment.readyState !== "READY") throw new Error("exact Preview is not READY");
  assertExactEnvironmentInventory(await branchEnvironmentInventory(), state);
  await verifyDisposableNeon(state);
  const production = await verifyProductionBoundaries();
  const attestation = {
    capturedAt: new Date().toISOString(),
    commitSha: state.commitSha,
    deployment: {
      createdIn: deployment.createdIn,
      id: deployment.id,
      readyState: deployment.readyState,
      regions: deployment.regions,
      source: deployment.source,
      url: deployment.url,
    },
    neon: {
      branchId: state.neonBranchId,
      endpointId: state.neonEndpointId,
      parentBranchId: state.parentBranchId,
      region: REVIEWED_DATABASE_REGION,
    },
    production,
    scope: "checkout-reservation-provider-attestation",
    secretValuesRetained: false,
  };
  assertNoSensitiveEvidence(attestation, state);
  const attestationPath = evidencePath("attestation", state.commitSha);
  writePrivateJson(attestationPath, attestation);
  replaceState({
    ...state,
    attestationPath,
    attestedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ attested: true, commitSha: state.commitSha, deploymentId: state.deploymentId }));
}

async function invoke(runSlot) {
  const state = assertCredentialReadyState(readState());
  assertExactCleanCommit(state.commitSha);
  if (!state.attestedAt || state.failedSlot) throw new Error("state is not eligible for a counted slot");
  if (runSlot === 1 && (state.slot1EvidencePath || state.slot2EvidencePath)) {
    throw new Error("slot 1 has already been attempted");
  }
  if (runSlot === 2 && (!state.slot1EvidencePath || state.slot2EvidencePath)) {
    throw new Error("slot 2 requires exactly one passing slot 1");
  }
  const activeBypass = await currentBypassSecrets();
  if (activeBypass.length !== 1 || activeBypass[0] !== state.bypassSecret) {
    throw new Error("automation bypass changed before counted invocation");
  }
  try {
    const response = await fetch(`https://${state.deploymentUrl}/api/internal/rls-context-gate`, {
      body: JSON.stringify({ runSlot, token: state.triggerSecret }),
      headers: {
        "Content-Type": "application/json",
        "x-vercel-protection-bypass": state.bypassSecret,
      },
      method: "POST",
      signal: AbortSignal.timeout(340_000),
    });
    const payload = await boundedJsonResponse(response, MAX_PROVIDER_BYTES);
    assertNoSensitiveEvidence(payload, state);
    const outputPath = evidencePath("response", state.commitSha, runSlot);
    writePrivateJson(outputPath, {
      capturedAt: new Date().toISOString(),
      httpStatus: response.status,
      response: payload,
    });
    if (response.status !== 200) {
      throw new Error(`provider slot ${runSlot} returned HTTP ${response.status}`);
    }
    validateProviderEvidence(payload, state, runSlot);
    replaceState({
      ...state,
      [`slot${runSlot}CompletedAt`]: new Date().toISOString(),
      [`slot${runSlot}EvidencePath`]: outputPath,
    });
    console.log(JSON.stringify({ countedPass: true, runSlot }));
  } catch (error) {
    replaceState({
      ...state,
      failedAt: new Date().toISOString(),
      failedSlot: runSlot,
    });
    throw error;
  }
}

async function cleanup(requireSuccess) {
  const expected = requireSuccess ? CLEANUP_CONFIRMATION : ABORT_CONFIRMATION;
  if (process.env.CHECKOUT_RESERVATION_PROVIDER_CLEANUP_CONFIRM !== expected) {
    throw new Error(`CHECKOUT_RESERVATION_PROVIDER_CLEANUP_CONFIRM=${expected} is required`);
  }
  let state = readState();
  if (requireSuccess) assertCredentialReadyState(state);
  if (state.phase === "creation-attempted") {
    try {
      state = await resolveAttemptedDisposableNeon(state);
      replaceState(state);
    } catch (error) {
      try {
        attemptedDisposableBranchAbsent();
      } catch {
        throw error;
      }
      const absentEvidence = {
        capturedAt: new Date().toISOString(),
        commitSha: state.commitSha,
        neonBranchAbsent: true,
        requireSuccess: false,
        scope: "checkout-reservation-provider-uncertain-creation-abort-cleanup",
        temporaryStateDeletedAfterEvidence: true,
      };
      assertNoSensitiveEvidence(absentEvidence, state);
      writePrivateJson(evidencePath("abort-cleanup", state.commitSha), absentEvidence);
      unlinkSync(PROVIDER_PROOF_STATE_PATH);
      console.log(JSON.stringify({ cleanupComplete: true, creationAbsent: true, requireSuccess: false }));
      return;
    }
  }
  if (state.phase === "neon-created") {
    if (requireSuccess) throw new Error("partial provider state cannot complete successful cleanup");
    await deleteDisposableNeon(state);
    const partialEvidence = {
      capturedAt: new Date().toISOString(),
      commitSha: state.commitSha,
      neonBranchDeleted: true,
      requireSuccess: false,
      scope: "checkout-reservation-provider-partial-abort-cleanup",
      temporaryStateDeletedAfterEvidence: true,
    };
    assertNoSensitiveEvidence(partialEvidence, state);
    writePrivateJson(evidencePath("abort-cleanup", state.commitSha), partialEvidence);
    unlinkSync(PROVIDER_PROOF_STATE_PATH);
    console.log(JSON.stringify({ cleanupComplete: true, partial: true, requireSuccess: false }));
    return;
  }
  if (requireSuccess) {
    for (const [slot, filePath] of [[1, state.slot1EvidencePath], [2, state.slot2EvidencePath]]) {
      const evidence = readPrivateJson(filePath, `slot ${slot} evidence`);
      if (evidence.httpStatus !== 200) throw new Error(`slot ${slot} did not retain HTTP 200 evidence`);
      validateProviderEvidence(evidence.response, state, slot);
    }
  }
  if (state.preparedAt) {
    await teardownFixtures(state);
    state = {
      ...state,
      teardownEvidencePath: evidencePath("teardown", state.commitSha),
    };
    replaceState(state);
    if (!existsSync(state.teardownEvidencePath)) runOwnerGate(state, "teardown");
  }
  if (state.configurationAttemptedAt) {
    const inventory = assertReviewedEnvironmentSubset(
      await branchEnvironmentInventory(),
      state,
    );
    const ids = inventory.map((entry) => entry.id).sort();
    if (
      state.configuredAt
      && JSON.stringify(ids) !== JSON.stringify([...state.environmentIds].sort())
    ) {
      throw new Error("Vercel variable identities drifted before cleanup");
    }
    if (ids.length > 0) {
      const { payload } = await vercelApi(`/v1/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`, {
        body: { ids },
        method: "DELETE",
      });
      if (
        Number(payload.deleted) !== ids.length
        || !Array.isArray(payload.ids)
        || JSON.stringify([...payload.ids].sort()) !== JSON.stringify(ids)
      ) throw new Error("Vercel did not delete every branch variable");
    }
    if ((await branchEnvironmentInventory()).length !== 0) throw new Error("branch variables remained");
  }
  const deployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  const allowedDeploymentCommits = new Set(
    [state.commitSha, state.priorCommitSha].filter(Boolean),
  );
  for (const deployment of deployments) {
    const deploymentCommit = deployment.meta?.githubCommitSha;
    if (
      deployment.target !== null
      || deployment.uid === REVIEWED_PRODUCTION_DEPLOYMENT_ID
      || !allowedDeploymentCommits.has(deploymentCommit)
    ) {
      throw new Error("deployment cleanup target escaped the disposable Preview branch");
    }
    const { payload: exactDeployment } = await readDeployment(deployment.uid);
    validateDeploymentIdentity(exactDeployment, {
      ...state,
      commitSha: deploymentCommit,
      deploymentId: deployment.uid,
    });
    await vercelApi(`/v13/deployments/${deployment.uid}`, { method: "DELETE" });
    if ((await readDeployment(deployment.uid, [404])).status !== 404) {
      throw new Error("Preview deployment remained after deletion");
    }
  }
  await revokeBypassSecret(state);
  await deleteDisposableNeon(state);
  const production = await verifyProductionBoundaries();
  const cleanupEvidence = {
    capturedAt: new Date().toISOString(),
    automationBypassRevoked: true,
    branchEnvironmentVariablesDeleted: state.configurationAttemptedAt
      ? (state.environmentIds?.length ?? 0)
      : 0,
    commitSha: state.commitSha,
    neonBranchDeleted: true,
    previewDeploymentsDeleted: deployments.length,
    production,
    requireSuccess,
    scope: "checkout-reservation-provider-cleanup",
    temporaryStateDeletedAfterEvidence: true,
  };
  assertNoSensitiveEvidence(cleanupEvidence, state);
  writePrivateJson(evidencePath(requireSuccess ? "cleanup" : "abort-cleanup", state.commitSha), cleanupEvidence);
  unlinkSync(PROVIDER_PROOF_STATE_PATH);
  console.log(JSON.stringify({ cleanupComplete: true, requireSuccess }));
}

async function status() {
  const state = existsSync(PROVIDER_PROOF_STATE_PATH) ? readState() : null;
  const environments = await branchEnvironmentInventory();
  const deployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches ?? [];
  console.log(JSON.stringify({
    branchEnvironmentVariableCount: environments.length,
    disposableNeonBranches: branches
      .filter((branch) => branch?.name === REVIEWED_STAGING_BRANCH_NAME)
      .map((branch) => ({ id: branch.id, state: branch.current_state })),
    previewDeployments: deployments.map((deployment) => ({
      id: deployment.uid,
      readyState: deployment.readyState ?? deployment.state,
    })),
    productionBranchPresent: branches.some((branch) => branch?.id === REVIEWED_PRODUCTION_BRANCH_ID),
    state: state ? {
      attested: Boolean(state.attestedAt),
      commitSha: state.commitSha,
      configured: Boolean(state.configuredAt),
      failedSlot: state.failedSlot ?? null,
      prepared: Boolean(state.preparedAt),
      slot1Passed: Boolean(state.slot1EvidencePath),
      slot2Passed: Boolean(state.slot2EvidencePath),
    } : null,
  }, null, 2));
}

function usage() {
  console.error(
    "Usage: node scripts/checkout-stock-reservation-provider-proof-operator.mjs <cleanup-bootstrap-preview|prepare|configure|rebind|attest|slot-1|slot-2|cleanup|cleanup-abort|status>",
  );
}

async function main() {
  switch (process.argv[2]) {
    case "cleanup-bootstrap-preview": await cleanupBootstrapPreview(); break;
    case "prepare": await prepare(); break;
    case "configure": await configure(); break;
    case "rebind": await rebind(); break;
    case "attest": await attest(); break;
    case "slot-1": await invoke(1); break;
    case "slot-2": await invoke(2); break;
    case "cleanup": await cleanup(true); break;
    case "cleanup-abort": await cleanup(false); break;
    case "status": await status(); break;
    default:
      usage();
      process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "provider proof operator failed");
    process.exitCode = 1;
  });
}
