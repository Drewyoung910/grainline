#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PHASE_B_RELEASE_COMMIT,
  REVIEWED_DATABASE_NAME,
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
import {
  buildNeonResetDirectUrl,
  readReviewedNeonOwnerRoleMetadata,
  revealReviewedNeonOwnerPassword,
  verifyReviewedNeonTarget,
} from "./saved-search-phase-b-owner-neon-reset.mjs";
import { assertDeterministicPostgresEnvironment } from "./postgres-url-safety.mjs";

const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const LOCAL_CREDENTIAL_TEMP_PATH = "/Users/drewyoung/grainline/.env.local.phase-b-owner-rotation.tmp";
const REVIEWED_NEON_CREDENTIAL_PATH = "/Users/drewyoung/.config/neonctl/credentials.json";
const CONFIRMATION = "recover-current-owner-via-pinned-neon-reveal-after-lost-reset-response";
const EXPECTED_STAGED_DIRECT_UPDATED_AT = 1784659428583;
const EXPECTED_RUNTIME_DATABASE_UPDATED_AT = 1784476074964;
const EXPECTED_RESET_ROLE_UPDATED_AT = "2026-07-21T19:16:14.000Z";
const VERIFY_ATTEMPTS = 16;
const VERIFY_INTERVAL_MS = 2_000;

