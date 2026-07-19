#!/usr/bin/env node
import { chmodSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { assertReviewedPostgresConnectionParameters } from "./postgres-url-safety.mjs";

const { Client, Pool } = pg;

export const MIN_ACCEPTANCE_REQUESTS = 500;
const DEFAULT_SCHEMA = "grainline_rls_canary";
const DEFAULT_TABLE = "context_canary";
const DEFAULT_RUN_CLAIM_TABLE = "context_gate_run_claim";
const DEFAULT_POLICY = "context_canary_select";
const DEFAULT_RPC_FUNCTION = "context_canary_rpc";
const DEFAULT_USER_A = "rls-canary-user-a";
const DEFAULT_USER_B = "rls-canary-user-b";
const DEFAULT_EMPTY_OWNER_USER = "";
const DEFAULT_TARGET_CONCURRENCY = 8;
const DEFAULT_POOL_SIZE = 8;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_TIMEOUT_MS = 35_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 5_000;
const LOCALITY_RTT_WARMUP_QUERIES = 5;
const LOCALITY_RTT_MEASURED_QUERIES = 25;
const PRISMA_APP_POOL_SIZE = 10;
const PREPARED_SELECT_NAME = "rls_context_gate_canary_select_v1";
const CONFIRMATION_VALUE = "staging-only";
const LOCALITY_CONFIRMATIONS = new Set(["diagnostic-only", "production-runtime"]);
const DATABASE_URL_ASSIGNMENT_PATTERN =
  /["']?\b(?:DATABASE_URL|DIRECT_URL|RLS_CONTEXT_GATE_(?:DATABASE_URL|ADMIN_DATABASE_URL))\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const PASSWORD_ASSIGNMENT_PATTERN = /["']?\b(?:PGPASSWORD|password|pass|pwd)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const USERINFO_PATTERN = /\b[^\s:@/]+:[^\s@/]+@(?=[A-Za-z0-9.-]+\b)/g;

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

function parseLocalityConfirmation(env) {
  const value = required(env.RLS_CONTEXT_GATE_LOCALITY_CONFIRM, "RLS_CONTEXT_GATE_LOCALITY_CONFIRM");
  if (!LOCALITY_CONFIRMATIONS.has(value)) {
    throw new Error("RLS_CONTEXT_GATE_LOCALITY_CONFIRM must be diagnostic-only or production-runtime");
  }
  return value;
}

function parseRegion(value, name) {
  const region = required(value, name);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(region)) {
    throw new Error(`${name} must be a bounded lowercase region identifier`);
  }
  return region;
}

function parseProviderIdentity(value, name, pattern) {
  const identity = required(value, name);
  if (identity.length > 128 || !pattern.test(identity)) {
    throw new Error(`${name} is not a valid provider-owned identity`);
  }
  return identity;
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

function containsEncodedUserContext(value) {
  let decoded = String(value);
  for (let pass = 0; pass < 3; pass += 1) {
    if (decoded.toLowerCase().includes("app.user_id")) return true;
    try {
      const next = decodeURIComponent(decoded.replaceAll("+", " "));
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.toLowerCase().includes("app.user_id");
}

function assertRuntimeUrlDoesNotPreseedUserContext(parsed) {
  for (const [name, value] of parsed.searchParams) {
    if (containsEncodedUserContext(name) || containsEncodedUserContext(value)) {
      throw new Error(
        "RLS_CONTEXT_GATE_DATABASE_URL must not pre-seed app.user_id through URL query parameters or options",
      );
    }
  }
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
  assertRuntimeUrlDoesNotPreseedUserContext(parsed);
  assertReviewedPostgresConnectionParameters(
    parsed,
    "RLS_CONTEXT_GATE_DATABASE_URL",
  );
  if (!parsed.hostname.includes("-pooler.") && !parseBooleanFlag(env, "RLS_CONTEXT_GATE_ALLOW_NON_POOLER")) {
    throw new Error(
      "RLS_CONTEXT_GATE_DATABASE_URL must be the pooled runtime endpoint; set RLS_CONTEXT_GATE_ALLOW_NON_POOLER=1 only for non-acceptance development checks",
    );
  }
  return parsed;
}

function parseExpectedDatabaseName(value) {
  const databaseName = required(value, "RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME");
  if (databaseName.length > 63 || !/^[A-Za-z0-9_-]+$/.test(databaseName)) {
    throw new Error("RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME must be a bounded PostgreSQL database name");
  }
  return databaseName;
}

function parseExpectedNeonEndpointId(value) {
  return parseProviderIdentity(
    value,
    "RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID",
    /^ep-[a-z0-9-]{1,60}$/,
  );
}

function neonDatabaseIdentity(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const match = parsed.hostname.toLowerCase().match(
    /^(ep-[a-z0-9-]+?)(-pooler)?\.([a-z0-9-]+)\.([a-z0-9-]+)\.neon\.tech$/,
  );
  if (!match) return null;
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  if (pathSegments.length !== 1) return null;
  return {
    databaseName: decodeURIComponent(pathSegments[0]),
    endpointId: match[1],
    pooled: Boolean(match[2]),
    region: `${match[3]}.${match[4]}`,
  };
}

function assertExpectedDatabaseIdentity(identity, expected, name) {
  if (!identity) {
    throw new Error(`${name} must use a parseable Neon endpoint hostname and one database path segment`);
  }
  if (identity.endpointId !== expected.endpointId) {
    throw new Error(`${name} endpoint id does not match the reviewed staging endpoint`);
  }
  if (identity.databaseName !== expected.databaseName) {
    throw new Error(`${name} database name does not match the reviewed staging database`);
  }
  if (identity.region !== expected.region) {
    throw new Error(`${name} region does not match the reviewed staging database region`);
  }
}

function observedNeonDatabaseRegion(databaseUrl) {
  const identity = neonDatabaseIdentity(databaseUrl);
  return identity?.pooled ? identity.region : null;
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

function rpcFunctionName(config) {
  return assertSafeIdentifier(config.rpcFunctionName ?? DEFAULT_RPC_FUNCTION, "RLS_CONTEXT_GATE_RPC_FUNCTION");
}

function buildRpcFunctionRef(config) {
  return `${quoteIdentifier(config.schemaName)}.${quoteIdentifier(rpcFunctionName(config))}`;
}

function buildRpcFunctionSignature(config) {
  return `${buildRpcFunctionRef(config)}(text)`;
}

function buildRpcFunctionIdentity(config) {
  return `${config.schemaName}.${rpcFunctionName(config)}(text)`;
}

function buildRpcSelectSql(config) {
  return `SELECT id, "userId", marker FROM ${buildRpcFunctionRef(config)}($1::text)`;
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

function redactEvidenceText(value) {
  return String(value)
    .replace(DATABASE_URL_ASSIGNMENT_PATTERN, "[redacted-database-url]")
    .replace(PASSWORD_ASSIGNMENT_PATTERN, "[redacted-password]")
    .replace(POSTGRES_URL_PATTERN, "[redacted-postgres-url]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted-credentials]@")
    .replace(USERINFO_PATTERN, "[redacted-credentials]@");
}

function redactEvidenceMessages(messages) {
  return messages.map((message) => redactEvidenceText(message));
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
  const parsedDatabaseUrl = validateDatabaseUrl(databaseUrl, env);

  const localityConfirmation = parseLocalityConfirmation(env);
  const expectedExecutionRegion = parseRegion(
    env.RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION,
    "RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION",
  );
  const expectedDatabaseRegion = parseRegion(
    env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION,
    "RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION",
  );
  const expectedDatabaseEndpointId = parseExpectedNeonEndpointId(
    env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID,
  );
  const expectedDatabaseName = parseExpectedDatabaseName(
    env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME,
  );
  const runtimeDatabaseIdentity = neonDatabaseIdentity(databaseUrl);
  const allowNonPooler = parseBooleanFlag(env, "RLS_CONTEXT_GATE_ALLOW_NON_POOLER");
  if (!allowNonPooler) {
    assertExpectedDatabaseIdentity(
      runtimeDatabaseIdentity,
      {
        databaseName: expectedDatabaseName,
        endpointId: expectedDatabaseEndpointId,
        region: expectedDatabaseRegion,
      },
      "RLS_CONTEXT_GATE_DATABASE_URL",
    );
    if (!runtimeDatabaseIdentity?.pooled || !parsedDatabaseUrl.hostname.includes("-pooler.")) {
      throw new Error("RLS_CONTEXT_GATE_DATABASE_URL must use the reviewed pooled Neon endpoint");
    }
  }
  const observedDatabaseRegion = observedNeonDatabaseRegion(databaseUrl);
  let observedExecutionRegion = env.VERCEL_REGION || null;
  let providerCommitSha = null;
  let providerDeploymentId = null;
  if (localityConfirmation === "production-runtime") {
    if (env.VERCEL !== "1") {
      throw new Error("RLS_CONTEXT_GATE_LOCALITY_CONFIRM=production-runtime requires provider-owned VERCEL=1");
    }
    observedExecutionRegion = parseRegion(env.VERCEL_REGION, "VERCEL_REGION");
    if (observedExecutionRegion !== expectedExecutionRegion) {
      throw new Error(
        `VERCEL_REGION=${observedExecutionRegion} does not match RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION=${expectedExecutionRegion}`,
      );
    }
    if (!observedDatabaseRegion) {
      throw new Error(
        "RLS_CONTEXT_GATE_LOCALITY_CONFIRM=production-runtime requires a parseable Neon pooled hostname containing the database region",
      );
    }
    if (observedDatabaseRegion !== expectedDatabaseRegion) {
      throw new Error(
        `observed database region ${observedDatabaseRegion} does not match RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION=${expectedDatabaseRegion}`,
      );
    }
    providerCommitSha = parseProviderIdentity(
      env.VERCEL_GIT_COMMIT_SHA,
      "VERCEL_GIT_COMMIT_SHA",
      /^[a-f0-9]{7,64}$/i,
    );
    providerDeploymentId = parseProviderIdentity(
      env.VERCEL_DEPLOYMENT_ID,
      "VERCEL_DEPLOYMENT_ID",
      /^[A-Za-z0-9._:-]+$/,
    );
  }

  const runtimeRole = assertSafeIdentifier(
    required(env.RLS_CONTEXT_GATE_RUNTIME_ROLE, "RLS_CONTEXT_GATE_RUNTIME_ROLE"),
    "RLS_CONTEXT_GATE_RUNTIME_ROLE",
  );
  const schemaName = assertSafeIdentifier(env.RLS_CONTEXT_GATE_SCHEMA ?? DEFAULT_SCHEMA, "RLS_CONTEXT_GATE_SCHEMA");
  const tableName = assertSafeIdentifier(env.RLS_CONTEXT_GATE_TABLE ?? DEFAULT_TABLE, "RLS_CONTEXT_GATE_TABLE");
  const runClaimTableName = assertSafeIdentifier(
    env.RLS_CONTEXT_GATE_RUN_CLAIM_TABLE ?? DEFAULT_RUN_CLAIM_TABLE,
    "RLS_CONTEXT_GATE_RUN_CLAIM_TABLE",
  );
  const policyName = assertSafeIdentifier(env.RLS_CONTEXT_GATE_POLICY ?? DEFAULT_POLICY, "RLS_CONTEXT_GATE_POLICY");
  const rpcFunction = assertSafeIdentifier(
    env.RLS_CONTEXT_GATE_RPC_FUNCTION ?? DEFAULT_RPC_FUNCTION,
    "RLS_CONTEXT_GATE_RPC_FUNCTION",
  );
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
  const poolSize = parsePositiveInt(env, "RLS_CONTEXT_GATE_POOL_SIZE", Math.max(DEFAULT_POOL_SIZE, burstConcurrency), {
    min: 1,
    max: 512,
  });
  if (poolSize < burstConcurrency) {
    throw new Error(
      "RLS_CONTEXT_GATE_POOL_SIZE must be at least RLS_CONTEXT_GATE_BURST_CONCURRENCY so the burst workload is not silently capped",
    );
  }
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
  const teardownRpcProbe = parseBooleanFlag(env, "RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE");
  if (teardownRpcProbe && (prepare || rollbackProbe)) {
    throw new Error(
      "RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE cannot be combined with RLS_CONTEXT_GATE_PREPARE or RLS_CONTEXT_GATE_ROLLBACK_PROBE",
    );
  }
  const adminDatabaseUrl = env.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL;
  if (prepare && !adminDatabaseUrl) {
    throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required when RLS_CONTEXT_GATE_PREPARE=1");
  }
  if (rollbackProbe && !adminDatabaseUrl) {
    throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required when RLS_CONTEXT_GATE_ROLLBACK_PROBE=1");
  }
  if (teardownRpcProbe && !adminDatabaseUrl) {
    throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required when RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE=1");
  }
  if (adminDatabaseUrl) {
    let parsedAdminDatabaseUrl;
    try {
      parsedAdminDatabaseUrl = new URL(adminDatabaseUrl);
    } catch {
      throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL must be a valid PostgreSQL URL");
    }
    if (!/^postgres(?:ql)?:$/.test(parsedAdminDatabaseUrl.protocol)) {
      throw new Error(
        "RLS_CONTEXT_GATE_ADMIN_DATABASE_URL must use the postgres/postgresql protocol",
      );
    }
    assertReviewedPostgresConnectionParameters(
      parsedAdminDatabaseUrl,
      "RLS_CONTEXT_GATE_ADMIN_DATABASE_URL",
    );
    const adminIdentity = neonDatabaseIdentity(adminDatabaseUrl);
    if (!allowNonPooler) {
      assertExpectedDatabaseIdentity(
        adminIdentity,
        {
          databaseName: expectedDatabaseName,
          endpointId: expectedDatabaseEndpointId,
          region: expectedDatabaseRegion,
        },
        "RLS_CONTEXT_GATE_ADMIN_DATABASE_URL",
      );
      if (adminIdentity?.pooled) {
        throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL must use the reviewed direct Neon endpoint");
      }
    }
    if (
      runtimeDatabaseIdentity
      && adminIdentity
      && (
        runtimeDatabaseIdentity.endpointId !== adminIdentity.endpointId
        || runtimeDatabaseIdentity.databaseName !== adminIdentity.databaseName
        || runtimeDatabaseIdentity.region !== adminIdentity.region
      )
    ) {
      throw new Error("runtime and admin database URLs must target the same Neon endpoint, region, and database");
    }
  }

  return {
    adminDatabaseUrl,
    burstConcurrency,
    connectionTimeoutMs,
    databaseUrl,
    evidencePath: optionalEvidencePath(env),
    expectedDatabaseEndpointId,
    expectedDatabaseName,
    expectedDatabaseRegion,
    expectedExecutionRegion,
    localityConfirmation,
    measuredRequests,
    observedDatabaseRegion,
    observedExecutionRegion,
    policyName,
    poolSize,
    prepare,
    providerCommitSha,
    providerDeploymentId,
    queryTimeoutMs,
    rollbackProbe,
    rpcFunctionName: rpcFunction,
    runClaimTableName,
    runtimeRole,
    schemaName,
    statementTimeoutMs,
    tableName,
    targetConcurrency,
    teardownRpcProbe,
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
  const gatePassed = result.issues.length === 0;
  const suppliedStatusMatches = (status === "passed") === gatePassed;
  const rawIssues = suppliedStatusMatches
    ? result.issues
    : [
        ...result.issues,
        "evidence status mismatch: caller-supplied status did not match the gate result",
      ];
  const issues = redactEvidenceMessages(rawIssues);
  const reports = redactEvidenceMessages(result.reports);
  const effectivePassed = gatePassed && suppliedStatusMatches;
  const runKind = config.prepare || config.rollbackProbe || config.teardownRpcProbe ? "setup" : "repeat";
  const evidenceStatus = runKind === "setup"
    ? (effectivePassed ? "setup_passed" : "setup_failed")
    : config.localityConfirmation === "diagnostic-only"
      ? (effectivePassed ? "diagnostic_passed" : "diagnostic_failed")
      : (effectivePassed ? "runtime_candidate_passed" : "runtime_candidate_failed");
  const providerRuntimeMetadataPresent = config.localityConfirmation === "production-runtime"
    && config.observedExecutionRegion === config.expectedExecutionRegion
    && config.observedDatabaseRegion === config.expectedDatabaseRegion
    && Boolean(config.providerCommitSha)
    && Boolean(config.providerDeploymentId);
  const queryRttProxyComplete = result.locality?.queryRttProxy?.measuredQueries === LOCALITY_RTT_MEASURED_QUERIES;
  const runtimeEvidenceCandidate = runKind === "repeat"
    && effectivePassed
    && providerRuntimeMetadataPresent
    && queryRttProxyComplete;

  return {
    generatedAt: finishedAt,
    run: {
      ciRunId: env.RLS_CONTEXT_GATE_CI_RUN_ID || env.GITHUB_RUN_ID || null,
      commitSha: config.providerCommitSha || env.RLS_CONTEXT_GATE_COMMIT_SHA || env.GITHUB_SHA || null,
      deploymentId: config.providerDeploymentId,
      finishedAt,
      kind: runKind,
      startedAt,
      status: evidenceStatus,
    },
    locality: {
      acceptanceEligible: false,
      confirmation: config.localityConfirmation,
      expectedDatabaseRegion: config.expectedDatabaseRegion,
      expectedExecutionRegion: config.expectedExecutionRegion,
      observedDatabaseRegion: config.observedDatabaseRegion,
      observedExecutionRegion: config.observedExecutionRegion,
      providerRuntimeMetadataPresent,
      queryRttProxy: result.locality?.queryRttProxy ?? null,
      requiresExternalDeploymentAttestation: true,
      runtimeEvidenceCandidate,
    },
    database: {
      databaseHost: sanitizedDatabaseHost(config.databaseUrl),
      expectedDatabaseEndpointId: config.expectedDatabaseEndpointId,
      expectedDatabaseName: config.expectedDatabaseName,
      policyName: config.policyName,
      rpcFunctionName: rpcFunctionName(config),
      runtimeRole: config.runtimeRole,
      schemaName: config.schemaName,
      tableName: config.tableName,
    },
    config: {
      burstConcurrency: config.burstConcurrency,
      connectionTimeoutMs: config.connectionTimeoutMs,
      measuredRequests: config.measuredRequests,
      poolSize: config.poolSize,
      prismaPoolSize: PRISMA_APP_POOL_SIZE,
      prismaPoolTimingAvailable: false,
      prepare: config.prepare,
      queryTimeoutMs: config.queryTimeoutMs,
      rollbackProbe: config.rollbackProbe,
      rpcCandidatePattern: {
        burstWorkers: config.burstConcurrency,
        evidenceScope: "synthetic-transport-only-not-saved-search-policy-proof",
        execution: "one-statement-security-invoker-function",
        persistsBetweenProviderRuntimeRepeats: true,
        prismaPoolSize: PRISMA_APP_POOL_SIZE,
      },
      statementTimeoutMs: config.statementTimeoutMs,
      targetConcurrency: config.targetConcurrency,
      teardownRpcProbe: Boolean(config.teardownRpcProbe),
      transactionTimeoutMs: config.transactionTimeoutMs,
      turnoverRequests: config.turnoverRequests,
      warmupRequests: config.warmupRequests,
    },
    result: {
      issueCount: issues.length,
      issues,
      reports,
    },
  };
}

function writeEvidencePayload(config, payload) {
  if (!config.evidencePath) return;
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(config.evidencePath, 0o600);
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
  let inTransaction = false;
  try {
    const roleResult = await client.query(
      "SELECT current_user AS current_user_name, session_user AS session_user_name, current_database() AS database_name",
    );
    const currentUser = roleResult.rows[0]?.current_user_name;
    if (currentUser === config.runtimeRole) {
      throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL must not authenticate as the runtime role");
    }
    if (roleResult.rows[0]?.database_name !== config.expectedDatabaseName) {
      throw new Error(
        "RLS_CONTEXT_GATE_ADMIN_DATABASE_URL current database does not match the reviewed staging database",
      );
    }

    const tableRef = buildTableRef(config);
    const rpcFunctionRef = buildRpcFunctionRef(config);
    const rpcFunctionSignature = buildRpcFunctionSignature(config);
    const runClaimTableRef = `${quoteIdentifier(config.schemaName)}.${quoteIdentifier(config.runClaimTableName)}`;
    await client.query("BEGIN");
    inTransaction = true;
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
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${runClaimTableRef} (
         run_id text NOT NULL,
         run_slot smallint NOT NULL CHECK (run_slot IN (1, 2)),
         deployment_id text NOT NULL,
         commit_sha text NOT NULL,
         status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed')),
         claimed_at timestamptz NOT NULL DEFAULT now(),
         finished_at timestamptz,
         evidence jsonb,
         PRIMARY KEY (run_id, run_slot)
       )`,
    );
    await client.query(`ALTER TABLE ${runClaimTableRef} ADD COLUMN IF NOT EXISTS evidence jsonb`);
    await client.query(`REVOKE ALL ON TABLE ${runClaimTableRef} FROM PUBLIC`);
    await client.query(`GRANT USAGE ON SCHEMA ${quoteIdentifier(config.schemaName)} TO ${quoteIdentifier(config.runtimeRole)}`);
    await client.query(`GRANT SELECT ON TABLE ${tableRef} TO ${quoteIdentifier(config.runtimeRole)}`);
    await client.query(`GRANT INSERT, SELECT ON TABLE ${runClaimTableRef} TO ${quoteIdentifier(config.runtimeRole)}`);
    await client.query(
      `GRANT UPDATE (status, finished_at, evidence) ON TABLE ${runClaimTableRef} TO ${quoteIdentifier(config.runtimeRole)}`,
    );
    await client.query(`DROP FUNCTION IF EXISTS ${rpcFunctionSignature}`);
    await client.query(
      `CREATE FUNCTION ${rpcFunctionRef}(p_user_id text)
       RETURNS TABLE(id text, "userId" text, marker text)
       LANGUAGE plpgsql
       VOLATILE
       PARALLEL UNSAFE
       SECURITY INVOKER
       SET search_path = pg_catalog
       AS $function$
       BEGIN
         IF p_user_id IS NULL OR p_user_id = '' THEN
           RAISE EXCEPTION 'synthetic canary user id is required' USING ERRCODE = '22023';
         END IF;
         PERFORM pg_catalog.set_config('app.user_id', p_user_id, true);
         RETURN QUERY
           SELECT canary.id, canary."userId", canary.marker
           FROM ${tableRef} AS canary
           ORDER BY canary.id;
       END
       $function$`,
    );
    await client.query(`REVOKE ALL ON FUNCTION ${rpcFunctionSignature} FROM PUBLIC`);
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${rpcFunctionSignature} TO ${quoteIdentifier(config.runtimeRole)}`,
    );
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
    await client.query("COMMIT");
    inTransaction = false;
    return {
      currentUser,
      rowsPrepared: rows.length,
      sessionUser: roleResult.rows[0]?.session_user_name,
    };
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export async function teardownRpcCanary(config) {
  if (!config.adminDatabaseUrl) {
    throw new Error("RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required for the owner-only RPC canary teardown");
  }
  const client = createClient(config.adminDatabaseUrl, config);
  await client.connect();
  let inTransaction = false;
  try {
    const roleResult = await client.query(
      "SELECT current_user AS current_user_name, current_database() AS database_name",
    );
    const currentUser = roleResult.rows[0]?.current_user_name;
    if (currentUser === config.runtimeRole) {
      throw new Error("RPC canary teardown must not authenticate as the runtime role");
    }
    if (roleResult.rows[0]?.database_name !== config.expectedDatabaseName) {
      throw new Error(
        "RPC canary teardown current database does not match the reviewed staging database",
      );
    }
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(`DROP FUNCTION IF EXISTS ${buildRpcFunctionSignature(config)}`);
    const inside = await client.query(
      "SELECT to_regprocedure($1) IS NULL AS function_absent",
      [buildRpcFunctionIdentity(config)],
    );
    if (inside.rows[0]?.function_absent !== true) {
      throw new Error("RPC canary function remained visible inside the owner-only teardown transaction");
    }
    await client.query("COMMIT");
    inTransaction = false;
    const after = await client.query(
      "SELECT to_regprocedure($1) IS NULL AS function_absent",
      [buildRpcFunctionIdentity(config)],
    );
    if (after.rows[0]?.function_absent !== true) {
      throw new Error("RPC canary function remained visible after the owner-only teardown committed");
    }
    return { currentUser, functionAbsent: true };
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export async function claimProviderRuntimeRunSlot(config, { runId, runSlot }) {
  if (
    config.localityConfirmation !== "production-runtime"
    || config.prepare
    || config.rollbackProbe
    || config.teardownRpcProbe
  ) {
    throw new Error("provider-runtime run slots may only be claimed for repeat-mode production-runtime gates");
  }
  if (!/^[A-Za-z0-9._:-]{32,128}$/.test(runId)) {
    throw new Error("RLS_CONTEXT_GATE_RUN_ID must be a bounded opaque run identifier");
  }
  if (runSlot !== 1 && runSlot !== 2) {
    throw new Error("RLS context gate run slot must be 1 or 2");
  }

  const client = createClient(config.databaseUrl, config);
  await client.connect();
  try {
    const connection = await client.query(
      "SELECT current_user AS current_user_name, session_user AS session_user_name, current_database() AS database_name",
    );
    if (
      connection.rows[0]?.current_user_name !== config.runtimeRole
      || connection.rows[0]?.session_user_name !== config.runtimeRole
      || connection.rows[0]?.database_name !== config.expectedDatabaseName
    ) {
      throw new Error(
        "provider-runtime slot connection does not match the reviewed runtime role and database",
      );
    }
    const runClaimTableRef = `${quoteIdentifier(config.schemaName)}.${quoteIdentifier(config.runClaimTableName)}`;
    const claimed = await client.query(
      `INSERT INTO ${runClaimTableRef} (run_id, run_slot, deployment_id, commit_sha)
       SELECT $1, $2::smallint, $3, $4
       WHERE $2::smallint = 1::smallint
          OR EXISTS (
            SELECT 1
            FROM ${runClaimTableRef}
            WHERE run_id = $1
              AND run_slot = 1
              AND status = 'passed'
              AND deployment_id = $3
              AND commit_sha = $4
          )
       ON CONFLICT (run_id, run_slot) DO NOTHING
       RETURNING run_slot`,
      [runId, runSlot, config.providerDeploymentId, config.providerCommitSha],
    );
    return claimed.rowCount === 1;
  } finally {
    await client.end();
  }
}

export async function completeProviderRuntimeRunSlot(config, { evidence, runId, runSlot, succeeded }) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("RLS context gate sanitized evidence object is required");
  }
  const serializedEvidence = JSON.stringify(evidence);
  if (Buffer.byteLength(serializedEvidence, "utf8") > 256 * 1024) {
    throw new Error("RLS context gate sanitized evidence exceeds 256 KiB");
  }
  const client = createClient(config.databaseUrl, config);
  await client.connect();
  try {
    const runClaimTableRef = `${quoteIdentifier(config.schemaName)}.${quoteIdentifier(config.runClaimTableName)}`;
    const completed = await client.query(
      `UPDATE ${runClaimTableRef}
       SET status = $3, finished_at = now(), evidence = $6::jsonb
       WHERE run_id = $1
         AND run_slot = $2
         AND status = 'running'
         AND deployment_id = $4
         AND commit_sha = $5
       RETURNING run_slot`,
      [
        runId,
        runSlot,
        succeeded ? "passed" : "failed",
        config.providerDeploymentId,
        config.providerCommitSha,
        serializedEvidence,
      ],
    );
    if (completed.rowCount !== 1) {
      throw new Error("RLS context gate run slot was not in the running state");
    }
  } finally {
    await client.end();
  }
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

async function inspectRpcCanary(client, config) {
  const result = await client.query(
    `SELECT target.oid IS NOT NULL AS function_exists,
            n.nspname AS schema_name,
            p.proname AS function_name,
            pg_get_userbyid(p.proowner) AS owner_name,
            p.prosecdef AS security_definer,
            p.proleakproof AS leakproof,
            p.provolatile AS volatility,
            p.proparallel AS parallel_safety,
            p.prokind AS function_kind,
            l.lanname AS language_name,
            p.proconfig AS function_config,
            pg_get_function_identity_arguments(p.oid) AS identity_arguments,
            pg_get_function_result(p.oid) AS result_type,
            EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS function_acl
              WHERE function_acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)
                AND function_acl.privilege_type = 'EXECUTE'
            ) AS runtime_execute,
            EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS function_acl
              WHERE function_acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)
                AND function_acl.privilege_type = 'EXECUTE'
                AND function_acl.is_grantable
            ) AS runtime_execute_grant_option,
            EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS function_acl
              WHERE function_acl.grantee = 0
                AND function_acl.privilege_type = 'EXECUTE'
            ) AS public_execute,
            EXISTS (
              SELECT 1
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS function_acl
              WHERE function_acl.grantee = 0
                AND function_acl.privilege_type = 'EXECUTE'
                AND function_acl.is_grantable
            ) AS public_execute_grant_option,
            ARRAY(
              SELECT privilege_role.rolname
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS function_acl
              JOIN pg_roles AS privilege_role ON privilege_role.oid = function_acl.grantee
              WHERE function_acl.grantee <> p.proowner
                AND function_acl.grantee <> (SELECT oid FROM pg_roles WHERE rolname = $2)
              ORDER BY privilege_role.rolname
            )::text[] AS unexpected_acl_roles,
            ARRAY(
              SELECT privilege_role.rolname
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS function_acl
              JOIN pg_roles AS privilege_role ON privilege_role.oid = function_acl.grantee
              WHERE function_acl.grantee <> p.proowner
                AND function_acl.grantee <> (SELECT oid FROM pg_roles WHERE rolname = $2)
                AND function_acl.is_grantable
              ORDER BY privilege_role.rolname
            )::text[] AS unexpected_grant_option_roles,
            has_schema_privilege($2, $3, 'USAGE') AS runtime_schema_usage,
            has_table_privilege($2, $4, 'SELECT') AS runtime_table_select,
            has_table_privilege($2, $4, 'INSERT') AS runtime_table_insert,
            has_table_privilege($2, $4, 'UPDATE') AS runtime_table_update,
            has_table_privilege($2, $4, 'DELETE') AS runtime_table_delete
       FROM (SELECT to_regprocedure($1) AS oid) AS target
       LEFT JOIN pg_proc AS p ON p.oid = target.oid
       LEFT JOIN pg_namespace AS n ON n.oid = p.pronamespace
       LEFT JOIN pg_language AS l ON l.oid = p.prolang`,
    [
      buildRpcFunctionIdentity(config),
      config.runtimeRole,
      config.schemaName,
      `${config.schemaName}.${config.tableName}`,
    ],
  );
  const row = result.rows[0] ?? {};
  const issues = [];
  if (row.function_exists !== true) {
    issues.push("synthetic one-statement RPC function is missing; rerun the owner-only setup before provider-runtime evidence");
    return { issues, ready: false, row };
  }
  if (row.schema_name !== config.schemaName) issues.push("synthetic RPC function resolved in the wrong schema");
  if (row.function_name !== rpcFunctionName(config)) issues.push("synthetic RPC function resolved with the wrong name");
  if (!row.owner_name || row.owner_name === config.runtimeRole) {
    issues.push("synthetic RPC function must be owned by the setup role, never the runtime role");
  }
  if (row.security_definer !== false) issues.push("synthetic RPC function must remain SECURITY INVOKER");
  if (row.leakproof !== false) issues.push("synthetic RPC function must not be LEAKPROOF");
  if (row.volatility !== "v") issues.push("synthetic RPC function must remain VOLATILE");
  if (row.parallel_safety !== "u") issues.push("synthetic RPC function must remain PARALLEL UNSAFE");
  if (row.function_kind !== "f") issues.push("synthetic RPC function must remain an ordinary function");
  if (row.language_name !== "plpgsql") issues.push("synthetic RPC function must remain PL/pgSQL");
  if (!exactStringArray(row.function_config, ["search_path=pg_catalog"])) {
    issues.push("synthetic RPC function must pin search_path=pg_catalog");
  }
  if (row.identity_arguments !== "p_user_id text") {
    issues.push(`synthetic RPC function arguments are ${row.identity_arguments ?? "missing"}, expected p_user_id text`);
  }
  if (row.result_type !== 'TABLE(id text, "userId" text, marker text)') {
    issues.push("synthetic RPC function result shape changed");
  }
  if (row.runtime_execute !== true) issues.push("runtime role lacks EXECUTE on the synthetic RPC function");
  if (row.runtime_execute_grant_option !== false) {
    issues.push("runtime EXECUTE on the synthetic RPC function must not be grantable");
  }
  if (row.public_execute !== false) issues.push("PUBLIC must not retain EXECUTE on the synthetic RPC function");
  if (row.public_execute_grant_option !== false) {
    issues.push("PUBLIC must not retain grantable EXECUTE on the synthetic RPC function");
  }
  if (!exactStringArray(row.unexpected_acl_roles, [])) {
    issues.push("synthetic RPC function grants privileges to an unexpected role");
  }
  if (!exactStringArray(row.unexpected_grant_option_roles, [])) {
    issues.push("synthetic RPC function grants privileges with grant option to an unexpected role");
  }
  if (row.runtime_schema_usage !== true) issues.push("runtime role lacks USAGE on the synthetic canary schema");
  if (row.runtime_table_select !== true) issues.push("runtime role lacks SELECT on the synthetic canary table");
  if (row.runtime_table_insert || row.runtime_table_update || row.runtime_table_delete) {
    issues.push("runtime role has unexpected write privileges on the synthetic canary table");
  }
  return { issues, ready: issues.length === 0, row };
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
    if (row.database_name !== config.expectedDatabaseName) {
      issues.push("runtime connection database does not match the reviewed staging database");
    }
    if (normalizeSetting(row.app_user_id) !== "") {
      issues.push("runtime connection starts with app.user_id already set");
    }
    const rpc = await inspectRpcCanary(client, config);
    issues.push(...rpc.issues);
    return { issues, row, rpc };
  } finally {
    client.release();
  }
}

async function measureLocalityQueryRttProxy(pool) {
  const client = await pool.connect();
  try {
    for (let index = 0; index < LOCALITY_RTT_WARMUP_QUERIES; index += 1) {
      await client.query("SELECT 1 AS locality_probe");
    }

    const samples = [];
    for (let index = 0; index < LOCALITY_RTT_MEASURED_QUERIES; index += 1) {
      const startedAt = performance.now();
      await client.query("SELECT 1 AS locality_probe");
      samples.push(performance.now() - startedAt);
    }

    return {
      kind: "warm-checked-out-sequential-select-1",
      measuredQueries: LOCALITY_RTT_MEASURED_QUERIES,
      metricsMs: {
        ...summarizeMetrics(samples),
        max: Math.max(...samples),
        min: Math.min(...samples),
      },
      warmupQueries: LOCALITY_RTT_WARMUP_QUERIES,
    };
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
    const context = await client.query(
      "SELECT set_config('app.user_id', $1, true) AS user_id",
      [userId],
    );
    const rows = await client.query(selectQuery(config, prepared));
    await client.query("COMMIT");
    inTransaction = false;
    const finishedAt = performance.now();
    const issues = [];
    if (context.rows[0]?.user_id !== userId) {
      issues.push(`${label}: set_config returned ${context.rows[0]?.user_id ?? "null"}, expected ${userId}`);
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

async function timedPrismaOneStatementDeniedRead(
  prisma,
  config,
  label = "prisma one-statement autocommit denied read",
) {
  const startedAt = performance.now();
  try {
    const rows = await prisma.$queryRawUnsafe(buildSelectSql(config));
    const finishedAt = performance.now();
    const issues = [];
    if (rows.length !== 0) {
      issues.push(`${label}: unset app.user_id returned ${rows.length} rows`);
    }
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, error, label, startedAt });
  }
}

async function timedPrismaRpcRead(prisma, config, userId, label = "prisma one-statement RPC read") {
  const startedAt = performance.now();
  try {
    const rows = await prisma.$queryRawUnsafe(buildRpcSelectSql(config), userId);
    const finishedAt = performance.now();
    const issues = collectRowIssues(config, rows, userId, label);
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, finishedAt, issues, label, startedAt });
  } catch (error) {
    return sample({ acquiredAt: startedAt, acquireStartedAt: startedAt, error, label, startedAt });
  }
}

async function timedPrismaRpcCleanupProbe(prisma, config) {
  const label = "prisma one-statement RPC cleanup probe";
  const startedAt = performance.now();
  try {
    const insideRows = await prisma.$queryRawUnsafe(buildRpcSelectSql(config), config.userA);
    const settingAfter = await prisma.$queryRawUnsafe("SELECT current_setting('app.user_id', true) AS user_id");
    const rowsAfter = await prisma.$queryRawUnsafe(buildSelectSql(config));
    const finishedAt = performance.now();
    const issues = collectRowIssues(config, insideRows, config.userA, `${label} RPC result`);
    if (normalizeSetting(settingAfter[0]?.user_id) !== "") {
      issues.push(`${label}: app.user_id survived RPC statement completion`);
    }
    if (rowsAfter.length !== 0) {
      issues.push(`${label}: protected rows visible after RPC statement completion`);
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
        const context = await tx.$queryRawUnsafe("SELECT set_config('app.user_id', $1, true) AS user_id", userId);
        const rows = await tx.$queryRawUnsafe(buildSelectSql(config));
        return { context, rows };
      },
      { timeout: config.transactionTimeoutMs, maxWait: config.connectionTimeoutMs },
    );
    const finishedAt = performance.now();
    const issues = [];
    if (result.context[0]?.user_id !== userId) {
      issues.push(`${label}: set_config returned ${result.context[0]?.user_id ?? "null"}, expected ${userId}`);
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
        case "autocommit-select":
          samples.push(await timedPrismaOneStatementDeniedRead(prisma, config, label));
          break;
        case "rpc": {
          const userId = index % 2 === 0 ? config.userA : config.userB;
          samples.push(await timedPrismaRpcRead(prisma, config, userId, label));
          break;
        }
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
  return summarizeWorkload(label, samples, { poolTimingAvailable: false });
}

async function runRollbackDisableProbe(config) {
  const tableRef = buildTableRef(config);
  const admin = createClient(config.adminDatabaseUrl, config);
  await admin.connect();
  let adminInTransaction = false;
  try {
    const issues = [];
    const connection = await admin.query(
      "SELECT current_user AS current_user_name, current_database() AS database_name",
    );
    if (
      connection.rows[0]?.current_user_name === config.runtimeRole
      || connection.rows[0]?.database_name !== config.expectedDatabaseName
    ) {
      throw new Error(
        "rollback probe connection does not match the reviewed owner role and database",
      );
    }
    await admin.query("BEGIN");
    adminInTransaction = true;
    await admin.query(`DROP FUNCTION ${buildRpcFunctionSignature(config)}`);
    const absentInsideRollback = await admin.query(
      "SELECT to_regprocedure($1) IS NULL AS function_absent",
      [buildRpcFunctionIdentity(config)],
    );
    if (absentInsideRollback.rows[0]?.function_absent !== true) {
      issues.push("rollback probe: synthetic RPC function remained visible after DROP inside the transaction");
    }
    await admin.query("ROLLBACK");
    adminInTransaction = false;
    const restoredAfterRollback = await admin.query(
      "SELECT to_regprocedure($1) IS NOT NULL AS function_present",
      [buildRpcFunctionIdentity(config)],
    );
    if (restoredAfterRollback.rows[0]?.function_present !== true) {
      issues.push("rollback probe: synthetic RPC function was not restored after owner transaction rollback");
    }

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
    if (adminInTransaction) await admin.query("ROLLBACK").catch(() => {});
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

function summarizeWorkload(label, samples, { poolTimingAvailable = true } = {}) {
  const successes = samples.filter((entry) => !entry.error);
  const errors = samples.filter((entry) => entry.error);
  const issues = samples.flatMap((entry) => entry.issues.map((issue) => `${entry.label}: ${issue}`));
  return {
    errors,
    issues,
    label,
    poolTimingAvailable,
    requestCount: samples.length,
    summaries: {
      acquireMs: summarizeMetrics(successes.map((entry) => entry.acquireMs)),
      holdMs: summarizeMetrics(successes.map((entry) => entry.holdMs)),
      latencyMs: summarizeMetrics(successes.map((entry) => entry.latencyMs)),
    },
  };
}

function compareWorkloads(label, baseline, wrapped, config, { candidateName = "wrapped" } = {}) {
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
      `${label}: ${candidateName} p95 ${formatMs(wrappedLatency.p95)} exceeds baseline p95 ${formatMs(baselineLatency.p95)} threshold`,
    );
  }
  if (wrappedLatency.p99 > baselineLatency.p99 * 3 || wrappedLatency.p99 - baselineLatency.p99 > 250) {
    issues.push(
      `${label}: ${candidateName} p99 ${formatMs(wrappedLatency.p99)} exceeds baseline p99 ${formatMs(baselineLatency.p99)} threshold`,
    );
  }
  if (baseline.poolTimingAvailable && wrapped.poolTimingAvailable) {
    if (wrappedAcquire.p95 > 100) {
      issues.push(`${label}: ${candidateName} connection acquisition p95 ${formatMs(wrappedAcquire.p95)} exceeds 100ms`);
    }
    if (wrappedAcquire.p99 > 250) {
      issues.push(`${label}: ${candidateName} connection acquisition p99 ${formatMs(wrappedAcquire.p99)} exceeds 250ms`);
    }
    if (wrappedHold.avg > baselineHold.avg * 2) {
      issues.push(`${label}: ${candidateName} average hold ${formatMs(wrappedHold.avg)} exceeds 2x baseline ${formatMs(baselineHold.avg)}`);
    }
    if (wrappedHold.p99 > config.transactionTimeoutMs / 2) {
      issues.push(
        `${label}: ${candidateName} p99 hold ${formatMs(wrappedHold.p99)} exceeds 50% of transaction timeout ${formatMs(config.transactionTimeoutMs)}`,
      );
    }
  }
  return issues;
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatSummary(workload) {
  const parts = [
    `${workload.label}: requests=${workload.requestCount}`,
    `latency p95=${formatMs(workload.summaries.latencyMs.p95)} p99=${formatMs(workload.summaries.latencyMs.p99)}`,
  ];
  if (workload.poolTimingAvailable) {
    parts.push(
      `acquire p95=${formatMs(workload.summaries.acquireMs.p95)} p99=${formatMs(workload.summaries.acquireMs.p99)}`,
      `hold avg=${formatMs(workload.summaries.holdMs.avg)} p99=${formatMs(workload.summaries.holdMs.p99)}`,
    );
  } else {
    parts.push("acquire=unavailable; hold=unavailable");
  }
  parts.push(`errors=${workload.errors.length}`);
  return parts.join("; ");
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
  let queryRttProxy = null;
  if (config.teardownRpcProbe) {
    const tornDown = await teardownRpcCanary(config);
    reports.push(
      `owner-only synthetic RPC teardown completed as ${tornDown.currentUser}; post-teardown function_absent=${tornDown.functionAbsent}`,
    );
    return {
      issues,
      locality: { queryRttProxy },
      reports,
    };
  }
  if (config.prepare) {
    const prepared = await prepareCanary(config);
    reports.push(
      `prepared ${prepared.rowsPrepared} synthetic canary rows and persistent candidate-pattern RPC fixture as ${prepared.currentUser}`,
    );
  }

  if (config.prepare || config.rollbackProbe) {
    issues.push(...await runRollbackDisableProbe(config));
    reports.push("setup rollback disable-RLS probe restored ENABLE/FORCE ROW LEVEL SECURITY");
    const restoreProbe = createPrismaProbe(config, { max: 1 });
    try {
      const restoredRuntime = await inspectRuntime(restoreProbe.pool, config);
      issues.push(...restoredRuntime.issues);
      for (const check of [
        await timedPrismaWrappedRead(
          restoreProbe.prisma,
          config,
          config.userA,
          "post-setup-restore Prisma wrapped read",
        ),
        await timedPrismaRpcRead(
          restoreProbe.prisma,
          config,
          config.userA,
          "post-setup-restore Prisma one-statement RPC read",
        ),
        await timedPrismaRpcCleanupProbe(restoreProbe.prisma, config),
      ]) {
        issues.push(...assertCleanSample(check));
      }
      reports.push(
        `setup verified the persistent synthetic RPC fixture catalog ready=${restoredRuntime.rpc.ready} and statement-local context cleanup`,
      );
    } finally {
      await disconnectPrismaProbe(restoreProbe);
    }
    return {
      issues,
      locality: { queryRttProxy },
      reports,
    };
  }

  const pool = createPool(config);
  try {
    const runtime = await inspectRuntime(pool, config);
    reports.push(
      `runtime current_user=${runtime.row.current_user_name ?? "unknown"} session_user=${runtime.row.session_user_name ?? "unknown"} database=${runtime.row.database_name ?? "unknown"}`,
    );
    issues.push(...runtime.issues);
    reports.push(
      `synthetic RPC candidate catalog ready=${runtime.rpc.ready}; scope=transport-only-not-saved-search-policy-proof`,
    );

    queryRttProxy = await measureLocalityQueryRttProxy(pool);
    reports.push(
      `locality query RTT proxy: kind=${queryRttProxy.kind}; warmup=${queryRttProxy.warmupQueries}; samples=${queryRttProxy.measuredQueries}; p95=${formatMs(queryRttProxy.metricsMs.p95)}; p99=${formatMs(queryRttProxy.metricsMs.p99)}`,
    );

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

    const prismaProbe = createPrismaProbe(config, { max: PRISMA_APP_POOL_SIZE });
    try {
      const prismaSingleChecks = [
        await timedPrismaAutocommitDeniedRead(prismaProbe.prisma, config, "single prisma autocommit denied read"),
        await timedPrismaOneStatementDeniedRead(
          prismaProbe.prisma,
          config,
          "single prisma one-statement autocommit denied read",
        ),
        await timedPrismaBaselineDeniedRead(prismaProbe.prisma, config, "single prisma baseline denied read"),
        await timedPrismaEmptyContextRead(prismaProbe.prisma, config),
        await timedPrismaWrappedRead(prismaProbe.prisma, config, config.userA, "single prisma user A wrapped read"),
        await timedPrismaWrappedRead(prismaProbe.prisma, config, config.userB, "single prisma user B wrapped read"),
        await timedPrismaCleanupProbe(prismaProbe.prisma, config, false),
        await timedPrismaCleanupProbe(prismaProbe.prisma, config, true),
      ];
      if (runtime.rpc.ready) {
        prismaSingleChecks.push(
          await timedPrismaRpcRead(
            prismaProbe.prisma,
            config,
            config.userA,
            "single prisma user A one-statement RPC read",
          ),
          await timedPrismaRpcRead(
            prismaProbe.prisma,
            config,
            config.userB,
            "single prisma user B one-statement RPC read",
          ),
          await timedPrismaRpcCleanupProbe(prismaProbe.prisma, config),
        );
      }
      for (const check of prismaSingleChecks) {
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
      const prismaReports = [
        prismaTargetAutocommitBaseline,
        prismaTargetBaseline,
        prismaTargetWrapped,
        prismaBurstAutocommitBaseline,
        prismaBurstBaseline,
        prismaBurstWrapped,
      ];
      if (runtime.rpc.ready) {
        const prismaTargetOneStatementBaseline = await runPrismaWorkload(prismaProbe.prisma, config, {
          concurrency: Math.min(config.targetConcurrency, config.poolSize),
          label: "Prisma target one-statement autocommit baseline",
          mode: "autocommit-select",
          requests: config.measuredRequests,
        });
        const prismaTargetRpc = await runPrismaWorkload(prismaProbe.prisma, config, {
          concurrency: Math.min(config.targetConcurrency, config.poolSize),
          label: "Prisma target one-statement RPC candidate",
          mode: "rpc",
          requests: config.measuredRequests,
        });
        const prismaBurstOneStatementBaseline = await runPrismaWorkload(prismaProbe.prisma, config, {
          concurrency: config.burstConcurrency,
          label: "Prisma burst one-statement autocommit baseline",
          mode: "autocommit-select",
          requests: config.measuredRequests,
        });
        const prismaBurstRpc = await runPrismaWorkload(prismaProbe.prisma, config, {
          concurrency: config.burstConcurrency,
          label: "Prisma burst one-statement RPC candidate",
          mode: "rpc",
          requests: config.measuredRequests,
        });
        prismaReports.push(
          prismaTargetOneStatementBaseline,
          prismaTargetRpc,
          prismaBurstOneStatementBaseline,
          prismaBurstRpc,
        );
        issues.push(...compareWorkloads(
          "Prisma target one-statement RPC adoption cost",
          prismaTargetOneStatementBaseline,
          prismaTargetRpc,
          config,
          { candidateName: "one-statement RPC" },
        ));
        issues.push(...compareWorkloads(
          "Prisma burst one-statement RPC adoption cost",
          prismaBurstOneStatementBaseline,
          prismaBurstRpc,
          config,
          { candidateName: "one-statement RPC" },
        ));
      } else {
        reports.push("Prisma one-statement RPC candidate workloads skipped because the catalog probe failed closed");
      }
      for (const workload of prismaReports) {
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

  return {
    issues,
    locality: { queryRttProxy },
    reports,
  };
}

function printUsage() {
  console.error("Usage:");
  console.error(
    "  RLS_CONTEXT_GATE_CONFIRM=staging-only RLS_CONTEXT_GATE_LOCALITY_CONFIRM=diagnostic-only RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION='<region>' RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION='<region>' RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID='<endpoint id>' RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME='<database>' RLS_CONTEXT_GATE_DATABASE_URL='<pooled runtime url>' RLS_CONTEXT_GATE_RUNTIME_ROLE=grainline_app_runtime npm run audit:rls-context",
  );
  console.error("Production-runtime output is candidate evidence only and additionally requires VERCEL=1, VERCEL_REGION, VERCEL_GIT_COMMIT_SHA, and VERCEL_DEPLOYMENT_ID; independently attest the Git-integrated deployment.");
  console.error("Non-counted staging setup:");
  console.error(
    "  RLS_CONTEXT_GATE_PREPARE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL='<direct migration-owner url>' ... npm run audit:rls-context",
  );
  console.error("Optional rollback proof:");
  console.error("  RLS_CONTEXT_GATE_ROLLBACK_PROBE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL='<direct migration-owner url>' ... npm run audit:rls-context");
  console.error("Owner-only RPC fixture teardown after retained provider-runtime evidence:");
  console.error("  RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE=1 RLS_CONTEXT_GATE_ADMIN_DATABASE_URL='<direct migration-owner url>' ... npm run audit:rls-context");
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
    `target=${config.targetConcurrency} burst=${config.burstConcurrency} rawPool=${config.poolSize} prismaPool=${PRISMA_APP_POOL_SIZE} requests=${config.measuredRequests} turnover=${config.turnoverRequests}`,
  );
  console.log(
    `locality=${config.localityConfirmation} execution=${config.observedExecutionRegion ?? "unverified"}/${config.expectedExecutionRegion} database=${config.observedDatabaseRegion ?? "unverified"}/${config.expectedDatabaseRegion}`,
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
  if (config.localityConfirmation === "diagnostic-only") {
    console.log("RLS context diagnostic passed, but diagnostic-only evidence is not acceptance-eligible.");
  } else {
    console.log("RLS context gate produced a passing runtime evidence candidate; external Git-integrated deployment attestation is still required.");
  }
  console.log("Route-level happy-path tests and per-table policy tests are still required before enabling production RLS.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}
