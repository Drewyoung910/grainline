import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEPLOYMENT_ID,
  DEPLOYMENT_SOURCE_COMMIT,
  DEPLOYMENT_SOURCE_REF,
  POSTFLIGHT_CONFIRMATION,
  buildPostflightEvidence,
  normalizeDeploymentState,
  normalizeGithubRun,
  normalizeLiveRoutes,
  normalizeRuntimeRlsProof,
  parsePostflightConfig,
  runPostflight,
} from "../scripts/runtime-db-credential-separation-postflight.mjs";

const OPERATOR_COMMIT = "a".repeat(40);
const OWNER_URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RUNTIME_URL = "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function config() {
  return parsePostflightConfig({
    RUNTIME_DB_SEPARATION_POSTFLIGHT_CONFIRM: POSTFLIGHT_CONFIRMATION,
    RUNTIME_DB_SEPARATION_POSTFLIGHT_OPERATOR_COMMIT: OPERATOR_COMMIT,
    RUNTIME_DB_SEPARATION_POSTFLIGHT_EVIDENCE_PATH:
      "/Users/drewyoung/grainline-rollout-evidence/test-postflight.json",
  }, new Date("2026-07-21T23:00:00.000Z"), {
    ownerDirectUrl: OWNER_URL,
    runtimeDatabaseUrl: RUNTIME_URL,
  });
}

function databaseState() {
  return {
    identity: { database_name: "neondb", current_user_name: "neondb_owner", session_user_name: "neondb_owner" },
    ownerRole: {
      rolname: "neondb_owner", rolsuper: false, rolcreatedb: true, rolcreaterole: true,
      rolinherit: true, rolcanlogin: true, rolreplication: true, rolbypassrls: true,
      memberships: ["grainline_app_runtime", "neon_superuser"],
      membership_options: [
        { role: "grainline_app_runtime", adminOption: true, inheritOption: false, setOption: false },
        { role: "neon_superuser", adminOption: false, inheritOption: true, setOption: true },
      ],
    },
    runtimeRole: {
      rolname: "grainline_app_runtime", rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolinherit: false, rolcanlogin: true, rolreplication: false,
      rolbypassrls: false, memberships: [], membership_options: [],
    },
    savedSearch: {
      rls_enabled: true, rls_forced: true, owner_name: "neondb_owner", policy_count: 3,
    },
    incompleteMigrationCount: 0,
  };
}

function dependencies() {
  return {
    readGitState: () => ({ head: OPERATOR_COMMIT, status: "" }),
    readResetProof: () => ({ accepted: true, oldCredentialRejected: true }),
    readPhaseBProof: () => ({ accepted: true }),
    readVercelState: () => ({
      stage: "runtime-only", presentPrivilegedKeys: [], projectPrivilegedKeys: [],
      sharedPrivilegedLinks: [], linkedSharedDatabaseKeys: ["DATABASE_URL"],
    }),
    readGithubState: () => ({
      protectionVerified: true,
      migrationSecret: { name: "PRODUCTION_MIGRATION_DIRECT_URL", updatedAt: "now" },
      digestVariable: {
        name: "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
        value: "2753b069cd2b60e557b3146869de053fb035e27e3f5a737b75abe4cf9ddffaf3",
        updatedAt: "now",
      },
    }),
    verifyNeonTarget: () => true,
    readNeonRole: () => ({ updatedAt: "2026-07-21T22:01:31.000Z" }),
    readDatabaseState: async () => databaseState(),
    readOwnerState: async () => ({
      canary: {
        bucket: "2026-07-20T06",
        status: "COMPLETED",
        started_at: new Date("2026-07-20T06:20:45.220Z"),
        completed_at: new Date("2026-07-20T06:20:45.580Z"),
        result: {
          ok: true,
          savedSearchRlsCanaryStatus: "healthy",
          savedSearchRlsCanaryIssueCount: 0,
        },
      },
    }),
    readOwnerSessionCount: async () => 0,
    readRuntimeProof: async () => ({ runtimeRole: "grainline_app_runtime", noContextRowCount: 0 }),
    readDeploymentState: () => ({ id: DEPLOYMENT_ID, sourceCommit: DEPLOYMENT_SOURCE_COMMIT }),
    readCiRun: () => ({ id: 29877480616, conclusion: "success" }),
    readMigrationRun: () => ({ id: 29872336361, conclusion: "success" }),
    readRoutes: async () => [{ path: "/", status: 200 }, { path: "/api/health", status: 200 }],
  };
}

