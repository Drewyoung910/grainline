import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  buildNeonOwnerResetEvidence,
  buildNeonResetDirectUrl,
  runNeonOwnerReset,
  validateNeonResetResponse,
} from "../scripts/saved-search-phase-b-owner-neon-reset.mjs";

const PROPOSED_URL = "postgresql://neondb_owner:prior-proposed-secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const LEGACY_URL = "postgresql://neondb_owner:legacy-secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const RESET_PASSWORD = "npg_provider_generated_password_0123456789";
const RESET_URL = buildNeonResetDirectUrl(PROPOSED_URL, RESET_PASSWORD);
const NOW = new Date("2026-07-21T19:15:00.000Z");

function rejectedPassword() {
  const error = new Error("authentication rejected");
  error.code = "28P01";
  throw error;
}

function ownerState() {
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
      memberships: ["neon_superuser", "grainline_app_runtime"],
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
      rls_forced: false,
      owner_name: "neondb_owner",
      policy_count: 3,
    },
    canary: {
      bucket: "2026-07-20T06",
      status: "COMPLETED",
      started_at: new Date("2026-07-20T06:20:45.220Z"),
      completed_at: new Date("2026-07-20T06:20:45.580Z"),
      result: {
        ok: true,
        failedCronRunCount: 0,
        staleRunningCronRunCount: 0,
        partialFailureCronRunCount: 0,
        partialCronRunIssueCount: 0,
        staleEmailOutboxCount: 0,
        deadEmailOutboxCount: 0,
        overdueSupportRequestCount: 0,
        stripeWebhookFailureCount: 0,
        resendWebhookFailureCount: 0,
        clerkWebhookFailureCount: 0,
        accountDeletionSideEffectFailureCount: 0,
        savedSearchRlsCanaryIssueCount: 0,
        savedSearchRlsCanaryStatus: "healthy",
      },
    },
  };
}

function config() {
  return {
    now: NOW,
    proposedDirectUrl: PROPOSED_URL,
    proposedPassword: "prior-proposed-secret",
    legacyDirectUrl: LEGACY_URL,
  };
}

function beforeMetadata() {
  return {
    directUrl: { updatedAt: 1784659428583 },
    databaseUrl: { updatedAt: 1784476074964 },
  };
}

function resetResponse(status = "running") {
  return {
    role: {
      branch_id: "br-hidden-mouse-aaugn2wr",
      name: "neondb_owner",
      password: RESET_PASSWORD,
      authentication_method: "password",
      updated_at: "2026-07-21T19:10:00.000Z",
    },
    operations: [{
      id: "12345678-abcd-4321-abcd-123456789012",
      project_id: "icy-unit-96812898",
      branch_id: "br-hidden-mouse-aaugn2wr",
      action: "apply_config",
      status,
    }],
  };
}

