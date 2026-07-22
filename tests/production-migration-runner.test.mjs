import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  PRODUCTION_MIGRATION_CONFIRMATION,
  assertProductionMigrationDatabaseState,
  assertProductionMigrationGitState,
  parseProductionMigrationEnvironment,
  runProductionMigrationPreflight,
} from "../scripts/guard-production-migration-runner.mjs";

const COMMIT = "a".repeat(40);
const DIRECT_URL = "postgresql://neondb_owner:owner-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const DIRECT_URL_SHA256 = createHash("sha256").update(DIRECT_URL).digest("hex");

function environment(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: COMMIT,
    PRODUCTION_MIGRATION_CONFIRM: PRODUCTION_MIGRATION_CONFIRMATION,
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: DIRECT_URL_SHA256,
    DIRECT_URL,
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    MIGRATION_DB_ROLE: "neondb_owner",
    ...overrides,
  };
}

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
    memberships: ["grainline_app_runtime", "neon_superuser"],
    membership_options: [
      {
        role: "grainline_app_runtime",
        adminOption: true,
        inheritOption: false,
        setOption: false,
      },
      {
        role: "neon_superuser",
        adminOption: false,
        inheritOption: true,
        setOption: true,
      },
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
      rls_enabled: true,
      rls_forced: true,
      owner_name: "neondb_owner",
      policy_count: 3,
    },
    incompleteMigrationCount: 0,
  };
}

describe("isolated production migration runner", () => {
  it("accepts only the exact manually dispatched main commit and direct owner target", () => {
    const parsed = parseProductionMigrationEnvironment(environment());
    assert.equal(parsed.releaseCommit, COMMIT);
    assert.equal(parsed.identity.username, "neondb_owner");
    assert.equal(parsed.identity.isPooler, false);
    assert.equal(parsed.identity.endpointId, "ep-plain-river-aaqg8gj4");
  });

  it("rejects non-main, non-manual, mismatched, pooled, and mixed-credential jobs", () => {
    const cases = [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "push" },
      { PRODUCTION_MIGRATION_RELEASE_COMMIT: "b".repeat(40) },
      { PRODUCTION_MIGRATION_CONFIRM: "yes" },
      { DIRECT_URL: DIRECT_URL.replace(".westus3", "-pooler.westus3") },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
    ];
    for (const drift of cases) {
      assert.throws(() => parseProductionMigrationEnvironment(environment(drift)));
    }
  });

  it("pins exact owner/runtime memberships, Phase B FORCE, and a clean migration ledger", () => {
    assert.deepEqual(assertProductionMigrationDatabaseState(databaseState()), {
      databaseName: "neondb",
      ownerRole: "neondb_owner",
      runtimeRole: "grainline_app_runtime",
      savedSearchRlsEnabled: true,
      savedSearchRlsForced: true,
      savedSearchPolicyCount: 3,
      incompleteMigrationCount: 0,
    });

    for (const mutate of [
      (state) => { state.savedSearch.rls_forced = false; },
      (state) => { state.incompleteMigrationCount = 1; },
      (state) => { state.ownerRole.membership_options[0].setOption = true; },
      (state) => { state.runtimeRole.rolbypassrls = true; },
    ]) {
      const drifted = databaseState();
      mutate(drifted);
      assert.throws(() => assertProductionMigrationDatabaseState(drifted), /drifted/);
    }
  });

  it("requires an exact clean checkout before the database read", async () => {
    assert.deepEqual(assertProductionMigrationGitState({ head: COMMIT, status: "" }, COMMIT), {
      head: COMMIT,
      clean: true,
    });
    assert.throws(
      () => assertProductionMigrationGitState({ head: COMMIT, status: "?? migration.sql" }, COMMIT),
      /exact clean dispatched release commit/,
    );

    const calls = [];
    const result = await runProductionMigrationPreflight(
      parseProductionMigrationEnvironment(environment()),
      {
        readGitState: () => {
          calls.push("git");
          return { head: COMMIT, status: "" };
        },
        readDatabaseState: async (url) => {
          assert.equal(url, DIRECT_URL);
          calls.push("database");
          return databaseState();
        },
      },
    );
    assert.deepEqual(calls, ["git", "database"]);
    assert.equal(result.status, "passed");
    assert.doesNotMatch(JSON.stringify(result), /owner-password|DIRECT_URL/);
  });

  it("uses an environment-scoped secret and never runs migrations in Vercel builds", () => {
    const workflow = fs.readFileSync(".github/workflows/production-migrations.yml", "utf8");
    const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    const runtimeSource = fs.readFileSync("src/lib/db.ts", "utf8");

    assert.match(workflow, /^\s*workflow_dispatch:/m);
    assert.match(workflow, /^permissions:\s*\n\s+contents: read/m);
    assert.match(workflow, /^\s+environment: Production$/m);
    assert.match(workflow, /secrets\.PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /vars\.PRODUCTION_MIGRATION_DIRECT_URL_SHA256/);
    assert.doesNotMatch(workflow, /secrets\.(?:DIRECT_URL|DATABASE_URL)\b/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /guard-production-migration-runner\.mjs[\s\S]*prisma migrate deploy[\s\S]*prisma migrate status[\s\S]*audit:db-grants/);
    const jobEnvironment = workflow.slice(
      workflow.indexOf("    env:"),
      workflow.indexOf("    steps:"),
    );
    assert.doesNotMatch(jobEnvironment, /DIRECT_URL:\s*\$\{\{\s*secrets\./);
    assert.match(workflow, /Verify exact source[\s\S]*?env:\s*\n\s+DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/);
    assert.equal(vercel.buildCommand, "npm run guard:runtime-db-env && npm run build");
    assert.doesNotMatch(vercel.buildCommand, /migrat/i);
    assert.match(runtimeSource, /requiredProductionEnv\("DATABASE_URL"\)/);
    assert.doesNotMatch(runtimeSource, /DIRECT_URL|MIGRATION_DB_ROLE/);
  });
});
