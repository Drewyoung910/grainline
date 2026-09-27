#!/usr/bin/env node

// Read-only operator for a separately approved Core Order RLS release. Merely
// adding this file does not invoke it, apply SQL, or activate RLS.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, existsSync, fsyncSync, lstatSync, openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_STAFF_READ_DATABASE_ENV,
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  verifyOrderCoreRuntimePosture,
  proveOrderCoreDirectSelectDenied,
} from "./order-core-rls-runtime-postflight.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const COMMIT = /^[0-9a-f]{40}$/u;
const POSITIVE_RUN = /^[1-9][0-9]{0,15}$/u;
const CONFIRMATION = "verify-production-order-core-rls-runtime-read-only";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function runId(env, key) {
  const raw = required(env, key);
  if (!POSITIVE_RUN.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`${key} must be a safe positive integer`);
  }
  return Number(raw);
}

export function parseOrderCorePostflightConfig(
  env = process.env,
  assertRuntimeIsolation = assertVercelRuntimeDatabaseIsolation,
) {
  assertDeterministicPostgresEnvironment(env, "Core Order RLS postflight");
  if (env.ORDER_CORE_RLS_POSTFLIGHT_CONFIRM !== CONFIRMATION) {
    throw new Error("Core Order RLS postflight confirmation is invalid");
  }
  const phase = required(env, "ORDER_CORE_RLS_POSTFLIGHT_PHASE");
  if (phase !== "enable" && phase !== "force") {
    throw new Error("Core Order RLS postflight phase must be enable or force");
  }
  const privileged = privilegedDatabaseEnvironmentKeys(env);
  if (privileged.length) {
    throw new Error(`Core Order RLS postflight rejects privileged database keys: ${privileged.join(", ")}`);
  }
  const aliases = unreviewedPostgresUrlEnvironmentKeys(env);
  if (aliases.length) {
    throw new Error(`Core Order RLS postflight rejects aliased PostgreSQL URLs: ${aliases.join(", ")}`);
  }
  if (env[ORDER_STAFF_READ_DATABASE_ENV]) {
    throw new Error(`Core Order RLS postflight rejects ${ORDER_STAFF_READ_DATABASE_ENV}`);
  }
  const releaseCommit = required(env, "ORDER_CORE_RLS_POSTFLIGHT_RELEASE_COMMIT");
  if (!COMMIT.test(releaseCommit)) {
    throw new Error("Core Order RLS postflight release commit is invalid");
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeIdentity = assertRuntimeIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(required(env, "ORDER_CORE_RLS_POSTFLIGHT_EVIDENCE_PATH"));
  if (
    path.basename(evidencePath) !== `order-core-rls-${phase}-postflight-${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("Core Order RLS postflight evidence path must be fresh and exact");
  }
  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: createHash("sha256").update(databaseUrl).digest("hex"),
    evidencePath,
    mainCiRunId: runId(env, "ORDER_CORE_RLS_POSTFLIGHT_MAIN_CI_RUN_ID"),
    migrationRunId: runId(env, "ORDER_CORE_RLS_POSTFLIGHT_MIGRATION_RUN_ID"),
    phase,
    releaseCommit,
    runtimeIdentity,
  });
}

export function readOrderCorePostflightGitState(cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertOrderCorePostflightGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("Core Order RLS postflight requires the exact clean release commit");
  }
  return Object.freeze({ head: state.head, clean: true });
}

export function writeOrderCorePostflightEvidence(pathname, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\/|password|rawRows|userIds|providerIds/iu.test(serialized)) {
    throw new Error("Core Order RLS postflight evidence contains forbidden data");
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
    throw new Error("Core Order RLS postflight evidence is not mode 0600");
  }
}

export async function runOrderCorePostflight(config) {
  const git = assertOrderCorePostflightGitState(
    readOrderCorePostflightGitState(), config.releaseCommit,
  );
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-order-core-rls-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(config.databaseUrl)),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const posture = await verifyOrderCoreRuntimePosture(client, {
      forced: config.phase === "force",
      database: config.runtimeIdentity.databaseName,
    });
    const denial = await proveOrderCoreDirectSelectDenied(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "order-core-rls-production-postflight",
      phase: config.phase,
      source: { commit: git.head, clean: git.clean },
      target: {
        databaseName: config.runtimeIdentity.databaseName,
        databaseUrlSha256: config.databaseUrlSha256,
        endpointId: config.runtimeIdentity.endpointId,
        region: config.runtimeIdentity.region,
        role: config.runtimeIdentity.runtimeRole,
      },
      runs: {
        mainCiRunId: config.mainCiRunId,
        migrationRunId: config.migrationRunId,
      },
      proof: { ...posture, ...denial, postflightReadOnly: true, rowsExported: false },
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeOrderCorePostflightEvidence(config.evidencePath, evidence);
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[redacted-credentials]@");
}

async function main() {
  try {
    if (process.argv.length !== 2) throw new Error("Core Order RLS postflight takes no arguments");
    const evidence = await runOrderCorePostflight(parseOrderCorePostflightConfig());
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      phase: evidence.phase,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: true,
      productionChangedByPostflight: false,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
