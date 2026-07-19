import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  PHASE_B_CANARY_BUCKET,
} from "../scripts/saved-search-phase-b-owner-rotation.mjs";
import {
  SEPARATION_CONFIRMATION,
  buildSeparationEvidence,
  parseSeparationOperatorConfig,
  runSeparationOperator,
} from "../scripts/runtime-db-credential-separation-operator.mjs";

const COMMIT = "b".repeat(40);
const OWNER_URL = "postgresql://neondb_owner:old-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const GENERATED_PASSWORD = "A_secure_generated_owner_password_0123456789_xyz";
const NOW = new Date("2026-07-20T07:00:00.000Z");

function config(mode = "rotate") {
  return {
    mode,
    now: NOW,
    releaseCommit: COMMIT,
    evidencePath: "/Users/drewyoung/grainline-rollout-evidence/test.json",
    currentDirectUrl: OWNER_URL,
  };
}

function environment(mode = "rotate") {
  return {
    RUNTIME_DB_SEPARATION_MODE: mode,
    RUNTIME_DB_SEPARATION_CONFIRM: SEPARATION_CONFIRMATION,
    RUNTIME_DB_SEPARATION_RELEASE_COMMIT: COMMIT,
    RUNTIME_DB_SEPARATION_EVIDENCE_PATH: "/Users/drewyoung/grainline-rollout-evidence/test.json",
    DIRECT_URL: OWNER_URL,
  };
}

function databaseState() {
  return {
    identity: {
      database_name: "neondb",
      current_user_name: "neondb_owner",
      session_user_name: "neondb_owner",
    },
    ownerRole: {
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
        { role: "grainline_app_runtime", adminOption: true, inheritOption: false, setOption: false },
        { role: "neon_superuser", adminOption: false, inheritOption: true, setOption: true },
      ],
    },
    runtimeRole: {
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
    },
    savedSearch: {
      rls_enabled: true,
      rls_forced: true,
      owner_name: "neondb_owner",
      policy_count: 3,
    },
    incompleteMigrationCount: 0,
  };
}

function ownerState() {
  return {
    canary: {
      bucket: PHASE_B_CANARY_BUCKET,
      status: "COMPLETED",
      started_at: new Date("2026-07-20T06:20:05.000Z"),
      completed_at: new Date("2026-07-20T06:20:06.000Z"),
      result: {
        ok: true,
        savedSearchRlsCanaryStatus: "healthy",
        savedSearchRlsCanaryIssueCount: 0,
      },
    },
  };
}

describe("runtime database credential separation operator", () => {
  it("pins the post-Phase-B gate, confirmation, release commit, and evidence path", () => {
    assert.equal(parseSeparationOperatorConfig(environment(), NOW).releaseCommit, COMMIT);
    assert.throws(
      () => parseSeparationOperatorConfig(environment(), new Date("2026-07-20T06:24:59Z")),
      /barred/,
    );
    assert.throws(() => parseSeparationOperatorConfig({
      ...environment(),
      RUNTIME_DB_SEPARATION_CONFIRM: "yes",
    }, NOW));
  });

  it("runs a read-only preflight without local, GitHub, or database mutation", async () => {
    const calls = [];
    const result = await runSeparationOperator(config("preflight-only"), {
      readGitState: () => ({ head: COMMIT, status: "" }),
      readVercelState: () => calls.push("vercel"),
      readGithubState: () => {
        calls.push("github");
        return { migrationSecret: null, digestVariable: null };
      },
      readDatabaseState: async () => databaseState(),
      readOwnerState: async () => ownerState(),
      updateLocalDirectUrl: () => calls.push("local-update"),
      updateGithubCredential: () => calls.push("github-update"),
      alterOwnerPassword: () => calls.push("database-update"),
    });
    assert.deepEqual(calls, ["vercel", "github"]);
    assert.equal(result.acceptanceEligible, false);
  });

  it("stores the new credential outside Vercel before SCRAM rotation and proves rejection and drain", async () => {
    const calls = [];
    let digest;
    let githubReads = 0;
    const result = await runSeparationOperator(config(), {
      readGitState: () => ({ head: COMMIT, status: "" }),
      readVercelState: () => calls.push("vercel"),
      readGithubState: () => {
        calls.push("github");
        githubReads += 1;
        return githubReads === 1
          ? { migrationSecret: null, digestVariable: null }
          : {
              migrationSecret: { updatedAt: "2026-07-20T07:00:01Z" },
              digestVariable: { value: digest },
            };
      },
      readDatabaseState: async (url) => {
        calls.push(url === OWNER_URL ? "database-before" : "database-after");
        return databaseState();
      },
      readOwnerState: async () => ownerState(),
      updateLocalDirectUrl: (url) => {
        assert.notEqual(url, OWNER_URL);
        calls.push("local-update");
      },
      updateGithubCredential: (url, value) => {
        assert.notEqual(url, OWNER_URL);
        digest = value;
        calls.push("github-update");
      },
      alterOwnerPassword: async (url, verifier) => {
        assert.equal(url, OWNER_URL);
        assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
        calls.push("database-update");
        throw new Error("ambiguous after commit");
      },
      proveOldCredentialRejected: async (url) => {
        assert.equal(url, OWNER_URL);
        calls.push("old-rejected");
      },
      readOtherOwnerSessionCount: async () => {
        calls.push("drain");
        return 0;
      },
      generatePassword: () => GENERATED_PASSWORD,
    });
    assert.deepEqual(calls, [
      "vercel", "github", "database-before", "local-update", "github-update",
      "github", "database-update", "database-after", "old-rejected", "drain", "vercel",
    ]);
    assert.equal(result.acceptanceEligible, true);
    assert.equal(result.state.githubCredentialMetadataVerified, true);
    assert.equal(result.state.oldCredentialRejected, true);
    assert.equal(result.ownerSessionCount, 0);
    assert.doesNotMatch(JSON.stringify(result), /old-password|generated_owner_password/);
  });

  it("does not alter PostgreSQL if the GitHub update fails", async () => {
    const calls = [];
    await assert.rejects(
      () => runSeparationOperator(config(), {
        readGitState: () => ({ head: COMMIT, status: "" }),
        readVercelState: () => {},
        readGithubState: () => ({ migrationSecret: null, digestVariable: null }),
        readDatabaseState: async () => databaseState(),
        readOwnerState: async () => ownerState(),
        updateLocalDirectUrl: () => {},
        updateGithubCredential: () => { throw new Error("failed"); },
        alterOwnerPassword: () => calls.push("database-update"),
        generatePassword: () => GENERATED_PASSWORD,
      }),
      (error) => {
        assert.deepEqual(calls, []);
        assert.equal(error.rotationState.localDirectUrlUpdated, true);
        assert.equal(error.rotationState.databaseCredentialRotationAttempted, false);
        return true;
      },
    );
  });

  it("keeps evidence and the executable error path free of secret material", () => {
    const source = fs.readFileSync(
      "scripts/runtime-db-credential-separation-operator.mjs",
      "utf8",
    );
    const main = source.slice(source.indexOf("async function main()"));
    assert.doesNotMatch(main, /error\.message|console\.(?:log|error)/);
    const evidence = buildSeparationEvidence(config(), {
      rotationState: { localDirectUrlUpdated: true },
    }, "failed");
    assert.doesNotMatch(JSON.stringify(evidence), /old-password|generated_owner_password/);
  });
});
