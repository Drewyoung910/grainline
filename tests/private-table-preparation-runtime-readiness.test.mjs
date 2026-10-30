import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  privateTablePreparationReleaseIds,
  verifyPrivateTablePreparationSource,
} from "../scripts/private-table-preparation-catalog.mjs";
import {
  PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS,
  collectPrivateTableRuntimeReadinessIssues,
  verifyPrivateTableRuntimeReadiness,
} from "../scripts/private-table-preparation-runtime-readiness.mjs";

const RUNTIME_URL = "postgresql://grainline_app_runtime:runtime-password@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const STAFF_URL = RUNTIME_URL.replace(
  "grainline_app_runtime:runtime-password",
  "grainline_staff_read_runtime:staff-password",
);
const productionEnv = Object.freeze({
  VERCEL: "1",
  VERCEL_ENV: "production",
  DATABASE_URL: RUNTIME_URL,
  ORDER_STAFF_READ_DATABASE_URL: STAFF_URL,
  RUNTIME_DB_ROLE: "grainline_app_runtime",
});

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const sourceByIdentity = new Map(
  privateTablePreparationReleaseIds("owner_social_verification_v1")
    .flatMap((releaseId) => {
      const verified = verifyPrivateTablePreparationSource(releaseId);
      return verified.release.functions.map((entry) => [
        `${entry.name}(${entry.arguments})`,
        verified.functionSources.get(entry.name),
      ]);
    }),
);

function readyRows(expectedFunctions, expectedRole) {
  return expectedFunctions.map((entry) => ({
    function_identity: entry.identity,
    current_user_name: expectedRole,
    session_user_name: expectedRole,
    database_name: "neondb",
    read_only: true,
    function_exists: true,
    function_execute: true,
    source: sourceByIdentity.get(entry.identity),
  }));
}

test("private-table readiness catalog covers the exact reviewed preparation batch", () => {
  assert.ok(PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.length > 0);
  assert.equal(
    new Set(PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.map((entry) => entry.identity)).size,
    PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.length,
  );
  for (const entry of PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS) {
    assert.equal(sha256(sourceByIdentity.get(entry.identity)), entry.sourceSha256);
    assert.ok(["runtime", "staff"].includes(entry.executeRole));
  }
});

test("readiness issue collector rejects missing, wrong-role and drifted functions", () => {
  const expected = PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.filter(
    (entry) => entry.executeRole === "runtime",
  );
  assert.deepEqual(
    collectPrivateTableRuntimeReadinessIssues(
      readyRows(expected, "grainline_app_runtime"),
      expected,
      "grainline_app_runtime",
    ),
    [],
  );
  const issues = collectPrivateTableRuntimeReadinessIssues(
    readyRows(expected.slice(1), "wrong_role").map((row, index) => (
      index === 0 ? { ...row, source: "drifted" } : row
    )),
    expected,
    "grainline_app_runtime",
  ).join("\n");
  assert.match(issues, /inventory is not exact/u);
  assert.match(issues, /database identity drifted/u);
  assert.match(issues, /body drifted/u);
  assert.match(issues, /missing required function/u);
});

test("readiness gate skips non-production builds without connecting", async () => {
  let constructed = false;
  class NeverClient {
    constructor() { constructed = true; }
  }
  assert.deepEqual(
    await verifyPrivateTableRuntimeReadiness({
      env: { VERCEL: "1", VERCEL_ENV: "preview" },
      ClientImpl: NeverClient,
    }),
    { enforced: false, environment: "preview" },
  );
  assert.equal(constructed, false);
});

test("production readiness checks runtime and staff functions read-only", async () => {
  const calls = [];
  class FixtureClient {
    constructor(config) {
      assert.equal(config.enableChannelBinding, true);
      assert.equal(config.ssl.rejectUnauthorized, true);
      this.staff = config.application_name.includes("staff");
    }
    async connect() { calls.push(this.staff ? "staff-connect" : "runtime-connect"); }
    async query(sql, values) {
      calls.push(`${this.staff ? "staff" : "runtime"}:${sql}`);
      if (/WITH expected/u.test(sql)) {
        const role = this.staff
          ? "grainline_staff_read_runtime"
          : "grainline_app_runtime";
        const expected = PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.filter(
          (entry) => entry.executeRole === (this.staff ? "staff" : "runtime"),
        );
        assert.deepEqual(values, [expected.map((entry) => entry.identity)]);
        return { rows: readyRows(expected, role) };
      }
      return { rows: [] };
    }
    async end() { calls.push(this.staff ? "staff-end" : "runtime-end"); }
  }
  const runtimeCount = PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.filter(
    (entry) => entry.executeRole === "runtime",
  ).length;
  const staffCount = PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.length - runtimeCount;
  assert.deepEqual(
    await verifyPrivateTableRuntimeReadiness({
      env: productionEnv,
      ClientImpl: FixtureClient,
    }),
    {
      enforced: true,
      environment: "production",
      releaseSelection: "owner_social_verification_v1",
      runtimeFunctionCount: runtimeCount,
      staffFunctionCount: staffCount,
      readOnly: true,
    },
  );
  assert.ok(calls.some((call) => call.includes("runtime:BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")));
  assert.ok(calls.some((call) => call.includes("staff:BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")));
  assert.deepEqual(calls.slice(-2), ["staff:COMMIT", "staff-end"]);
});

test("production readiness fails closed when a reviewed function is absent", async () => {
  class FixtureClient {
    constructor(config) { this.staff = config.application_name.includes("staff"); }
    async connect() {}
    async query(sql) {
      if (/WITH expected/u.test(sql)) return { rows: [] };
      return { rows: [] };
    }
    async end() {}
  }
  await assert.rejects(
    verifyPrivateTableRuntimeReadiness({
      env: productionEnv,
      ClientImpl: FixtureClient,
    }),
    /preparation is absent or authority drifted/u,
  );
});
