import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_DELETION_APPLICATION_FUNCTIONS,
  ACCOUNT_DELETION_RUNTIME_FUNCTIONS,
  collectAccountDeletionApplicationReadinessIssues,
  collectAccountDeletionRuntimeReadinessIssues,
  verifyAccountDeletionRuntimeReadiness,
} from "../scripts/account-deletion-runtime-readiness.mjs";

const RUNTIME_URL = "postgresql://grainline_app_runtime:runtime-password@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const productionEnv = Object.freeze({
  VERCEL: "1",
  VERCEL_ENV: "production",
  DATABASE_URL: RUNTIME_URL,
  ORDER_STAFF_READ_DATABASE_URL: RUNTIME_URL.replace(
    "grainline_app_runtime:runtime-password",
    "grainline_staff_read_runtime:staff-password",
  ),
  ACCOUNT_DELETION_DATABASE_URL: RUNTIME_URL.replace(
    "grainline_app_runtime:runtime-password",
    "grainline_account_deletion_runtime:account-deletion-password",
  ),
  RUNTIME_DB_ROLE: "grainline_app_runtime",
});

function readyRows(overrides = {}) {
  return ACCOUNT_DELETION_RUNTIME_FUNCTIONS.map((functionIdentity) => ({
    function_identity: functionIdentity,
    current_user_name: "grainline_account_deletion_runtime",
    session_user_name: "grainline_account_deletion_runtime",
    database_name: "neondb",
    read_only: true,
    role_restricted: true,
    schema_usage: true,
    schema_create: false,
    table_crud: true,
    function_exists: true,
    function_execute: true,
    ...overrides,
  }));
}

function readyApplicationRows(overrides = {}) {
  return ACCOUNT_DELETION_APPLICATION_FUNCTIONS.map((functionIdentity) => ({
    function_identity: functionIdentity,
    current_user_name: "grainline_app_runtime",
    session_user_name: "grainline_app_runtime",
    database_name: "neondb",
    read_only: true,
    function_exists: true,
    function_execute: true,
    ...overrides,
  }));
}

test("readiness validator requires exact prepared worker authority", () => {
  assert.deepEqual(collectAccountDeletionRuntimeReadinessIssues(readyRows()), []);
  const issues = collectAccountDeletionRuntimeReadinessIssues([
    ...readyRows({ function_execute: false }).slice(0, 2),
  ]).join("\n");
  assert.match(issues, /missing required function/);
  assert.match(issues, /function inventory is not exact/);
  assert.match(issues, /lacks effective EXECUTE/);
});

test("readiness validator requires the regular-runtime media enqueue authority", () => {
  assert.deepEqual(
    collectAccountDeletionApplicationReadinessIssues(readyApplicationRows()),
    [],
  );
  const issues = collectAccountDeletionApplicationReadinessIssues([
    ...readyApplicationRows({ function_execute: false }),
  ]).join("\n");
  assert.match(issues, /lacks effective EXECUTE/u);
  assert.match(
    collectAccountDeletionApplicationReadinessIssues([]).join("\n"),
    /missing required application function/u,
  );
});

test("readiness gate skips non-production builds without connecting", async () => {
  let constructed = false;
  class NeverClient {
    constructor() { constructed = true; }
  }
  assert.deepEqual(
    await verifyAccountDeletionRuntimeReadiness({
      env: { VERCEL: "1", VERCEL_ENV: "preview" },
      ClientImpl: NeverClient,
    }),
    { enforced: false, environment: "preview" },
  );
  assert.equal(constructed, false);
});

test("production readiness checks worker and application authority read-only", async () => {
  const calls = [];
  class FixtureClient {
    constructor(config) {
      assert.equal(config.enableChannelBinding, true);
      assert.equal(config.ssl.rejectUnauthorized, true);
      assert.doesNotMatch(config.application_name, /password/u);
      this.application = config.application_name.includes("application");
    }
    async connect() { calls.push(this.application ? "application-connect" : "worker-connect"); }
    async query(sql, values) {
      calls.push(`${this.application ? "application" : "worker"}:${sql}`);
      if (/WITH expected/u.test(sql)) {
        if (this.application) {
          assert.deepEqual(values, [ACCOUNT_DELETION_APPLICATION_FUNCTIONS]);
          return { rows: readyApplicationRows() };
        }
        assert.deepEqual(values, [ACCOUNT_DELETION_RUNTIME_FUNCTIONS]);
        assert.doesNotMatch(sql, /FROM public\."AccountDeletionSideEffect"/u);
        return { rows: readyRows() };
      }
      return { rows: [] };
    }
    async end() { calls.push(this.application ? "application-end" : "worker-end"); }
  }
  const result = await verifyAccountDeletionRuntimeReadiness({
    env: productionEnv,
    ClientImpl: FixtureClient,
  });
  assert.deepEqual(result, {
    enforced: true,
    environment: "production",
    role: "grainline_account_deletion_runtime",
    preparedFunctionCount: 3,
    applicationFunctionCount: 1,
    readOnly: true,
  });
  assert.ok(calls.some((call) => /worker:BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u.test(call)));
  assert.ok(calls.some((call) => /application:BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u.test(call)));
  assert.deepEqual(calls.slice(-2), ["application-end", "worker-end"]);
});

test("production readiness fails closed without exposing provider detail", async () => {
  class FixtureClient {
    constructor(config) { this.application = config.application_name.includes("application"); }
    async connect() {}
    async query(sql) {
      if (/WITH expected/u.test(sql)) {
        return { rows: this.application ? readyApplicationRows() : readyRows({ table_crud: false }) };
      }
      return { rows: [] };
    }
    async end() {}
  }
  await assert.rejects(
    verifyAccountDeletionRuntimeReadiness({ env: productionEnv, ClientImpl: FixtureClient }),
    /preparation is absent or authority drifted/u,
  );
});

test("production readiness fails closed when the media enqueue RPC is absent", async () => {
  class FixtureClient {
    constructor(config) { this.application = config.application_name.includes("application"); }
    async connect() {}
    async query(sql) {
      if (/WITH expected/u.test(sql)) {
        return { rows: this.application ? [] : readyRows() };
      }
      return { rows: [] };
    }
    async end() {}
  }
  await assert.rejects(
    verifyAccountDeletionRuntimeReadiness({ env: productionEnv, ClientImpl: FixtureClient }),
    /preparation is absent or authority drifted/u,
  );
});
