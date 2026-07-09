#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const { Client, Pool } = pg;

export const MIN_ACCEPTANCE_REQUESTS = 500;
const DEFAULT_SCHEMA = "grainline_rls_canary";
const DEFAULT_TABLE = "context_canary";
const DEFAULT_POLICY = "context_canary_select";
const DEFAULT_USER_A = "rls-canary-user-a";
const DEFAULT_USER_B = "rls-canary-user-b";
const DEFAULT_EMPTY_OWNER_USER = "";
const DEFAULT_TARGET_CONCURRENCY = 8;
const DEFAULT_POOL_SIZE = 8;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_TIMEOUT_MS = 35_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 5_000;
const PREPARED_SELECT_NAME = "rls_context_gate_canary_select_v1";
const CONFIRMATION_VALUE = "staging-only";

const PREPARED_STATEMENT_ERROR_PATTERNS = [
  /prepared statement already exists/i,
  /prepared statement .* does not exist/i,
  /cached plan must not change result type/i,
  /unnamed prepared statement does not exist/i,
];

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePositiveInt(env, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function parseBooleanFlag(env, name) {
  return env[name] === "1" || env[name] === "true";
}

function optionalEvidencePath(env) {
  const raw = env.RLS_CONTEXT_GATE_EVIDENCE_PATH;
  if (raw === undefined || raw === "") return undefined;
  if (raw.includes("\0")) throw new Error("RLS_CONTEXT_GATE_EVIDENCE_PATH must not contain null bytes");
  return raw;
}

function assertSafeIdentifier(value, name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`);
  }
  return value;
}

function quoteIdentifier(value) {
  assertSafeIdentifier(value, "identifier");
  return `"${value}"`;
}

function validateDatabaseUrl(value, env) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("RLS_CONTEXT_GATE_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("RLS_CONTEXT_GATE_DATABASE_URL must use the postgres/postgresql protocol");
  }
  if (!parsed.hostname.includes("-pooler.") && !parseBooleanFlag(env, "RLS_CONTEXT_GATE_ALLOW_NON_POOLER")) {
    throw new Error(
      "RLS_CONTEXT_GATE_DATABASE_URL must be the pooled runtime endpoint; set RLS_CONTEXT_GATE_ALLOW_NON_POOLER=1 only for non-acceptance development checks",
    );
  }
  return parsed;
}

function validateSyntheticUserId(value, name, allowCustomUserIds) {
  if (value.length > 96 || !/^[A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error(`${name} must be a bounded synthetic id containing only safe id characters`);
  }
  if (!allowCustomUserIds && value && !value.startsWith("rls-canary-")) {
    throw new Error(`${name} must start with rls-canary- unless RLS_CONTEXT_GATE_ALLOW_CUSTOM_USER_IDS=1 is set`);
  }
  return value;
}

function buildTableRef(config) {
  return `${quoteIdentifier(config.schemaName)}.${quoteIdentifier(config.tableName)}`;
}

function buildSelectSql(config) {
  return `SELECT id, "userId", marker FROM ${buildTableRef(config)} ORDER BY id`;
}

function canaryRows(config) {
  return [
    { id: "rls-context-user-a", userId: config.userA, marker: "user-a" },
    { id: "rls-context-user-b", userId: config.userB, marker: "user-b" },
    { id: "rls-context-empty-owner", userId: DEFAULT_EMPTY_OWNER_USER, marker: "empty-owner-should-not-match" },
  ];
}

function expectedRowForUser(config, userId) {
  return canaryRows(config).find((row) => row.userId === userId);
}

function normalizeSetting(value) {
  return value ?? "";
}

function safeErrorMessage(error) {
  if (!error) return "unknown error";
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isPreparedStatementError(error) {
  const message = safeErrorMessage(error);
  return PREPARED_STATEMENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function parseGateConfig(env = process.env) {
  if (env.RLS_CONTEXT_GATE_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`RLS_CONTEXT_GATE_CONFIRM=${CONFIRMATION_VALUE} is required before running the staging gate`);
  }

  const databaseUrl = required(env.RLS_CONTEXT_GATE_DATABASE_URL, "RLS_CONTEXT_GATE_DATABASE_URL");
  validateDatabaseUrl(databaseUrl, env);

  const runtimeRole = assertSafeIdentifier(
    required(env.RLS_CONTEXT_GATE_RUNTIME_ROLE, "RLS_CONTEXT_GATE_RUNTIME_ROLE"),
    "RLS_CONTEXT_GATE_RUNTIME_ROLE",
  );
  const schemaName = assertSafeIdentifier(env.RLS_CONTEXT_GATE_SCHEMA ?? DEFAULT_SCHEMA, "RLS_CONTEXT_GATE_SCHEMA");
  const tableName = assertSafeIdentifier(env.RLS_CONTEXT_GATE_TABLE ?? DEFAULT_TABLE, "RLS_CONTEXT_GATE_TABLE");
  const policyName = assertSafeIdentifier(env.RLS_CONTEXT_GATE_POLICY ?? DEFAULT_POLICY, "RLS_CONTEXT_GATE_POLICY");
  const allowCustomUserIds = parseBooleanFlag(env, "RLS_CONTEXT_GATE_ALLOW_CUSTOM_USER_IDS");
  const userA = validateSyntheticUserId(env.RLS_CONTEXT_GATE_USER_A ?? DEFAULT_USER_A, "RLS_CONTEXT_GATE_USER_A", allowCustomUserIds);
  const userB = validateSyntheticUserId(env.RLS_CONTEXT_GATE_USER_B ?? DEFAULT_USER_B, "RLS_CONTEXT_GATE_USER_B", allowCustomUserIds);
  if (userA === userB) throw new Error("RLS_CONTEXT_GATE_USER_A and RLS_CONTEXT_GATE_USER_B must differ");

  const measuredRequests = parsePositiveInt(env, "RLS_CONTEXT_GATE_REQUESTS", MIN_ACCEPTANCE_REQUESTS, {
    min: MIN_ACCEPTANCE_REQUESTS,
    max: 100_000,
  });
  const warmupRequests = parsePositiveInt(env, "RLS_CONTEXT_GATE_WARMUP_REQUESTS", 50, {
    min: 0,
    max: 10_000,
  });
  const turnoverRequests = parsePositiveInt(env, "RLS_CONTEXT_GATE_TURNOVER_REQUESTS", 64, {
    min: 2,
    max: 10_000,
  });
  const targetConcurrency = parsePositiveInt(env, "RLS_CONTEXT_GATE_TARGET_CONCURRENCY", DEFAULT_TARGET_CONCURRENCY, {
    min: 1,
    max: 512,
  });
  const burstConcurrency = parsePositiveInt(env, "RLS_CONTEXT_GATE_BURST_CONCURRENCY", targetConcurrency * 2, {
    min: 1,
    max: 1024,
  });
  const poolSize = parsePositiveInt(env, "RLS_CONTEXT_GATE_POOL_SIZE", Math.max(DEFAULT_POOL_SIZE, targetConcurrency), {
    min: 1,
    max: 512,
  });
  const connectionTimeoutMs = parsePositiveInt(env, "RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS", DEFAULT_CONNECTION_TIMEOUT_MS, {
    min: 500,
    max: 120_000,
  });
  const statementTimeoutMs = parsePositiveInt(env, "RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS", DEFAULT_STATEMENT_TIMEOUT_MS, {
    min: 1_000,
    max: 300_000,
  });
  const queryTimeoutMs = parsePositiveInt(env, "RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS", DEFAULT_QUERY_TIMEOUT_MS, {
    min: 1_000,
    max: 300_000,
  });
  const transactionTimeoutMs = parsePositiveInt(env, "RLS_CONTEXT_GATE_TX_TIMEOUT_MS", DEFAULT_TRANSACTION_TIMEOUT_MS, {
    min: 1_000,
    max: 300_000,
  });
  const prepare = parseBooleanFlag(env, "RLS_CONTEXT_GATE_PREPARE");
  const rollbackProbe = parseBooleanFlag(env, "RLS_CONTEXT_GATE_ROLLBACK_PROBE") || prepare;
  const adminDatabaseUrl = env.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL;
  if (prepare && !adminDatabaseUrl) {
    throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required when RLS_CONTEXT_GATE_PREPARE=1");
  }
  if (rollbackProbe && !adminDatabaseUrl) {
    throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required when RLS_CONTEXT_GATE_ROLLBACK_PROBE=1");
  }

  return {
    adminDatabaseUrl,
    burstConcurrency,
    connectionTimeoutMs,
    databaseUrl,
    evidencePath: optionalEvidencePath(env),
    measuredRequests,
    policyName,
    poolSize,
    prepare,
    queryTimeoutMs,
    rollbackProbe,
    runtimeRole,
    schemaName,
    statementTimeoutMs,
    tableName,
    targetConcurrency,
    transactionTimeoutMs,
    turnoverRequests,
    userA,
    userB,
    warmupRequests,
  };
}

function sanitizedDatabaseHost(databaseUrl) {
  return new URL(databaseUrl).hostname;
}

export function buildEvidencePayload(config, result, { finishedAt, startedAt, status }, env = process.env) {
  return {
    generatedAt: finishedAt,
    run: {
      ciRunId: env.RLS_CONTEXT_GATE_CI_RUN_ID || env.GITHUB_RUN_ID || null,
      commitSha: env.RLS_CONTEXT_GATE_COMMIT_SHA || env.GITHUB_SHA || null,
      finishedAt,
      startedAt,
      status,
    },
    database: {
      databaseHost: sanitizedDatabaseHost(config.databaseUrl),
      policyName: config.policyName,
      runtimeRole: config.runtimeRole,
      schemaName: config.schemaName,
      tableName: config.tableName,
    },
    config: {
      burstConcurrency: config.burstConcurrency,
      connectionTimeoutMs: config.connectionTimeoutMs,
      measuredRequests: config.measuredRequests,
      poolSize: config.poolSize,
      prepare: config.prepare,
      queryTimeoutMs: config.queryTimeoutMs,
      rollbackProbe: config.rollbackProbe,
      statementTimeoutMs: config.statementTimeoutMs,
      targetConcurrency: config.targetConcurrency,
      transactionTimeoutMs: config.transactionTimeoutMs,
      turnoverRequests: config.turnoverRequests,
      warmupRequests: config.warmupRequests,
    },
    result: {
      issueCount: result.issues.length,
      issues: result.issues,
      reports: result.reports,
    },
  };
}

function writeEvidencePayload(config, payload) {
  if (!config.evidencePath) return;
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`RLS context evidence written to ${config.evidencePath}`);
}

function createClient(connectionString, config) {
  return new Client({
    application_name: "grainline-rls-context-gate",
    connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
  });
}

function createPool(config, { max, maxUses } = {}) {
  const poolConfig = {
    application_name: "grainline-rls-context-gate",
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: 5_000,
    max: max ?? config.poolSize,
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
  };
  if (maxUses !== undefined) poolConfig.maxUses = maxUses;
  return new Pool(poolConfig);
}

function createPrismaProbe(config, { max, maxUses } = {}) {
  const pool = createPool(config, { max, maxUses });
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  const prisma = new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: config.connectionTimeoutMs,
      timeout: config.transactionTimeoutMs,
    },
  });
  return { pool, prisma };
}

async function disconnectPrismaProbe(probe) {
  await probe.prisma.$disconnect().catch(() => {});
  await probe.pool.end().catch(() => {});
}

export async function prepareCanary(config) {
  const client = createClient(config.adminDatabaseUrl, config);
  await client.connect();
  try {
    const roleResult = await client.query("SELECT current_user AS current_user_name, session_user AS session_user_name");
    const currentUser = roleResult.rows[0]?.current_user_name;
    if (currentUser === config.runtimeRole) {
      throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL must not authenticate as the runtime role");
    }

    const tableRef = buildTableRef(config);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(config.schemaName)}`);
    await client.query(`REVOKE ALL ON SCHEMA ${quoteIdentifier(config.schemaName)} FROM PUBLIC`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${tableRef} (
         id text PRIMARY KEY,
         "userId" text NOT NULL,
         marker text NOT NULL,
         "createdAt" timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await client.query(`REVOKE ALL ON TABLE ${tableRef} FROM PUBLIC`);
    await client.query(`GRANT USAGE ON SCHEMA ${quoteIdentifier(config.schemaName)} TO ${quoteIdentifier(config.runtimeRole)}`);
    await client.query(`GRANT SELECT ON TABLE ${tableRef} TO ${quoteIdentifier(config.runtimeRole)}`);
    await client.query(`ALTER TABLE ${tableRef} DISABLE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS ${quoteIdentifier(config.policyName)} ON ${tableRef}`);

    const rows = canaryRows(config);
    await client.query(
      `DELETE FROM ${tableRef} WHERE id = ANY($1::text[])`,
      [rows.map((row) => row.id)],
    );
    for (const row of rows) {
      await client.query(
        `INSERT INTO ${tableRef} (id, "userId", marker)
         VALUES ($1, $2, $3)
         ON CONFLICT (id)
         DO UPDATE SET "userId" = EXCLUDED."userId", marker = EXCLUDED.marker`,
        [row.id, row.userId, row.marker],
      );
    }
    await client.query(
      `CREATE POLICY ${quoteIdentifier(config.policyName)}
         ON ${tableRef}
         FOR SELECT
         TO ${quoteIdentifier(config.runtimeRole)}
         USING ("userId" = NULLIF(current_setting('app.user_id', true), ''))`,
    );
    await client.query(`ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${tableRef} FORCE ROW LEVEL SECURITY`);
    return {
      currentUser,
      rowsPrepared: rows.length,
      sessionUser: roleResult.rows[0]?.session_user_name,
    };
  } finally {
    await client.end();
  }
}

async function inspectRuntime(pool, config) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT current_user AS current_user_name,
              session_user AS session_user_name,
              current_database() AS database_name,
              current_setting('app.user_id', true) AS app_user_id`,
    );
    const row = result.rows[0] ?? {};
    const issues = [];
    if (row.current_user_name !== config.runtimeRole) {
      issues.push(`runtime connection current_user is ${row.current_user_name ?? "unknown"}, expected ${config.runtimeRole}`);
    }
    if (row.session_user_name !== config.runtimeRole) {
      issues.push(`runtime connection session_user is ${row.session_user_name ?? "unknown"}, expected ${config.runtimeRole}`);
    }
    if (normalizeSetting(row.app_user_id) !== "") {
      issues.push("runtime connection starts with app.user_id already set");
    }
    return { issues, row };
  } finally {
    client.release();
  }
}

function selectQuery(config, prepared) {
  const text = buildSelectSql(config);
  if (!prepared) return { text };
  return { name: PREPARED_SELECT_NAME, text };
}

function collectRowIssues(config, rows, expectedUserId, label) {
  const expected = expectedRowForUser(config, expectedUserId);
  if (!expected) return [`${label}: expected row definition missing`];
  if (rows.length !== 1) return [`${label}: expected exactly one protected row, got ${rows.length}`];
  const row = rows[0];
  const issues = [];
  if (row.userId !== expected.userId) issues.push(`${label}: returned userId ${row.userId}, expected ${expected.userId}`);
  if (row.id !== expected.id) issues.push(`${label}: returned row ${row.id}, expected ${expected.id}`);
  if (row.marker !== expected.marker) issues.push(`${label}: returned marker ${row.marker}, expected ${expected.marker}`);
  return issues;
}

async function timedBaselineDeniedRead(pool, config, label = "baseline denied read") {
  const startedAt = performance.now();
  const acquireStartedAt = performance.now();
  const client = await pool.connect();
  const acquiredAt = performance.now();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const setting = await client.query("SELECT current_setting('app.user_id', true) AS user_id");
    const rows = await client.query(selectQuery(config, true));
    await client.query("COMMIT");
    inTransaction = false;
    const finishedAt = performance.now();
    const issues = [];
    if (normalizeSetting(setting.rows[0]?.user_id) !== "") {
      issues.push(`${label}: unset app.user_id was ${setting.rows[0]?.user_id}`);
    }
    if (rows.rows.length !== 0) {
      issues.push(`${label}: unset app.user_id returned ${rows.rows.length} rows`);
    }
    return sample({ acquiredAt, acquireStartedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    return sample({ acquiredAt, acquireStartedAt, error, label, startedAt });
  } finally {
    client.release();
  }
}

async function timedAutocommitDeniedRead(pool, config, label = "autocommit denied read") {
  const startedAt = performance.now();
  const acquireStartedAt = performance.now();
  const client = await pool.connect();
  const acquiredAt = performance.now();
  try {
    const setting = await client.query("SELECT current_setting('app.user_id', true) AS user_id");
    const rows = await client.query(selectQuery(config, false));
    const finishedAt = performance.now();
    const issues = [];
    if (normalizeSetting(setting.rows[0]?.user_id) !== "") {
      issues.push(`${label}: unset app.user_id was ${setting.rows[0]?.user_id}`);
    }
    if (rows.rows.length !== 0) {
      issues.push(`${label}: unset app.user_id returned ${rows.rows.length} rows`);
    }
    return sample({ acquiredAt, acquireStartedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt, acquireStartedAt, error, label, startedAt });
  } finally {
    client.release();
  }
}

async function timedOutsideTransactionDeniedRead(pool, config) {
  return timedAutocommitDeniedRead(pool, config, "outside transaction denied read");
}

async function timedEmptyContextRead(pool, config) {
  const startedAt = performance.now();
  const acquireStartedAt = performance.now();
  const client = await pool.connect();
  const acquiredAt = performance.now();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SELECT set_config('app.user_id', $1, true) AS user_id", [""]);
    const setting = await client.query("SELECT current_setting('app.user_id', true) AS user_id");
    const rows = await client.query(selectQuery(config, false));
    await client.query("COMMIT");
    inTransaction = false;
    const finishedAt = performance.now();
    const issues = [];
    if (normalizeSetting(setting.rows[0]?.user_id) !== "") {
      issues.push(`empty context: expected empty app.user_id, got ${setting.rows[0]?.user_id}`);
    }
    if (rows.rows.length !== 0) {
      issues.push(`empty context: expected zero rows, got ${rows.rows.length}`);
    }
    return sample({ acquiredAt, acquireStartedAt, finishedAt, issues, label: "empty context denied read", startedAt });
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    return sample({ acquiredAt, acquireStartedAt, error, label: "empty context denied read", startedAt });
  } finally {
    client.release();
  }
}

async function timedWrappedRead(pool, config, userId, { label = "wrapped read", prepared = true } = {}) {
  const startedAt = performance.now();
  const acquireStartedAt = performance.now();
  const client = await pool.connect();
  const acquiredAt = performance.now();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SELECT set_config('app.user_id', $1, true) AS user_id", [userId]);
    const setting = await client.query("SELECT current_setting('app.user_id', true) AS user_id");
    const rows = await client.query(selectQuery(config, prepared));
    await client.query("COMMIT");
    inTransaction = false;
    const finishedAt = performance.now();
    const issues = [];
    if (setting.rows[0]?.user_id !== userId) {
      issues.push(`${label}: current_setting returned ${setting.rows[0]?.user_id ?? "null"}, expected ${userId}`);
    }
    issues.push(...collectRowIssues(config, rows.rows, userId, label));
    return sample({ acquiredAt, acquireStartedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    return sample({ acquiredAt, acquireStartedAt, error, label, startedAt });
  } finally {
    client.release();
  }
}

async function transactionCleanupProbe(pool, config, action) {
  const startedAt = performance.now();
  const acquireStartedAt = performance.now();
  const client = await pool.connect();
  const acquiredAt = performance.now();
  let inTransaction = false;
  const label = `${action} cleanup probe`;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SELECT set_config('app.user_id', $1, true) AS user_id", [config.userA]);
    const rowsInside = await client.query(selectQuery(config, false));
    if (action === "commit") {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    inTransaction = false;
    const settingAfter = await client.query("SELECT current_setting('app.user_id', true) AS user_id");
    const rowsAfter = await client.query(selectQuery(config, false));
    const finishedAt = performance.now();
    const issues = [];
    issues.push(...collectRowIssues(config, rowsInside.rows, config.userA, `${label} inside transaction`));
    if (normalizeSetting(settingAfter.rows[0]?.user_id) !== "") {
      issues.push(`${label}: app.user_id survived ${action}`);
    }
    if (rowsAfter.rows.length !== 0) {
      issues.push(`${label}: protected rows visible after ${action}`);
    }
    return sample({ acquiredAt, acquireStartedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    return sample({ acquiredAt, acquireStartedAt, error, label, startedAt });
  } finally {
    client.release();
  }
}

async function retryProbe(pool, config) {
  const attempts = [];
  async function runAttempt(index, shouldFail) {
    const result = await timedWrappedRead(pool, config, config.userA, {
      label: `synthetic retry attempt ${index}`,
      prepared: false,
    });
    attempts.push(result);
    if (shouldFail) {
      const error = new Error("synthetic serialization retry");
      error.code = "40001";
      throw error;
    }
    return result;
  }

  try {
    await runAttempt(1, true);
  } catch (error) {
    if (error?.code !== "40001") throw error;
    await runAttempt(2, false);
  }

  const issues = [];
  if (attempts.length !== 2) issues.push(`synthetic retry probe ran ${attempts.length} attempts, expected 2`);
  for (const attempt of attempts) {
    issues.push(...attempt.issues);
    if (attempt.error) issues.push(`${attempt.label}: ${safeErrorMessage(attempt.error)}`);
  }
  return { attempts, issues, label: "synthetic retry probe" };
}

async function timedPrismaBaselineDeniedRead(prisma, config, label = "prisma baseline denied read") {
  const startedAt = performance.now();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const setting = await tx.$queryRawUnsafe("SELECT current_setting('app.user_id', true) AS user_id");
        const rows = await tx.$queryRawUnsafe(buildSelectSql(config));
        return { rows, setting };
      },
      { timeout: config.transactionTimeoutMs, maxWait: config.connectionTimeoutMs },
    );
    const finishedAt = performance.now();
    const issues = [];
    if (normalizeSetting(result.setting[0]?.user_id) !== "") {
      issues.push(`${label}: unset app.user_id was ${result.setting[0]?.user_id}`);
    }
    if (result.rows.length !== 0) {
      issues.push(`${label}: unset app.user_id returned ${result.rows.length} rows`);
    }
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, error, label, startedAt });
  }
}

async function timedPrismaAutocommitDeniedRead(prisma, config, label = "prisma autocommit denied read") {
  const startedAt = performance.now();
  try {
    const setting = await prisma.$queryRawUnsafe("SELECT current_setting('app.user_id', true) AS user_id");
    const rows = await prisma.$queryRawUnsafe(buildSelectSql(config));
    const finishedAt = performance.now();
    const issues = [];
    if (normalizeSetting(setting[0]?.user_id) !== "") {
      issues.push(`${label}: unset app.user_id was ${setting[0]?.user_id}`);
    }
    if (rows.length !== 0) {
      issues.push(`${label}: unset app.user_id returned ${rows.length} rows`);
    }
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, error, label, startedAt });
  }
}

async function timedPrismaEmptyContextRead(prisma, config) {
  const label = "prisma empty context denied read";
  const startedAt = performance.now();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe("SELECT set_config('app.user_id', $1, true) AS user_id", "");
        const setting = await tx.$queryRawUnsafe("SELECT current_setting('app.user_id', true) AS user_id");
        const rows = await tx.$queryRawUnsafe(buildSelectSql(config));
        return { rows, setting };
      },
      { timeout: config.transactionTimeoutMs, maxWait: config.connectionTimeoutMs },
    );
    const finishedAt = performance.now();
    const issues = [];
    if (normalizeSetting(result.setting[0]?.user_id) !== "") {
      issues.push(`${label}: expected empty app.user_id, got ${result.setting[0]?.user_id}`);
    }
    if (result.rows.length !== 0) {
      issues.push(`${label}: expected zero rows, got ${result.rows.length}`);
    }
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, error, label, startedAt });
  }
}

async function timedPrismaWrappedRead(prisma, config, userId, label = "prisma wrapped read") {
  const startedAt = performance.now();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe("SELECT set_config('app.user_id', $1, true) AS user_id", userId);
        const setting = await tx.$queryRawUnsafe("SELECT current_setting('app.user_id', true) AS user_id");
        const rows = await tx.$queryRawUnsafe(buildSelectSql(config));
        return { rows, setting };
      },
      { timeout: config.transactionTimeoutMs, maxWait: config.connectionTimeoutMs },
    );
    const finishedAt = performance.now();
    const issues = [];
    if (result.setting[0]?.user_id !== userId) {
      issues.push(`${label}: current_setting returned ${result.setting[0]?.user_id ?? "null"}, expected ${userId}`);
    }
    issues.push(...collectRowIssues(config, result.rows, userId, label));
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, error, label, startedAt });
  }
}

async function timedPrismaCleanupProbe(prisma, config, shouldThrow) {
  const label = `prisma ${shouldThrow ? "rollback" : "commit"} cleanup probe`;
  const startedAt = performance.now();
  try {
    let insideRows = [];
    try {
      insideRows = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe("SELECT set_config('app.user_id', $1, true) AS user_id", config.userA);
          const rows = await tx.$queryRawUnsafe(buildSelectSql(config));
          insideRows = rows;
          if (shouldThrow) throw new Error("synthetic rollback");
          return rows;
        },
        { timeout: config.transactionTimeoutMs, maxWait: config.connectionTimeoutMs },
      );
    } catch (error) {
      if (!shouldThrow || safeErrorMessage(error) !== "synthetic rollback") throw error;
    }
    const settingAfter = await prisma.$queryRawUnsafe("SELECT current_setting('app.user_id', true) AS user_id");
    const rowsAfter = await prisma.$queryRawUnsafe(buildSelectSql(config));
    const finishedAt = performance.now();
    const issues = [];
    issues.push(...collectRowIssues(config, insideRows, config.userA, `${label} inside transaction`));
    if (normalizeSetting(settingAfter[0]?.user_id) !== "") {
      issues.push(`${label}: app.user_id survived transaction completion`);
    }
    if (rowsAfter.length !== 0) {
      issues.push(`${label}: protected rows visible after transaction completion`);
    }
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, error, label, startedAt });
  }
}

async function prismaRetryProbe(prisma, config) {
  const attempts = [];
  async function runAttempt(index, shouldFail) {
    const result = await timedPrismaWrappedRead(prisma, config, config.userA, `prisma synthetic retry attempt ${index}`);
    attempts.push(result);
    if (shouldFail) {
      const error = new Error("synthetic serialization retry");
      error.code = "40001";
      throw error;
    }
    return result;
  }

  try {
    await runAttempt(1, true);
  } catch (error) {
    if (error?.code !== "40001") throw error;
    await runAttempt(2, false);
  }

  const issues = [];
  if (attempts.length !== 2) issues.push(`prisma synthetic retry probe ran ${attempts.length} attempts, expected 2`);
  for (const attempt of attempts) {
    issues.push(...attempt.issues);
    if (attempt.error) issues.push(`${attempt.label}: ${safeErrorMessage(attempt.error)}`);
  }
  return { attempts, issues, label: "prisma synthetic retry probe" };
}

async function runPrismaWorkload(prisma, config, { concurrency, label, mode, requests }) {
  const samples = [];
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= requests) return;
      switch (mode) {
        case "baseline":
          samples.push(await timedPrismaBaselineDeniedRead(prisma, config, label));
          break;
        case "autocommit":
          samples.push(await timedPrismaAutocommitDeniedRead(prisma, config, label));
          break;
        case "wrapped": {
          const userId = index % 2 === 0 ? config.userA : config.userB;
          samples.push(await timedPrismaWrappedRead(prisma, config, userId, label));
          break;
        }
        default:
          throw new Error(`Unknown Prisma RLS gate workload mode: ${mode}`);
      }
    }
  });
  await Promise.all(workers);
  return summarizeWorkload(label, samples);
}

async function runRollbackDisableProbe(config) {
  const tableRef = buildTableRef(config);
  const admin = createClient(config.adminDatabaseUrl, config);
  await admin.connect();
  try {
    await admin.query(`ALTER TABLE ${tableRef} DISABLE ROW LEVEL SECURITY`);
    const probe = createPrismaProbe(config, { max: 1 });
    try {
      const result = await probe.prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe("SELECT set_config('app.user_id', $1, true) AS user_id", config.userA);
          const setting = await tx.$queryRawUnsafe("SELECT current_setting('app.user_id', true) AS user_id");
          const count = await tx.$queryRawUnsafe(`SELECT count(*)::int AS row_count FROM ${tableRef}`);
          return { count, setting };
        },
        { timeout: config.transactionTimeoutMs, maxWait: config.connectionTimeoutMs },
      );
      const rowCount = Number(result.count[0]?.row_count ?? 0);
      const issues = [];
      if (result.setting[0]?.user_id !== config.userA) {
        issues.push(`rollback probe: current_setting returned ${result.setting[0]?.user_id ?? "null"}, expected ${config.userA}`);
      }
      if (rowCount < canaryRows(config).length) {
        issues.push(`rollback probe: expected disabled-RLS canary count >= ${canaryRows(config).length}, got ${rowCount}`);
      }
      return issues;
    } finally {
      await disconnectPrismaProbe(probe);
    }
  } finally {
    await admin.query(`ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY`).catch(() => {});
    await admin.query(`ALTER TABLE ${tableRef} FORCE ROW LEVEL SECURITY`).catch(() => {});
    await admin.end();
  }
}

function sample({ acquiredAt, acquireStartedAt, error, finishedAt, issues = [], label, startedAt }) {
  const end = finishedAt ?? performance.now();
  return {
    acquireMs: Math.max(0, acquiredAt - acquireStartedAt),
    error,
    holdMs: Math.max(0, end - acquiredAt),
    issues,
    label,
    latencyMs: Math.max(0, end - startedAt),
  };
}

async function runWorkload(pool, config, { concurrency, label, mode, requests }) {
  const samples = [];
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= requests) return;
      switch (mode) {
        case "baseline":
          samples.push(await timedBaselineDeniedRead(pool, config, label));
          break;
        case "autocommit":
          samples.push(await timedAutocommitDeniedRead(pool, config, label));
          break;
        case "wrapped": {
          const userId = index % 2 === 0 ? config.userA : config.userB;
          samples.push(await timedWrappedRead(pool, config, userId, { label, prepared: true }));
          break;
        }
        default:
          throw new Error(`Unknown RLS gate workload mode: ${mode}`);
      }
    }
  });
  await Promise.all(workers);
  return summarizeWorkload(label, samples);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeMetrics(values) {
  return {
    avg: average(values),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

function summarizeWorkload(label, samples) {
  const successes = samples.filter((entry) => !entry.error);
  const errors = samples.filter((entry) => entry.error);
  const issues = samples.flatMap((entry) => entry.issues.map((issue) => `${entry.label}: ${issue}`));
  return {
    errors,
    issues,
    label,
    requestCount: samples.length,
    summaries: {
      acquireMs: summarizeMetrics(successes.map((entry) => entry.acquireMs)),
      holdMs: summarizeMetrics(successes.map((entry) => entry.holdMs)),
      latencyMs: summarizeMetrics(successes.map((entry) => entry.latencyMs)),
    },
  };
}

function compareWorkloads(label, baseline, wrapped, config) {
  const issues = [];
  const baselineLatency = baseline.summaries.latencyMs;
  const wrappedLatency = wrapped.summaries.latencyMs;
  const baselineHold = baseline.summaries.holdMs;
  const wrappedHold = wrapped.summaries.holdMs;
  const wrappedAcquire = wrapped.summaries.acquireMs;

  issues.push(...baseline.issues, ...wrapped.issues);
  for (const workload of [baseline, wrapped]) {
    if (workload.errors.length > 0) {
      issues.push(`${workload.label}: ${workload.errors.length} request errors`);
      for (const errorSample of workload.errors.slice(0, 5)) {
        issues.push(`${workload.label}: ${safeErrorMessage(errorSample.error)}`);
      }
      if (workload.errors.some((entry) => isPreparedStatementError(entry.error))) {
        issues.push(`${workload.label}: prepared-statement/cached-plan/protocol error seen`);
      }
    }
  }

  if (wrappedLatency.p95 > baselineLatency.p95 * 2 || wrappedLatency.p95 - baselineLatency.p95 > 100) {
    issues.push(
      `${label}: wrapped p95 ${formatMs(wrappedLatency.p95)} exceeds baseline p95 ${formatMs(baselineLatency.p95)} threshold`,
    );
  }
  if (wrappedLatency.p99 > baselineLatency.p99 * 3 || wrappedLatency.p99 - baselineLatency.p99 > 250) {
    issues.push(
      `${label}: wrapped p99 ${formatMs(wrappedLatency.p99)} exceeds baseline p99 ${formatMs(baselineLatency.p99)} threshold`,
    );
  }
  if (wrappedAcquire.p95 > 100) {
    issues.push(`${label}: wrapped connection acquisition p95 ${formatMs(wrappedAcquire.p95)} exceeds 100ms`);
  }
  if (wrappedAcquire.p99 > 250) {
    issues.push(`${label}: wrapped connection acquisition p99 ${formatMs(wrappedAcquire.p99)} exceeds 250ms`);
  }
  if (wrappedHold.avg > baselineHold.avg * 2) {
    issues.push(`${label}: wrapped average hold ${formatMs(wrappedHold.avg)} exceeds 2x baseline ${formatMs(baselineHold.avg)}`);
  }
  if (wrappedHold.p99 > config.transactionTimeoutMs / 2) {
    issues.push(
      `${label}: wrapped p99 hold ${formatMs(wrappedHold.p99)} exceeds 50% of transaction timeout ${formatMs(config.transactionTimeoutMs)}`,
    );
  }
  return issues;
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatSummary(workload) {
  return [
    `${workload.label}: requests=${workload.requestCount}`,
    `latency p95=${formatMs(workload.summaries.latencyMs.p95)} p99=${formatMs(workload.summaries.latencyMs.p99)}`,
    `acquire p95=${formatMs(workload.summaries.acquireMs.p95)} p99=${formatMs(workload.summaries.acquireMs.p99)}`,
    `hold avg=${formatMs(workload.summaries.holdMs.avg)} p99=${formatMs(workload.summaries.holdMs.p99)}`,
    `errors=${workload.errors.length}`,
  ].join("; ");
}

function assertCleanSample(sampleResult) {
  const issues = [];
  if (sampleResult.error) issues.push(`${sampleResult.label}: ${safeErrorMessage(sampleResult.error)}`);
  issues.push(...sampleResult.issues);
  return issues;
}

export async function runAcceptanceGate(config) {
  const issues = [];
  const reports = [];
  if (config.prepare) {
    const prepared = await prepareCanary(config);
    reports.push(`prepared ${prepared.rowsPrepared} synthetic canary rows as ${prepared.currentUser}`);
  }

  const pool = createPool(config);
  try {
    const runtime = await inspectRuntime(pool, config);
    reports.push(
      `runtime current_user=${runtime.row.current_user_name ?? "unknown"} session_user=${runtime.row.session_user_name ?? "unknown"} database=${runtime.row.database_name ?? "unknown"}`,
    );
    issues.push(...runtime.issues);

    for (const check of [
      await timedOutsideTransactionDeniedRead(pool, config),
      await timedAutocommitDeniedRead(pool, config, "single autocommit denied read"),
      await timedBaselineDeniedRead(pool, config, "single baseline denied read"),
      await timedEmptyContextRead(pool, config),
      await timedWrappedRead(pool, config, config.userA, { label: "single user A wrapped read", prepared: false }),
      await timedWrappedRead(pool, config, config.userB, { label: "single user B wrapped read", prepared: false }),
      await transactionCleanupProbe(pool, config, "commit"),
      await transactionCleanupProbe(pool, config, "rollback"),
    ]) {
      issues.push(...assertCleanSample(check));
    }

    const retry = await retryProbe(pool, config);
    issues.push(...retry.issues);
    reports.push("synthetic retry probe attempts=2");

    if (config.warmupRequests > 0) {
      const warmupAutocommitBaseline = await runWorkload(pool, config, {
        concurrency: Math.min(config.targetConcurrency, config.poolSize),
        label: "warmup autocommit baseline",
        mode: "autocommit",
        requests: config.warmupRequests,
      });
      const warmupBaseline = await runWorkload(pool, config, {
        concurrency: Math.min(config.targetConcurrency, config.poolSize),
        label: "warmup baseline",
        mode: "baseline",
        requests: config.warmupRequests,
      });
      const warmupWrapped = await runWorkload(pool, config, {
        concurrency: Math.min(config.targetConcurrency, config.poolSize),
        label: "warmup wrapped",
        mode: "wrapped",
        requests: config.warmupRequests,
      });
      issues.push(...warmupAutocommitBaseline.issues, ...warmupBaseline.issues, ...warmupWrapped.issues);
      if (warmupAutocommitBaseline.errors.length > 0 || warmupBaseline.errors.length > 0 || warmupWrapped.errors.length > 0) {
        issues.push("warmup produced request errors");
      }
    }

    const prismaProbe = createPrismaProbe(config, { max: Math.min(config.targetConcurrency, config.poolSize) });
    try {
      for (const check of [
        await timedPrismaAutocommitDeniedRead(prismaProbe.prisma, config, "single prisma autocommit denied read"),
        await timedPrismaBaselineDeniedRead(prismaProbe.prisma, config, "single prisma baseline denied read"),
        await timedPrismaEmptyContextRead(prismaProbe.prisma, config),
        await timedPrismaWrappedRead(prismaProbe.prisma, config, config.userA, "single prisma user A wrapped read"),
        await timedPrismaWrappedRead(prismaProbe.prisma, config, config.userB, "single prisma user B wrapped read"),
        await timedPrismaCleanupProbe(prismaProbe.prisma, config, false),
        await timedPrismaCleanupProbe(prismaProbe.prisma, config, true),
      ]) {
        issues.push(...assertCleanSample(check));
      }
      const prismaRetry = await prismaRetryProbe(prismaProbe.prisma, config);
      issues.push(...prismaRetry.issues);
      reports.push("Prisma adapter synthetic retry probe attempts=2");

      const prismaTargetAutocommitBaseline = await runPrismaWorkload(prismaProbe.prisma, config, {
        concurrency: Math.min(config.targetConcurrency, config.poolSize),
        label: "Prisma target autocommit baseline",
        mode: "autocommit",
        requests: config.measuredRequests,
      });
      const prismaTargetBaseline = await runPrismaWorkload(prismaProbe.prisma, config, {
        concurrency: Math.min(config.targetConcurrency, config.poolSize),
        label: "Prisma target baseline",
        mode: "baseline",
        requests: config.measuredRequests,
      });
      const prismaTargetWrapped = await runPrismaWorkload(prismaProbe.prisma, config, {
        concurrency: Math.min(config.targetConcurrency, config.poolSize),
        label: "Prisma target wrapped",
        mode: "wrapped",
        requests: config.measuredRequests,
      });
      const prismaBurstAutocommitBaseline = await runPrismaWorkload(prismaProbe.prisma, config, {
        concurrency: Math.min(config.burstConcurrency, config.poolSize),
        label: "Prisma burst autocommit baseline",
        mode: "autocommit",
        requests: config.measuredRequests,
      });
      const prismaBurstBaseline = await runPrismaWorkload(prismaProbe.prisma, config, {
        concurrency: Math.min(config.burstConcurrency, config.poolSize),
        label: "Prisma burst baseline",
        mode: "baseline",
        requests: config.measuredRequests,
      });
      const prismaBurstWrapped = await runPrismaWorkload(prismaProbe.prisma, config, {
        concurrency: Math.min(config.burstConcurrency, config.poolSize),
        label: "Prisma burst wrapped",
        mode: "wrapped",
        requests: config.measuredRequests,
      });
      for (const workload of [
        prismaTargetAutocommitBaseline,
        prismaTargetBaseline,
        prismaTargetWrapped,
        prismaBurstAutocommitBaseline,
        prismaBurstBaseline,
        prismaBurstWrapped,
      ]) {
        reports.push(formatSummary(workload));
      }
      issues.push(...compareWorkloads("Prisma target concurrency", prismaTargetBaseline, prismaTargetWrapped, config));
      issues.push(...compareWorkloads("Prisma target autocommit adoption cost", prismaTargetAutocommitBaseline, prismaTargetWrapped, config));
      issues.push(...compareWorkloads("Prisma burst concurrency", prismaBurstBaseline, prismaBurstWrapped, config));
      issues.push(...compareWorkloads("Prisma burst autocommit adoption cost", prismaBurstAutocommitBaseline, prismaBurstWrapped, config));
    } finally {
      await disconnectPrismaProbe(prismaProbe);
    }

    const targetAutocommitBaseline = await runWorkload(pool, config, {
      concurrency: Math.min(config.targetConcurrency, config.poolSize),
      label: "target autocommit baseline",
      mode: "autocommit",
      requests: config.measuredRequests,
    });
    const targetBaseline = await runWorkload(pool, config, {
      concurrency: Math.min(config.targetConcurrency, config.poolSize),
      label: "target baseline",
      mode: "baseline",
      requests: config.measuredRequests,
    });
    const targetWrapped = await runWorkload(pool, config, {
      concurrency: Math.min(config.targetConcurrency, config.poolSize),
      label: "target wrapped",
      mode: "wrapped",
      requests: config.measuredRequests,
    });
    const targetWrappedRepeat = await runWorkload(pool, config, {
      concurrency: Math.min(config.targetConcurrency, config.poolSize),
      label: "target wrapped repeat",
      mode: "wrapped",
      requests: config.measuredRequests,
    });
    const burstAutocommitBaseline = await runWorkload(pool, config, {
      concurrency: Math.min(config.burstConcurrency, config.poolSize),
      label: "burst autocommit baseline",
      mode: "autocommit",
      requests: config.measuredRequests,
    });
    const burstBaseline = await runWorkload(pool, config, {
      concurrency: Math.min(config.burstConcurrency, config.poolSize),
      label: "burst baseline",
      mode: "baseline",
      requests: config.measuredRequests,
    });
    const burstWrapped = await runWorkload(pool, config, {
      concurrency: Math.min(config.burstConcurrency, config.poolSize),
      label: "burst wrapped",
      mode: "wrapped",
      requests: config.measuredRequests,
    });

    for (const workload of [
      targetAutocommitBaseline,
      targetBaseline,
      targetWrapped,
      targetWrappedRepeat,
      burstAutocommitBaseline,
      burstBaseline,
      burstWrapped,
    ]) {
      reports.push(formatSummary(workload));
    }
    issues.push(...compareWorkloads("target concurrency", targetBaseline, targetWrapped, config));
    issues.push(...compareWorkloads("target autocommit adoption cost", targetAutocommitBaseline, targetWrapped, config));
    issues.push(...compareWorkloads("target repeat", targetBaseline, targetWrappedRepeat, config));
    issues.push(...compareWorkloads("target repeat autocommit adoption cost", targetAutocommitBaseline, targetWrappedRepeat, config));
    issues.push(...compareWorkloads("burst concurrency", burstBaseline, burstWrapped, config));
    issues.push(...compareWorkloads("burst autocommit adoption cost", burstAutocommitBaseline, burstWrapped, config));
  } finally {
    await pool.end();
  }

  const turnoverPool = createPool(config, { max: Math.min(config.targetConcurrency, config.poolSize), maxUses: 1 });
  try {
    const turnover = await runWorkload(turnoverPool, config, {
      concurrency: Math.min(config.targetConcurrency, config.poolSize),
      label: "connection turnover wrapped",
      mode: "wrapped",
      requests: config.turnoverRequests,
    });
    reports.push(formatSummary(turnover));
    issues.push(...turnover.issues);
    if (turnover.errors.length > 0) {
      issues.push(`connection turnover wrapped: ${turnover.errors.length} request errors`);
      if (turnover.errors.some((entry) => isPreparedStatementError(entry.error))) {
        issues.push("connection turnover wrapped: prepared-statement/cached-plan/protocol error seen");
      }
    }
  } finally {
    await turnoverPool.end();
  }

  const prismaTurnoverProbe = createPrismaProbe(config, {
    max: Math.min(config.targetConcurrency, config.poolSize),
    maxUses: 1,
  });
  try {
    const prismaTurnover = await runPrismaWorkload(prismaTurnoverProbe.prisma, config, {
      concurrency: Math.min(config.targetConcurrency, config.poolSize),
      label: "Prisma connection turnover wrapped",
      mode: "wrapped",
      requests: config.turnoverRequests,
    });
    reports.push(formatSummary(prismaTurnover));
    issues.push(...prismaTurnover.issues);
    if (prismaTurnover.errors.length > 0) {
      issues.push(`Prisma connection turnover wrapped: ${prismaTurnover.errors.length} request errors`);
      if (prismaTurnover.errors.some((entry) => isPreparedStatementError(entry.error))) {
        issues.push("Prisma connection turnover wrapped: prepared-statement/cached-plan/protocol error seen");
      }
    }
  } finally {
    await disconnectPrismaProbe(prismaTurnoverProbe);
  }

  if (config.rollbackProbe) {
    issues.push(...await runRollbackDisableProbe(config));
    reports.push("rollback disable-RLS probe restored ENABLE/FORCE ROW LEVEL SECURITY");
    const restoreProbe = createPrismaProbe(config, { max: 1 });
    try {
      issues.push(...assertCleanSample(await timedPrismaWrappedRead(
        restoreProbe.prisma,
        config,
        config.userA,
        "post-rollback-restore Prisma wrapped read",
      )));
    } finally {
      await disconnectPrismaProbe(restoreProbe);
    }
  }

  return { issues, reports };
}

function printUsage() {
  console.error("Usage:");
  console.error(
    "  RLS_CONTEXT_GATE_CONFIRM=staging-only RLS_CONTEXT_GATE_DATABASE_URL='<pooled runtime url>' RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime npm run audit:rls-context",
  );
  console.error("Optional staging setup:");
  console.error(
    "  RLS_CONTEXT_GATE_PREPARE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL='<direct migration-owner url>' ... npm run audit:rls-context",
  );
  console.error("Optional rollback proof:");
  console.error("  RLS_CONTEXT_GATE_ROLLBACK_PROBE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL='<direct migration-owner url>' ... npm run audit:rls-context");
  console.error("Optional evidence artifact:");
  console.error("  RLS_CONTEXT_GATE_EVIDENCE_PATH='rls-context-gate-evidence.json' ... npm run audit:rls-context");
}

async function main() {
  let config;
  try {
    config = parseGateConfig();
  } catch (error) {
    console.error(safeErrorMessage(error));
    printUsage();
    process.exitCode = 2;
    return;
  }

  console.log(`RLS context acceptance gate: ${config.schemaName}.${config.tableName}`);
  console.log(
    `target=${config.targetConcurrency} burst=${config.burstConcurrency} pool=${config.poolSize} requests=${config.measuredRequests} turnover=${config.turnoverRequests}`,
  );
  const startedAt = new Date().toISOString();
  const result = await runAcceptanceGate(config);
  const finishedAt = new Date().toISOString();
  for (const report of result.reports) console.log(report);
  const status = result.issues.length > 0 ? "failed" : "passed";
  const evidence = buildEvidencePayload(config, result, { finishedAt, startedAt, status });
  writeEvidencePayload(config, evidence);
  if (result.issues.length > 0) {
    console.error("RLS context acceptance gate failed.");
    for (const issue of result.issues.slice(0, 40)) console.error(`- ${issue}`);
    if (result.issues.length > 40) console.error(`- ... ${result.issues.length - 40} more issues`);
    process.exitCode = 1;
    return;
  }
  console.log("RLS context acceptance gate passed for the synthetic staging canary.");
  console.log("Route-level happy-path tests and per-table policy tests are still required before enabling production RLS.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}
