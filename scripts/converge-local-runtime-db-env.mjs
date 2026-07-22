#!/usr/bin/env node
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
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  REVIEWED_DATABASE_NAME,
  REVIEWED_DATABASE_REGION,
  REVIEWED_ENDPOINT_ID,
  REVIEWED_OWNER_ROLE,
  REVIEWED_RUNTIME_ROLE,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  assertProductionMigrationGitState,
  readProductionMigrationGitState,
} from "./guard-production-migration-runner.mjs";
import {
  assertVercelRuntimeDatabaseIsolation,
  parseVercelRuntimeDatabaseIdentity,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  buildNeonRuntimePoolerUrl,
  revealReviewedNeonRuntimePassword,
  verifyReviewedNeonTarget,
} from "./neon-owner-password-control.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const LOCAL_RUNTIME_CONVERGENCE_CONFIRMATION =
  "replace-local-owner-db-env-with-reviewed-runtime";
const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function exactPrivateFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (
    !stat.isFile()
    || (stat.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) throw new Error(`${label} must be a private regular file`);
  return stat;
}

function parseAssignmentValue(line, key) {
  const raw = line.slice(key.length + 1);
  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith("'") && raw.endsWith("'"))
  ) return raw.slice(1, -1);
  if (raw === "" || /\s/.test(raw)) throw new Error(`${key} assignment is invalid`);
  return raw;
}

function exactAssignment(lines, key, requiredAssignment = true) {
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith(`${key}=`));
  if ((requiredAssignment && matches.length !== 1) || matches.length > 1) {
    throw new Error(`${key} assignment count is invalid`);
  }
  if (matches.length === 0) return null;
  return Object.freeze({
    ...matches[0],
    value: parseAssignmentValue(matches[0].line, key),
  });
}

function normalizeLegacyOwnerPooler(value) {
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error("local DATABASE_URL is invalid");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("local DATABASE_URL is invalid");
  }
  const parameters = [...parsed.searchParams.entries()];
  if (
    parsed.protocol !== "postgresql:"
    || decodeURIComponent(parsed.username) !== REVIEWED_OWNER_ROLE
    || parsed.password === ""
    || parsed.hostname
      !== `${REVIEWED_ENDPOINT_ID}-pooler.${REVIEWED_DATABASE_REGION}.neon.tech`
    || !["", "5432"].includes(parsed.port)
    || parsed.pathname !== `/${REVIEWED_DATABASE_NAME}`
    || parsed.hash !== ""
    || parameters.length !== 2
    || parameters.filter(([key]) => key === "sslmode").length !== 1
    || !["require", "verify-full"].includes(parsed.searchParams.get("sslmode"))
    || parameters.filter(([key]) => key === "channel_binding").length !== 1
    || parsed.searchParams.get("channel_binding") !== "require"
  ) throw new Error("local DATABASE_URL predecessor is not the reviewed owner pooler");
  return Object.freeze({ username: REVIEWED_OWNER_ROLE });
}

function assertReviewedDirectPredecessor(value) {
  const identity = parseVercelRuntimeDatabaseIdentity(value, "DIRECT_URL");
  if (
    identity.username !== REVIEWED_OWNER_ROLE
    || identity.isPooler
    || identity.endpointId !== REVIEWED_ENDPOINT_ID
    || identity.databaseName !== REVIEWED_DATABASE_NAME
    || identity.region !== REVIEWED_DATABASE_REGION
  ) throw new Error("local DIRECT_URL predecessor is not the reviewed owner direct endpoint");
  return identity;
}

export function convergeLocalRuntimeEnvironmentSource(source, runtimeDatabaseUrl) {
  if (typeof source !== "string" || source.length === 0 || source.includes("\0")) {
    throw new Error("local environment source is invalid");
  }
  const runtimeIdentity = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: runtimeDatabaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
  });
  const lines = source.split(/\r?\n/);
  const database = exactAssignment(lines, "DATABASE_URL");
  const direct = exactAssignment(lines, "DIRECT_URL", false);
  const assignments = Object.fromEntries(lines
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const key = line.slice(0, line.indexOf("="));
      return [key, parseAssignmentValue(line, key)];
    }));
  const unexpectedPostgresKeys = unreviewedPostgresUrlEnvironmentKeys(assignments)
    .filter((key) => !["DATABASE_URL", "DIRECT_URL"].includes(key));
  const unexpectedPrivilegedKeys = privilegedDatabaseEnvironmentKeys(assignments)
    .filter((key) => key !== "DIRECT_URL");
  if (unexpectedPostgresKeys.length > 0 || unexpectedPrivilegedKeys.length > 0) {
    throw new Error("local environment contains an unreviewed database credential key");
  }

  let priorDatabaseRole;
  try {
    const current = parseVercelRuntimeDatabaseIdentity(database.value, "DATABASE_URL");
    if (current.username !== REVIEWED_RUNTIME_ROLE || !current.isPooler) {
      throw new Error("not converged");
    }
    priorDatabaseRole = REVIEWED_RUNTIME_ROLE;
  } catch {
    priorDatabaseRole = normalizeLegacyOwnerPooler(database.value).username;
  }
  if (direct) assertReviewedDirectPredecessor(direct.value);

  const nextLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => index !== direct?.index)
    .map(({ line, index }) => (
      index === database.index ? `DATABASE_URL="${runtimeDatabaseUrl}"` : line
    ));
  const nextSource = nextLines.join(source.includes("\r\n") ? "\r\n" : "\n");
  return Object.freeze({
    source: nextSource,
    priorDatabaseRole,
    directUrlRemoved: Boolean(direct),
    changed: nextSource !== source,
    runtimeIdentity,
  });
}

