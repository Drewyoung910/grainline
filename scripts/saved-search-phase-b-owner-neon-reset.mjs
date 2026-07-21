#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  PHASE_B_RELEASE_COMMIT,
  REVIEWED_DATABASE_NAME,
  REVIEWED_DATABASE_REGION,
  REVIEWED_ENDPOINT_ID,
  REVIEWED_OWNER_ROLE,
  REVIEWED_RUNTIME_ROLE,
  REVIEWED_VERCEL_PROJECT_DIRECTORY,
  assertOwnerState,
  assertReviewedVercelProject,
  readProductionDatabaseMetadataWithVercel,
  realDatabaseOperations,
  updateProductionDirectUrlWithVercel,
  updateReviewedLocalDirectUrl,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  inspectOwnerCredential,
  loadReviewedSplitOwnerCredentials,
} from "./saved-search-phase-b-owner-reconciliation.mjs";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import { assertDeterministicPostgresEnvironment } from "./postgres-url-safety.mjs";

const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const LOCAL_CREDENTIAL_TEMP_PATH = "/Users/drewyoung/grainline/.env.local.phase-b-owner-rotation.tmp";
const CONFIRMATION = "reset-production-owner-via-pinned-neon-api-after-sql-xx000";
const EXPECTED_STAGED_DIRECT_UPDATED_AT = 1784659428583;
const EXPECTED_RUNTIME_DATABASE_UPDATED_AT = 1784476074964;
const REVIEWED_NEON_PROJECT_ID = "icy-unit-96812898";
const REVIEWED_NEON_BRANCH_ID = "br-hidden-mouse-aaugn2wr";
const REVIEWED_NEON_BRANCH_NAME = "production";
const REVIEWED_NEON_ORG_ID = "org-raspy-frost-18952075";
const REVIEWED_NEON_CLI_PATH = "/Users/drewyoung/.npm/_npx/74274893b9fe65d3/node_modules/neonctl/dist/cli.js";
const REVIEWED_NEON_CLI_VERSION = "2.35.1";
const REVIEWED_NEON_CREDENTIAL_PATH = "/Users/drewyoung/.config/neonctl/credentials.json";
const VERIFY_ATTEMPTS = 16;
const VERIFY_INTERVAL_MS = 2_000;

function required(value, label) {
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${label} is required without surrounding whitespace`);
  }
  return value;
}

export function parseNeonOwnerResetConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Phase B Neon owner reset");
  if (env.PHASE_B_NEON_OWNER_RESET_CONFIRM !== CONFIRMATION) {
    throw new Error("Phase B Neon owner reset confirmation is not exact");
  }
  if (env.PHASE_B_NEON_OWNER_RESET_RELEASE_COMMIT !== PHASE_B_RELEASE_COMMIT) {
    throw new Error("Phase B Neon owner reset release commit is not sealed");
  }
  const evidencePath = required(
    env.PHASE_B_NEON_OWNER_RESET_EVIDENCE_PATH,
    "PHASE_B_NEON_OWNER_RESET_EVIDENCE_PATH",
  );
  if (
    !path.isAbsolute(evidencePath)
    || path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.extname(evidencePath) !== ".json"
  ) {
    throw new Error("Neon owner reset evidence must be one JSON file in the rollout-evidence directory");
  }
  if (existsSync(LOCAL_CREDENTIAL_TEMP_PATH)) {
    throw new Error("stale local owner-rotation temporary credential file exists");
  }
  const credentialStat = statSync(REVIEWED_NEON_CREDENTIAL_PATH);
  if (!credentialStat.isFile() || (credentialStat.mode & 0o077) !== 0) {
    throw new Error("reviewed Neon CLI credential file must not be group/world accessible");
  }
  return Object.freeze({
    evidencePath,
    now: new Date(),
    ...loadReviewedSplitOwnerCredentials(),
  });
}

export function assertReviewedNeonCli() {
  const packagePath = path.resolve(
    path.dirname(REVIEWED_NEON_CLI_PATH),
    "..",
    "package.json",
  );
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  if (metadata?.name !== "neonctl" || metadata.version !== REVIEWED_NEON_CLI_VERSION) {
    throw new Error("Neon CLI package does not match the reviewed operator version");
  }
  return Object.freeze({ name: metadata.name, version: metadata.version });
}

function neonCliEnvironment(env = process.env) {
  const childEnvironment = { ...env };
  for (const key of ["DATABASE_URL", "DIRECT_URL", "GRANT_AUDIT_DATABASE_URL"]) {
    delete childEnvironment[key];
  }
  return childEnvironment;
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
      env: neonCliEnvironment(process.env),
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error("reviewed Neon API command failed without a usable response");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("reviewed Neon API response was not valid JSON");
  }
}

function exactOperation(operation) {
  if (
    typeof operation?.id !== "string"
    || operation.project_id !== REVIEWED_NEON_PROJECT_ID
    || (operation.branch_id && operation.branch_id !== REVIEWED_NEON_BRANCH_ID)
    || typeof operation.action !== "string"
    || typeof operation.status !== "string"
  ) {
    throw new Error("Neon password-reset operation did not match the reviewed project and branch");
  }
  return Object.freeze({
    id: operation.id,
    action: operation.action,
    status: operation.status,
  });
}

export function validateNeonResetResponse(payload) {
  const role = payload?.role;
  if (
    role?.branch_id !== REVIEWED_NEON_BRANCH_ID
    || role.name !== REVIEWED_OWNER_ROLE
    || role.authentication_method !== "password"
    || typeof role.updated_at !== "string"
    || typeof role.password !== "string"
    || role.password.length < 20
    || role.password.length > 256
    || !/^[\x21-\x7e]+$/.test(role.password)
    || !Array.isArray(payload.operations)
    || payload.operations.length === 0
  ) {
    throw new Error("Neon password-reset response did not match the reviewed role shape");
  }
  return Object.freeze({
    password: role.password,
    roleUpdatedAt: new Date(role.updated_at).toISOString(),
    operations: payload.operations.map(exactOperation),
  });
}

export function resetReviewedNeonOwnerPassword() {
  const pathname = `/projects/${REVIEWED_NEON_PROJECT_ID}`
    + `/branches/${REVIEWED_NEON_BRANCH_ID}`
    + `/roles/${REVIEWED_OWNER_ROLE}/reset_password`;
  return validateNeonResetResponse(runNeonApi(pathname, "POST"));
}

export function readReviewedNeonOperation(operationId) {
  if (typeof operationId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(operationId)) {
    throw new Error("Neon operation id is not bounded");
  }
  const payload = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/operations/${operationId}`,
  );
  return exactOperation(payload?.operation);
}

