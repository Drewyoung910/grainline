import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import pg from "pg";

const {
  MIN_ACCEPTANCE_REQUESTS,
  assertReviewedAdminConnectionIdentity,
  buildEvidencePayload,
  claimProviderRuntimeRunSlot,
  completeProviderRuntimeRunSlot,
  isPreparedStatementError,
  parseGateConfig,
  restoreForcedRlsState,
  runAcceptanceGate,
  runRollbackDisableProbe,
  summarizeMetrics,
} = await import("../scripts/rls-context-acceptance-gate.mjs");

const { Client } = pg;

function source(path) {
  return readFileSync(path, "utf8");
}

function assertContractMatch(text, pattern, message) {
  assert.equal(pattern.test(text), true, message);
}

function assertContractNotMatch(text, pattern, message) {
  assert.equal(pattern.test(text), false, message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function baseEnv(overrides = {}) {
  return {
    RLS_CONTEXT_GATE_CONFIRM: "staging-only",
    RLS_CONTEXT_GATE_DATABASE_URL: "postgresql://grainline_app_runtime:secret@ep-test-pooler.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
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
    /wrapped p99 hold .* exceeds 50% of transaction timeout/.test(issue) ||
    /one-statement RPC p95 .* exceeds baseline p95 .* threshold/.test(issue) ||
    /one-statement RPC p99 .* exceeds baseline p99 .* threshold/.test(issue)
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
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_DATABASE_URL: "postgresql://grainline_app_runtime:secret@ep-test.example.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require" })),
      /pooled runtime endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_DATABASE_URL:
          "postgresql://grainline_app_runtime:secret@ep-test-pooler.westus3.azure.neon.tech:5432/grainline_staging?options=-c%20app%252Euser_id%253Dpreseeded",
      })),
      /must not pre-seed app\.user_id through URL query parameters or options/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_DATABASE_URL:
          "postgresql://grainline_app_runtime:secret@ep-test-pooler.westus3.azure.neon.tech:5432/grainline_staging?app%2Euser_id=preseeded",
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
    assert.equal(config.rpcFunctionName, "context_canary_rpc");
    assert.equal(config.teardownRpcProbe, false);
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
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_EVIDENCE_PATH: "tmp/rls-context-gate-evidence.json",
      })),
      /reserved for owner-only prepare, rollback, or teardown operations/,
    );
    assert.equal(parseGateConfig(baseEnv({
      RLS_CONTEXT_GATE_ADMIN_DATABASE_URL:
        "postgresql://neondb_owner:secret@ep-test.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
      RLS_CONTEXT_GATE_EVIDENCE_PATH: "tmp/rls-context-gate-evidence.json",
      RLS_CONTEXT_GATE_PREPARE: "1",
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
        RLS_CONTEXT_GATE_DATABASE_URL: "postgresql://grainline_app_runtime:secret@ep-test-pooler.example.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
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

  it("rejects connection-string target, credential, context, and TLS overrides", () => {
    const gateSource = source("scripts/rls-context-acceptance-gate.mjs");
    assert.equal(
      gateSource.match(/postgresChannelBindingClientOptions\(new URL\(/g)?.length,
      2,
    );
    for (const parameter of [
      "host=evil.example",
      "hostaddr=203.0.113.1",
      "user=other_runtime",
      "password=other-secret",
      "port=6543",
      "database=otherdb",
      "dbname=otherdb",
      "service=other-service",
      "ssl=true",
      "sslcert=%2Ftmp%2Funreviewed-cert",
      "sslkey=%2Ftmp%2Funreviewed-key",
      "sslrootcert=%2Ftmp%2Funreviewed-ca",
      "uselibpqcompat=true",
    ]) {
      assert.throws(
        () => parseGateConfig(baseEnv({
          RLS_CONTEXT_GATE_DATABASE_URL:
            `${baseEnv().RLS_CONTEXT_GATE_DATABASE_URL}&${parameter}`,
        })),
        (error) => {
          assert.match(
            error.message,
            /may contain only reviewed sslmode and channel_binding connection parameters/,
          );
          assert.doesNotMatch(error.message, /secret|evil|203\.0\.113\.1|postgresql:/);
          return true;
        },
      );
    }

    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_DATABASE_URL:
          baseEnv().RLS_CONTEXT_GATE_DATABASE_URL.replace(
            "sslmode=verify-full",
            "sslmode=no-verify",
          ),
      })),
      /must use sslmode=verify-full/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_DATABASE_URL:
          `${baseEnv().RLS_CONTEXT_GATE_DATABASE_URL}&sslmode=verify-full`,
      })),
      /must not contain duplicate or case-variant connection parameters/,
    );

    const reviewedUrl = baseEnv().RLS_CONTEXT_GATE_DATABASE_URL;
    for (const databaseUrl of [
      ` ${reviewedUrl}`,
      `${reviewedUrl} `,
      reviewedUrl.replace(":secret@", "@"),
      reviewedUrl.replace(":5432/", "/"),
      `${reviewedUrl}#fragment`,
      reviewedUrl.replace(":5432/grainline_staging", ":5432//grainline_staging"),
      reviewedUrl.replace(":5432/grainline_staging", ":5432/grainline_staging/"),
      reviewedUrl.replace(":5432/grainline_staging", ":5432/grainline_staging//"),
      reviewedUrl.replace(":5432/grainline_staging", ":5432/grainline_staging%3Fother"),
      reviewedUrl.replace("sslmode=verify-full", "sslmode=VERIFY-FULL"),
      reviewedUrl.replace("channel_binding=require", "channel_binding=REQUIRE"),
    ]) {
      assert.throws(
        () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_DATABASE_URL: databaseUrl })),
        (error) => {
          assert.doesNotMatch(error.message, /secret|postgresql:/);
          return true;
        },
      );
    }

    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_DATABASE_URL: reviewedUrl.replace(
          "grainline_app_runtime:",
          "other_runtime:",
        ),
      })),
      /username must match RLS_CONTEXT_GATE_RUNTIME_ROLE/,
    );
    for (const environmentOverride of [
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c role=other" },
    ]) {
      assert.throws(
        () => parseGateConfig(baseEnv(environmentOverride)),
        /must not/,
      );
    }
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
    assert.throws(
      () => parseGateConfig(baseEnv({ RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE: "1" })),
      /RLS_CONTEXT_GATE_ADMIN_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-test.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
        RLS_CONTEXT_GATE_PREPARE: "1",
        RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE: "1",
      })),
      /cannot be combined/,
    );

    const config = parseGateConfig(baseEnv({
      RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-test.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
      RLS_CONTEXT_GATE_PREPARE: "1",
    }));
    assert.equal(config.prepare, true);
    assert.equal(config.rollbackProbe, true);
    assert.equal(config.adminDatabaseUsername, "owner");
    for (const adminDatabaseUrl of [
      " postgresql://owner:secret@ep-test.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
      "postgresql://owner:secret@ep-test.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require ",
    ]) {
      assert.throws(
        () => parseGateConfig(baseEnv({
          RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: adminDatabaseUrl,
          RLS_CONTEXT_GATE_PREPARE: "1",
        })),
        /without surrounding whitespace/,
      );
    }
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-other.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
        RLS_CONTEXT_GATE_PREPARE: "1",
      })),
      /endpoint id does not match the reviewed staging endpoint/,
    );
    assert.throws(
      () => parseGateConfig(baseEnv({
        RLS_CONTEXT_GATE_ADMIN_DATABASE_URL: "postgresql://owner:secret@ep-test-pooler.westus3.azure.neon.tech:5432/grainline_staging?sslmode=verify-full&channel_binding=require",
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
    assert.match(script, /CREATE FUNCTION \$\{rpcFunctionRef\}\(p_user_id text\)/);
    assert.match(script, /LANGUAGE plpgsql/);
    assert.match(script, /SECURITY INVOKER/);
    assert.match(script, /PARALLEL UNSAFE/);
    assert.match(script, /p\.proparallel AS parallel_safety/);
    assert.match(script, /synthetic RPC function must remain PARALLEL UNSAFE/);
    assert.match(script, /SET search_path = pg_catalog/);
    assert.match(script, /REVOKE ALL ON FUNCTION \$\{rpcFunctionSignature\} FROM PUBLIC/);
    assert.match(script, /GRANT EXECUTE ON FUNCTION \$\{rpcFunctionSignature\}/);
    assert.match(script, /runtime_execute_grant_option/);
    assert.match(script, /public_execute_grant_option/);
    assert.match(script, /unexpected_acl_roles/);
    assert.match(script, /unexpected_grant_option_roles/);
    assert.match(
      script,
      /\)::text\[\] AS unexpected_acl_roles/,
      "pg returns name[] as an undecoded string; cast catalog role arrays to text[]",
    );
    assert.match(script, /\)::text\[\] AS unexpected_grant_option_roles/);
    assert.match(script, /runtime EXECUTE on the synthetic RPC function must not be grantable/);
    assert.match(script, /synthetic RPC function grants privileges to an unexpected role/);
    assert.match(script, /synthetic-transport-only-not-saved-search-policy-proof/);
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
    assert.match(script, /candidateName = "wrapped"/);
    assert.match(script, /\$\{candidateName\} p95/);
    assert.match(script, /\$\{candidateName\} p99/);
    assert.match(script, /connection acquisition p95/);
    assert.match(script, /transaction timeout/);
    assert.match(script, /warm-checked-out-sequential-select-1/);
    assert.match(script, /LOCALITY_RTT_MEASURED_QUERIES = 25/);
    assert.match(script, /SELECT 1 AS locality_probe/);
    assert.match(script, /Prisma target one-statement RPC candidate/);
    assert.match(script, /Prisma burst one-statement RPC candidate/);
    assert.match(script, /candidateName: "one-statement RPC"/);

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

  it("benchmarks a fail-closed one-statement SECURITY INVOKER candidate without disguising wrapper failures", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");
    const rpcRead = script.slice(
      script.indexOf("async function timedPrismaRpcRead"),
      script.indexOf("async function timedPrismaRpcCleanupProbe"),
    );
    const rpcCatalog = script.slice(
      script.indexOf("async function inspectRpcCanary"),
      script.indexOf("async function inspectRuntime"),
    );
    const rollbackProbe = script.slice(
      script.indexOf("async function runRollbackDisableProbe"),
      script.indexOf("function sample"),
    );
    const restoreRls = script.slice(
      script.indexOf("export async function restoreForcedRlsState"),
      script.indexOf("async function runRollbackDisableProbe"),
    );

    assert.equal((rpcRead.match(/\$queryRawUnsafe/g) ?? []).length, 1);
    assert.match(rpcRead, /buildRpcSelectSql\(config\), userId/);
    assert.doesNotMatch(rpcRead, /\$transaction/);
    assert.match(rpcCatalog, /p\.prosecdef AS security_definer/);
    assert.match(rpcCatalog, /p\.proleakproof AS leakproof/);
    assert.match(rpcCatalog, /p\.provolatile AS volatility/);
    assert.match(rpcCatalog, /p\.proconfig AS function_config/);
    assert.match(rpcCatalog, /function_acl\.grantee = 0/);
    assert.match(rpcCatalog, /PUBLIC must not retain EXECUTE/);
    assert.match(rpcCatalog, /runtime role has unexpected write privileges/);
    assert.match(rpcCatalog, /rerun the owner-only setup before provider-runtime evidence/);
    assert.match(rollbackProbe, /DROP FUNCTION \$\{buildRpcFunctionSignature\(config\)\}/);
    assert.match(rollbackProbe, /await admin\.query\("ROLLBACK"\)/);
    assert.match(rollbackProbe, /synthetic RPC function was not restored after owner transaction rollback/);
    assert.match(rollbackProbe, /await restoreForcedRlsState\(admin, config\)/);
    assert.match(restoreRls, /c\.relrowsecurity AS rls_enabled/);
    assert.match(restoreRls, /c\.relforcerowsecurity AS rls_forced/);
    assert.doesNotMatch(restoreRls, /\.catch\(\(\) => \{\}\)/);
    assert.match(script, /export async function teardownRpcCanary/);
    assert.match(script, /post-teardown function_absent/);
    assert.match(script, /if \(config\.teardownRpcProbe\)/);
    assert.match(script, /compareWorkloads\("Prisma target concurrency"/);
    assert.match(script, /compareWorkloads\("Prisma burst concurrency"/);
  });

  it("pins owner-only operations to the exact reviewed admin role and database", () => {
    const config = {
      adminDatabaseUsername: "grainline_migration_owner",
      expectedDatabaseName: "grainline_staging",
    };
    assert.doesNotThrow(() => assertReviewedAdminConnectionIdentity({
      current_user_name: "grainline_migration_owner",
      database_name: "grainline_staging",
      session_user_name: "grainline_migration_owner",
    }, config, "owner setup"));

    for (const row of [
      {
        current_user_name: "unexpected_owner",
        database_name: "grainline_staging",
        session_user_name: "grainline_migration_owner",
      },
      {
        current_user_name: "grainline_migration_owner",
        database_name: "other_database",
        session_user_name: "grainline_migration_owner",
      },
    ]) {
      assert.throws(
        () => assertReviewedAdminConnectionIdentity(row, config, "owner setup"),
        (error) => {
          assert.match(error.message, /does not match the reviewed admin URL identity and database/);
          assert.doesNotMatch(error.message, /unexpected_owner|other_database/);
          return true;
        },
      );
    }
  });

  it("does not issue RLS ALTERs when rollback-probe admin identity is unreviewed", async () => {
    const queries = [];
    let ended = false;
    const adminClient = {
      async connect() {},
      async end() {
        ended = true;
      },
      async query(sql) {
        queries.push(sql);
        if (sql.includes("current_user AS current_user_name")) {
          return {
            rows: [{
              current_user_name: "unexpected_owner",
              database_name: "grainline_staging",
              session_user_name: "unexpected_owner",
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };

    await assert.rejects(
      runRollbackDisableProbe({
        adminDatabaseUsername: "grainline_migration_owner",
        expectedDatabaseName: "grainline_staging",
        schemaName: "grainline_rls_canary",
        tableName: "context_canary",
      }, { adminClient }),
      /does not match the reviewed admin URL identity and database/,
    );
    assert.equal(queries.some((sql) => /ALTER TABLE/.test(sql)), false);
    assert.equal(ended, true);
  });

  it("restores and positively verifies forced RLS without swallowing cleanup failures", async () => {
    const config = { schemaName: "grainline_rls_canary", tableName: "context_canary" };
    const queries = [];
    const client = {
      async query(sql, parameters) {
        queries.push({ parameters, sql });
        if (sql.includes("FROM pg_class")) {
          return {
            rowCount: 1,
            rows: [{ rls_enabled: true, rls_forced: true }],
          };
        }
        return { rowCount: null, rows: [] };
      },
    };
    await restoreForcedRlsState(client, config);
    assert.match(queries[0].sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(queries[1].sql, /FORCE ROW LEVEL SECURITY/);
    assert.deepEqual(queries[2].parameters, [config.schemaName, config.tableName]);

    await assert.rejects(
      restoreForcedRlsState({
        async query(sql) {
          if (sql.includes("FORCE ROW LEVEL SECURITY")) throw new Error("force failed");
          return { rowCount: null, rows: [] };
        },
      }, config),
      /force failed/,
    );
    await assert.rejects(
      restoreForcedRlsState({
        async query(sql) {
          if (sql.includes("FROM pg_class")) {
            return { rowCount: 1, rows: [{ rls_enabled: true, rls_forced: false }] };
          }
          return { rowCount: null, rows: [] };
        },
      }, config),
      /failed to restore and verify ENABLE\/FORCE ROW LEVEL SECURITY/,
    );
  });

  it("mirrors the real app Prisma pool and does not invent adapter pool timings", () => {
    const script = source("scripts/rls-context-acceptance-gate.mjs");
    const db = source("src/lib/db.ts");
    const databaseUrl = source("src/lib/databaseUrl.ts");

    assert.match(script, /const PRISMA_APP_POOL_SIZE = 10/);
    assert.match(script, /createPrismaProbe\(config, \{ max: PRISMA_APP_POOL_SIZE \}\)/);
    assert.match(db, /max: 10/);
    assert.match(db, /runtimeDatabasePoolOptions\(requiredProductionEnv\("DATABASE_URL"\)\)/);
    assert.match(databaseUrl, /enableChannelBinding: true/);
    assert.match(script, /postgresChannelBindingClientOptions\(new URL\(config\.databaseUrl\)\)/);
    assert.match(script, /prismaPoolSize: PRISMA_APP_POOL_SIZE/);
    assert.match(script, /prismaPoolTimingAvailable: false/);
    assert.match(script, /rawPool=\$\{config\.poolSize\} prismaPool=\$\{PRISMA_APP_POOL_SIZE\}/);
    assert.match(script, /poolTimingAvailable: false/);
    assert.match(script, /acquire=unavailable; hold=unavailable/);
    assert.match(script, /baseline\.poolTimingAvailable && wrapped\.poolTimingAvailable/);
    assert.match(script, /concurrency: config\.burstConcurrency,[\s\S]*label: "Prisma burst one-statement RPC candidate"/);
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
    assert.match(agentContract, /captured separately outside the repository with mode `0600`/);
  });

  it("keeps owner-local setup evidence distinct from provider HTTP-response evidence", () => {
    const runbook = source("docs/runbook.md");
    const defense = source("docs/db-defense-in-depth-plan.md");
    const launch = source("docs/launch-checklist.md");
    const agentContract = source("CLAUDE.md");

    for (const [name, contract] of [
      ["runbook", runbook],
      ["defense plan", defense],
      ["launch checklist", launch],
      ["CLAUDE", agentContract],
    ]) {
      assertContractMatch(
        contract,
        /RLS_CONTEXT_GATE_EVIDENCE_PATH[\s\S]{0,700}(?:owner-only|local)[\s\S]{0,400}(?:setup|prepare|rollback|teardown)/i,
        `${name} must reserve RLS_CONTEXT_GATE_EVIDENCE_PATH for local owner operations`,
      );
      assertContractMatch(
        contract,
        /RLS_CONTEXT_GATE_EVIDENCE_PATH[\s\S]{0,900}(?:mode [`']?0600|writer enforces mode [`']?0600)/i,
        `${name} must require mode 0600 for local evidence-path artifacts`,
      );
      assertContractMatch(
        contract,
        /(?:capture|captured|retain|retained|write|written)[\s\S]{0,240}(?:sanitized )?(?:candidate )?(?:Preview )?HTTP\s+response[\s\S]{0,240}(?:separate|distinct|outside the repository)[\s\S]{0,240}(?:mode [`']?0600|local file)|(?:mode [`']?0600)[\s\S]{0,160}(?:sanitized )?(?:candidate )?(?:Preview )?HTTP\s+response[\s\S]{0,240}(?:separate|distinct|outside the repository)/i,
        `${name} must require separate mode-0600 capture of the provider HTTP response`,
      );
      assertContractMatch(
        contract,
        /provider(?:[\s\S]{0,300}HTTP)?\s+response[\s\S]{0,400}(?:is not|must not be|does not write)[\s\S]{0,200}(?:an )?RLS_CONTEXT_GATE_EVIDENCE_PATH/i,
        `${name} must not conflate a provider response with an evidence-path artifact`,
      );
    }
  });

  it("pins one exact provider manifest and branch-isolated Preview database configuration", () => {
    const runbook = source("docs/runbook.md");
    const defense = source("docs/db-defense-in-depth-plan.md");
    const launch = source("docs/launch-checklist.md");
    const agentContract = source("CLAUDE.md");
    const docs = [
      ["runbook", runbook],
      ["defense plan", defense],
      ["launch checklist", launch],
      ["CLAUDE", agentContract],
    ];
    const contract = docs.map(([, text]) => text).join("\n");
    const exactManifest = new Map([
      ["RLS_CONTEXT_GATE_CONFIRM", "staging-only"],
      ["RLS_CONTEXT_GATE_LOCALITY_CONFIRM", "production-runtime"],
      ["RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION", "sfo1"],
      ["RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION", "westus3.azure"],
      ["RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID", "ep-bold-recipe-aavx4plv"],
      ["RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME", "neondb"],
      ["RLS_CONTEXT_GATE_RUNTIME_ROLE", "grainline_app_runtime"],
      ["RLS_CONTEXT_GATE_REQUESTS", "500"],
      ["RLS_CONTEXT_GATE_WARMUP_REQUESTS", "50"],
      ["RLS_CONTEXT_GATE_TURNOVER_REQUESTS", "64"],
      ["RLS_CONTEXT_GATE_TARGET_CONCURRENCY", "8"],
      ["RLS_CONTEXT_GATE_BURST_CONCURRENCY", "16"],
      ["RLS_CONTEXT_GATE_POOL_SIZE", "16"],
      ["RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS", "10000"],
      ["RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS", "30000"],
      ["RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS", "35000"],
      ["RLS_CONTEXT_GATE_TX_TIMEOUT_MS", "5000"],
      ["RLS_CONTEXT_GATE_SCHEMA", "grainline_rls_canary"],
      ["RLS_CONTEXT_GATE_TABLE", "context_canary"],
    ]);
    const operationalManifestBlocks = docs
      .filter(([docName]) => docName !== "CLAUDE")
      .map(([docName, text]) => {
        const start = text.indexOf("RLS_CONTEXT_GATE_CONFIRM=staging-only");
        const endMarker = "RLS_CONTEXT_GATE_TABLE=context_canary";
        const end = text.indexOf(endMarker, start);
        assert.ok(start >= 0 && end >= start, `${docName} must contain one complete exact provider manifest block`);
        return [docName, text.slice(start, end + endMarker.length)];
      });

    for (const [name, value] of exactManifest) {
      assert.match(
        contract,
        new RegExp(`${name}=[\\"'\\x60]?${value.replaceAll(".", "\\.")}(?:[\\"'\\x60\\s]|$)`),
        `${name} must be pinned to ${value}`,
      );

      for (const [docName, manifestBlock] of operationalManifestBlocks) {
        const assignments = [
          ...manifestBlock.matchAll(
            new RegExp(`${escapeRegExp(name)}=[\\"'\\x60]?([A-Za-z0-9._-]+)`, "g"),
          ),
        ].map((match) => match[1]);

        assert.ok(assignments.length > 0, `${docName} must assign ${name} inside its exact manifest block`);
        assert.deepEqual(
          [...new Set(assignments.filter((assignment) => assignment !== value))],
          [],
          `${docName} must not contradict ${name}=${value}`,
        );
      }
    }
    for (const [docName, text] of docs) {
      assertContractMatch(
        text,
        /RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA[\s\S]{0,320}exact Git-integrated Preview(?:\s+gate)?\s+commit SHA[\s\S]{0,260}(?:not|different)[\s\S]{0,180}(?:cleaned )?production Release 0 SHA/i,
        `${docName} must pin the allowed Preview gate SHA without conflating it with the cleaned production Release 0 SHA`,
      );
    }
    assertContractMatch(contract, /(?:Prisma|application) (?:app )?pool(?: size)?[^\n.]{0,120}(?:`10`|10)/i, "manifest must pin the application Prisma pool to 10");
    assertContractMatch(contract, /fresh[^\n.]{0,160}RLS_CONTEXT_GATE_RUN_ID/i, "manifest must require a fresh run id");
    assertContractMatch(contract, /fresh[^\n.]{0,160}RLS_CONTEXT_GATE_TRIGGER_SECRET/i, "manifest must require a fresh trigger secret");

    const gate = source("scripts/rls-context-acceptance-gate.mjs");
    assert.match(gate, /const DEFAULT_RUN_CLAIM_TABLE = ["']context_gate_run_claim["']/);
    assert.match(gate, /const DEFAULT_POLICY = ["']context_canary_select["']/);
    assert.match(gate, /const DEFAULT_RPC_FUNCTION = ["']context_canary_rpc["']/);
    assertContractMatch(contract, /code(?: additionally)? pins?[\s\S]{0,180}context_gate_run_claim[\s\S]{0,180}context_canary_select[\s\S]{0,180}context_canary_rpc/i, "docs must retain the three code-pinned canary object names");

    const responseFields = [
      /HTTP [`']?200/i,
      /run\.status=runtime_candidate_passed/,
      /result\.issueCount=0/,
      /locality\.runtimeEvidenceCandidate=true/,
      /locality\.acceptanceEligible=false/,
      /(?:expected|requested) [`']?runner\.runSlot/i,
    ];
    for (const [name, text] of docs) {
      for (const field of responseFields) {
        assertContractMatch(text, field, `${name} must pin provider response field ${field}`);
      }
      assertContractMatch(
        text,
        /run\.commitSha[\s\S]{0,240}run\.deploymentId/i,
        `${name} must pin both provider deployment identity fields`,
      );
      assertContractMatch(
        text,
        /independent(?:ly)?[\s\S]{0,300}(?:attestation|attested|inspected)/i,
        `${name} must require independent provider deployment attestation`,
      );
    }

    for (const [name, text] of docs) {
      assertContractMatch(
        text,
        /branch-scoped(?=[\s\S]{0,600}`?DATABASE_URL`?)(?=[\s\S]{0,600}`?RLS_CONTEXT_GATE_DATABASE_URL`?)[\s\S]{0,900}same (?:(?:exact|byte-for-byte)\s+)?pooled\s+staging(?:\s+runtime(?:-role)?)?\s+URL/i,
        `${name} must put both branch-scoped database variables on the same runtime URL`,
      );
      assertContractMatch(
        text,
        /(?:configure|set|write)[\s\S]{0,500}(?:branch-scoped|Preview)[\s\S]{0,500}(?:before|prior to)[\s\S]{0,180}(?:push|attested gate commit|deploy)|(?:before|prior to)[\s\S]{0,180}(?:push|attested gate commit|deploy)[\s\S]{0,500}(?:configure|set|write)[\s\S]{0,500}(?:branch-scoped|Preview)/i,
        `${name} must configure branch-scoped Preview variables before push`,
      );
      assertContractMatch(
        text,
        /(?:Preview|branch-scoped)[\s\S]{0,800}(?:must not|never|absent|shows no)[\s\S]{0,350}DIRECT_URL/i,
        `${name} must exclude DIRECT_URL from the branch-scoped Preview`,
      );
      assertContractMatch(
        text,
        /(?:fresh )?read-only[\s\S]{0,180}(?:Vercel )?environment\/deployment inventory/i,
        `${name} must require a fresh read-only provider inventory`,
      );
    }
  });

  it("documents non-replayable claimed-slot recovery and the fail-closed promotion order", () => {
    const runbook = source("docs/runbook.md");
    const defense = source("docs/db-defense-in-depth-plan.md");
    const launch = source("docs/launch-checklist.md");
    const agentContract = source("CLAUDE.md");

    const docs = [
      ["runbook", runbook],
      ["defense plan", defense],
      ["launch checklist", launch],
      ["CLAUDE", agentContract],
    ];
    for (const [name, contract] of docs) {
      assertContractMatch(
        contract,
        /(?:exception|failure|timeout|500)[\s\S]{0,240}(?:after|once)[\s\S]{0,120}(?:durable )?(?:claim|claimed)[\s\S]{0,240}(?:consumes|consumed|do not|must not|never)/i,
        `${name} must treat a failure after durable claim as consuming the slot`,
      );
      assertContractMatch(
        contract,
        /(?:fresh[\s`']+RLS_CONTEXT_GATE_RUN_ID|fresh run id)[\s\S]{0,500}fresh Git-integrated (?:Preview )?deployment[\s\S]{0,300}(?:restart|begin again)[\s\S]{0,160}slot 1/i,
        `${name} must require a fresh run id, deployment, and slot-1 restart after a claimed-slot failure`,
      );
      assertContractMatch(
        contract,
        /(?:do not|must not|never)[\s\S]{0,320}(?:edit|repair|rewrite|reset)[\s\S]{0,220}(?:ledger|run-claim)/i,
        `${name} must forbid manual run-claim repair`,
      );
      assertContractMatch(
        contract,
        /(?:do not|must not|never)[^\n.]{0,220}(?:call|run|start)[^\n.]{0,100}slot 2/i,
        `${name} must forbid slot 2 after a claimed-slot failure`,
      );
      assertContractMatch(
        contract,
        /(?:corrected )?provider(?:-runtime)?(?: context\/performance)? (?:proof|repeats|responses)[\s\S]{0,350}(?:must pass|required|preconditions?)[\s\S]{0,350}before[\s\S]{0,220}production Release 0/i,
        `${name} must put corrected provider proof before production Release 0`,
      );
      assertContractMatch(contract, /Release 0[\s\S]{0,300}RLS (?:is|remains|must remain|still) off/i, `${name} must keep RLS off throughout Release 0`);
      assertContractMatch(
        contract,
        /Release 0[\s\S]{0,700}relrowsecurity=false[\s\S]{0,300}relforcerowsecurity=false[\s\S]{0,300}zero policies/i,
        `${name} must require live-catalog proof that SavedSearch RLS and FORCE remain off with zero policies before traffic`,
      );
      assertContractMatch(contract, /real(?:-table)? [`']?SavedSearch[`']? (?:proof|gate|staging proof)[\s\S]{0,350}before Phase A/i, `${name} must put real SavedSearch proof before Phase A`);
      assertContractMatch(contract, /Phase B[\s\S]{0,220}separate (?:reviewed )?(?:release|migration|pass)/i, `${name} must keep Phase B separate`);
      assertContractMatch(contract, /Bucket B[\s\S]{0,200}(?:explicitly )?paused[\s\S]{0,220}separate pass/i, `${name} must keep Bucket B paused for a separate pass`);
    }
  });

  it("labels the prior failed provider result as a dated historical baseline", () => {
    const contract = `${source("docs/runbook.md")}\n${source("docs/db-defense-in-depth-plan.md")}\n${source("docs/launch-checklist.md")}\n${source("CLAUDE.md")}`;

    assertContractMatch(contract, /Baseline recorded 2026-07-16[\s\S]{0,240}historical[\s\S]{0,240}not (?:the )?current (?:provider )?(?:inventory|evidence)/i, "the 2026-07-16 locality baseline must be labeled historical, not current inventory");
    assertContractMatch(contract, /(?:Historical (?:failed )?(?:provider-runtime )?result|provider-runtime result recorded) 2026-07-17/i, "the failed 2026-07-17 provider result must be explicitly historical");
    assertContractNotMatch(contract, /latest provider-runtime slot 1/i, "stale provider evidence must not be described as latest");
  });

  it("builds a sanitized evidence payload without database URLs", () => {
    const config = parseGateConfig(baseEnv());
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
    assert.equal(payload.database.rpcFunctionName, "context_canary_rpc");
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
    assert.deepEqual(payload.config.rpcCandidatePattern, {
      burstWorkers: 16,
      evidenceScope: "synthetic-transport-only-not-saved-search-policy-proof",
      execution: "one-statement-security-invoker-function",
      persistsBetweenProviderRuntimeRepeats: true,
      prismaPoolSize: 10,
    });
    assert.equal(payload.config.teardownRpcProbe, false);
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
        adminDatabaseUsername: decodeURIComponent(new URL(adminDatabaseUrl).username),
        burstConcurrency: 2,
        connectionTimeoutMs: 10_000,
        databaseUrl,
        expectedDatabaseName: decodeURIComponent(new URL(adminDatabaseUrl).pathname.slice(1)),
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
      assert.match(result.reports.join("\n"), /Prisma target one-statement RPC candidate/);
      assert.match(result.reports.join("\n"), /Prisma burst one-statement RPC candidate/);
      assert.match(result.reports.join("\n"), /scope=transport-only-not-saved-search-policy-proof/);
      assert.equal(result.locality.queryRttProxy.measuredQueries, 25);
      assert.equal(result.locality.queryRttProxy.warmupQueries, 5);

      const teardown = await runAcceptanceGate({
        ...config,
        prepare: false,
        rollbackProbe: false,
        teardownRpcProbe: true,
      });
      assert.deepEqual(teardown.issues, []);
      assert.match(teardown.reports.join("\n"), /post-teardown function_absent=true/);
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
