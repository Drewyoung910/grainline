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
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  collectDirectUploadCleanupRoleProvisionIssues,
  readDirectUploadCleanupRoleProvisionSnapshot,
} from "./direct-upload-cleanup-role-production-provision.mjs";
import {
  PRODUCTION_MIGRATION_CONFIRMATION,
  assertProductionMigrationGitState,
  parseProductionMigrationEnvironment,
  readProductionMigrationGitState,
} from "./guard-production-migration-runner.mjs";
import {
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "./verify-direct-upload-activation-release.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECTION_CONFIRMATION =
  "inspect-failed-direct-upload-activation-read-only";
export const DIRECT_UPLOAD_ACTIVATION_MIGRATION =
  "20260801194000_enable_direct_upload_rls";
const MIGRATION_PATH = path.resolve(
  "prisma",
  "migrations",
  DIRECT_UPLOAD_ACTIVATION_MIGRATION,
  "migration.sql",
);
const EVIDENCE_PREFIX = "direct-upload-activation-failure-inspection-";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const FORBIDDEN_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "GRANT_AUDIT_DATABASE_URL",
  "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  "DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID",
  "DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseDirectUploadActivationFailureInspectionConfig(
  env = process.env,
) {
  if (
    env.DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_CONFIRM
      !== DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECTION_CONFIRMATION
  ) {
    throw new Error("DirectUpload activation failure-inspection confirmation is invalid");
  }
  const forbidden = FORBIDDEN_ENVIRONMENT_KEYS.filter((key) =>
    Object.hasOwn(env, key),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `DirectUpload activation failure inspection contains forbidden credentials: ${forbidden.join(", ")}`,
    );
  }
  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("DirectUpload activation failure-inspection commit is invalid");
  }
  const failedMigrationRunId = required(
    env,
    "DIRECT_UPLOAD_ACTIVATION_FAILED_MIGRATION_RUN_ID",
  );
  const inspectionRunId = required(env, "GITHUB_RUN_ID");
  if (
    !SAFE_RUN_ID_PATTERN.test(failedMigrationRunId)
    || !SAFE_RUN_ID_PATTERN.test(inspectionRunId)
    || failedMigrationRunId === inspectionRunId
  ) {
    throw new Error("DirectUpload activation failure-inspection run ids are invalid");
  }
  const owner = parseProductionMigrationEnvironment({
    ...env,
    PRODUCTION_MIGRATION_CONFIRM: PRODUCTION_MIGRATION_CONFIRMATION,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: releaseCommit,
  });
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    runnerTemp,
    `${EVIDENCE_PREFIX}${releaseCommit}.json`,
  );
  if (evidencePath !== expectedEvidencePath || existsSync(evidencePath)) {
    throw new Error("DirectUpload activation failure evidence path is not fresh and exact");
  }
  return Object.freeze({
    ...owner,
    evidencePath,
    failedMigrationRunId,
    inspectionRunId,
  });
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function migrationExceptionFragments(migrationSql) {
  return [...migrationSql.matchAll(/RAISE\s+EXCEPTION\s+'((?:''|[^'])*)'/giu)]
    .map((match) => match[1].replaceAll("''", "'").split("%")[0].trim())
    .filter((value) => value.length >= 12)
    .sort((left, right) => right.length - left.length);
}

export function extractDirectUploadActivationReadOnlyPreflight(migrationSql) {
  const rolePreflight =
    "DO $grainline_direct_upload_activation_role_preflight$";
  const functionPreflightEnd =
    "$grainline_direct_upload_activation_function_preflight$;";
  const start = migrationSql.indexOf(rolePreflight);
  const endStart = migrationSql.indexOf(functionPreflightEnd, start);
  if (start < 0 || endStart < 0) {
    throw new Error("DirectUpload activation read-only preflight markers are missing");
  }
  const end = endStart + functionPreflightEnd.length;
  const preflight = migrationSql.slice(start, end);
  const forbiddenStatement = /^\s*(?:ALTER|CALL|COMMENT|COPY|CREATE|DELETE|DROP|GRANT|INSERT|LOCK|MERGE|REFRESH|REINDEX|REVOKE|SECURITY\s+LABEL|TRUNCATE|UPDATE|VACUUM)\b/imu;
  if (
    (preflight.match(/^DO \$grainline_direct_upload_activation_(?:role|function)_preflight\$/gmu)
      ?? []).length !== 2
    || forbiddenStatement.test(preflight)
    || preflight.includes("pg_advisory_xact_lock")
    || preflight.includes("COMMIT;")
  ) {
    throw new Error("DirectUpload activation read-only preflight extraction is not exact");
  }
  return preflight;
}

