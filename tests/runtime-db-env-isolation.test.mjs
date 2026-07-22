import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoNotificationRlsDraftDeployment,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  runtimeDatabaseIsolationFailureCode,
  runtimeDatabaseIsolationFailureDetail,
  unreviewedPostgresUrlEnvironmentKeys,
} from "../scripts/guard-runtime-db-env.mjs";

const RUNTIME_URL = "postgresql://grainline_app_runtime:runtime-password@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function productionEnv(overrides = {}) {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: RUNTIME_URL,
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    ...overrides,
  };
}

describe("Vercel runtime database environment isolation", () => {
  it("bars Vercel deployment while the unapplied Notification draft is present", () => {
    assert.throws(
      () => assertNoNotificationRlsDraftDeployment({ VERCEL: "1" }, true),
      (error) => {
        assert.match(
          error.message,
          /deployment is barred while the unapplied Notification RLS draft is present/,
        );
        assert.equal(
          runtimeDatabaseIsolationFailureCode(error),
          "NOTIFICATION_RLS_DRAFT_PRESENT",
        );
        return true;
      },
    );
    assert.doesNotThrow(() => assertNoNotificationRlsDraftDeployment({}, true));
    assert.doesNotThrow(() => assertNoNotificationRlsDraftDeployment({ VERCEL: "1" }, false));
  });

  it("accepts only the reviewed pooled production runtime identity", () => {
    assert.deepEqual(assertVercelRuntimeDatabaseIsolation(productionEnv()), {
      enforced: true,
      provider: "vercel",
      environment: "production",
      runtimeDatabaseVerified: true,
      endpointId: "ep-plain-river-aaqg8gj4",
      databaseName: "neondb",
      region: "westus3.azure",
      runtimeRole: "grainline_app_runtime",
    });
  });

  it("rejects every current or future-shaped privileged database variable", () => {
    const forbidden = [
      "DIRECT_URL",
      "MIGRATION_DB_ROLE",
      "GRANT_AUDIT_DATABASE_URL",
      "RLS_CONTEXT_GATE_ADMIN_DATABASE_URL",
      "SAVED_SEARCH_FORCE_PROOF_DIRECT_URL",
    ];
    assert.deepEqual(
      privilegedDatabaseEnvironmentKeys(Object.fromEntries(forbidden.map((key) => [key, ""]))),
      [...forbidden].sort((left, right) => left.localeCompare(right)),
    );
    for (const key of forbidden) {
      assert.throws(
        () => assertVercelRuntimeDatabaseIsolation(productionEnv({ [key]: "present" })),
        /must not receive privileged database environment keys/,
      );
    }
  });

  it("rejects a PostgreSQL owner URL hidden under an unrecognized key", () => {
    const hidden = {
      OWNER_CONNECTION: ` ${RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner")
        .replace("-pooler", "")}`,
    };
    assert.deepEqual(unreviewedPostgresUrlEnvironmentKeys(hidden), ["OWNER_CONNECTION"]);
    assert.throws(
      () => assertVercelRuntimeDatabaseIsolation(productionEnv(hidden)),
      /PostgreSQL URLs outside DATABASE_URL/,
    );
  });

  it("rejects owner, direct, wrong endpoint, and wrong declared role production URLs", () => {
    const cases = [
      {
        DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner"),
      },
      {
        DATABASE_URL: RUNTIME_URL.replace("-pooler", ""),
      },
      {
        DATABASE_URL: RUNTIME_URL.replace("ep-plain-river-aaqg8gj4", "ep-other-endpoint"),
      },
      { RUNTIME_DB_ROLE: "neondb_owner" },
    ];
    for (const drift of cases) {
      assert.throws(() => assertVercelRuntimeDatabaseIsolation(productionEnv(drift)));
    }
  });

  it("allows a database-free preview but still rejects privileged variables", () => {
    assert.deepEqual(assertVercelRuntimeDatabaseIsolation({
      VERCEL: "1",
      VERCEL_ENV: "preview",
    }), {
      enforced: true,
      provider: "vercel",
      environment: "preview",
      runtimeDatabaseVerified: false,
    });
    assert.throws(() => assertVercelRuntimeDatabaseIsolation({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DIRECT_URL: "",
    }));
  });

  it("does not impose Vercel-only identity checks on local or CI builds", () => {
    assert.deepEqual(assertVercelRuntimeDatabaseIsolation({}), {
      enforced: false,
      provider: null,
      environment: null,
    });
  });

  it("reports only bounded diagnostic codes for build-time failures", () => {
    const cases = [
      [new Error("Vercel deployment is barred while the unapplied Notification RLS draft is present"), "NOTIFICATION_RLS_DRAFT_PRESENT"],
      [{ DIRECT_URL: "secret" }, "PRIVILEGED_DATABASE_KEYS"],
      [{ DATABASE_URL: RUNTIME_URL.replace("verify-full", "require") }, "DATABASE_URL_PARAMETERS"],
      [{ DATABASE_URL: RUNTIME_URL.replace("-pooler", "") }, "DATABASE_URL_NOT_POOLED"],
      [{ RUNTIME_DB_ROLE: "unexpected-role" }, "PRODUCTION_RUNTIME_IDENTITY"],
    ];
    for (const [input, expected] of cases) {
      const invoke = input instanceof Error
        ? () => { throw input; }
        : () => assertVercelRuntimeDatabaseIsolation(productionEnv(input));
      assert.throws(invoke, (error) => {
        const code = runtimeDatabaseIsolationFailureCode(error);
        assert.equal(code, expected);
        assert.doesNotMatch(code, /secret|password|postgresql:/i);
        return true;
      });
    }
    assert.equal(runtimeDatabaseIsolationFailureCode(new Error("unexpected secret detail")), "UNCLASSIFIED");
    assert.equal(
      runtimeDatabaseIsolationFailureDetail("PRIVILEGED_DATABASE_KEYS", {
        DIRECT_URL: "do-not-print",
        RLS_PROOF_DIRECT_URL: "do-not-print",
        SAFE: "do-not-print",
      }),
      "DIRECT_URL,RLS_PROOF_DIRECT_URL",
    );
    assert.equal(
      runtimeDatabaseIsolationFailureDetail("ALIASED_DATABASE_URL", {
        OWNER_CONNECTION: RUNTIME_URL,
        DATABASE_URL: RUNTIME_URL,
      }),
      "OWNER_CONNECTION",
    );
    assert.equal(runtimeDatabaseIsolationFailureDetail("DATABASE_URL_PARAMETERS", {
      DIRECT_URL: "do-not-print",
    }), "");
  });
});
