#!/usr/bin/env node
import {
  chmodSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
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
  buildScramSha256Verifier,
  readProductionDatabaseMetadataWithVercel,
  realDatabaseOperations,
} from "./saved-search-phase-b-owner-rotation.mjs";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import { assertDeterministicPostgresEnvironment } from "./postgres-url-safety.mjs";

const LOCAL_CREDENTIAL_PATH = "/Users/drewyoung/grainline/.env.local";
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const CONFIRMATION = "converge-vercel-new-database-old-owner-credential";
const EXPECTED_STAGED_DIRECT_UPDATED_AT = 1784659428583;
const EXPECTED_RUNTIME_DATABASE_UPDATED_AT = 1784476074964;
const VERIFY_ATTEMPTS = 7;
const VERIFY_INTERVAL_MS = 2_000;

function required(value, label) {
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${label} is required without surrounding whitespace`);
  }
  return value;
}

function normalizeLocalUrl(value, label) {
  let url;
  try {
    url = new URL(required(value, label));
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  for (const key of url.searchParams.keys()) {
    if (key !== "sslmode" && key !== "channel_binding") {
      throw new Error(`${label} has an unreviewed parameter`);
    }
  }
  if (url.port === "") url.port = "5432";
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.set("channel_binding", "require");
  return url;
}

function assertReviewedIdentity(url, { isPooler, label }) {
  const identity = parseGuardedNeonDatabaseIdentity(url.toString(), label);
  if (
    identity.endpointId !== REVIEWED_ENDPOINT_ID
    || identity.databaseName !== REVIEWED_DATABASE_NAME
    || identity.region !== REVIEWED_DATABASE_REGION
    || identity.username !== REVIEWED_OWNER_ROLE
    || identity.isPooler !== isPooler
  ) {
    throw new Error(`${label} is not the reviewed production owner target`);
  }
}

export function loadReviewedSplitOwnerCredentials() {
  const credentialStat = statSync(LOCAL_CREDENTIAL_PATH);
  if (!credentialStat.isFile() || (credentialStat.mode & 0o077) !== 0) {
    throw new Error("reviewed local database credential file must remain mode 0600");
  }
  const local = dotenv.parse(readFileSync(LOCAL_CREDENTIAL_PATH));
  const proposed = normalizeLocalUrl(local.DIRECT_URL, "proposed DIRECT_URL");
  const legacyPooler = normalizeLocalUrl(local.DATABASE_URL, "legacy DATABASE_URL");
  assertReviewedIdentity(proposed, { isPooler: false, label: "proposed DIRECT_URL" });
  assertReviewedIdentity(legacyPooler, { isPooler: true, label: "legacy DATABASE_URL" });
  if (proposed.password === legacyPooler.password) {
    throw new Error("proposed and legacy owner credentials must differ");
  }
  const legacyDirect = new URL(legacyPooler);
  legacyDirect.hostname = proposed.hostname;
  assertReviewedIdentity(legacyDirect, { isPooler: false, label: "legacy direct URL" });
  return Object.freeze({
    proposedDirectUrl: proposed.toString(),
    proposedPassword: decodeURIComponent(proposed.password),
    legacyDirectUrl: legacyDirect.toString(),
  });
}

export function parseOwnerReconciliationConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Phase B owner reconciliation");
  if (env.PHASE_B_OWNER_RECONCILIATION_CONFIRM !== CONFIRMATION) {
    throw new Error("Phase B owner reconciliation confirmation is not exact");
  }
  if (env.PHASE_B_OWNER_RECONCILIATION_RELEASE_COMMIT !== PHASE_B_RELEASE_COMMIT) {
    throw new Error("Phase B owner reconciliation release commit is not sealed");
  }
  const evidencePath = required(
    env.PHASE_B_OWNER_RECONCILIATION_EVIDENCE_PATH,
    "PHASE_B_OWNER_RECONCILIATION_EVIDENCE_PATH",
  );
  if (
    !path.isAbsolute(evidencePath)
    || path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.extname(evidencePath) !== ".json"
  ) {
    throw new Error("owner reconciliation evidence must be one JSON file in the rollout-evidence directory");
  }
  return Object.freeze({
    evidencePath,
    now: new Date(),
    ...loadReviewedSplitOwnerCredentials(),
  });
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{2,24}$/.test(error.code)
    ? error.code
    : "UNCLASSIFIED";
}

function isPostgresSqlState(code) {
  return /^[A-Z0-9]{5}$/.test(code);
}

export async function inspectOwnerCredential(database, connectionString, label) {
  try {
    return Object.freeze({
      status: "accepted",
      state: await database.readOwnerState(connectionString),
    });
  } catch (error) {
    if (error?.code === "28P01") {
      return Object.freeze({ status: "rejected", state: null });
    }
    throw new Error(`${label} failed for a reason other than password authentication`);
  }
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

export async function runOwnerReconciliation(
  config,
  {
    database = realDatabaseOperations,
    readVercelMetadata = readProductionDatabaseMetadataWithVercel,
    verifyVercelProject = assertReviewedVercelProject,
    wait = defaultWait,
  } = {},
) {
  let metadata = null;
  let reconciliationMode = null;
  let alterResult = null;
  const checks = {
    vercelProjectVerified: false,
    vercelDirectUrlMetadataExact: false,
    runtimeDatabaseUrlMetadataUnchanged: false,
    credentialStateUnambiguousBefore: false,
    databaseCredentialRotationAttempted: false,
    proposedCredentialVerifiedAfter: false,
    legacyCredentialRejectedAfter: false,
    runtimeRolePostureUnchanged: false,
    ownerSessionsDrained: false,
  };
  try {
    verifyVercelProject(REVIEWED_VERCEL_PROJECT_DIRECTORY);
    checks.vercelProjectVerified = true;
    metadata = await readVercelMetadata(REVIEWED_VERCEL_PROJECT_DIRECTORY);
    if (metadata.directUrl.updatedAt !== EXPECTED_STAGED_DIRECT_UPDATED_AT) {
      throw new Error("Vercel proposed DIRECT_URL metadata is not the exact staged update");
    }
    checks.vercelDirectUrlMetadataExact = true;
    if (metadata.databaseUrl.updatedAt !== EXPECTED_RUNTIME_DATABASE_UPDATED_AT) {
      throw new Error("Vercel runtime DATABASE_URL metadata drifted");
    }
    checks.runtimeDatabaseUrlMetadataUnchanged = true;

    const proposedBefore = await inspectOwnerCredential(
      database,
      config.proposedDirectUrl,
      "proposed owner credential inspection",
    );
    const legacyBefore = await inspectOwnerCredential(
      database,
      config.legacyDirectUrl,
      "legacy owner credential inspection",
    );
    if (proposedBefore.status === "rejected" && legacyBefore.status === "accepted") {
      assertOwnerState(legacyBefore.state, config.now);
      reconciliationMode = "apply";
    } else if (
      proposedBefore.status === "accepted"
      && legacyBefore.status === "rejected"
    ) {
      assertOwnerState(proposedBefore.state, config.now);
      reconciliationMode = "verify-only";
    } else {
      throw new Error("owner credential acceptance state is not an approved reconciliation state");
    }
    checks.credentialStateUnambiguousBefore = true;

    if (reconciliationMode === "apply") {
      const verifier = buildScramSha256Verifier(config.proposedPassword);
      checks.databaseCredentialRotationAttempted = true;
      try {
        await database.alterCurrentOwnerPassword(config.legacyDirectUrl, verifier);
        alterResult = Object.freeze({ returned: true, errorCode: null });
      } catch (error) {
        const errorCode = safeErrorCode(error);
        alterResult = Object.freeze({ returned: false, errorCode });
        if (isPostgresSqlState(errorCode)) {
          throw new Error("PostgreSQL rejected the owner password change with a SQLSTATE");
        }
        // A connection failure after commit is ambiguous. Proposed-password
        // authentication below is authoritative. A rerun safely becomes
        // verify-only if PostgreSQL committed the ALTER ROLE.
      }
    }

    const after = await readStateWithRetry(database, config.proposedDirectUrl, wait);
    if (!after) throw new Error("proposed owner credential did not authenticate after reconciliation");
    assertOwnerState(after, config.now);
    checks.proposedCredentialVerifiedAfter = true;
    checks.runtimeRolePostureUnchanged = true;
    await database.proveOldCredentialRejected(config.legacyDirectUrl);
    checks.legacyCredentialRejectedAfter = true;
    let ownerSessionCount = null;
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
      ownerSessionCount = await database.readOtherOwnerSessionCount(config.proposedDirectUrl);
      if (ownerSessionCount === 0) break;
      if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
    }
    if (ownerSessionCount !== 0) throw new Error("owner session drain did not reach zero");
    checks.ownerSessionsDrained = true;
    return Object.freeze({
      checks,
      metadata,
      ownerSessionCount,
      reconciliationMode,
      alterResult,
    });
  } catch (error) {
    error.reconciliationChecks = { ...checks };
    error.reconciliationMetadata = metadata;
    error.reconciliationMode = reconciliationMode;
    error.reconciliationAlterResult = alterResult;
    throw error;
  }
}

export function buildOwnerReconciliationEvidence(result, status = "passed") {
  const passed = status === "passed";
  return {
    generatedAt: new Date().toISOString(),
    status,
    acceptanceEligible: passed && result?.checks?.ownerSessionsDrained === true,
    issueCount: passed ? 0 : 1,
    phase: "phase-b-owner-reconciliation",
    reconciliationMode: result?.reconciliationMode ?? null,
    alterResult: result?.alterResult ?? null,
    releaseCommit: PHASE_B_RELEASE_COMMIT,
    target: {
      endpointId: REVIEWED_ENDPOINT_ID,
      databaseName: REVIEWED_DATABASE_NAME,
      region: REVIEWED_DATABASE_REGION,
      ownerRole: REVIEWED_OWNER_ROLE,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
    vercelDatabaseMetadata: result?.metadata ? {
      directUrlUpdatedAt: result.metadata.directUrl.updatedAt,
      databaseUrlUpdatedAt: result.metadata.databaseUrl.updatedAt,
    } : null,
    checks: result?.checks ?? result?.reconciliationChecks ?? null,
    ownerSessionCount: result?.ownerSessionCount ?? null,
    issues: passed ? [] : ["Phase B owner reconciliation failed closed; inspect sanitized checks before any retry"],
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
    config = parseOwnerReconciliationConfig(process.env);
    const result = await runOwnerReconciliation(config);
    const payload = buildOwnerReconciliationEvidence(result);
    writeEvidence(config.evidencePath, payload);
    process.stdout.write(`${JSON.stringify({
      status: payload.status,
      acceptanceEligible: payload.acceptanceEligible,
      issueCount: payload.issueCount,
    })}\n`);
  } catch (error) {
    const evidencePath = config?.evidencePath
      ?? process.env.PHASE_B_OWNER_RECONCILIATION_EVIDENCE_PATH;
    if (
      typeof evidencePath === "string"
      && path.isAbsolute(evidencePath)
      && path.dirname(evidencePath) === EVIDENCE_DIRECTORY
    ) {
      writeEvidence(evidencePath, buildOwnerReconciliationEvidence({
        reconciliationChecks: error?.reconciliationChecks ?? null,
        metadata: error?.reconciliationMetadata ?? null,
        reconciliationMode: error?.reconciliationMode ?? null,
        alterResult: error?.reconciliationAlterResult ?? null,
      }, "failed"));
    }
    process.stderr.write("Phase B owner reconciliation failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
