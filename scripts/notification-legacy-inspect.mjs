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
import pg from "pg";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const NOTIFICATION_LEGACY_INSPECTION_CONFIRMATION =
  "inspect-prelaunch-notification-legacy-state";
export const NOTIFICATION_RLS_PREREQUISITE_CONFIRMATION =
  "saved-search-phase-b-and-runtime-separation-postflights-passed";

export const REVIEWED_NOTIFICATION_INSPECTION_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
});

const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

export function parseNotificationLegacyInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Notification legacy inspection");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error(
      "Notification legacy inspection requires the reviewed manual GitHub Actions main-branch context",
    );
  }
  const releaseCommit = required(env, "NOTIFICATION_LEGACY_INSPECT_RELEASE_COMMIT");
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error("Notification legacy inspection release commit must match the dispatched main commit");
  }
  if (
    env.NOTIFICATION_LEGACY_INSPECT_CONFIRM
      !== NOTIFICATION_LEGACY_INSPECTION_CONFIRMATION
  ) {
    throw new Error("NOTIFICATION_LEGACY_INSPECT_CONFIRM must match the reviewed inspect value");
  }
  if (
    env.NOTIFICATION_RLS_PREREQUISITES_CONFIRMED
      !== NOTIFICATION_RLS_PREREQUISITE_CONFIRMATION
  ) {
    throw new Error("Notification reset prerequisites are not explicitly confirmed");
  }
  if (Object.hasOwn(env, "DATABASE_URL")) {
    throw new Error("DATABASE_URL must remain absent from the owner-only inspection job");
  }
  if (Object.hasOwn(env, "GRANT_AUDIT_DATABASE_URL")) {
    throw new Error("GRANT_AUDIT_DATABASE_URL must remain absent during legacy inspection");
  }

  const directUrl = required(env, "DIRECT_URL");
  const expectedDirectUrlSha256 = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  const directUrlSha256 = createHash("sha256").update(directUrl, "utf8").digest("hex");
  if (
    !SHA256_PATTERN.test(expectedDirectUrlSha256)
    || expectedDirectUrlSha256 !== directUrlSha256
  ) {
    throw new Error("DIRECT_URL does not match the protected environment digest");
  }
  const migrationRole = required(env, "MIGRATION_DB_ROLE");
  const runtimeRole = required(env, "RUNTIME_DB_ROLE");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  const target = REVIEWED_NOTIFICATION_INSPECTION_TARGET;
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
    required(env, "NOTIFICATION_LEGACY_INSPECT_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    runnerTemp,
    `notification-legacy-inspection-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedEvidencePath || existsSync(evidencePath)) {
    throw new Error("Notification legacy inspection evidence path is not the fresh reviewed runner path");
  }

  return Object.freeze({
    mode: "inspect",
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    releaseCommit,
  });
}

export function readNotificationLegacyInspectionGitState(cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertNotificationLegacyInspectionGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("Notification legacy inspection checkout is not the exact clean dispatched commit");
  }
  return Object.freeze({ head: state.head, clean: true });
}

export function normalizeNotificationLegacyCounts(row) {
  const counts = {
    total: Number(row?.total_count),
    missingSource: Number(row?.missing_source_count),
    missingRelatedUser: Number(row?.missing_related_user_count),
  };
  if (Object.values(counts).some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new TypeError("Notification legacy inspection returned invalid counts");
  }
  return Object.freeze(counts);
}

async function readPosture(client) {
  const result = await client.query(`
    SELECT
      CURRENT_USER AS current_user,
      pg_catalog.current_database() AS database_name,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      table_class.relrowsecurity AS rls_enabled,
      table_class.relforcerowsecurity AS rls_forced,
      table_owner.rolname AS table_owner,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = table_class.oid) AS policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Notification"', 'SELECT'
      ) AS runtime_can_select,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Notification"', 'INSERT'
      ) AS runtime_can_insert,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Notification"', 'UPDATE'
      ) AS runtime_can_update,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Notification"', 'DELETE'
      ) AS runtime_can_delete,
      pg_catalog.has_column_privilege(
        'grainline_app_runtime', 'public."Notification"', 'relatedUserId', 'SELECT'
      ) AS related_user_column_present
    FROM pg_catalog.pg_class AS table_class
    JOIN pg_catalog.pg_namespace AS table_schema
      ON table_schema.oid = table_class.relnamespace
    JOIN pg_catalog.pg_roles AS table_owner
      ON table_owner.oid = table_class.relowner
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.rolname = 'neondb_owner'
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE table_schema.nspname = 'public'
      AND table_class.relname = 'Notification'
      AND table_class.relkind = 'r'
  `);
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || row.current_user !== REVIEWED_NOTIFICATION_INSPECTION_TARGET.ownerRole
    || row.database_name !== REVIEWED_NOTIFICATION_INSPECTION_TARGET.databaseName
    || row.owner_bypass_rls !== true
    || row.runtime_bypass_rls !== false
    || row.runtime_superuser !== false
    || row.table_owner !== REVIEWED_NOTIFICATION_INSPECTION_TARGET.ownerRole
    || row.rls_enabled !== false
    || row.rls_forced !== false
    || Number(row.policy_count) !== 0
    || row.runtime_can_select !== true
    || row.runtime_can_insert !== true
    || row.runtime_can_update !== true
    || row.runtime_can_delete !== true
    || row.related_user_column_present !== true
  ) {
    throw new Error("Notification legacy inspection database posture is not the reviewed pre-activation state");
  }
  return Object.freeze({
    currentUser: row.current_user,
    databaseName: row.database_name,
    tableOwner: row.table_owner,
    rlsEnabled: row.rls_enabled,
    rlsForced: row.rls_forced,
    policyCount: Number(row.policy_count),
    legacyRuntimeCrudRetained: true,
    relatedUserColumnPresent: true,
  });
}

async function readCounts(client) {
  const result = await client.query(`
    SELECT
      pg_catalog.count(*) AS total_count,
      pg_catalog.count(*) FILTER (
        WHERE "sourceType" IS NULL OR "sourceId" IS NULL
      ) AS missing_source_count,
      pg_catalog.count(*) FILTER (
        WHERE "relatedUserId" IS NULL
      ) AS missing_related_user_count
    FROM public."Notification"
  `);
  return normalizeNotificationLegacyCounts(result.rows[0]);
}

export async function runNotificationLegacyInspection(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-notification-legacy-inspection",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const posture = await readPosture(client);
    const before = await readCounts(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      mode: config.mode,
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      posture,
      before,
      transaction: Object.freeze({ isolation: "repeatable read", readOnly: true }),
      retained: Object.freeze({ rawRows: false, credentials: false }),
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function writeNotificationLegacyInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\/|DIRECT_URL|password/i.test(serialized)) {
    throw new Error("Notification legacy inspection evidence contains credential-shaped data");
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
    throw new Error("Notification legacy inspection evidence is not a private regular file");
  }
}

async function main() {
  try {
    const config = parseNotificationLegacyInspectionConfig(process.env);
    const git = assertNotificationLegacyInspectionGitState(
      readNotificationLegacyInspectionGitState(),
      config.releaseCommit,
    );
    const result = await runNotificationLegacyInspection(config);
    const evidence = Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      git,
      ...result,
    });
    writeNotificationLegacyInspectionEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.releaseCommit,
      posture: evidence.posture,
      before: evidence.before,
      transaction: evidence.transaction,
      retained: evidence.retained,
      evidenceWritten: true,
    })}\n`);
  } catch {
    process.stderr.write("Notification legacy inspection failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
