import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS,
  PROVIDER_BYPASS_STATE_PATH,
  PROVIDER_ENVIRONMENT_KEYS,
  PROVIDER_ENVIRONMENT_VALUES,
  PROVIDER_PROOF_BRANCH,
  PROVIDER_PROOF_STATE_PATH,
  REVIEWED_PRODUCTION_BRANCH_ID,
  REVIEWED_STAGING_BRANCH_ID,
  buildStagingDatabaseUrl,
  providerEnvironmentEntries,
  validateDatabaseUrl,
} from "../scripts/notification-provider-proof-operator.mjs";

const RUNTIME_PASSWORD = "a".repeat(64);
const OWNER_PASSWORD = "b".repeat(16);

describe("disposable Notification provider proof operator", () => {
  it("builds only the exact reviewed staging database identities", () => {
    assert.notEqual(REVIEWED_STAGING_BRANCH_ID, REVIEWED_PRODUCTION_BRANCH_ID);
    const runtime = buildStagingDatabaseUrl("grainline_app_runtime", RUNTIME_PASSWORD, {
      pooled: true,
    });
    const owner = buildStagingDatabaseUrl("neondb_owner", OWNER_PASSWORD, {
      pooled: false,
    });

    assert.equal(
      new URL(runtime).hostname,
      "ep-bold-recipe-aavx4plv-pooler.westus3.azure.neon.tech",
    );
    assert.equal(new URL(owner).hostname, "ep-bold-recipe-aavx4plv.westus3.azure.neon.tech");
    assert.equal(new URL(runtime).port, "5432");
    assert.equal(new URL(runtime).pathname, "/neondb");
    assert.equal(new URL(runtime).searchParams.get("sslmode"), "verify-full");
    assert.equal(new URL(runtime).searchParams.get("channel_binding"), "require");
    assert.equal(
      validateDatabaseUrl(runtime, { pooled: true, role: "grainline_app_runtime" }),
      runtime,
    );
    assert.throws(() => validateDatabaseUrl(
      runtime.replace("ep-bold-recipe-aavx4plv", "ep-plain-river-aaqg8gj4"),
      { pooled: true, role: "grainline_app_runtime" },
    ));
  });

  it("pins exactly 24 branch-scoped Preview variables with no owner authority", () => {
    const runtimeDatabaseUrl = buildStagingDatabaseUrl(
      "grainline_app_runtime",
      RUNTIME_PASSWORD,
      { pooled: true },
    );
    const entries = providerEnvironmentEntries({
      commitSha: "a".repeat(40),
      runId: `notification-b-${"c".repeat(36)}`,
      runtimeDatabaseUrl,
      triggerSecret: "d".repeat(64),
    });

    assert.equal(entries.length, 24);
    assert.deepEqual(entries.map((entry) => entry.key), PROVIDER_ENVIRONMENT_KEYS);
    assert.equal(new Set(entries.map((entry) => entry.key)).size, 24);
    assert.equal(entries.every((entry) => entry.gitBranch === PROVIDER_PROOF_BRANCH), true);
    assert.equal(entries.every((entry) => entry.type === "sensitive"), true);
    assert.equal(entries.every((entry) => JSON.stringify(entry.target) === '["preview"]'), true);
    assert.equal(
      entries.find((entry) => entry.key === "DATABASE_URL").value,
      entries.find((entry) => entry.key === "RLS_CONTEXT_GATE_DATABASE_URL").value,
    );
    assert.deepEqual(
      entries.map((entry) => entry.key).filter((key) => FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(key)),
      [],
    );
    assert.equal(PROVIDER_ENVIRONMENT_VALUES.RLS_CONTEXT_GATE_REQUESTS, "500");
    assert.equal(PROVIDER_ENVIRONMENT_VALUES.RLS_CONTEXT_GATE_POOL_SIZE, "16");
  });

  it("keeps cleanup exact, production-excluding, and secret-state deleting", () => {
    const source = readFileSync("scripts/notification-provider-proof-operator.mjs", "utf8");

    assert.match(source, /REVIEWED_STAGING_BRANCH_ID === REVIEWED_PRODUCTION_BRANCH_ID/);
    assert.match(source, /deployment\.id === REVIEWED_PRODUCTION_DEPLOYMENT_ID/);
    assert.match(source, /NOTIFICATION_PROVIDER_PROOF_CLEANUP_CONFIRM/);
    assert.match(source, /delete-disposable-preview-and-staging/);
    assert.match(source, /delete-failed-disposable-preview-and-staging/);
    assert.match(source, /ownerOnlyFixtureTeardownPassed/);
    assert.match(source, /branchEnvironmentVariablesDeleted/);
    assert.match(source, /\^v24\\\./);
    assert.match(source, /configuredNodeVersion/);
    assert.match(source, /unlinkSync\(PROVIDER_PROOF_STATE_PATH\)/);
    assert.match(source, /unlinkSync\(PROVIDER_BYPASS_STATE_PATH\)/);
    assert.equal(PROVIDER_PROOF_STATE_PATH.startsWith("/private/tmp/"), true);
    assert.equal(PROVIDER_BYPASS_STATE_PATH.startsWith("/private/tmp/"), true);
    assert.doesNotMatch(source, /console\.log\([^\n]*(?:triggerSecret|runtimeDatabaseUrl|adminDatabaseUrl|bypassSecret)/);
  });
});
