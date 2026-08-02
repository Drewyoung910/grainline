#!/usr/bin/env node
import assert from "node:assert/strict";
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
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_ROLE,
} from "./direct-upload-activation-catalog.mjs";
import {
  directUploadFunctionSourceHashes,
} from "./direct-upload-function-source-catalog.mjs";
import {
  collectDirectUploadCleanupAuthorityIssues,
  readDirectUploadCleanupAuthority,
} from "./direct-upload-cleanup-worker.mjs";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  assertExplicitPostgresConnectionAuthority,
  assertReviewedPostgresConnectionParameters,
  parseCanonicalPostgresDatabaseName,
  parseExactPostgresUrl,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_ACTIVATION_RUNTIME_POSTFLIGHT_CONFIRMATION =
  "verify-production-direct-upload-activation-runtime-read-only";
export const DIRECT_UPLOAD_ACTIVATION_CLEANUP_POSTFLIGHT_CONFIRMATION =
  "verify-production-direct-upload-activation-cleanup-read-only";

const REVIEWED_TARGET = Object.freeze({
  databaseName: "neondb",
  endpointId: "ep-plain-river-aaqg8gj4",
  migrationRole: "neondb_owner",
  region: "westus3.azure",
  runtimeRole: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
  cleanupRole: DIRECT_UPLOAD_CLEANUP_ROLE,
});
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,19}$/;
const MODES = new Set(["runtime", "cleanup"]);
const CLEANUP_FORBIDDEN_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DIRECT_URL",
  "GRANT_AUDIT_DATABASE_URL",
  "PRODUCTION_MIGRATION_DIRECT_URL",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID",
  "DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parsePositiveInteger(env, key) {
  const raw = required(env, key);
  if (!SAFE_POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} must be a safe positive integer`);
  }
  return value;
}

function parseCleanupDatabaseIdentity(value) {
  const label = "DIRECT_UPLOAD_CLEANUP_DATABASE_URL";
  const parsed = parseExactPostgresUrl(value, label);
  const { username } = assertExplicitPostgresConnectionAuthority(parsed, label);
  assertReviewedPostgresConnectionParameters(parsed, label);
  const databaseName = parseCanonicalPostgresDatabaseName(parsed, label);
  const match = parsed.hostname.toLowerCase().match(
    /^(ep-[a-z0-9-]+?)(-pooler)?\.([a-z0-9-]+)\.([a-z0-9-]+)\.neon\.tech$/,
  );
  if (!match) {
    throw new Error(`${label} must identify one Neon endpoint`);
  }
  const identity = Object.freeze({
    databaseName,
    endpointId: match[1],
    isPooler: Boolean(match[2]),
    parsed,
    region: `${match[3]}.${match[4]}`,
    username,
  });
  if (
    identity.isPooler
    || identity.databaseName !== REVIEWED_TARGET.databaseName
    || identity.endpointId !== REVIEWED_TARGET.endpointId
    || identity.region !== REVIEWED_TARGET.region
    || identity.username !== REVIEWED_TARGET.cleanupRole
  ) {
    throw new Error(
      `${label} is not the reviewed direct production cleanup-role target`,
    );
  }
  return identity;
}

function expectedEvidenceBasename(mode, releaseCommit) {
  return `direct-upload-activation-${mode}-postflight-${releaseCommit}.json`;
}

export function parseDirectUploadActivationPostflightConfig(
  env = process.env,
  mode,
) {
  if (!MODES.has(mode)) {
    throw new Error("DirectUpload activation postflight mode is invalid");
  }
  assertDeterministicPostgresEnvironment(
    env,
    `DirectUpload activation ${mode} postflight`,
  );
  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("DirectUpload activation postflight release commit is invalid");
  }
  const mainCiRunId = parsePositiveInteger(
    env,
    "DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID",
  );
  const migrationRunId = parsePositiveInteger(
    env,
    "DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID",
  );
  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH"),
  );
  if (
    path.basename(evidencePath) !== expectedEvidenceBasename(mode, releaseCommit)
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "DirectUpload activation postflight evidence path is not fresh and exact",
    );
  }

  if (mode === "runtime") {
    if (
      env.DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_CONFIRM
        !== DIRECT_UPLOAD_ACTIVATION_RUNTIME_POSTFLIGHT_CONFIRMATION
    ) {
      throw new Error("DirectUpload runtime postflight confirmation is invalid");
    }
    const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
    if (privilegedKeys.length > 0) {
      throw new Error(
        `DirectUpload runtime postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
      );
    }
    const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
    if (unreviewedUrlKeys.length > 0) {
      throw new Error(
        `DirectUpload runtime postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
      );
    }
    const databaseUrl = required(env, "DATABASE_URL");
    const runtimeIdentity = assertVercelRuntimeDatabaseIsolation({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: databaseUrl,
      RUNTIME_DB_ROLE: REVIEWED_TARGET.runtimeRole,
      NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
      PGOPTIONS: env.PGOPTIONS,
    });
    return Object.freeze({
      databaseUrl,
      databaseUrlSha256: sha256(databaseUrl),
      evidencePath,
      mainCiRunId,
      migrationRunId,
      mode,
      releaseCommit,
      runId: null,
      targetIdentity: runtimeIdentity,
    });
  }

  if (
    env.DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_CONFIRM
      !== DIRECT_UPLOAD_ACTIVATION_CLEANUP_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("DirectUpload cleanup postflight confirmation is invalid");
  }
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_SHA !== releaseCommit
  ) {
    throw new Error(
      "DirectUpload cleanup postflight requires the exact manual main run",
    );
  }
  const forbidden = CLEANUP_FORBIDDEN_ENV_KEYS.filter((key) =>
    Object.hasOwn(env, key),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `DirectUpload cleanup postflight contains forbidden shared credentials: ${forbidden.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env)
    .filter((key) => key !== "DIRECT_UPLOAD_CLEANUP_DATABASE_URL");
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `DirectUpload cleanup postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }
  const databaseUrl = required(env, "DIRECT_UPLOAD_CLEANUP_DATABASE_URL");
  const databaseUrlSha256 = sha256(databaseUrl);
  const expectedUrlSha256 = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL_SHA256",
  );
  if (
    !SHA256_PATTERN.test(expectedUrlSha256)
    || expectedUrlSha256 !== databaseUrlSha256
  ) {
    throw new Error(
      "DirectUpload cleanup postflight URL does not match its protected digest",
    );
  }
  const targetIdentity = parseCleanupDatabaseIdentity(databaseUrl);
  const runId = required(env, "GITHUB_RUN_ID");
  if (!SAFE_POSITIVE_INTEGER.test(runId)) {
    throw new Error("DirectUpload cleanup postflight run id is invalid");
  }
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  if (path.dirname(evidencePath) !== runnerTemp) {
    throw new Error(
      "DirectUpload cleanup postflight evidence must stay in runner temp",
    );
  }
  return Object.freeze({
    databaseUrl,
    databaseUrlSha256,
    evidencePath,
    mainCiRunId,
    migrationRunId,
    mode,
    releaseCommit,
    runId,
    targetIdentity,
  });
}

export function readDirectUploadActivationPostflightGitState(
  cwd = process.cwd(),
) {
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

export function assertDirectUploadActivationPostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "DirectUpload activation postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

function normalizedStrings(value) {
  return Array.isArray(value)
    ? value.map(String).sort((left, right) => left.localeCompare(right))
    : [];
}

function collectActivatedCatalogIssues(snapshot) {
  const issues = [];
  const tables = Array.isArray(snapshot?.rlsTables) ? snapshot.rlsTables : [];
  for (const tableName of ["DirectUpload", "DirectUploadReference"]) {
    const rows = tables.filter((row) => row.relname === tableName);
    if (rows.length !== 1) {
      issues.push(`${tableName} activation catalog row is not exact`);
      continue;
    }
    if (
      rows[0].relrowsecurity !== true
      || rows[0].relforcerowsecurity !== true
      || Number(rows[0].policy_count) !== 0
    ) {
      issues.push(`${tableName} is not policyless ENABLE plus FORCE RLS`);
    }
  }

  const functions = Array.isArray(snapshot?.functions)
    ? snapshot.functions
    : [];
  const expectedByName = new Map(
    DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => [entry.name, entry]),
  );
  const actualNames = functions.map((row) => row.function_name).sort();
  const expectedNames = [...DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES].sort();
  if (
    actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    issues.push("DirectUpload activation function catalog is not exact");
  }
  const sourceHashes = directUploadFunctionSourceHashes();
  for (const row of functions) {
    const expected = expectedByName.get(row.function_name);
    if (!expected) continue;
    if (row.identity_arguments !== expected.identityArguments) {
      issues.push(`${row.function_name} identity arguments drifted`);
    }
    if (row.owner_name !== REVIEWED_TARGET.migrationRole) {
      issues.push(`${row.function_name} owner drifted`);
    }
    if (
      typeof row.function_source !== "string"
      || sha256(row.function_source) !== sourceHashes[row.function_name]
    ) {
      issues.push(`${row.function_name} source drifted`);
    }
    if (
      row.function_kind !== "f"
      || row.leakproof !== false
      || row.security_definer !== expected.securityDefiner
      || !Array.isArray(row.function_config)
      || row.function_config.length !== 1
      || row.function_config[0] !== "search_path=pg_catalog"
    ) {
      issues.push(`${row.function_name} mode or search path drifted`);
    }
    if (
      row.runtime_execute !== expected.runtimeExecute
      || row.runtime_direct_execute !== expected.runtimeExecute
      || row.worker_execute !== expected.cleanupExecute
      || row.worker_direct_execute !== expected.cleanupExecute
      || row.runtime_execute_grantable !== false
      || row.worker_execute_grantable !== false
      || row.public_execute !== false
      || normalizedStrings(row.other_role_execute).length > 0
      || normalizedStrings(row.other_role_execute_grantable).length > 0
    ) {
      issues.push(`${row.function_name} activation ACL drifted`);
    }
  }
  return issues;
}

export function collectDirectUploadRuntimeActivationIssues(snapshot) {
  const issues = collectActivatedCatalogIssues(snapshot);
  const role = snapshot?.role;
  if (
    !role
    || role.rolname !== REVIEWED_TARGET.runtimeRole
    || role.rolsuper !== false
    || role.rolcreatedb !== false
    || role.rolcreaterole !== false
    || role.rolinherit !== false
    || role.rolcanlogin !== true
    || role.rolreplication !== false
    || role.rolbypassrls !== false
  ) {
    issues.push("runtime role identity or attributes are not exact");
  }
  if (
    snapshot?.currentUser !== REVIEWED_TARGET.runtimeRole
    || snapshot?.sessionUser !== REVIEWED_TARGET.runtimeRole
  ) {
    issues.push("runtime session identity is not exact");
  }
  if (normalizedStrings(snapshot?.memberships).length > 0) {
    issues.push("runtime role has a parent membership");
  }
  if (
    snapshot?.schemaUsage !== true
    || snapshot?.schemaCreate !== false
    || snapshot?.databaseCreate !== false
  ) {
    issues.push("runtime schema or database authority drifted");
  }
  const protectedTables = new Set(["DirectUpload", "DirectUploadReference"]);
  if (
    normalizedStrings(snapshot?.tablePrivileges)
      .some((name) => protectedTables.has(name))
    || normalizedStrings(snapshot?.columnPrivileges)
      .some((name) => /^(?:DirectUpload|DirectUploadReference)\./.test(name))
  ) {
    issues.push("runtime retained DirectUpload table or column authority");
  }
  return issues;
}

async function expectSqlState(client, operation, expectedCode, label) {
  await client.query("SAVEPOINT direct_upload_postflight_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT direct_upload_postflight_expected_failure");
  await client.query("RELEASE SAVEPOINT direct_upload_postflight_expected_failure");
  assert.equal(caught?.code, expectedCode, `${label} returned the wrong SQLSTATE`);
}

async function proveRuntimeBoundary(client) {
  await expectSqlState(
    client,
    () => client.query(`SELECT * FROM public."DirectUpload" LIMIT 1`),
    "42501",
    "runtime direct DirectUpload read",
  );
  await expectSqlState(
    client,
    () => client.query(`
      SELECT public.grainline_direct_upload_sync_public_core(
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::text[],
        NULL::text[]
      )
    `),
    "42501",
    "runtime private core call",
  );
  await expectSqlState(
    client,
    () => client.query(
      `SELECT * FROM public.grainline_direct_upload_cleanup_lease(1)`,
    ),
    "42501",
    "runtime cleanup lease call",
  );
  const owned = await client.query(`
    SELECT *
    FROM public.grainline_direct_upload_owned_lookup(
      'direct-upload-activation-postflight-invalid-actor',
      'direct-upload-activation-postflight/invalid-key'
    )
  `);
  assert.equal(owned.rows.length, 0);
  const privateRead = await client.query(`
    SELECT *
    FROM public.grainline_direct_upload_case_attachment_read(
      'direct-upload-activation-postflight-invalid-actor',
      'direct-upload-activation-postflight-invalid-case',
      'direct-upload-activation-postflight-invalid-attachment'
    )
  `);
  assert.equal(privateRead.rows.length, 0);
  return Object.freeze([
    "direct_table_read_denied",
    "private_core_execute_denied",
    "cleanup_execute_denied",
    "invalid_actor_runtime_reads_fail_closed",
  ]);
}

async function proveCleanupBoundary(client) {
  await expectSqlState(
    client,
    () => client.query(`SELECT * FROM public."DirectUpload" LIMIT 1`),
    "42501",
    "cleanup direct DirectUpload read",
  );
  await expectSqlState(
    client,
    () => client.query(`
      SELECT *
      FROM public.grainline_direct_upload_owned_lookup(
        'direct-upload-activation-postflight-invalid-actor',
        'direct-upload-activation-postflight/invalid-key'
      )
    `),
    "42501",
    "cleanup runtime lookup call",
  );
  await expectSqlState(
    client,
    () => client.query(
      `SELECT * FROM public.grainline_direct_upload_cleanup_lease(1)`,
    ),
    "25006",
    "cleanup lease read-only fence",
  );
  return Object.freeze([
    "direct_table_read_denied",
    "runtime_execute_denied",
    "cleanup_execute_reached_read_only_fence",
  ]);
}

export function writeDirectUploadActivationPostflightEvidence(
  pathname,
  evidence,
) {
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  const stat = lstatSync(pathname);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("DirectUpload activation postflight evidence is not mode 0600");
  }
}

export async function runDirectUploadActivationPostflight(config) {
  const git = assertDirectUploadActivationPostflightGitState(
    readDirectUploadActivationPostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: `grainline-direct-upload-activation-${config.mode}-postflight`,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(config.databaseUrl)),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionOpen = true;
    const transactionReadOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS value",
    )).rows[0]?.value;
    assert.equal(transactionReadOnly, "on");
    const snapshot = await readDirectUploadCleanupAuthority(client);
    const issues = config.mode === "runtime"
      ? collectDirectUploadRuntimeActivationIssues(snapshot)
      : collectDirectUploadCleanupAuthorityIssues(snapshot);
    if (issues.length > 0) {
      throw new Error(
        `DirectUpload activation ${config.mode} authority drifted: ${issues.join("; ")}`,
      );
    }
    const incompleteMigrationCount = Number((await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
      FROM public._prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `)).rows[0]?.count);
    assert.equal(incompleteMigrationCount, 0);
    const boundaryChecks = config.mode === "runtime"
      ? await proveRuntimeBoundary(client)
      : await proveCleanupBoundary(client);
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "direct-upload-activation-production-postflight",
      source: Object.freeze({ clean: git.clean, commit: git.head }),
      target: Object.freeze({
        databaseName: REVIEWED_TARGET.databaseName,
        databaseUrlSha256: config.databaseUrlSha256,
        endpointId: REVIEWED_TARGET.endpointId,
        mode: config.mode,
        region: REVIEWED_TARGET.region,
        role: config.mode === "runtime"
          ? REVIEWED_TARGET.runtimeRole
          : REVIEWED_TARGET.cleanupRole,
      }),
      runs: Object.freeze({
        cleanupPostflightRunId: config.runId,
        mainCiRunId: config.mainCiRunId,
        migrationRunId: config.migrationRunId,
      }),
      proof: Object.freeze({
        boundaryChecks,
        cleanupFunctionCount: DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.length,
        functionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES.length,
        incompleteMigrationCount,
        policyCount: 0,
        postflightReadOnly: true,
        privateFunctionCount:
          DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES.length,
        rlsEnabled: true,
        rlsForced: true,
        runtimeFunctionCount:
          DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.length,
        tableOrColumnAuthority: false,
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeDirectUploadActivationPostflightEvidence(config.evidencePath, evidence);
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  const selected = [
    process.argv.includes("--runtime") ? "runtime" : null,
    process.argv.includes("--cleanup") ? "cleanup" : null,
  ].filter(Boolean);
  try {
    if (selected.length !== 1) {
      throw new Error("use exactly one of --runtime or --cleanup");
    }
    const config = parseDirectUploadActivationPostflightConfig(
      process.env,
      selected[0],
    );
    const evidence = await runDirectUploadActivationPostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      mode: evidence.target.mode,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