describe("SavedSearch Phase B Neon owner reset fallback", () => {
  it("validates the provider response and changes only the password", () => {
    const validated = validateNeonResetResponse(resetResponse());
    assert.equal(validated.password, RESET_PASSWORD);
    const before = new URL(PROPOSED_URL);
    const after = new URL(RESET_URL);
    assert.notEqual(after.password, before.password);
    assert.equal(after.username, before.username);
    assert.equal(after.hostname, before.hostname);
    assert.equal(after.port, before.port);
    assert.equal(after.pathname, before.pathname);
    assert.equal(after.search, before.search);
  });

  it("persists locally before Vercel, waits for Neon, and proves both superseded credentials reject", async () => {
    const calls = [];
    let metadataReads = 0;
    const database = {
      readOwnerState: async (url) => {
        if (url === PROPOSED_URL) {
          calls.push("prior-proposed-rejected-before");
          rejectedPassword();
        }
        if (url === LEGACY_URL) {
          calls.push("legacy-accepted-before");
          return ownerState();
        }
        assert.equal(url, RESET_URL);
        calls.push("reset-credential-accepted-after");
        return ownerState();
      },
      proveOldCredentialRejected: async (url) => {
        calls.push(url === LEGACY_URL ? "legacy-rejected-after" : "prior-proposed-rejected-after");
      },
      readOtherOwnerSessionCount: async () => {
        calls.push("owner-session-count");
        return 0;
      },
    };
    const result = await runNeonOwnerReset(config(), {
      database,
      verifyVercelProject: () => calls.push("verify-vercel-project"),
      verifyNeonTarget: () => calls.push("verify-neon-target"),
      readVercelMetadata: async () => {
        metadataReads += 1;
        calls.push(metadataReads === 1 ? "vercel-before" : "vercel-after");
        return metadataReads === 1 ? beforeMetadata() : {
          directUrl: { updatedAt: 1784661000000 },
          databaseUrl: { updatedAt: 1784476074964 },
        };
      },
      resetNeonOwnerPassword: async () => {
        calls.push("neon-reset");
        return validateNeonResetResponse(resetResponse());
      },
      updateLocalDirectUrl: (url) => {
        assert.equal(url, RESET_URL);
        calls.push("update-local");
      },
      updateProductionDirectUrl: async (url) => {
        assert.equal(url, RESET_URL);
        calls.push("update-vercel");
      },
      readNeonOperation: async () => {
        calls.push("read-neon-operation");
        return validateNeonResetResponse(resetResponse("finished")).operations[0];
      },
      wait: async () => calls.push("wait"),
    });
    assert.equal(result.checks.ownerSessionsDrained, true);
    assert.equal(buildNeonOwnerResetEvidence(result).acceptanceEligible, true);
    assert.deepEqual(calls, [
      "verify-vercel-project",
      "verify-neon-target",
      "vercel-before",
      "prior-proposed-rejected-before",
      "legacy-accepted-before",
      "neon-reset",
      "update-local",
      "update-vercel",
      "vercel-after",
      "wait",
      "read-neon-operation",
      "reset-credential-accepted-after",
      "legacy-rejected-after",
      "prior-proposed-rejected-after",
      "owner-session-count",
    ]);
  });

  it("stops before reset when the control-plane target is not verified", async () => {
    let resetCalls = 0;
    await assert.rejects(
      () => runNeonOwnerReset(config(), {
        verifyVercelProject: () => {},
        verifyNeonTarget: () => { throw new Error("target drift"); },
        resetNeonOwnerPassword: async () => { resetCalls += 1; },
      }),
      /target drift/,
    );
    assert.equal(resetCalls, 0);
  });

  it("records local persistence if a later Vercel update fails without emitting passwords", async () => {
    await assert.rejects(
      () => runNeonOwnerReset(config(), {
        database: {
          readOwnerState: async (url) => {
            if (url === PROPOSED_URL) rejectedPassword();
            return ownerState();
          },
        },
        verifyVercelProject: () => {},
        verifyNeonTarget: () => {},
        readVercelMetadata: async () => beforeMetadata(),
        resetNeonOwnerPassword: async () => validateNeonResetResponse(resetResponse()),
        updateLocalDirectUrl: () => {},
        updateProductionDirectUrl: async () => { throw new Error("do not preserve"); },
      }),
      (error) => {
        assert.equal(error.neonResetState.localDirectUrlUpdated, true);
        assert.equal(error.neonResetState.vercelDirectUrlUpdated, false);
        assert.doesNotMatch(
          JSON.stringify(buildNeonOwnerResetEvidence({
            neonResetState: error.neonResetState,
            neonResetSummary: error.neonResetSummary,
          }, "failed")),
          /npg_provider|prior-proposed|legacy-secret|do not preserve/,
        );
        return true;
      },
    );
    const source = fs.readFileSync(
      "scripts/saved-search-phase-b-owner-neon-reset.mjs",
      "utf8",
    );
    const mainBlock = source.slice(source.indexOf("async function main()"));
    assert.doesNotMatch(mainBlock, /error\.message|console\.(?:log|error)/);
    assert.doesNotMatch(mainBlock, /password.*JSON\.stringify/i);
  });
});
