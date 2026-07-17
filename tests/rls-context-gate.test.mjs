import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import pg from "pg";

const {
  MIN_ACCEPTANCE_REQUESTS,
  buildEvidencePayload,
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
    RLS_CONTEXT_GATE_DATABASE_URL: "postgresql://runtime:secret@ep-test-pooler.example.neon.tech/grainline_staging",
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

  it("requires explicit staging confirmation, pooled runtime URL, and runtime role", () => {
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
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_RUNTIME_ROLE: "" })),
      /RLS_CONTEXT_GATE_RUNTIME_ROLE is required/,
    );

    const config = parseGateConfig(baseEnv());
    assert.equal(config.databaseUrl, baseEnv().RLS_CONTEXT_GATE_DATABASE_URL);
    assert.equal(config.runtimeRole, "grainline_app_runtime");
    assert.equal(config.measuredRequests, MIN_ACCEPTANCE_REQUESTS);
    assert.equal(config.targetConcurrency, 8);
    assert.equal(config.burstConcurrency, 16);
    assert.equal(config.poolSize, 16);
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
      RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-test.example.neon.tech/grainline_staging",
      RLS_CONTEXT_GATE_PREPARE: "1",
    }));
    assert.equal(config.prepare, true);
    assert.equal(config.rollbackProbe, true);
  });

  it("pins the transaction-local context and fail-closed canary policy shape", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");

    assert.match(script, /set_config\('app\.user_id', \$1, true\)/);
    assert.match(script, /current_setting\('app\.user_id', true\)/);
    assert.match(script, /NULLIF\(current_setting\('app\.user_id', true\), ''\)/);
    assert.match(script, /PrismaPg/);
    assert.match(script, /new PrismaClient/);
    assert.match(script, /timedPrismaWrappedRead/);
    assert.match(script, /ENABLE ROW LEVEL SECURITY/);
    assert.match(script, /DISABLE ROW LEVEL SECURITY/);
    assert.match(script, /FORCE ROW LEVEL SECURITY/);
    assert.match(script, /runRollbackDisableProbe/);
    assert.match(script, /empty-owner-should-not-match/);
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

    assert.equal(isPreparedStatementError(new Error("prepared statement already exists")), true);
    assert.equal(isPreparedStatementError(new Error("cached plan must not change result type")), true);
    assert.equal(isPreparedStatementError(new Error("ordinary timeout")), false);
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

    assert.equal(payload.run.status, "failed");
    assert.equal(payload.run.ciRunId, "12345");
    assert.equal(payload.run.commitSha, "abc123");
    assert.equal(payload.database.databaseHost, "ep-test-pooler.example.neon.tech");
    assert.equal(payload.database.runtimeRole, "grainline_app_runtime");
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
  });

  it("smoke-runs the gate orchestration against synthetic CI Postgres objects", { skip: gateIntegrationSkipReason() }, async () => {
    await withCiRuntimeRole(async ({ adminDatabaseUrl, databaseUrl, runtimeRole, schemaName }) => {
      const result = await runAcceptanceGate({
        adminDatabaseUrl,
        burstConcurrency: 2,
        connectionTimeoutMs: 10_000,
        databaseUrl,
        measuredRequests: 4,
        policyName: "context_canary_select",
        poolSize: 2,
        prepare: true,
        queryTimeoutMs: 30_000,
        rollbackProbe: true,
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
      });

      assert.deepEqual(nonPerformanceGateIssues(result.issues), []);
      assert.match(result.reports.join("\n"), /prepared 3 synthetic canary rows/);
      assert.match(result.reports.join("\n"), /target autocommit baseline/);
      assert.match(result.reports.join("\n"), /Prisma target autocommit baseline/);
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
