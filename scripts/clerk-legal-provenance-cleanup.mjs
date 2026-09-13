#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

import {
  CLERK_LEGAL_PROVENANCE_INSPECTION_SQL,
  REVIEWED_CLERK_LEGAL_INSPECTION_TARGET,
  REVIEWED_CURRENT_TERMS_VERSION,
  buildClerkLegalProvenanceInspectionSql,
  normalizeClerkLegalProvenanceCounts,
} from "./clerk-legal-provenance-inspect.mjs";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const CLERK_LEGAL_PROVENANCE_CLEANUP_CONFIRMATION =
  "clear-one-untrusted-clerk-legal-acceptance";
export const REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION = Object.freeze({
  runId: "33886609425",
  releaseCommit: "1e4e0c786a9fe4259cbd3d6e79bec39aabc9de2d",
  evidenceSha256: "6b9819119b1c20e3f386546e623c98f894181a294c3f8dc9932e37c747bb50ca",
});
export const REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS = Object.freeze({
  inspected: Object.freeze({
    totalUsers: 9,
    activeUsers: 9,
    deletedUsers: 0,
    activeCurrentAccepted: 5,
    activeTrustedCurrentAccepted: 4,
    activeUntrustedCurrentAccepted: 1,
    activePartialOrStaleLegalState: 3,
    activeNoLegalState: 1,
    deletedCurrentAccepted: 0,
  }),
  cleared: Object.freeze({
    totalUsers: 9,
    activeUsers: 9,
    deletedUsers: 0,
    activeCurrentAccepted: 4,
    activeTrustedCurrentAccepted: 4,
    activeUntrustedCurrentAccepted: 0,
    activePartialOrStaleLegalState: 3,
    activeNoLegalState: 2,
    deletedCurrentAccepted: 0,
  }),
  reaccepted: Object.freeze({
    totalUsers: 9,
    activeUsers: 9,
    deletedUsers: 0,
    activeCurrentAccepted: 5,
    activeTrustedCurrentAccepted: 5,
    activeUntrustedCurrentAccepted: 0,
    activePartialOrStaleLegalState: 3,
    activeNoLegalState: 1,
    deletedCurrentAccepted: 0,
  }),
});

export const CLERK_LEGAL_ACCOUNT_STATE_CACHE_TTL_SECONDS = 60;
export const CLERK_LEGAL_ACCOUNT_STATE_CACHE_DRAIN_SECONDS = 65;

const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const PRODUCTION_RELATIONS = Object.freeze({
  user: 'public."User"',
  audit: 'public."AdminAuditLog"',
});
const PROOF_RELATIONS = Object.freeze({
  user: "pg_temp.clerk_legal_user_fixture",
  audit: "pg_temp.clerk_legal_audit_fixture",
});

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function assertReviewedRelations(relations) {
  const matchesProduction =
    relations?.user === PRODUCTION_RELATIONS.user
    && relations?.audit === PRODUCTION_RELATIONS.audit;
  const matchesProof =
    relations?.user === PROOF_RELATIONS.user
    && relations?.audit === PROOF_RELATIONS.audit;
  if (!matchesProduction && !matchesProof) {
    throw new Error("Clerk legal provenance cleanup relations are not reviewed");
  }
  return relations;
}

export function buildClerkLegalProvenanceCleanupTargetSql(
  relations = PRODUCTION_RELATIONS,
) {
  const reviewed = assertReviewedRelations(relations);
  return `
    SELECT subject.id
    FROM ${reviewed.user} AS subject
    WHERE subject."deletedAt" IS NULL
      AND subject."termsAcceptedAt" IS NOT NULL
      AND subject."ageAttestedAt" IS NOT NULL
      AND subject."termsVersion" IS NOT DISTINCT FROM '${REVIEWED_CURRENT_TERMS_VERSION}'
      AND NOT EXISTS (
        SELECT 1
        FROM ${reviewed.audit} AS audit
        WHERE audit."adminId" = subject.id
          AND audit.action = 'TERMS_ACCEPTED'
          AND audit."targetType" = 'USER'
          AND audit."targetId" = subject.id
          AND audit.undone = false
          AND audit.metadata->>'actorKind' = 'user'
          AND audit.metadata->>'route' = '/api/account/accept-terms'
          AND audit.metadata->>'termsVersion' = '${REVIEWED_CURRENT_TERMS_VERSION}'
      )
    ORDER BY subject.id
    FOR UPDATE OF subject
  `;
}