function required(value, label) {
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${label} is required without surrounding whitespace`);
  }
  return value;
}

export function parseNeonOwnerRecoveryConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Phase B Neon owner recovery");
  if (env.PHASE_B_NEON_OWNER_RECOVERY_CONFIRM !== CONFIRMATION) {
    throw new Error("Phase B Neon owner recovery confirmation is not exact");
  }
  if (env.PHASE_B_NEON_OWNER_RECOVERY_RELEASE_COMMIT !== PHASE_B_RELEASE_COMMIT) {
    throw new Error("Phase B Neon owner recovery release commit is not sealed");
  }
  const evidencePath = required(
    env.PHASE_B_NEON_OWNER_RECOVERY_EVIDENCE_PATH,
    "PHASE_B_NEON_OWNER_RECOVERY_EVIDENCE_PATH",
  );
  if (
    !path.isAbsolute(evidencePath)
    || path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.extname(evidencePath) !== ".json"
  ) {
    throw new Error("Neon owner recovery evidence must be one JSON file in the rollout-evidence directory");
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

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

export async function runNeonOwnerRecovery(
  config,
  {
    database = realDatabaseOperations,
    verifyVercelProject = assertReviewedVercelProject,
    verifyNeonTarget = verifyReviewedNeonTarget,
    readNeonOwnerRoleMetadata = readReviewedNeonOwnerRoleMetadata,
    revealNeonOwnerPassword = revealReviewedNeonOwnerPassword,
    readVercelMetadata = readProductionDatabaseMetadataWithVercel,
    updateLocalDirectUrl = updateReviewedLocalDirectUrl,
    updateProductionDirectUrl = updateProductionDirectUrlWithVercel,
    wait = defaultWait,
  } = {},
) {
  let vercelMetadata = null;
  let roleMetadata = null;
  const checks = {
    vercelProjectVerified: false,
    neonTargetVerified: false,
    bothKnownCredentialsRejected: false,
    resetRoleMetadataVerified: false,
    currentPasswordRevealed: false,
    localDirectUrlUpdated: false,
    vercelDirectUrlUpdated: false,
    runtimeDatabaseUrlMetadataUnchanged: false,
    currentCredentialVerified: false,
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
      throw new Error("Vercel database metadata is not the exact post-reset recovery state");
    }
    const priorProposed = await inspectOwnerCredential(
      database,
      config.proposedDirectUrl,
      "prior proposed owner credential inspection",
    );
    const legacy = await inspectOwnerCredential(
      database,
      config.legacyDirectUrl,
      "legacy owner credential inspection",
    );
    if (priorProposed.status !== "rejected" || legacy.status !== "rejected") {
      throw new Error("both known owner credentials must reject before reveal recovery");
    }
    checks.bothKnownCredentialsRejected = true;

    roleMetadata = await readNeonOwnerRoleMetadata();
    if (roleMetadata.updatedAt !== EXPECTED_RESET_ROLE_UPDATED_AT) {
      throw new Error("Neon owner role timestamp is not the exact completed reset");
    }
    checks.resetRoleMetadataVerified = true;
    const currentPassword = await revealNeonOwnerPassword();
    if (
      currentPassword === config.proposedPassword
      || currentPassword === decodeURIComponent(new URL(config.legacyDirectUrl).password)
    ) {
      throw new Error("Neon reveal returned a superseded owner password");
    }
    checks.currentPasswordRevealed = true;
    const currentDirectUrl = buildNeonResetDirectUrl(
      config.proposedDirectUrl,
      currentPassword,
    );
    updateLocalDirectUrl(currentDirectUrl);
    checks.localDirectUrlUpdated = true;

    await updateProductionDirectUrl(currentDirectUrl, REVIEWED_VERCEL_PROJECT_DIRECTORY);
    checks.vercelDirectUrlUpdated = true;
    const afterMetadata = await readVercelMetadata(REVIEWED_VERCEL_PROJECT_DIRECTORY);
    if (
      afterMetadata.directUrl.updatedAt <= beforeMetadata.directUrl.updatedAt
      || afterMetadata.databaseUrl.updatedAt !== beforeMetadata.databaseUrl.updatedAt
    ) {
      throw new Error("Vercel metadata did not prove a DIRECT_URL-only recovery update");
    }
    checks.runtimeDatabaseUrlMetadataUnchanged = true;
    vercelMetadata = Object.freeze({
      directUrlBeforeUpdatedAt: beforeMetadata.directUrl.updatedAt,
      directUrlAfterUpdatedAt: afterMetadata.directUrl.updatedAt,
      databaseUrlBeforeUpdatedAt: beforeMetadata.databaseUrl.updatedAt,
      databaseUrlAfterUpdatedAt: afterMetadata.databaseUrl.updatedAt,
    });

    const after = await readStateWithRetry(database, currentDirectUrl, wait);
    if (!after) throw new Error("revealed current owner credential did not authenticate");
    assertOwnerState(after, config.now);
    checks.currentCredentialVerified = true;
    checks.runtimeRolePostureUnchanged = true;
    await database.proveOldCredentialRejected(config.legacyDirectUrl);
    checks.legacyCredentialRejected = true;
    await database.proveOldCredentialRejected(config.proposedDirectUrl);
    checks.priorProposedCredentialRejected = true;

    let ownerSessionCount = null;
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
      ownerSessionCount = await database.readOtherOwnerSessionCount(currentDirectUrl);
      if (ownerSessionCount === 0) break;
      if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
    }
    if (ownerSessionCount !== 0) throw new Error("owner session drain did not reach zero");
    checks.ownerSessionsDrained = true;
    return Object.freeze({ checks, vercelMetadata, roleMetadata, ownerSessionCount });
  } catch (error) {
    error.neonRecoveryState = { ...checks };
    error.neonRecoveryVercelMetadata = vercelMetadata;
    error.neonRecoveryRoleMetadata = roleMetadata;
    throw error;
  }
}

export function buildNeonOwnerRecoveryEvidence(result, status = "passed") {
  const passed = status === "passed";
  return {
    generatedAt: new Date().toISOString(),
    status,
    acceptanceEligible: passed && result?.checks?.ownerSessionsDrained === true,
    issueCount: passed ? 0 : 1,
    phase: "phase-b-owner-neon-reveal-recovery",
    releaseCommit: PHASE_B_RELEASE_COMMIT,
    target: {
      endpointId: REVIEWED_ENDPOINT_ID,
      databaseName: REVIEWED_DATABASE_NAME,
      ownerRole: REVIEWED_OWNER_ROLE,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
    checks: result?.checks ?? result?.neonRecoveryState ?? null,
    roleMetadata: result?.roleMetadata ?? result?.neonRecoveryRoleMetadata ?? null,
    vercelDatabaseMetadata: result?.vercelMetadata
      ?? result?.neonRecoveryVercelMetadata
      ?? null,
    ownerSessionCount: result?.ownerSessionCount ?? null,
    issues: passed ? [] : [
      "Phase B Neon reveal recovery failed closed; do not reset or reveal again without classifying provider, local, Vercel, and database state",
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
    config = parseNeonOwnerRecoveryConfig(process.env);
    const result = await runNeonOwnerRecovery(config);
    const payload = buildNeonOwnerRecoveryEvidence(result);
    writeEvidence(config.evidencePath, payload);
    process.stdout.write(`${JSON.stringify({
      status: payload.status,
      acceptanceEligible: payload.acceptanceEligible,
      issueCount: payload.issueCount,
    })}\n`);
  } catch (error) {
    const evidencePath = config?.evidencePath
      ?? process.env.PHASE_B_NEON_OWNER_RECOVERY_EVIDENCE_PATH;
    if (
      typeof evidencePath === "string"
      && path.isAbsolute(evidencePath)
      && path.dirname(evidencePath) === EVIDENCE_DIRECTORY
      && path.extname(evidencePath) === ".json"
    ) {
      writeEvidence(evidencePath, buildNeonOwnerRecoveryEvidence({
        neonRecoveryState: error?.neonRecoveryState ?? null,
        neonRecoveryVercelMetadata: error?.neonRecoveryVercelMetadata ?? null,
        neonRecoveryRoleMetadata: error?.neonRecoveryRoleMetadata ?? null,
      }, "failed"));
    }
    process.stderr.write("Phase B Neon owner reveal recovery failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