export function verifyReviewedNeonTarget() {
  const project = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}`)?.project;
  const branch = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_NEON_BRANCH_ID}`,
  )?.branch;
  const endpoints = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/endpoints`,
  )?.endpoints;
  const endpoint = Array.isArray(endpoints)
    ? endpoints.find((candidate) => candidate?.id === REVIEWED_ENDPOINT_ID)
    : null;
  if (
    project?.id !== REVIEWED_NEON_PROJECT_ID
    || project.org_id !== REVIEWED_NEON_ORG_ID
    || project.region_id !== "azure-westus3"
    || project.store_passwords !== true
    || branch?.id !== REVIEWED_NEON_BRANCH_ID
    || branch.name !== REVIEWED_NEON_BRANCH_NAME
    || branch.primary !== true
    || branch.default !== true
    || endpoint?.branch_id !== REVIEWED_NEON_BRANCH_ID
    || endpoint.region_id !== "azure-westus3"
    || endpoint.type !== "read_write"
    || endpoint.disabled !== false
  ) {
    throw new Error("Neon project, production branch, or endpoint metadata drifted");
  }
  return Object.freeze({
    projectId: project.id,
    branchId: branch.id,
    endpointId: endpoint.id,
  });
}

export function buildNeonResetDirectUrl(currentDirectUrl, password) {
  if (
    typeof password !== "string"
    || password.length < 20
    || password.length > 256
    || !/^[\x21-\x7e]+$/.test(password)
  ) {
    throw new Error("Neon-returned owner password does not match the reviewed shape");
  }
  const before = parseGuardedNeonDatabaseIdentity(currentDirectUrl, "current DIRECT_URL");
  const next = new URL(currentDirectUrl);
  next.password = password;
  const nextUrl = next.toString();
  const after = parseGuardedNeonDatabaseIdentity(nextUrl, "Neon-reset DIRECT_URL");
  if (
    JSON.stringify(before) !== JSON.stringify(after)
    || after.endpointId !== REVIEWED_ENDPOINT_ID
    || after.databaseName !== REVIEWED_DATABASE_NAME
    || after.region !== REVIEWED_DATABASE_REGION
    || after.username !== REVIEWED_OWNER_ROLE
    || after.isPooler
  ) {
    throw new Error("Neon-reset DIRECT_URL changed the reviewed database identity");
  }
  return nextUrl;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForNeonOperations(initial, readOperation, wait) {
  let operations = initial;
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    if (operations.some((operation) => ["failed", "error", "cancelled"].includes(operation.status))) {
      throw new Error("Neon password-reset operation failed");
    }
    if (operations.every((operation) => ["finished", "skipped"].includes(operation.status))) {
      return operations;
    }
    if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
    operations = await Promise.all(
      operations.map((operation) => readOperation(operation.id)),
    );
  }
  throw new Error("Neon password-reset operations did not finish in the reviewed window");
}

async function readStateWithRetry(database, connectionString, wait) {
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    try {
      return await database.readOwnerState(connectionString);
    } catch {
      if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
    }
  }
  return null;
}

export async function runNeonOwnerReset(
  config,
  {
    database = realDatabaseOperations,
    verifyVercelProject = assertReviewedVercelProject,
    verifyNeonTarget = verifyReviewedNeonTarget,
    readVercelMetadata = readProductionDatabaseMetadataWithVercel,
    resetNeonOwnerPassword = resetReviewedNeonOwnerPassword,
    readNeonOperation = readReviewedNeonOperation,
    updateLocalDirectUrl = updateReviewedLocalDirectUrl,
    updateProductionDirectUrl = updateProductionDirectUrlWithVercel,
    wait = defaultWait,
  } = {},
) {
  let vercelMetadata = null;
  let neon = null;
  const checks = {
    vercelProjectVerified: false,
    neonTargetVerified: false,
    splitCredentialStateVerified: false,
    neonPasswordResetAttempted: false,
    neonPasswordResetResponseVerified: false,
    localDirectUrlUpdated: false,
    vercelDirectUrlUpdated: false,
    runtimeDatabaseUrlMetadataUnchanged: false,
    neonOperationsFinished: false,
    newCredentialVerified: false,
    legacyCredentialRejected: false,
    priorProposedCredentialRejected: false,
    runtimeRolePostureUnchanged: false,
    ownerSessionsDrained: false,
  };
  try {
    verifyVercelProject(REVIEWED_VERCEL_PROJECT_DIRECTORY);
    checks.vercelProjectVerified = true;
    verifyNeonTarget();
    checks.neonTargetVerified = true;
    const beforeMetadata = await readVercelMetadata(REVIEWED_VERCEL_PROJECT_DIRECTORY);
    if (
      beforeMetadata.directUrl.updatedAt !== EXPECTED_STAGED_DIRECT_UPDATED_AT
      || beforeMetadata.databaseUrl.updatedAt !== EXPECTED_RUNTIME_DATABASE_UPDATED_AT
    ) {
      throw new Error("Vercel database metadata is not the exact reviewed split state");
    }
    const proposedBefore = await inspectOwnerCredential(
      database,
      config.proposedDirectUrl,
      "prior proposed owner credential inspection",
    );
    const legacyBefore = await inspectOwnerCredential(
      database,
      config.legacyDirectUrl,
      "legacy owner credential inspection",
    );
    if (proposedBefore.status !== "rejected" || legacyBefore.status !== "accepted") {
      throw new Error("database credentials are not in the exact reviewed split state");
    }
    assertOwnerState(legacyBefore.state, config.now);
    checks.splitCredentialStateVerified = true;

    checks.neonPasswordResetAttempted = true;
    neon = await resetNeonOwnerPassword();
    if (
      neon.password === config.proposedPassword
      || decodeURIComponent(new URL(config.legacyDirectUrl).password) === neon.password
    ) {
      throw new Error("Neon reset did not return a distinct owner password");
    }
    checks.neonPasswordResetResponseVerified = true;
    const resetDirectUrl = buildNeonResetDirectUrl(
      config.proposedDirectUrl,
      neon.password,
    );
    updateLocalDirectUrl(resetDirectUrl);
    checks.localDirectUrlUpdated = true;

    await updateProductionDirectUrl(resetDirectUrl, REVIEWED_VERCEL_PROJECT_DIRECTORY);
    checks.vercelDirectUrlUpdated = true;
    const afterMetadata = await readVercelMetadata(REVIEWED_VERCEL_PROJECT_DIRECTORY);
    if (
      afterMetadata.directUrl.updatedAt <= beforeMetadata.directUrl.updatedAt
      || afterMetadata.databaseUrl.updatedAt !== beforeMetadata.databaseUrl.updatedAt
    ) {
      throw new Error("Vercel metadata did not prove a DIRECT_URL-only Neon-reset update");
    }
    checks.runtimeDatabaseUrlMetadataUnchanged = true;
    vercelMetadata = Object.freeze({
      directUrlBeforeUpdatedAt: beforeMetadata.directUrl.updatedAt,
      directUrlAfterUpdatedAt: afterMetadata.directUrl.updatedAt,
      databaseUrlBeforeUpdatedAt: beforeMetadata.databaseUrl.updatedAt,
      databaseUrlAfterUpdatedAt: afterMetadata.databaseUrl.updatedAt,
    });

    const operations = await waitForNeonOperations(neon.operations, readNeonOperation, wait);
    checks.neonOperationsFinished = true;
    const after = await readStateWithRetry(database, resetDirectUrl, wait);
    if (!after) throw new Error("Neon-reset owner credential did not authenticate");
    assertOwnerState(after, config.now);
    checks.newCredentialVerified = true;
    checks.runtimeRolePostureUnchanged = true;
    await database.proveOldCredentialRejected(config.legacyDirectUrl);
    checks.legacyCredentialRejected = true;
    await database.proveOldCredentialRejected(config.proposedDirectUrl);
    checks.priorProposedCredentialRejected = true;

    let ownerSessionCount = null;
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
      ownerSessionCount = await database.readOtherOwnerSessionCount(resetDirectUrl);
      if (ownerSessionCount === 0) break;
      if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
    }
    if (ownerSessionCount !== 0) throw new Error("owner session drain did not reach zero");
    checks.ownerSessionsDrained = true;
    return Object.freeze({
      checks,
      vercelMetadata,
      ownerSessionCount,
      neon: {
        roleUpdatedAt: neon.roleUpdatedAt,
        operations,
      },
    });
  } catch (error) {
    error.neonResetState = { ...checks };
    error.neonResetVercelMetadata = vercelMetadata;
    error.neonResetSummary = neon ? {
      roleUpdatedAt: neon.roleUpdatedAt,
      operations: neon.operations,
    } : null;
    throw error;
  }
}

export function buildNeonOwnerResetEvidence(result, status = "passed") {
  const passed = status === "passed";
  return {
    generatedAt: new Date().toISOString(),
    status,
    acceptanceEligible: passed && result?.checks?.ownerSessionsDrained === true,
    issueCount: passed ? 0 : 1,
    phase: "phase-b-owner-neon-api-reset",
    releaseCommit: PHASE_B_RELEASE_COMMIT,
    target: {
      neonProjectId: REVIEWED_NEON_PROJECT_ID,
      neonOrgId: REVIEWED_NEON_ORG_ID,
      branchId: REVIEWED_NEON_BRANCH_ID,
      branchName: REVIEWED_NEON_BRANCH_NAME,
      endpointId: REVIEWED_ENDPOINT_ID,
      databaseName: REVIEWED_DATABASE_NAME,
      ownerRole: REVIEWED_OWNER_ROLE,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
    checks: result?.checks ?? result?.neonResetState ?? null,
    vercelDatabaseMetadata: result?.vercelMetadata
      ?? result?.neonResetVercelMetadata
      ?? null,
    neon: result?.neon ?? result?.neonResetSummary ?? null,
    ownerSessionCount: result?.ownerSessionCount ?? null,
    issues: passed ? [] : [
      "Phase B Neon owner reset failed closed; do not retry without classifying the provider operation and both owner credentials",
    ],
  };
}

function writeEvidence(evidencePath, payload) {
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(evidencePath, 0o600);
}

async function main() {
  let config;
  try {
    config = parseNeonOwnerResetConfig(process.env);
    const result = await runNeonOwnerReset(config);
    const payload = buildNeonOwnerResetEvidence(result);
    writeEvidence(config.evidencePath, payload);
    process.stdout.write(`${JSON.stringify({
      status: payload.status,
      acceptanceEligible: payload.acceptanceEligible,
      issueCount: payload.issueCount,
    })}\n`);
  } catch (error) {
    const evidencePath = config?.evidencePath ?? process.env.PHASE_B_NEON_OWNER_RESET_EVIDENCE_PATH;
    if (
      typeof evidencePath === "string"
      && path.isAbsolute(evidencePath)
      && path.dirname(evidencePath) === EVIDENCE_DIRECTORY
      && path.extname(evidencePath) === ".json"
    ) {
      writeEvidence(evidencePath, buildNeonOwnerResetEvidence({
        neonResetState: error?.neonResetState ?? null,
        neonResetVercelMetadata: error?.neonResetVercelMetadata ?? null,
        neonResetSummary: error?.neonResetSummary ?? null,
      }, "failed"));
    }
    process.stderr.write("Phase B Neon owner reset failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