export function buildClerkLegalProvenanceClearSql(
  relations = PRODUCTION_RELATIONS,
) {
  const reviewed = assertReviewedRelations(relations);
  return `
    UPDATE ${reviewed.user}
    SET
      "termsAcceptedAt" = NULL,
      "termsVersion" = NULL,
      "ageAttestedAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = $1
      AND "deletedAt" IS NULL
      AND "termsAcceptedAt" IS NOT NULL
      AND "ageAttestedAt" IS NOT NULL
      AND "termsVersion" IS NOT DISTINCT FROM '${REVIEWED_CURRENT_TERMS_VERSION}'
    RETURNING id
  `;
}

export const CLERK_LEGAL_PROVENANCE_CLEANUP_TARGET_SQL =
  buildClerkLegalProvenanceCleanupTargetSql();
export const CLERK_LEGAL_PROVENANCE_CLEAR_SQL =
  buildClerkLegalProvenanceClearSql();
export const CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_TARGET_SQL =
  buildClerkLegalProvenanceCleanupTargetSql(PROOF_RELATIONS);
export const CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_CLEAR_SQL =
  buildClerkLegalProvenanceClearSql(PROOF_RELATIONS);
export const CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_COUNTS_SQL =
  buildClerkLegalProvenanceInspectionSql(PROOF_RELATIONS);

