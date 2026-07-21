import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  EXPECTED_PRODUCTION_DATABASE_UPDATED_AT,
  EXPECTED_PRODUCTION_DIRECT_UPDATED_AT,
  EXPECTED_PRODUCTION_MIGRATION_ROLE_UPDATED_AT,
  EXPECTED_PRODUCTION_RUNTIME_ROLE_UPDATED_AT,
  SEPARATION_CONFIRMATION,
  buildSeparationEvidence,
  normalizeVercelDatabaseEnvironmentState,
  parseSeparationOperatorConfig,
  runSeparationOperator,
} from "../scripts/runtime-db-credential-separation-operator.mjs";
import { PHASE_B_CANARY_BUCKET } from "../scripts/saved-search-phase-b-owner-rotation.mjs";

const COMMIT = "b".repeat(40);
const OWNER_URL = "postgresql://neondb_owner:old-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const NEXT_URL = "postgresql://neondb_owner:AbCdEfGhIjKlMn_1@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const NOW = new Date("2026-07-21T20:00:00.000Z");

function config(mode = "reset") {
  return {
    mode,
    now: NOW,
    releaseCommit: COMMIT,
    evidencePath: "/Users/drewyoung/grainline-rollout-evidence/test.json",
    currentDirectUrl: OWNER_URL,
  };
}