function safeGenericDatabaseMessage(logs) {
  const trimmed = logs.trim();
  const candidates = [
    ...logs.matchAll(/message:\s*"([^"\r\n]{1,500})"/giu),
    ...logs.matchAll(/(?:^|\n)ERROR:\s*([^\r\n]{1,500})/giu),
  ].map((match) => match[1].trim());
  if (trimmed.length > 0 && trimmed.length <= 500 && !/[\r\n]/u.test(trimmed)) {
    candidates.push(trimmed);
  }
  const safePrefixes = [
    "syntax error at or near",
    "function ",
    "operator does not exist",
    "permission denied for",
    "relation ",
    "current transaction is aborted",
  ];
  return candidates.find((candidate) =>
    safePrefixes.some((prefix) => candidate.toLowerCase().startsWith(prefix)))
    ?? null;
}

export function classifyDirectUploadActivationFailure(logs, migrationSql) {
  const value = typeof logs === "string" ? logs : "";
  const matchedMigrationException = migrationExceptionFragments(migrationSql)
    .find((fragment) => value.includes(fragment)) ?? null;
  const sqlState = value.match(/SqlState\(E?([0-9A-Z]{5})\)/u)?.[1]
    ?? value.match(/(?:database error code|SQLSTATE)[:=]\s*`?([0-9A-Z]{5})/iu)?.[1]
    ?? null;
  return Object.freeze({
    databaseMessage: matchedMigrationException ?? safeGenericDatabaseMessage(value),
    matchedMigrationException: matchedMigrationException !== null,
    sqlState,
    logBytes: Buffer.byteLength(value, "utf8"),
    logSha256: sha256(value),
    rawLogRetained: false,
  });
}

export function classifyDirectUploadActivationPreflightError(
  error,
  migrationSql,
) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const classified = classifyDirectUploadActivationFailure(message, migrationSql);
  const code = typeof error?.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code)
    ? error.code
    : classified.sqlState;
  return Object.freeze({
    databaseMessage: classified.databaseMessage,
    matchedMigrationException: classified.matchedMigrationException,
    sqlState: code,
    rawErrorRetained: false,
  });
}

function summarizePosture(snapshot) {
  const allIssues = collectDirectUploadCleanupRoleProvisionIssues(snapshot);
  const incompleteLedgerIssue =
    "production migration ledger contains an incomplete migration";
  const rollbackIssues = allIssues.filter((issue) =>
    issue !== incompleteLedgerIssue,
  );
  const tables = Object.fromEntries((snapshot.tables ?? []).map((table) => [
    table.table_name,
    Object.freeze({
      cleanupCrud: [
        table.cleanup_select,
        table.cleanup_insert,
        table.cleanup_update,
        table.cleanup_delete,
      ].some(Boolean),
      owner: table.owner_name,
      policyCount: Number(table.policy_count),
      rlsEnabled: table.rls_enabled,
      rlsForced: table.rls_forced,
      runtimeCrud: [
        table.runtime_select,
        table.runtime_insert,
        table.runtime_update,
        table.runtime_delete,
      ].every(Boolean),
    }),
  ]));
  return Object.freeze({
    directUploadFunctionCount: snapshot.functions?.length ?? 0,
    incompleteMigrationCount: Number(snapshot.incompleteMigrationCount),
    preActivationPostureRestored: rollbackIssues.length === 0,
    rollbackIssues,
    tables,
    transactionReadOnly: snapshot.transactionReadOnly,
  });
}

export function writeDirectUploadActivationFailureEvidence(pathname, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\/|DIRECT_URL|PASSWORD|SECRET_ACCESS_KEY|"raw(?:Error|Log)"\s*:/iu
      .test(serialized)
  ) {
    throw new Error("DirectUpload activation failure evidence contains sensitive-shaped data");
  }
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  const stat = lstatSync(pathname);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("DirectUpload activation failure evidence is not mode 0600");
  }
}

export async function runDirectUploadActivationFailureInspection(config) {
  const git = assertProductionMigrationGitState(
    readProductionMigrationGitState(),
    config.releaseCommit,
  );
  const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
  const reviewedRecoveryChecksum = sha256(migrationSql);
  if (
    DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName
      !== DIRECT_UPLOAD_ACTIVATION_MIGRATION
    || reviewedRecoveryChecksum !== DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256
  ) {
    throw new Error("DirectUpload activation failure inspection migration bytes drifted");
  }
  const client = new Client({
    connectionString: config.directUrl,
    application_name: "grainline-direct-upload-activation-failure-inspection",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(config.directUrl)),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const snapshot = await readDirectUploadCleanupRoleProvisionSnapshot(client);
    const ledger = await client.query(`
      SELECT
        checksum,
        started_at,
        finished_at,
        rolled_back_at,
        applied_steps_count,
        logs
      FROM public._prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at DESC
    `, [DIRECT_UPLOAD_ACTIVATION_MIGRATION]);
    if (ledger.rows.length !== 1) {
      throw new Error("DirectUpload activation ledger does not contain one exact failed row");
    }
    const row = ledger.rows[0];
    const failedLedgerExact =
      row.checksum === FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256
      && row.started_at instanceof Date
      && row.finished_at === null
      && row.rolled_back_at === null
      && Number(row.applied_steps_count) === 0;
    if (!failedLedgerExact) {
      throw new Error("DirectUpload activation failed ledger row drifted");
    }
    const posture = summarizePosture(snapshot);
    if (!posture.transactionReadOnly || !posture.preActivationPostureRestored) {
      throw new Error("DirectUpload activation preflight safety posture drifted");
    }
    let livePreflight;
    try {
      await client.query(
        extractDirectUploadActivationReadOnlyPreflight(migrationSql),
      );
      livePreflight = Object.freeze({
        passed: true,
        databaseMessage: null,
        matchedMigrationException: false,
        sqlState: null,
        rawErrorRetained: false,
      });
    } catch (error) {
      livePreflight = Object.freeze({
        passed: false,
        ...classifyDirectUploadActivationPreflightError(error, migrationSql),
      });
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
    const failure = classifyDirectUploadActivationFailure(row.logs, migrationSql);
    const evidence = Object.freeze({
      schemaVersion: 3,
      operation: "direct-upload-activation-failure-inspection",
      source: Object.freeze({ clean: git.clean, commit: git.head }),
      runs: Object.freeze({
        failedMigrationRunId: config.failedMigrationRunId,
        inspectionRunId: config.inspectionRunId,
      }),
      migration: Object.freeze({
        name: DIRECT_UPLOAD_ACTIVATION_MIGRATION,
        expectedChecksum: FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
        checksumMatches: row.checksum === FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
        reviewedRecoveryChecksum,
        failedLedgerExact,
        finished: row.finished_at !== null,
        rolledBackRecorded: row.rolled_back_at !== null,
        appliedStepsCount: Number(row.applied_steps_count),
        failure,
        liveReadOnlyPreflight: livePreflight,
      }),
      posture,
      transaction: Object.freeze({
        isolation: "repeatable read",
        readOnly: true,
      }),
      retained: Object.freeze({
        credentials: false,
        databaseRows: false,
        migrationLog: false,
      }),
      productionChangedByInspection: false,
      completedAt: new Date().toISOString(),
      status: "inspected",
    });
    writeDirectUploadActivationFailureEvidence(config.evidencePath, evidence);
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const config = parseDirectUploadActivationFailureInspectionConfig(process.env);
    const evidence = await runDirectUploadActivationFailureInspection(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      source: evidence.source,
      runs: evidence.runs,
      migration: evidence.migration,
      posture: evidence.posture,
      transaction: evidence.transaction,
      productionChangedByInspection: evidence.productionChangedByInspection,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation failure inspection failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
