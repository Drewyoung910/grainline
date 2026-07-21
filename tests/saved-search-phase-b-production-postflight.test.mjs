import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  PHASE_B_DEPLOYMENT_HOST,
  PHASE_B_DEPLOYMENT_ID,
  PHASE_B_DIRECT_URL_UPDATED_AT,
  PHASE_B_MIGRATION,
  PHASE_B_RELEASE_BRANCH,
  PHASE_B_RUNTIME_URL_UPDATED_AT,
  buildProductionPostflightEvidence,
  collectProductionPostflightIssues,
  exactPhaseBRoleState,
  normalizeVercelPostflightState,
  runProductionPostflight,
} from "../scripts/saved-search-phase-b-production-postflight.mjs";
import {
  PHASE_B_RELEASE_COMMIT,
  REVIEWED_VERCEL_PROJECT,
} from "../scripts/saved-search-phase-b-owner-rotation.mjs";

function ownerRole() {
  return {
    rolname: "neondb_owner",
    rolsuper: false,
    rolcreatedb: true,
    rolcreaterole: true,
    rolinherit: true,
    rolcanlogin: true,
    rolreplication: true,
    rolbypassrls: true,
    memberships: ["neon_superuser", "grainline_app_runtime"],
    membership_options: [
      { role: "grainline_app_runtime", adminOption: true, inheritOption: false, setOption: false },
      { role: "neon_superuser", adminOption: false, inheritOption: true, setOption: true },
    ],
  };
}

function runtimeRole() {
  return {
    rolname: "grainline_app_runtime",
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolcanlogin: true,
    rolreplication: false,
    rolbypassrls: false,
    memberships: [],
    membership_options: [],
  };
}

function databaseState() {
  return {
    identity: {
      database_name: "neondb",
      current_user_name: "neondb_owner",
      session_user_name: "neondb_owner",
    },
    ownerRole: ownerRole(),
    runtimeRole: runtimeRole(),
    savedSearch: {
      schema: "public",
      table: "SavedSearch",
      relrowsecurity: true,
      relforcerowsecurity: true,
      policy_count: 3,
      owner_name: "neondb_owner",
    },
    policies: [{ policy_name: "saved_search_owner_select" }],
    policyIssues: [],
    grantIssues: [],
    grantInventory: {
      tables: 58,
      enums: 20,
      functions: 3,
      extensions: 1,
      rlsPolicyTables: 1,
      sequenceReferences: 0,
    },
    migration: {
      migration_name: PHASE_B_MIGRATION,
      finished: true,
      not_rolled_back: true,
      applied_steps_count: 1,
    },
    migrationRowCount: 1,
    canary: { status: "COMPLETED" },
    otherOwnerSessionCount: 0,
  };
}

function vercelState() {
  return {
    deploymentMatches: true,
    environmentMatches: true,
    deployment: { id: PHASE_B_DEPLOYMENT_ID },
    environment: { phaseGuardRecordCount: 0 },
  };
}

function routes() {
  return {
    health: { status: 200, ok: true },
    browse: { status: 200 },
    signedOutSavedSearchApi: { status: 401, error: "Unauthorized" },
    signedOutSavedSearchPage: {
      status: 307,
      location: "/sign-in?redirect_url=%2Faccount%2Fsaved-searches",
    },
  };
}

describe("SavedSearch Phase B production postflight", () => {
  it("accepts only the exact owner and runtime role postures", () => {
    assert.equal(exactPhaseBRoleState(ownerRole(), runtimeRole()), true);
    assert.equal(exactPhaseBRoleState(ownerRole(), { ...runtimeRole(), rolbypassrls: true }), false);
    const owner = ownerRole();
    owner.membership_options[0] = { ...owner.membership_options[0], setOption: true };
    assert.equal(exactPhaseBRoleState(owner, runtimeRole()), false);
  });

  it("normalizes and pins the exact deployment and environment metadata", () => {
    const environmentPayload = {
      envs: [
        ["DIRECT_URL", PHASE_B_DIRECT_URL_UPDATED_AT],
        ["DATABASE_URL", PHASE_B_RUNTIME_URL_UPDATED_AT],
        ["RUNTIME_DB_ROLE", 11],
        ["MIGRATION_DB_ROLE", 12],
      ].map(([key, updatedAt]) => ({
        key,
        type: "sensitive",
        target: ["production"],
        createdAt: 1,
        updatedAt,
      })),
    };
    const normalized = normalizeVercelPostflightState({
      id: PHASE_B_DEPLOYMENT_ID,
      url: PHASE_B_DEPLOYMENT_HOST,
      name: REVIEWED_VERCEL_PROJECT.projectName,
      projectId: REVIEWED_VERCEL_PROJECT.projectId,
      ownerId: REVIEWED_VERCEL_PROJECT.orgId,
      target: "production",
      readyState: "READY",
      source: "cli",
      createdAt: 1,
      alias: ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app"],
      meta: {
        gitCommitSha: PHASE_B_RELEASE_COMMIT,
        gitCommitRef: PHASE_B_RELEASE_BRANCH,
      },
    }, environmentPayload);
    assert.equal(normalized.deploymentMatches, true);
    assert.equal(normalized.environmentMatches, true);
    environmentPayload.envs.push({
      key: "SAVED_SEARCH_RLS_DEPLOY_PHASE",
      type: "encrypted",
      target: ["production"],
      createdAt: 1,
      updatedAt: 1,
    });
    assert.equal(
      normalizeVercelPostflightState({
        ...normalized.deployment,
        alias: normalized.deployment.aliases,
        meta: {
          gitCommitSha: PHASE_B_RELEASE_COMMIT,
          gitCommitRef: PHASE_B_RELEASE_BRANCH,
        },
      }, environmentPayload).environmentMatches,
      false,
    );
  });

  it("passes only when every database, deployment, runtime-proof, and route gate passes", async () => {
    const config = {
      generatedAt: "2026-07-21T19:40:00.000Z",
      releaseDirectory: "/release",
      projectDirectory: "/project",
    };
    const result = await runProductionPostflight(config, {
      localEnvironment: { DIRECT_URL: "postgresql://not-recorded" },
      verifyRelease: () => ({ head: PHASE_B_RELEASE_COMMIT, clean: true }),
      readDatabase: async () => databaseState(),
      readVercel: () => vercelState(),
      readRuntimeProof: () => ({ accepted: true }),
      readRoutes: async () => routes(),
    });
    assert.deepEqual(result.issues, []);
    assert.equal(buildProductionPostflightEvidence(config, result).acceptanceEligible, true);

    const drifted = { ...result, database: { ...result.database, otherOwnerSessionCount: 1 } };
    assert.match(collectProductionPostflightIssues(drifted).join("\n"), /owner sessions/);
  });

  it("keeps credentials and caught errors out of durable evidence and main output", () => {
    const evidence = buildProductionPostflightEvidence(
      { generatedAt: "2026-07-21T19:40:00.000Z" },
      {
        issues: [],
        database: databaseState(),
        vercel: vercelState(),
        runtimeProof: { accepted: true },
        routes: routes(),
      },
    );
    assert.doesNotMatch(JSON.stringify(evidence), /postgres(?:ql)?:\/\//i);
    const source = fs.readFileSync(
      "scripts/saved-search-phase-b-production-postflight.mjs",
      "utf8",
    );
    const mainBlock = source.slice(source.indexOf("async function main()"));
    assert.doesNotMatch(mainBlock, /error\.message|console\.(?:log|error)/);
  });
});