function sameCounts(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

export function classifyClerkLegalProvenanceCleanupState(
  counts,
  expected = REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS,
) {
  if (sameCounts(counts, expected.inspected)) return "cleanup-required";
  if (sameCounts(counts, expected.cleared)) return "already-cleared";
  if (sameCounts(counts, expected.reaccepted)) return "already-reaccepted";
  if (counts.activeUntrustedCurrentAccepted === 0) return "already-converged";
  throw new Error("Clerk legal provenance cleanup state is not an exact reviewed state");
}

export function parseClerkLegalProvenanceCleanupConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Clerk legal provenance cleanup");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error(
      "Clerk legal provenance cleanup requires a manual main-branch GitHub Actions dispatch",
    );
  }
  const releaseCommit = required(
    env,
    "CLERK_LEGAL_PROVENANCE_CLEANUP_RELEASE_COMMIT",
  );
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error(
      "Clerk legal provenance cleanup commit must match the dispatched main commit",
    );
  }
  if (
    env.CLERK_LEGAL_PROVENANCE_CLEANUP_CONFIRM
    !== CLERK_LEGAL_PROVENANCE_CLEANUP_CONFIRMATION
  ) {
    throw new Error("Clerk legal provenance cleanup confirmation is not exact");
  }
  const inspectionRunId = required(
    env,
    "CLERK_LEGAL_PROVENANCE_INSPECTION_RUN_ID",
  );
  const inspectionEvidenceSha256 = required(
    env,
    "CLERK_LEGAL_PROVENANCE_INSPECTION_EVIDENCE_SHA256",
  );
  if (
    !RUN_ID_PATTERN.test(inspectionRunId)
    || inspectionRunId !== REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION.runId
    || inspectionEvidenceSha256
      !== REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION.evidenceSha256
  ) {
    throw new Error("Clerk legal provenance cleanup inspection binding is not exact");
  }
  if (Object.hasOwn(env, "DATABASE_URL")) {
    throw new Error("DATABASE_URL must remain absent from the owner-only cleanup job");
  }
  if (Object.hasOwn(env, "GRANT_AUDIT_DATABASE_URL")) {
    throw new Error("GRANT_AUDIT_DATABASE_URL must remain absent during cleanup");
  }

  const directUrl = required(env, "DIRECT_URL");
  const expectedDirectUrlSha256 = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  const directUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  if (
    !SHA256_PATTERN.test(expectedDirectUrlSha256)
    || expectedDirectUrlSha256 !== directUrlSha256
  ) {
    throw new Error("DIRECT_URL does not match the protected environment digest");
  }
  const migrationRole = required(env, "MIGRATION_DB_ROLE");
  const runtimeRole = required(env, "RUNTIME_DB_ROLE");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  const target = REVIEWED_CLERK_LEGAL_INSPECTION_TARGET;
  if (
    identity.isPooler
    || identity.endpointId !== target.endpointId
    || identity.databaseName !== target.databaseName
    || identity.region !== target.region
    || identity.username !== target.ownerRole
    || migrationRole !== target.ownerRole
    || runtimeRole !== target.runtimeRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }

  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "CLERK_LEGAL_PROVENANCE_CLEANUP_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    runnerTemp,
    `clerk-legal-provenance-cleanup-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedEvidencePath || existsSync(evidencePath)) {
    throw new Error("Clerk legal provenance cleanup evidence path is not fresh");
  }

  return Object.freeze({
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    inspectionEvidenceSha256,
    inspectionRunId,
    releaseCommit,
  });
}

export function readClerkLegalProvenanceCleanupGitState(cwd = process.cwd()) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertClerkLegalProvenanceCleanupGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("Clerk legal provenance cleanup checkout is not exact and clean");
  }
  return Object.freeze({ head: state.head, clean: true });
}

async function readPosture(client) {
  const result = await client.query(`
    SELECT
      CURRENT_USER AS current_user,
      pg_catalog.current_database() AS database_name,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      runtime_role.rolinherit AS runtime_inherit,
      pg_catalog.to_regclass('public."User"') IS NOT NULL AS user_table_present,
      pg_catalog.to_regclass('public."AdminAuditLog"') IS NOT NULL AS audit_table_present
    FROM pg_catalog.pg_roles AS owner_role
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE owner_role.rolname = 'neondb_owner'
  `);
  const row = result.rows[0];
  const target = REVIEWED_CLERK_LEGAL_INSPECTION_TARGET;
  if (
    result.rows.length !== 1
    || row.current_user !== target.ownerRole
    || row.database_name !== target.databaseName
    || row.owner_bypass_rls !== true
    || row.runtime_bypass_rls !== false
    || row.runtime_superuser !== false
    || row.runtime_inherit !== false
    || row.user_table_present !== true
    || row.audit_table_present !== true
  ) {
    throw new Error("Clerk legal provenance cleanup database posture is not reviewed");
  }
  return Object.freeze({
    currentUser: row.current_user,
    databaseName: row.database_name,
    runtimeNoBypassRls: true,
    runtimeNoInherit: true,
    requiredTablesPresent: true,
  });
}

async function readCounts(client, countsSql) {
  const result = await client.query(countsSql);
  if (result.rows.length !== 1) {
    throw new Error("Clerk legal provenance cleanup did not return one aggregate row");
  }
  return normalizeClerkLegalProvenanceCounts(result.rows[0]);
}

export async function runClerkLegalProvenanceCleanupTransaction({
  client,
  countsSql = CLERK_LEGAL_PROVENANCE_INSPECTION_SQL,
  targetSql = CLERK_LEGAL_PROVENANCE_CLEANUP_TARGET_SQL,
  clearSql = CLERK_LEGAL_PROVENANCE_CLEAR_SQL,
  expectedCounts = REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS,
  verifyPosture = true,
}) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  let transactionOpen = true;
  try {
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_isolation') AS isolation,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    if (
      transaction.rows[0]?.isolation !== "serializable"
      || transaction.rows[0]?.read_only !== "off"
    ) {
      throw new Error("Clerk legal provenance cleanup transaction is not serializable read-write");
    }
    await client.query(`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('grainline.clerk-legal-provenance.cleanup', 0)
      )
    `);
    const posture = verifyPosture ? await readPosture(client) : null;
    const beforeCounts = await readCounts(client, countsSql);
    const beforeState = classifyClerkLegalProvenanceCleanupState(
      beforeCounts,
      expectedCounts,
    );
    let changedRows = 0;
    let transactionAfterCounts = beforeCounts;

    if (beforeState === "cleanup-required") {
      const candidates = await client.query(targetSql);
      if (candidates.rows.length !== 1 || typeof candidates.rows[0]?.id !== "string") {
        throw new Error("Clerk legal provenance cleanup target is not exactly one row");
      }
      const cleared = await client.query(clearSql, [candidates.rows[0].id]);
      if (
        cleared.rowCount !== 1
        || cleared.rows.length !== 1
        || cleared.rows[0]?.id !== candidates.rows[0].id
      ) {
        throw new Error("Clerk legal provenance cleanup did not clear exactly its locked row");
      }
      changedRows = 1;
      transactionAfterCounts = await readCounts(client, countsSql);
      if (!sameCounts(transactionAfterCounts, expectedCounts.cleared)) {
        throw new Error("Clerk legal provenance cleanup transaction did not converge exactly");
      }
    } else if (beforeCounts.activeUntrustedCurrentAccepted !== 0) {
      throw new Error("Clerk legal provenance cleanup no-op state is inconsistent");
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return Object.freeze({
      posture,
      beforeCounts,
      beforeState,
      changedRows,
      transactionAfterCounts,
      transaction: Object.freeze({
        isolation: "serializable",
        readOnly: false,
        committed: true,
      }),
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function readFinalCounts(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let transactionOpen = true;
  try {
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_isolation') AS isolation,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    if (
      transaction.rows[0]?.isolation !== "repeatable read"
      || transaction.rows[0]?.read_only !== "on"
    ) {
      throw new Error("Clerk legal provenance cleanup final check is not engine-read-only");
    }
    const counts = await readCounts(client, CLERK_LEGAL_PROVENANCE_INSPECTION_SQL);
    classifyClerkLegalProvenanceCleanupState(counts);
    if (counts.activeUntrustedCurrentAccepted !== 0) {
      throw new Error("Clerk legal provenance cleanup final count is not zero");
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
    return counts;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runClerkLegalProvenanceCleanup(config, options = {}) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-clerk-legal-provenance-cleanup",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  try {
    const mutation = await runClerkLegalProvenanceCleanupTransaction({ client });
    const waitSeconds = options.cacheDrainSeconds
      ?? CLERK_LEGAL_ACCOUNT_STATE_CACHE_DRAIN_SECONDS;
    if (!Number.isInteger(waitSeconds) || waitSeconds < 0) {
      throw new Error("Clerk legal provenance cache-drain wait is invalid");
    }
    if (waitSeconds > 0) await delay(waitSeconds * 1_000);
    const finalCounts = await readFinalCounts(client);
    return Object.freeze({
      mode: "cleanup",
      releaseCommit: config.releaseCommit,
      inspection: Object.freeze({
        runId: config.inspectionRunId,
        releaseCommit: REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION.releaseCommit,
        evidenceSha256: config.inspectionEvidenceSha256,
      }),
      directUrlSha256: config.directUrlSha256,
      termsVersion: REVIEWED_CURRENT_TERMS_VERSION,
      posture: mutation.posture,
      disposition: mutation.beforeState,
      beforeCounts: mutation.beforeCounts,
      transactionAfterCounts: mutation.transactionAfterCounts,
      finalCounts,
      changedRows: mutation.changedRows,
      cache: Object.freeze({
        accountStateTtlSeconds: CLERK_LEGAL_ACCOUNT_STATE_CACHE_TTL_SECONDS,
        drainWaitSeconds: waitSeconds,
        expiredBeforeFinalCheck:
          waitSeconds > CLERK_LEGAL_ACCOUNT_STATE_CACHE_TTL_SECONDS,
      }),
      transaction: mutation.transaction,
      retained: Object.freeze({
        aggregateCountsOnly: true,
        rawRows: false,
        identifiers: false,
        credentials: false,
      }),
      productionChanged: mutation.changedRows === 1,
    });
  } finally {
    await client.end().catch(() => {});
  }
}

export function writeClerkLegalProvenanceCleanupEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\/|DIRECT_URL|password|"(?:id|clerkId|email|targetId|adminId)"\s*:/i.test(
      serialized,
    )
  ) {
    throw new Error("Clerk legal provenance cleanup evidence contains private data");
  }
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Clerk legal provenance cleanup evidence is not private");
  }
}

async function main() {
  try {
    const config = parseClerkLegalProvenanceCleanupConfig(process.env);
    const git = assertClerkLegalProvenanceCleanupGitState(
      readClerkLegalProvenanceCleanupGitState(),
      config.releaseCommit,
    );
    const result = await runClerkLegalProvenanceCleanup(config);
    const evidence = Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      git,
      ...result,
    });
    writeClerkLegalProvenanceCleanupEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.releaseCommit,
      inspection: evidence.inspection,
      termsVersion: evidence.termsVersion,
      posture: evidence.posture,
      disposition: evidence.disposition,
      beforeCounts: evidence.beforeCounts,
      transactionAfterCounts: evidence.transactionAfterCounts,
      finalCounts: evidence.finalCounts,
      changedRows: evidence.changedRows,
      cache: evidence.cache,
      transaction: evidence.transaction,
      retained: evidence.retained,
      productionChanged: evidence.productionChanged,
      evidenceWritten: true,
    })}\n`);
  } catch {
    process.stderr.write("Clerk legal provenance cleanup failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