export async function verifyLocalRuntimeRls(connectionString) {
  const client = new Client({
    connectionString,
    application_name: "grainline-local-runtime-convergence",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  try {
    const row = (await client.query(`
      SELECT current_user AS current_user_name,
             session_user AS session_user_name,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls,
             NULLIF(current_setting('app.user_id', true), '') AS app_user_id,
             (SELECT COUNT(*)::integer FROM public."SavedSearch") AS saved_search_count
    `)).rows[0];
    if (
      row?.current_user_name !== REVIEWED_RUNTIME_ROLE
      || row.session_user_name !== REVIEWED_RUNTIME_ROLE
      || row.rolbypassrls !== false
      || ![null, ""].includes(row.app_user_id)
      || Number(row.saved_search_count) !== 0
    ) throw new Error("local runtime credential did not prove direct RLS denial");
    return Object.freeze({
      runtimeRole: row.current_user_name,
      bypassRls: row.rolbypassrls,
      noContextRowCount: Number(row.saved_search_count),
    });
  } finally {
    await client.end();
  }
}

function writeAtomicPrivateFile(filePath, source, originalStat = null) {
  const temporaryPath = `${filePath}.runtime-convergence.tmp`;
  if (existsSync(temporaryPath)) throw new Error("local runtime convergence temp exists");
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, source, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporaryPath, 0o600);
  try {
    if (originalStat) {
      const current = exactPrivateFile(filePath, "local environment");
      if (
        current.dev !== originalStat.dev
        || current.ino !== originalStat.ino
        || current.size !== originalStat.size
        || current.mtimeMs !== originalStat.mtimeMs
      ) throw new Error("local environment changed during convergence");
    }
    renameSync(temporaryPath, filePath);
    chmodSync(filePath, 0o600);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

function writeEvidence(filePath, evidence) {
  if (
    !path.isAbsolute(filePath)
    || path.dirname(filePath) !== EVIDENCE_DIRECTORY
    || path.extname(filePath) !== ".json"
    || existsSync(filePath)
  ) throw new Error("local runtime convergence evidence path is invalid");
  writeAtomicPrivateFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function main() {
  try {
    if (
      process.env.LOCAL_RUNTIME_DB_CONVERGENCE_CONFIRM
      !== LOCAL_RUNTIME_CONVERGENCE_CONFIRMATION
    ) throw new Error("local runtime convergence confirmation is invalid");
    if (
      privilegedDatabaseEnvironmentKeys(process.env).length > 0
      || unreviewedPostgresUrlEnvironmentKeys(process.env).length > 0
    ) throw new Error("local runtime convergence rejects ambient database credentials");
    const commit = required(process.env, "LOCAL_RUNTIME_DB_CONVERGENCE_COMMIT");
    if (!COMMIT_PATTERN.test(commit)) throw new Error("local runtime convergence commit is invalid");
    const evidencePath = required(
      process.env,
      "LOCAL_RUNTIME_DB_CONVERGENCE_EVIDENCE_PATH",
    );
    const git = assertProductionMigrationGitState(
      readProductionMigrationGitState(),
      commit,
    );
    verifyReviewedNeonTarget();
    const runtimeDatabaseUrl = buildNeonRuntimePoolerUrl(
      revealReviewedNeonRuntimePassword(),
    );
    const runtimeProof = await verifyLocalRuntimeRls(runtimeDatabaseUrl);
    const originalStat = exactPrivateFile(LOCAL_ENV_PATH, "local environment");
    const source = readFileSync(LOCAL_ENV_PATH, "utf8");
    const convergence = convergeLocalRuntimeEnvironmentSource(source, runtimeDatabaseUrl);
    if (convergence.changed) {
      writeAtomicPrivateFile(LOCAL_ENV_PATH, convergence.source, originalStat);
    }
    const after = convergeLocalRuntimeEnvironmentSource(
      readFileSync(LOCAL_ENV_PATH, "utf8"),
      runtimeDatabaseUrl,
    );
    if (after.priorDatabaseRole !== REVIEWED_RUNTIME_ROLE || after.directUrlRemoved) {
      throw new Error("local runtime environment did not converge exactly");
    }
    const evidence = Object.freeze({
      version: 1,
      phase: "local-runtime-db-environment-convergence",
      generatedAt: new Date().toISOString(),
      status: "passed",
      acceptanceEligible: true,
      issueCount: 0,
      git,
      priorDatabaseRole: convergence.priorDatabaseRole,
      databaseRoleAfter: REVIEWED_RUNTIME_ROLE,
      directUrlRemoved: convergence.directUrlRemoved,
      changed: convergence.changed,
      runtimeIdentity: convergence.runtimeIdentity,
      runtimeProof,
      localFileMode: "0600",
    });
    writeEvidence(evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      acceptanceEligible: evidence.acceptanceEligible,
      databaseRoleAfter: evidence.databaseRoleAfter,
      directUrlRemoved: evidence.directUrlRemoved,
    })}\n`);
  } catch {
    process.stderr.write("Local runtime database environment convergence failed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