function environment(mode = "reset") {
  return {
    RUNTIME_DB_SEPARATION_MODE: mode,
    RUNTIME_DB_SEPARATION_CONFIRM: SEPARATION_CONFIRMATION,
    RUNTIME_DB_SEPARATION_RELEASE_COMMIT: COMMIT,
    RUNTIME_DB_SEPARATION_EVIDENCE_PATH:
      "/Users/drewyoung/grainline-rollout-evidence/test.json",
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

function vercel(stage = "runtime-only") {
  return {
    stage,
    presentPrivilegedKeys: stage === "runtime-only"
      ? []
      : ["DIRECT_URL", "MIGRATION_DB_ROLE"],
    databaseUrlUpdatedAt: EXPECTED_PRODUCTION_DATABASE_UPDATED_AT,
    runtimeRoleUpdatedAt: EXPECTED_PRODUCTION_RUNTIME_ROLE_UPDATED_AT,
  };
}

function github(empty = true, digest = null) {
  return {
    protectionVerified: true,
    branchPolicyId: 55079962,
    migrationSecret: empty ? null : { updatedAt: "2026-07-21T20:00:01Z" },
    digestVariable: empty ? null : { value: digest },
  };
}

function common(overrides = {}) {
  return {
    readGitState: () => ({ head: COMMIT, status: "" }),
    readDatabaseState: async () => databaseState(),
    readOwnerState: async () => ownerState(),
    readOtherOwnerSessionCount: async () => 0,
    readVercelState: () => vercel(),
    readGithubState: () => github(),
    readPhaseBProof: () => ({ accepted: true, sha256: "proof" }),
    verifyNeonTarget: () => ({ projectId: "icy-unit-96812898" }),
    readNeonRoleMetadata: () => ({ updatedAt: "2026-07-21T19:16:14.000Z" }),
    priorOwnerStateExists: () => false,
    wait: async () => {},
    ...overrides,
  };
}

function sensitiveRecord(key, updatedAt) {
  return {
    key,
    type: "sensitive",
    target: ["production"],
    gitBranch: null,
    createdAt: 1,
    updatedAt,
  };
}

describe("runtime database credential separation operator", () => {
  it("pins the post-Phase-B gate, explicit mode, release commit, and evidence path", () => {
    assert.equal(parseSeparationOperatorConfig(environment(), NOW).releaseCommit, COMMIT);
    for (const mode of [
      "preflight-only",
      "repair-local",
      "remove-vercel",
      "reset",
      "recover",
    ]) {
      assert.equal(parseSeparationOperatorConfig(environment(mode), NOW).mode, mode);
    }
    assert.throws(
      () => parseSeparationOperatorConfig(environment(), new Date("2026-07-20T06:24:59Z")),
      /barred/,
    );
    assert.throws(() => parseSeparationOperatorConfig({
      ...environment(),
      RUNTIME_DB_SEPARATION_CONFIRM: "yes",
    }, NOW));
  });

  it("distinguishes exact pre-removal, partial, and runtime-only Vercel states", () => {
    const base = [
      sensitiveRecord("DATABASE_URL", EXPECTED_PRODUCTION_DATABASE_UPDATED_AT),
      sensitiveRecord("RUNTIME_DB_ROLE", EXPECTED_PRODUCTION_RUNTIME_ROLE_UPDATED_AT),
      {
        ...sensitiveRecord("DATABASE_URL", 123),
        type: "encrypted",
        target: ["development"],
      },
    ];
    const direct = sensitiveRecord("DIRECT_URL", EXPECTED_PRODUCTION_DIRECT_UPDATED_AT);
    const migration = sensitiveRecord(
      "MIGRATION_DB_ROLE",
      EXPECTED_PRODUCTION_MIGRATION_ROLE_UPDATED_AT,
    );
    assert.equal(normalizeVercelDatabaseEnvironmentState({
      envs: [...base, direct, migration],
    }).stage, "pre-removal");
    assert.equal(normalizeVercelDatabaseEnvironmentState({
      envs: [...base, migration],
    }).stage, "partial-removal");
    assert.equal(normalizeVercelDatabaseEnvironmentState({ envs: base }).stage, "runtime-only");
    assert.throws(() => normalizeVercelDatabaseEnvironmentState({
      envs: [...base, sensitiveRecord("OTHER_ADMIN_DATABASE_URL", 1)],
    }), /unreviewed/);
    assert.throws(() => normalizeVercelDatabaseEnvironmentState({
      envs: [
        ...base,
        { ...direct, target: ["preview"] },
      ],
    }), /outside unscoped Production/);
    assert.throws(() => normalizeVercelDatabaseEnvironmentState({
      envs: [...base, direct, { ...direct }],
    }), /duplicate/);
  });

  it("runs a read-only preflight and a bounded Vercel-only removal step", async () => {
    const calls = [];
    const preflight = await runSeparationOperator(config("preflight-only"), common({
      readVercelState: () => vercel("pre-removal"),
      updateLocalDirectUrl: () => calls.push("local"),
      updateGithubCredential: () => calls.push("github"),
      resetNeonPassword: () => calls.push("reset"),
    }));
    assert.equal(preflight.acceptanceEligible, false);
    assert.deepEqual(calls, []);

    const removal = await runSeparationOperator(config("remove-vercel"), common({
      readVercelState: () => vercel("pre-removal"),
      removeVercelEnvironment: (before) => {
        calls.push(`remove:${before.stage}`);
        return vercel("runtime-only");
      },
    }));
    assert.equal(removal.vercel.stage, "runtime-only");
    assert.deepEqual(calls, ["remove:pre-removal"]);
  });

  it("repairs only a rejected local owner URL from the pinned current Neon credential", async () => {
    const calls = [];
    const rejected = new Error("rejected");
    rejected.code = "28P01";
    const result = await runSeparationOperator(config("repair-local"), common({
      readVercelState: () => vercel("pre-removal"),
      readDatabaseState: async (url) => {
        if (url === OWNER_URL) throw rejected;
        return databaseState();
      },
      readNeonRoleMetadata: () => ({ updatedAt: "2026-07-21T19:16:14.000Z" }),
      revealNeonPassword: () => "AbCdEfGhIjKlMn_1",
      buildNeonDirectUrl: () => NEXT_URL,
      updateLocalDirectUrl: (url) => calls.push(`local:${url === NEXT_URL}`),
      updateGithubCredential: () => calls.push("github"),
      resetNeonPassword: () => calls.push("reset"),
      removeVercelEnvironment: () => calls.push("vercel-remove"),
    }));
    assert.equal(result.recoveryOutcome, "local-current-owner-reconciled");
    assert.equal(result.acceptanceEligible, false);
    assert.equal(result.state.oldCredentialRejected, true);
    assert.equal(result.state.databaseStateVerified, true);
    assert.deepEqual(calls, ["local:true"]);
  });

  it("persists reset output locally and in protected GitHub before waiting, then proves old rejection", async () => {
    const calls = [];
    let resetComplete = false;
    let digest;
    let githubRead = 0;
    const result = await runSeparationOperator(config("reset"), common({
      readDatabaseState: async (url) => {
        if (url === OWNER_URL && resetComplete) {
          const error = new Error("rejected");
          error.code = "28P01";
          throw error;
        }
        return databaseState();
      },
      readGithubState: () => {
        githubRead += 1;
        return githubRead === 1 ? github() : github(false, digest);
      },
      writePriorOwnerState: () => calls.push("prior-write"),
      resetNeonPassword: () => {
        calls.push("neon-reset");
        resetComplete = true;
        return {
          password: "AbCdEfGhIjKlMn_1",
          roleUpdatedAt: "2026-07-21T20:00:00.000Z",
          operations: [{ id: "operation-1234", status: "running" }],
        };
      },
      buildNeonDirectUrl: () => NEXT_URL,
      updateLocalDirectUrl: () => calls.push("local-update"),
      updateGithubCredential: (url, value) => {
        assert.equal(url, NEXT_URL);
        digest = value;
        calls.push("github-update");
      },
      waitForNeonOperations: async () => {
        calls.push("wait-operations");
        return [{ id: "operation-1234", action: "reset_password", status: "finished" }];
      },
    }));
    assert.equal(result.acceptanceEligible, true);
    assert.deepEqual(calls, [
      "prior-write",
      "neon-reset",
      "local-update",
      "github-update",
      "wait-operations",
    ]);
    assert.equal(result.cleanupPriorOwnerState, true);
    assert.equal(result.state.priorOwnerStateRemovalReady, true);
    assert.equal(result.state.priorOwnerStateRemoved, false);
    assert.equal(result.state.oldCredentialRejected, true);
    assert.equal(result.ownerSessionCount, 0);
  });

  it("recovers a completed reset through idempotent reveal without issuing another reset", async () => {
    let digest;
    let githubRead = 0;
    const calls = [];
    const rejected = async (url) => {
      if (url === OWNER_URL) {
        const error = new Error("rejected");
        error.code = "28P01";
        throw error;
      }
      return databaseState();
    };
    const result = await runSeparationOperator(config("recover"), common({
      readDatabaseState: rejected,
      readPriorOwnerState: () => ({
        version: 1,
        priorDirectUrl: OWNER_URL,
        roleUpdatedAtBefore: "2026-07-21T19:16:14.000Z",
      }),
      readNeonRoleMetadata: () => ({ updatedAt: "2026-07-21T20:00:00.000Z" }),
      revealNeonPassword: () => {
        calls.push("reveal");
        return "AbCdEfGhIjKlMn_1";
      },
      resetNeonPassword: () => assert.fail("recovery must not reset"),
      buildNeonDirectUrl: () => NEXT_URL,
      updateLocalDirectUrl: () => calls.push("local-update"),
      updateGithubCredential: (url, value) => {
        assert.equal(url, NEXT_URL);
        digest = value;
        calls.push("github-update");
      },
      readGithubState: () => {
        githubRead += 1;
        return githubRead === 1 ? github() : github(false, digest);
      },
    }));
    assert.equal(result.recoveryOutcome, "completed-reset-recovered");
    assert.equal(result.cleanupPriorOwnerState, true);
    assert.deepEqual(calls, ["reveal", "local-update", "github-update"]);
  });

  it("clears recovery state without mutation when the reset definitively did not complete", async () => {
    const calls = [];
    const result = await runSeparationOperator(config("recover"), common({
      readPriorOwnerState: () => ({
        version: 1,
        priorDirectUrl: OWNER_URL,
        roleUpdatedAtBefore: "2026-07-21T19:16:14.000Z",
      }),
      updateLocalDirectUrl: () => calls.push("local-update"),
      updateGithubCredential: () => calls.push("github-update"),
    }));
    assert.equal(result.recoveryOutcome, "reset-not-completed");
    assert.equal(result.acceptanceEligible, false);
    assert.equal(result.cleanupPriorOwnerState, true);
    assert.equal(result.state.priorOwnerStateRemovalReady, true);
    assert.deepEqual(calls, []);
  });

  it("reconciles partial local and GitHub placement when Neon retained the prior password", async () => {
    const calls = [];
    const result = await runSeparationOperator({
      ...config("recover"),
      currentDirectUrl: NEXT_URL,
    }, common({
      readPriorOwnerState: () => ({
        version: 1,
        priorDirectUrl: OWNER_URL,
        roleUpdatedAtBefore: "2026-07-21T19:16:14.000Z",
      }),
      readNeonRoleMetadata: () => ({ updatedAt: "2026-07-21T20:00:00.000Z" }),
      readGithubState: () => github(false, "partial-digest"),
      revealNeonPassword: () => "old-password",
      buildNeonDirectUrl: () => OWNER_URL,
      updateLocalDirectUrl: (url) => calls.push(`local:${url === OWNER_URL}`),
      clearGithubCredential: () => calls.push("github-clear"),
      resetNeonPassword: () => assert.fail("recovery must not reset"),
    }));
    assert.equal(result.recoveryOutcome, "reset-not-completed-reconciled");
    assert.equal(result.acceptanceEligible, false);
    assert.equal(result.state.githubCredentialCleared, true);
    assert.deepEqual(calls, ["local:true", "github-clear"]);
  });

  it("converges a reset whose old and new passwords temporarily overlap", async () => {
    let oldReads = 0;
    let digest;
    const result = await runSeparationOperator(config("recover"), common({
      readDatabaseState: async (url) => {
        if (url === OWNER_URL) {
          oldReads += 1;
          if (oldReads > 2) {
            const error = new Error("rejected");
            error.code = "28P01";
            throw error;
          }
        }
        return databaseState();
      },
      readPriorOwnerState: () => ({
        version: 1,
        priorDirectUrl: OWNER_URL,
        roleUpdatedAtBefore: "2026-07-21T19:16:14.000Z",
      }),
      readNeonRoleMetadata: () => ({ updatedAt: "2026-07-21T20:00:00.000Z" }),
      readGithubState: () => github(false, digest),
      revealNeonPassword: () => "AbCdEfGhIjKlMn_1",
      buildNeonDirectUrl: () => NEXT_URL,
      updateGithubCredential: (_url, value) => { digest = value; },
    }));
    assert.equal(result.recoveryOutcome, "completed-reset-recovered-after-overlap");
    assert.equal(result.state.oldCredentialRejected, true);
  });

  it("does not make acceptance evidence eligible before recovery-state cleanup", () => {
    const pending = buildSeparationEvidence(config(), {
      acceptanceEligible: true,
      state: {
        priorOwnerStateRemovalReady: true,
        priorOwnerStateRemoved: false,
      },
    });
    const finalized = buildSeparationEvidence(config(), {
      acceptanceEligible: true,
      state: {
        priorOwnerStateRemovalReady: true,
        priorOwnerStateRemoved: true,
      },
    });
    assert.equal(pending.acceptanceEligible, false);
    assert.equal(finalized.acceptanceEligible, true);
  });

  it("keeps credentials and caught errors out of evidence and executable output", () => {
    const evidence = buildSeparationEvidence(config(), {
      state: { neonPasswordResetAttempted: true },
      phaseBProof: { accepted: true },
      vercel: vercel(),
    }, "failed");
    assert.doesNotMatch(JSON.stringify(evidence), /old-password|AbCdEfGhIjKlMn/);
    const source = fs.readFileSync(
      "scripts/runtime-db-credential-separation-operator.mjs",
      "utf8",
    );
    const main = source.slice(source.indexOf("async function main()"));
    assert.doesNotMatch(main, /error\.message|console\.(?:log|error)/);
  });
});
