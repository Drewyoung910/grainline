import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import pg from "pg";

const {
  MIN_ACCEPTANCE_REQUESTS,
  buildEvidencePayload,
  claimProviderRuntimeRunSlot,
  completeProviderRuntimeRunSlot,
  isPreparedStatementError,
  parseGateConfig,
  runAcceptanceGate,
  summarizeMetrics,
} = await import("../scripts/rls-context-acceptance-gate.mjs");

const { Client } = pg;

function source(path) {
  return readFileSync(path, "utf8");
}

function baseEnv(overrides = {}) {
  return {
    RLS_CONTEXT_GATE_CONFIRM: "staging-only",
    RLS_CONTEXT_GATE_DATABASE_URL: "postgresql://runtime:secret@ep-test-pooler.westus3.azure.neon.tech/grainline_staging",
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: "ep-test",
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME: "grainline_staging",
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: "westus3.azure",
    RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION: "sfo1",
    RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "diagnostic-only",
    RLS_CONTEXT_GATE_RUNTIME_ROLE: "grainline_app_runtime",
    ...overrides,
  };
}

function gateIntegrationSkipReason() {
  if (process.env.GITHUB_ACTIONS !== "true") return "requires the GitHub Actions Postgres service";
  if (!process.env.DATABASE_URL) return "requires DATABASE_URL";
  return false;
}

function quotePgIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runtimeDatabaseUrl(adminUrl, username, password) {
  const url = new URL(adminUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

async function withCiRuntimeRole(fn) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const runtimeRole = `grainline_rls_gate_${suffix}`;
  const runtimePassword = `rls_gate_${suffix}_password`;
  const schemaName = `grainline_rls_gate_${suffix}`;
  const adminDatabaseUrl = process.env.DATABASE_URL;
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${quotePgIdentifier(schemaName)} CASCADE`);
    await admin.query(`DROP OWNED BY ${quotePgIdentifier(runtimeRole)}`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${quotePgIdentifier(runtimeRole)}`);
    await admin.query(`CREATE ROLE ${quotePgIdentifier(runtimeRole)} LOGIN PASSWORD ${sqlLiteral(runtimePassword)}`);
    const database = await admin.query("SELECT current_database() AS name");
    await admin.query(
      `GRANT CONNECT ON DATABASE ${quotePgIdentifier(database.rows[0].name)} TO ${quotePgIdentifier(runtimeRole)}`,
    );
  } finally {
    await admin.end();
  }

  try {
    return await fn({
      adminDatabaseUrl,
      databaseUrl: runtimeDatabaseUrl(adminDatabaseUrl, runtimeRole, runtimePassword),
      runtimeRole,
      schemaName,
    });
  } finally {
    const cleanup = new Client({ connectionString: adminDatabaseUrl });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP SCHEMA IF EXISTS ${quotePgIdentifier(schemaName)} CASCADE`).catch(() => {});
      await cleanup.query(`DROP OWNED BY ${quotePgIdentifier(runtimeRole)}`).catch(() => {});
      await cleanup.query(`DROP ROLE IF EXISTS ${quotePgIdentifier(runtimeRole)}`).catch(() => {});
    } finally {
      await cleanup.end();
    }
  }
}

function nonPerformanceGateIssues(issues) {
  return issues.filter((issue) => !(
    /wrapped p95 .* exceeds baseline p95 .* threshold/.test(issue) ||
    /wrapped p99 .* exceeds baseline p99 .* threshold/.test(issue) ||
    /wrapped connection acquisition p95 .* exceeds 100ms/.test(issue) ||
    /wrapped connection acquisition p99 .* exceeds 250ms/.test(issue) ||
    /wrapped average hold .* exceeds 2x baseline/.test(issue) ||
    /wrapped p99 hold .* exceeds 50% of transaction timeout/.test(issue)
  ));
}

describe("RLS context acceptance gate guardrails", () => {
  it("exposes the staging gate as an explicit npm script", () => {
    const pkg = JSON.parse(source("package.json"));

    assert.equal(pkg.scripts["audit:rls-context"], "node scripts/rls-context-acceptance-gate.mjs");
  });

  it("requires explicit staging and locality confirmation, expected regions, pooled runtime URL, and runtime role", () => {
    assert.throws(
      () => parseGateConfig({}),
      /RLS_CONTEXT_GATE_CONFIRM=staging-only is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_CONFIRM: "production" })),
      /RLS_CONTEXT_GATE_CONFIRM=staging-only is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_DATABASE_URL: "" })),
      /RLS_CONTEXT_GATE_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_DATABASE_URL: "postgresql://runtime:secret@ep-test.example.neon.tech/grainline_staging" })),
      /pooled runtime endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_DATABASE_URL:
          "postgresql://runtime:secret@ep-test-pooler.westus3.azure.neon.tech/grainline_staging?options=-c%20app%252Euser_id%253Dpreseeded",
      })),
      /must not pre-seed app\.user_id through URL query parameters or options/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_DATABASE_URL:
          "postgresql://runtime:secret@ep-test-pooler.westus3.azure.neon.tech/grainline_staging?app%2Euser_id=preseeded",
      })),
      /must not pre-seed app\.user_id through URL query parameters or options/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_RUNTIME_ROLE: "" })),
      /RLS_CONTEXT_GATE_RUNTIME_ROLE is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "" })),
      /RLS_CONTEXT_GATE_LOCALITY_CONFIRM is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "laptop" })),
      /must be diagnostic-only or production-runtime/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION: "" })),
      /RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: "West US 3" })),
      /bounded lowercase region identifier/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: "ep-other" })),
      /endpoint id does not match the reviewed staging endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME: "other_db" })),
      /database name does not match the reviewed staging database/,
    );

    const config = parseGateConfig(baseEnv());
    assert.equal(config.databaseUrl, baseEnv().RLS_CONTEXT_GATE_DATABASE_URL);
    assert.equal(config.runtimeRole, "grainline_app_runtime");
    assert.equal(config.measuredRequests, MIN_ACCEPTANCE_REQUESTS);
    assert.equal(config.targetConcurrency, 8);
    assert.equal(config.burstConcurrency, 16);
    assert.equal(config.poolSize, 16);
    assert.equal(config.localityConfirmation, "diagnostic-only");
    assert.equal(config.expectedExecutionRegion, "sfo1");
    assert.equal(config.expectedDatabaseEndpointId, "ep-test");
    assert.equal(config.expectedDatabaseName, "grainline_staging");
    assert.equal(config.expectedDatabaseRegion, "westus3.azure");
    assert.equal(config.observedDatabaseRegion, "westus3.azure");
    assert.equal(config.observedExecutionRegion, null);
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_BURST_CONCURRENCY: "16",
        RLS_CONTEXT_GATE_POOL_SIZE: "8",
      })),
      /POOL_SIZE must be at least RLS_CONTEXT_GATE_BURST_CONCURRENCY/,
    );
    assert.equal(parseGateConfig(baseEnv({
      RLS_CONTEXT_GATE_EVIDENCE_PATH: "tmp/rls-context-gate-evidence.json",
    })).evidencePath, "tmp/rls-context-gate-evidence.json");
  });

  it("accepts production-runtime locality only from the matching provider-owned Vercel runtime", () => {
    const productionRuntimeEnv = {
      RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "production-runtime",
      VERCEL: "1",
      VERCEL_DEPLOYMENT_ID: "dpl_test123",
      VERCEL_GIT_COMMIT_SHA: "abcdef1234567890",
      VERCEL_REGION: "sfo1",
    };

    assert.throws(
      () => parseGateConfig(baseEnv({ ...productionRuntimeEnv, VERCEL: "" })),
      /requires provider-owned VERCEL=1/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ ...productionRuntimeEnv, VERCEL_REGION: "iad1" })),
      /does not match RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION=sfo1/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ ...productionRuntimeEnv, VERCEL_GIT_COMMIT_SHA: "" })),
      /VERCEL_GIT_COMMIT_SHA is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ ...productionRuntimeEnv, VERCEL_DEPLOYMENT_ID: "" })),
      /VERCEL_DEPLOYMENT_ID is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        ...productionRuntimeEnv,
        RLS_CONTEXT_GATE_DATABASE_URL: "postgresql://runtime:secret@ep-test-pooler.example.neon.tech/grainline_staging",
      })),
      /must use a parseable Neon endpoint hostname and one database path segment/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        ...productionRuntimeEnv,
        RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: "eastus2.azure",
      })),
      /region does not match the reviewed staging database region/,
    );

    const config = parseGateConfig(baseEnv(productionRuntimeEnv));
    assert.equal(config.localityConfirmation, "production-runtime");
    assert.equal(config.observedDatabaseRegion, "westus3.azure");
    assert.equal(config.observedExecutionRegion, "sfo1");
    assert.equal(config.providerCommitSha, "abcdef1234567890");
    assert.equal(config.providerDeploymentId, "dpl_test123");
  });

  it("does not fall back to ambient production database env vars", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");

    assert.match(script, /RLS_CONTEXT_GATE_DATABASE_URL/);
    assert.doesNotMatch(script, /process\.env\.DATABASE_URL/);
    assert.doesNotMatch(script, /process\.env\.DIRECT_URL/);
    assert.doesNotMatch(script, /\?\?\s*env\.DATABASE_URL/);
    assert.doesNotMatch(script, /\?\?\s*env\.DIRECT_URL/);
  });

  it("keeps canary users synthetic unless custom ids are explicitly allowed", () => {
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_USER_A: "user_123" })),
      /must start with rls-canary-/,
    );

    const config = parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_USER_A: "user_123", RLS_CONTEXT_GATE_ALLOW_CUSTOM_USER_IDS: "1" }));
    assert.equal(config.userA, "user_123");
  });

  it("requires acceptance-sized samples for the measured paths", () => {
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_REQUESTS: "499" })),
      /RLS_CONTEXT_GATE_REQUESTS must be between 500/,
    );

    const config = parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_REQUESTS: "500" }));
    assert.equal(config.measuredRequests, 500);
  });

  it("can prepare only with an explicit admin/migration-owner URL", () => {
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_PREPARE: "1" })),
      /RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_ROLLBACK_PROBE: "1" })),
      /RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required/,
    );

    const config = parseGateConfig(baseEnv({
      RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-test.westus3.azure.neon.tech/grainline_staging",
      RLS_CONTEXT_GATE_PREPARE: "1",
    }));
    assert.equal(config.prepare, true);
    assert.equal(config.rollbackProbe, true);
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-other.westus3.azure.neon.tech/grainline_staging",
        RLS_CONTEXT_GATE_PREPARE: "1",
      })),
      /endpoint id does not match the reviewed staging endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-test-pooler.westus3.azure.neon.tech/grainline_staging",
        RLS_CONTEXT_GATE_PREPARE: "1",
      })),
      /must use the reviewed direct Neon endpoint/,
    );
  });

  it("pins the transaction-local context and fail-closed canary policy shape", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");
    const runtimeInspection = script.slice(
      script.indexOf("async function inspectRuntime"),
      script.indexOf("async function measureLocalityQueryRttProxy"),
    );

    assert.match(script, /set_config\('app\.user_id', \$1, true\)/);
    assert.match(script, /current_setting\('app\.user_id', true\)/);
    assert.match(script, /NULLIF\(current_setting\('app\.user_id', true\), ''\)/);
    assert.match(script, /PrismaPg/);
    assert.match(script, /new PrismaClient/);
    assert.match(script, /timedPrismaWrappedRead/);
    assert.match(script, /ENABLE ROW LEVEL SECURITY/);
    assert.match(script, /DISABLE ROW LEVEL SECURITY/);
    assert.match(runtimeInspection, /current_setting\('app\.user_id', true\) AS app_user_id/);
    assert.match(runtimeInspection, /runtime connection starts with app\.user_id already set/);
    assert.match(script, /FORCE ROW LEVEL SECURITY/);
    assert.match(script, /runRollbackDisableProbe/);
    assert.match(script, /empty-owner-should-not-match/);
  });

  it("uses a durable two-slot ledger that prevents replay and overlapping evidence runs", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");

    assert.match(script, /PRIMARY KEY \(run_id, run_slot\)/);
    assert.match(script, /ON CONFLICT \(run_id, run_slot\) DO NOTHING/);
    assert.match(script, /SELECT \$1, \$2::smallint, \$3, \$4/);
    assert.match(script, /WHERE \$2::smallint = 1::smallint/);
    assert.match(
      script,
      /run_slot = 1[\s\S]*status = 'passed'[\s\S]*deployment_id = \$3[\s\S]*commit_sha = \$4/,
    );
    assert.match(script, /status = 'running'/);
    assert.match(script, /evidence jsonb/);
    assert.match(script, /ADD COLUMN IF NOT EXISTS evidence jsonb/);
    assert.match(script, /SET status = \$3, finished_at = now\(\), evidence = \$6::jsonb/);
    assert.match(script, /sanitized evidence exceeds 256 KiB/);
    assert.match(script, /succeeded \? "passed" : "failed"/);
  });

  it("probes pooled prepared statements, connection recycling, and latency thresholds", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");

    assert.match(script, /PREPARED_SELECT_NAME/);
    assert.match(script, /timedAutocommitDeniedRead/);
    assert.match(script, /timedPrismaAutocommitDeniedRead/);
    assert.match(script, /autocommit adoption cost/);
    assert.match(script, /prepared statement already exists/);
    assert.match(script, /prepared statement .* does not exist/);
    assert.match(script, /cached plan must not change result type/);
    assert.match(script, /maxUses: 1/);
    assert.match(script, /wrapped p95/);
    assert.match(script, /wrapped p99/);
    assert.match(script, /connection acquisition p95/);
    assert.match(script, /transaction timeout/);
    assert.match(script, /warm-checked-out-sequential-select-1/);
    assert.match(script, /LOCALITY_RTT_MEASURED_QUERIES = 25/);
    assert.match(script, /SELECT 1 AS locality_probe/);

    assert.equal(isPreparedStatementError(new Error("prepared statement already exists")), true);
    assert.equal(isPreparedStatementError(new Error("cached plan must not change result type")), true);
    assert.equal(isPreparedStatementError(new Error("ordinary timeout")), false);
  });

  it("benchmarks the production wrapper without a redundant context round trip", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");
    const rawWrapped = script.slice(
      script.indexOf("async function timedWrappedRead"),
      script.indexOf("async function transactionCleanupProbe"),
    );
    const prismaWrapped = script.slice(
      script.indexOf("async function timedPrismaWrappedRead"),
      script.indexOf("async function timedPrismaCleanupProbe"),
    );

    for (const wrapped of [rawWrapped, prismaWrapped]) {
      assert.match(wrapped, /const context = await/);
      assert.match(wrapped, /set_config\('app\.user_id'/);
      assert.match(wrapped, /set_config returned/);
      assert.doesNotMatch(wrapped, /SELECT current_setting\('app\.user_id'/);
    }
  });

  it("mirrors the real app Prisma pool and does not invent adapter pool timings", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");
    const db = source("src/lib/db.ts");

    assert.match(script, /const PRISMA_APP_POOL_SIZE = 10/);
    assert.match(script, /createPrismaProbe\(config, \{ max: PRISMA_APP_POOL_SIZE \}\)/);
    assert.match(db, /max: 10/);
    assert.match(script, /prismaPoolSize: PRISMA_APP_POOL_SIZE/);
    assert.match(script, /prismaPoolTimingAvailable: false/);
    assert.match(script, /rawPool=\$\{config\.poolSize\} prismaPool=\$\{PRISMA_APP_POOL_SIZE\}/);
    assert.match(script, /poolTimingAvailable: false/);
    assert.match(script, /acquire=unavailable; hold=unavailable/);
    assert.match(script, /baseline\.poolTimingAvailable && wrapped\.poolTimingAvailable/);
  });

  it("documents the gate in the RLS runbook and defense-in-depth plan", () => {
    const defense = source("docs/db-defense-in-depth-plan.md");
    const runbook = source("docs/runbook.md");
    const launch = source("docs/launch-checklist.md");
    const agentContract = source("CLAUDE.md");

    assert.match(defense, /scripts\/rls-context-acceptance-gate\.mjs/);
    assert.match(defense, /npm run audit:rls-context/);
    assert.match(defense, /synthetic non-customer canary rows/);
    assert.match(defense, /autocommit baseline/);
    assert.match(defense, /proves read\/context\s+  isolation for the synthetic canary only/);
    assert.match(defense, /per-table write-policy behavior/);
    assert.match(defense, /Prisma adapter transaction path/);
    assert.match(defense, /pool size to at least the configured burst concurrency/);
    assert.match(runbook, /RLS_CONTEXT_GATE_CONFIRM=staging-only/);
    assert.match(runbook, /RLS_CONTEXT_GATE_PREPARE=1/);
    assert.match(runbook, /RLS_CONTEXT_GATE_ROLLBACK_PROBE=1/);
    assert.match(runbook, /RLS_CONTEXT_GATE_EVIDENCE_PATH/);
    assert.match(runbook, /must not contain database URLs or credentials/);
    assert.match(runbook, /pooled runtime-role URL/);
    assert.match(runbook, /autocommit baseline/);
    assert.match(runbook, /proves read\/context\s+  isolation on synthetic canary rows/);
    assert.match(runbook, /per-table write-policy behavior/);
    assert.match(runbook, /POOL_SIZE` at or above\s+`RLS_CONTEXT_GATE_BURST_CONCURRENCY/);
    assert.match(launch, /audit:rls-context/);
    assert.match(launch, /RLS_CONTEXT_GATE_EVIDENCE_PATH/);
    assert.match(agentContract, /RLS_CONTEXT_GATE_EVIDENCE_PATH/);
    assert.match(agentContract, /retain the sanitized JSON artifact/);
  });

  it("builds a sanitized evidence payload without database URLs", () => {
    const config = parseGateConfig(baseEnv({
      RLS_CONTEXT_GATE_EVIDENCE_PATH: "tmp/rls-context-gate-evidence.json",
    }));
    const payload = buildEvidencePayload(
      config,
      {
        issues: [
          "synthetic issue",
          "connection failed for postgresql://owner:secret@ep-admin-pooler.example.neon.tech/grainline_staging?sslmode=require",
          "env RLS_CONTEXT_GATE_ADMIN_DATABASE_URL=postgres://admin:admin-secret@ep-admin.example.neon.tech/grainline_staging",
          "dsn user=owner password=owner-password host=ep-admin.example.neon.tech",
          'json config {"password":"json-secret","DATABASE_URL":"postgres://json:json-db-secret@ep-json.example.neon.tech/db"}',
        ],
        reports: [
          "synthetic report",
          "upstream URL had https://runtime:report-secret@example.invalid/path and PGPASSWORD=report-secret",
        ],
        locality: {
          queryRttProxy: {
            kind: "warm-checked-out-sequential-select-1",
            measuredQueries: 25,
            metricsMs: { avg: 1, max: 2, min: 0.5, p95: 2, p99: 2 },
            warmupQueries: 5,
          },
        },
      },
      {
        finishedAt: "2026-07-09T22:00:01.000Z",
        startedAt: "2026-07-09T22:00:00.000Z",
        status: "failed",
      },
      {
        GITHUB_RUN_ID: "12345",
        GITHUB_SHA: "abc123",
      },
    );

    assert.equal(payload.run.status, "diagnostic_failed");
    assert.equal(payload.run.ciRunId, "12345");
    assert.equal(payload.run.commitSha, "abc123");
    assert.equal(payload.database.databaseHost, "ep-test-pooler.westus3.azure.neon.tech");
    assert.equal(payload.database.expectedDatabaseEndpointId, "ep-test");
    assert.equal(payload.database.expectedDatabaseName, "grainline_staging");
    assert.equal(payload.database.runtimeRole, "grainline_app_runtime");
    assert.equal(payload.locality.confirmation, "diagnostic-only");
    assert.equal(payload.locality.acceptanceEligible, false);
    assert.equal(payload.locality.expectedExecutionRegion, "sfo1");
    assert.equal(payload.locality.expectedDatabaseRegion, "westus3.azure");
    assert.equal(payload.locality.observedDatabaseRegion, "westus3.azure");
    assert.equal(payload.locality.queryRttProxy.measuredQueries, 25);
    assert.equal(payload.result.issueCount, 5);
    assert.match(payload.result.issues[1], /\[redacted-postgres-url\]/);
    assert.match(payload.result.issues[2], /\[redacted-database-url\]/);
    assert.match(payload.result.issues[3], /\[redacted-password\]/);
    assert.match(payload.result.issues[4], /\[redacted-password\]/);
    assert.match(payload.result.issues[4], /\[redacted-database-url\]/);
    assert.match(payload.result.reports[1], /\[redacted-credentials\]/);
    assert.equal(payload.config.measuredRequests, MIN_ACCEPTANCE_REQUESTS);
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /postgresql:\/\//);
    assert.doesNotMatch(serialized, /postgres:\/\//);
    assert.doesNotMatch(serialized, /runtime:secret/);
    assert.doesNotMatch(serialized, /owner:secret|admin-secret|owner-password|json-secret|json-db-secret|report-secret|runtime:report-secret/);
    assert.doesNotMatch(serialized, /RLS_CONTEXT_GATE_DATABASE_URL/);
    assert.doesNotMatch(serialized, /RLS_CONTEXT_GATE_ADMIN_DATABASE_URL/);

    const diagnosticPassed = buildEvidencePayload(
      config,
      { issues: [], locality: payload.locality, reports: [] },
      {
        finishedAt: "2026-07-09T22:00:01.000Z",
        startedAt: "2026-07-09T22:00:00.000Z",
        status: "passed",
      },
      {},
    );
    assert.equal(diagnosticPassed.run.status, "diagnostic_passed");
    assert.equal(diagnosticPassed.locality.acceptanceEligible, false);

    const setupPassed = buildEvidencePayload(
      { ...config, prepare: true, rollbackProbe: true },
      { issues: [], locality: { queryRttProxy: null }, reports: [] },
      {
        finishedAt: "2026-07-09T22:00:01.000Z",
        startedAt: "2026-07-09T22:00:00.000Z",
        status: "passed",
      },
      {},
    );
    assert.equal(setupPassed.run.kind, "setup");
    assert.equal(setupPassed.run.status, "setup_passed");
    assert.equal(setupPassed.locality.runtimeEvidenceCandidate, false);
    assert.match(source("scripts/rls-context-acceptance-gate.mjs"), /chmodSync\(config\.evidencePath, 0o600\)/);
  });

  it("emits only a runtime evidence candidate and requires external deployment attestation", () => {
    const config = parseGateConfig(baseEnv({
      RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "production-runtime",
      VERCEL: "1",
      VERCEL_DEPLOYMENT_ID: "dpl_test123",
      VERCEL_GIT_COMMIT_SHA: "abcdef1234567890",
      VERCEL_REGION: "sfo1",
    }));
    const result = {
      issues: [],
      locality: {
        queryRttProxy: {
          kind: "warm-checked-out-sequential-select-1",
          measuredQueries: 25,
          metricsMs: { avg: 1, max: 2, min: 0.5, p95: 2, p99: 2 },
          warmupQueries: 5,
        },
      },
      reports: [],
    };
    const timing = {
      finishedAt: "2026-07-09T22:00:01.000Z",
      startedAt: "2026-07-09T22:00:00.000Z",
      status: "passed",
    };

    const passed = buildEvidencePayload(config, result, timing, {});
    assert.equal(passed.run.status, "runtime_candidate_passed");
    assert.equal(passed.run.kind, "repeat");
    assert.equal(passed.locality.acceptanceEligible, false);
    assert.equal(passed.locality.runtimeEvidenceCandidate, true);
    assert.equal(passed.locality.providerRuntimeMetadataPresent, true);
    assert.equal(passed.locality.requiresExternalDeploymentAttestation, true);
    assert.equal(passed.run.commitSha, "abcdef1234567890");
    assert.equal(passed.run.deploymentId, "dpl_test123");

    const mismatchedFailed = buildEvidencePayload(config, result, { ...timing, status: "failed" }, {});
    assert.equal(mismatchedFailed.run.status, "runtime_candidate_failed");
    assert.equal(mismatchedFailed.locality.runtimeEvidenceCandidate, false);
    assert.equal(mismatchedFailed.result.issueCount, 1);
    assert.match(mismatchedFailed.result.issues[0], /evidence status mismatch/);

    const issuesButPassed = buildEvidencePayload(
      config,
      { ...result, issues: ["synthetic gate issue"] },
      timing,
      {},
    );
    assert.equal(issuesButPassed.run.status, "runtime_candidate_failed");
    assert.equal(issuesButPassed.locality.runtimeEvidenceCandidate, false);
    assert.equal(issuesButPassed.result.issueCount, 2);
    assert.match(issuesButPassed.result.issues[1], /evidence status mismatch/);

    const incomplete = buildEvidencePayload(config, { ...result, locality: undefined }, timing, {});
    assert.equal(incomplete.locality.runtimeEvidenceCandidate, false);
  });

  it("smoke-runs the gate orchestration against synthetic CI Postgres objects", { skip: gateIntegrationSkipReason() }, async () => {
    await withCiRuntimeRole(async ({ adminDatabaseUrl, databaseUrl, runtimeRole, schemaName }) => {
      const config = {
        adminDatabaseUrl,
        burstConcurrency: 2,
        connectionTimeoutMs: 10_000,
        databaseUrl,
        expectedDatabaseRegion: "ci-local",
        expectedExecutionRegion: "ci-local",
        localityConfirmation: "diagnostic-only",
        measuredRequests: 4,
        observedDatabaseRegion: "ci-local",
        observedExecutionRegion: null,
        policyName: "context_canary_select",
        poolSize: 2,
        prepare: true,
        providerCommitSha: null,
        providerDeploymentId: null,
        queryTimeoutMs: 30_000,
        rollbackProbe: true,
        runClaimTableName: "context_gate_run_claim",
        runtimeRole,
        schemaName,
        statementTimeoutMs: 30_000,
        tableName: "context_canary",
        targetConcurrency: 2,
        transactionTimeoutMs: 5_000,
        turnoverRequests: 2,
        userA: "rls-canary-ci-a",
        userB: "rls-canary-ci-b",
        warmupRequests: 0,
      };
      const setupResult = await runAcceptanceGate(config);

      assert.deepEqual(setupResult.issues, []);
      assert.match(setupResult.reports.join("\n"), /prepared 3 synthetic canary rows/);
      assert.match(setupResult.reports.join("\n"), /setup rollback disable-RLS probe restored/);
      assert.equal(setupResult.locality.queryRttProxy, null);

      const claimConfig = {
        ...config,
        adminDatabaseUrl: undefined,
        localityConfirmation: "production-runtime",
        prepare: false,
        providerCommitSha: "abcdef1234567890",
        providerDeploymentId: "dpl_ci_test",
        rollbackProbe: false,
      };
      const runId = `rls-context-ci-${randomUUID()}`;
      assert.equal(await claimProviderRuntimeRunSlot(claimConfig, { runId, runSlot: 2 }), false);
      assert.equal(await claimProviderRuntimeRunSlot(claimConfig, { runId, runSlot: 1 }), true);
      assert.equal(await claimProviderRuntimeRunSlot(claimConfig, { runId, runSlot: 1 }), false);
      assert.equal(await claimProviderRuntimeRunSlot(claimConfig, { runId, runSlot: 2 }), false);
      await completeProviderRuntimeRunSlot(claimConfig, {
        evidence: { result: { issueCount: 0 }, run: { status: "runtime_candidate_passed" } },
        runId,
        runSlot: 1,
        succeeded: true,
      });
      assert.equal(await claimProviderRuntimeRunSlot({
        ...claimConfig,
        providerDeploymentId: "dpl_ci_other",
      }, { runId, runSlot: 2 }), false);
      assert.equal(await claimProviderRuntimeRunSlot({
        ...claimConfig,
        providerCommitSha: "fedcba0987654321",
      }, { runId, runSlot: 2 }), false);
      assert.equal(await claimProviderRuntimeRunSlot(claimConfig, { runId, runSlot: 2 }), true);
      await completeProviderRuntimeRunSlot(claimConfig, {
        evidence: { result: { issueCount: 0 }, run: { status: "runtime_candidate_passed" } },
        runId,
        runSlot: 2,
        succeeded: true,
      });

      const result = await runAcceptanceGate({
        ...config,
        adminDatabaseUrl: undefined,
        prepare: false,
        rollbackProbe: false,
      });
      assert.deepEqual(nonPerformanceGateIssues(result.issues), []);
      assert.match(result.reports.join("\n"), /target autocommit baseline/);
      assert.match(result.reports.join("\n"), /Prisma target autocommit baseline/);
      assert.equal(result.locality.queryRttProxy.measuredQueries, 25);
      assert.equal(result.locality.queryRttProxy.warmupQueries, 5);
    });
  });

  it("summarizes p95 and p99 metrics deterministically", () => {
    assert.deepEqual(summarizeMetrics([5, 1, 3, 2, 4]), {
      avg: 3,
      p95: 5,
      p99: 5,
    });
  });
});
