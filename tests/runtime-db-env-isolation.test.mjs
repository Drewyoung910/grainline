import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoNotificationRlsDraftDeployment,
  assertVercelRuntimeDatabaseIsolation,
  NOTIFICATION_PROVIDER_PROOF,
  notificationProviderProofDeploymentIsReviewed,
  privilegedDatabaseEnvironmentKeys,
  runtimeDatabaseIsolationFailureCode,
  runtimeDatabaseIsolationFailureDetail,
  unreviewedPostgresUrlEnvironmentKeys,
} from "../scripts/guard-runtime-db-env.mjs";

const RUNTIME_URL = "postgresql://grainline_app_runtime:runtime-password@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const PROVIDER_PROOF_URL = "postgresql://grainline_app_runtime:runtime-password@ep-mute-shape-aahq7xma-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const PROVIDER_PROOF_SHA = "a".repeat(40);

function productionEnv(overrides = {}) {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: RUNTIME_URL,
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    ...overrides,
  };
}

function providerProofEnv(overrides = {}) {
  return {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: NOTIFICATION_PROVIDER_PROOF.branch,
    VERCEL_GIT_COMMIT_SHA: PROVIDER_PROOF_SHA,
    DATABASE_URL: PROVIDER_PROOF_URL,
    RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA: PROVIDER_PROOF_SHA,
    RLS_CONTEXT_GATE_CONFIRM: "staging-only",
    RLS_CONTEXT_GATE_DATABASE_URL: PROVIDER_PROOF_URL,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: NOTIFICATION_PROVIDER_PROOF.endpointId,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME: NOTIFICATION_PROVIDER_PROOF.databaseName,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: NOTIFICATION_PROVIDER_PROOF.region,
    RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "production-runtime",
    RLS_CONTEXT_GATE_RUNTIME_ROLE: NOTIFICATION_PROVIDER_PROOF.runtimeRole,
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

  it("allows drafts and the duplicate URL only for the exact disposable provider proof", () => {
    const env = providerProofEnv();
    assert.equal(notificationProviderProofDeploymentIsReviewed(env), true);
    assert.doesNotThrow(() => assertNoNotificationRlsDraftDeployment(env, true));
    assert.deepEqual(unreviewedPostgresUrlEnvironmentKeys(env), []);
    assert.deepEqual(assertVercelRuntimeDatabaseIsolation(env), {
      enforced: true,
      provider: "vercel",
      environment: "preview",
      runtimeDatabaseVerified: true,
      endpointId: NOTIFICATION_PROVIDER_PROOF.endpointId,
      databaseName: NOTIFICATION_PROVIDER_PROOF.databaseName,
      region: NOTIFICATION_PROVIDER_PROOF.region,
      runtimeRole: NOTIFICATION_PROVIDER_PROOF.runtimeRole,
    });
  });

  it("keeps the provider exception fail-closed across identity and artifact drift", () => {
    const cases = [
      { VERCEL_ENV: "production" },
      { VERCEL_GIT_COMMIT_REF: "main" },
      { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
      { RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA: "not-a-sha" },
      { RLS_CONTEXT_GATE_CONFIRM: "production" },
      { RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "diagnostic-only" },
      { RLS_CONTEXT_GATE_DATABASE_URL: PROVIDER_PROOF_URL.replace("runtime-password", "other-password") },
      { RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: "ep-other" },
    ];
    for (const drift of cases) {
      const env = providerProofEnv(drift);
      assert.equal(notificationProviderProofDeploymentIsReviewed(env), false);
      assert.throws(() => assertNoNotificationRlsDraftDeployment(env, true), /deployment is barred/);
    }
    assert.equal(
      notificationProviderProofDeploymentIsReviewed(
        providerProofEnv(),
        { rootDirectory: "/definitely/missing/provider-proof-root" },
      ),
      false,
    );
    assert.throws(
      () => assertVercelRuntimeDatabaseIsolation(
        providerProofEnv({ EXTRA_DATABASE_URL: PROVIDER_PROOF_URL }),
      ),
      /PostgreSQL URLs outside DATABASE_URL/,
    );
  });

  it("never reviews an ordinary Preview PostgreSQL alias", () => {
    const env = {
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROVIDER_PROOF_URL,
      RLS_CONTEXT_GATE_DATABASE_URL: PROVIDER_PROOF_URL,
    };
    assert.equal(notificationProviderProofDeploymentIsReviewed(env), false);
    assert.deepEqual(unreviewedPostgresUrlEnvironmentKeys(env), [
      "RLS_CONTEXT_GATE_DATABASE_URL",
    ]);
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
