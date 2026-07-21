import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
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
});