describe("runtime database credential separation postflight", () => {
  it("rejects ambient credentials and accepts exact local identities", () => {
    assert.equal(config().runtimeGuard.runtimeDatabaseVerified, true);
    assert.throws(() => parsePostflightConfig({
      RUNTIME_DB_SEPARATION_POSTFLIGHT_CONFIRM: POSTFLIGHT_CONFIRMATION,
      RUNTIME_DB_SEPARATION_POSTFLIGHT_OPERATOR_COMMIT: OPERATOR_COMMIT,
      RUNTIME_DB_SEPARATION_POSTFLIGHT_EVIDENCE_PATH:
        "/Users/drewyoung/grainline-rollout-evidence/test-postflight.json",
      DIRECT_URL: OWNER_URL,
    }, new Date(), { ownerDirectUrl: OWNER_URL, runtimeDatabaseUrl: RUNTIME_URL }), /ambient/);
  });

  it("pins successful GitHub runs, deployment aliases, runtime denial, and live routes", () => {
    assert.equal(normalizeGithubRun({
      id: 1, name: "CI", event: "push", head_sha: DEPLOYMENT_SOURCE_COMMIT,
      status: "completed", conclusion: "success",
    }, { id: 1, name: "CI", headSha: DEPLOYMENT_SOURCE_COMMIT, event: null }).conclusion, "success");
    assert.throws(() => normalizeGithubRun({
      id: 2, name: "Production Migrations", event: "push",
      head_sha: DEPLOYMENT_SOURCE_COMMIT, status: "completed", conclusion: "success",
    }, {
      id: 2, name: "Production Migrations", event: "workflow_dispatch",
      headSha: DEPLOYMENT_SOURCE_COMMIT,
    }), /drifted/);
    const deployment = normalizeDeploymentState({
      id: DEPLOYMENT_ID, readyState: "READY", target: "production",
      meta: {
        gitCommitSha: DEPLOYMENT_SOURCE_COMMIT,
        gitCommitRef: DEPLOYMENT_SOURCE_REF,
      },
    }, ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app"].map((alias) => ({
      alias, id: DEPLOYMENT_ID, readyState: "READY", target: "production",
    })));
    assert.equal(deployment.aliases.length, 3);
    assert.equal(normalizeRuntimeRlsProof({
      current_user_name: "grainline_app_runtime", session_user_name: "grainline_app_runtime",
      rolbypassrls: false, app_user_id: null, saved_search_count: 0,
    }, {
      app_user_id: "grainline_postflight_nonexistent_user", saved_search_count: 0,
    }, { app_user_id: null, saved_search_count: 0 }).cleanupContextCleared, true);
    assert.equal(normalizeLiveRoutes([
      { path: "/", status: 200, contentType: "text/html; charset=utf-8" },
      { path: "/api/health", status: 200, contentType: "application/json" },
    ]).length, 2);
  });

  it("builds acceptance evidence only after every live proof passes", async () => {
    const result = await runPostflight(config(), dependencies());
    const evidence = buildPostflightEvidence(config(), result);
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.acceptanceEligible, true);
    assert.equal(evidence.issueCount, 0);
    assert.equal(evidence.deployment.id, DEPLOYMENT_ID);
    const serialized = JSON.stringify(evidence);
    assert.equal(serialized.includes(OWNER_URL), false);
    assert.equal(serialized.includes(RUNTIME_URL), false);
    assert.equal(serialized.includes("owner@"), false);
    assert.equal(serialized.includes("runtime@"), false);

    await assert.rejects(() => runPostflight(config(), {
      ...dependencies(),
      readVercelState: () => ({
        stage: "partial-removal", presentPrivilegedKeys: ["DIRECT_URL"],
        projectPrivilegedKeys: [], sharedPrivilegedLinks: [{ key: "DIRECT_URL" }],
      }),
    }), /Vercel runtime database separation postflight failed/);
  });
});
