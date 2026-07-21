import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  buildNeonOwnerRecoveryEvidence,
  runNeonOwnerRecovery,
} from "../scripts/saved-search-phase-b-owner-neon-recovery.mjs";
import { buildNeonResetDirectUrl } from "../scripts/saved-search-phase-b-owner-neon-reset.mjs";

const PROPOSED_URL = "postgresql://neondb_owner:prior-proposed-secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const LEGACY_URL = "postgresql://neondb_owner:legacy-secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const CURRENT_PASSWORD = "npg_revealed_current_password_0123456789";
const CURRENT_URL = buildNeonResetDirectUrl(PROPOSED_URL, CURRENT_PASSWORD);

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
    now: new Date("2026-07-21T19:20:00.000Z"),
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

function roleMetadata() {
  return {
    branchId: "br-hidden-mouse-aaugn2wr",
    name: "neondb_owner",
    authenticationMethod: "password",
    updatedAt: "2026-07-21T19:16:14.000Z",
  };
}

describe("SavedSearch Phase B Neon reveal recovery", () => {
  it("reveals without resetting, persists locally first, and proves the recovered credential", async () => {
    const calls = [];
    let metadataReads = 0;
    const result = await runNeonOwnerRecovery(config(), {
      database: {
        readOwnerState: async (url) => {
          if (url === CURRENT_URL) {
            calls.push("current-accepted");
            return ownerState();
          }
          calls.push(url === PROPOSED_URL ? "proposed-rejected" : "legacy-rejected");
          rejectedPassword();
        },
        proveOldCredentialRejected: async (url) => {
          calls.push(url === LEGACY_URL ? "prove-legacy-rejected" : "prove-proposed-rejected");
        },
        readOtherOwnerSessionCount: async () => {
          calls.push("owner-session-count");
          return 0;
        },
      },
      verifyVercelProject: () => calls.push("verify-vercel"),
      verifyNeonTarget: () => calls.push("verify-neon"),
      readVercelMetadata: async () => {
        metadataReads += 1;
        calls.push(metadataReads === 1 ? "vercel-before" : "vercel-after");
        return metadataReads === 1 ? beforeMetadata() : {
          directUrl: { updatedAt: 1784662000000 },
          databaseUrl: { updatedAt: 1784476074964 },
        };
      },
      readNeonOwnerRoleMetadata: async () => {
        calls.push("read-role-metadata");
        return roleMetadata();
      },
      revealNeonOwnerPassword: async () => {
        calls.push("reveal-current-password");
        return CURRENT_PASSWORD;
      },
      updateLocalDirectUrl: (url) => {
        assert.equal(url, CURRENT_URL);
        calls.push("update-local");
      },
      updateProductionDirectUrl: async (url) => {
        assert.equal(url, CURRENT_URL);
        calls.push("update-vercel");
      },
      wait: async () => assert.fail("successful immediate proof must not wait"),
    });
    assert.equal(buildNeonOwnerRecoveryEvidence(result).acceptanceEligible, true);
    assert.deepEqual(calls, [
      "verify-vercel",
      "verify-neon",
      "vercel-before",
      "proposed-rejected",
      "legacy-rejected",
      "read-role-metadata",
      "reveal-current-password",
      "update-local",
      "update-vercel",
      "vercel-after",
      "current-accepted",
      "prove-legacy-rejected",
      "prove-proposed-rejected",
      "owner-session-count",
    ]);
  });

  it("does not reveal when either known credential still accepts", async () => {
    let revealCalls = 0;
    await assert.rejects(
      () => runNeonOwnerRecovery(config(), {
        database: { readOwnerState: async () => ownerState() },
        verifyVercelProject: () => {},
        verifyNeonTarget: () => {},
        readVercelMetadata: async () => beforeMetadata(),
        revealNeonOwnerPassword: async () => { revealCalls += 1; },
      }),
      /both known owner credentials must reject/,
    );
    assert.equal(revealCalls, 0);
  });

  it("keeps revealed password and caught errors out of evidence and main output", async () => {
    await assert.rejects(
      () => runNeonOwnerRecovery(config(), {
        database: { readOwnerState: async () => rejectedPassword() },
        verifyVercelProject: () => {},
        verifyNeonTarget: () => {},
        readVercelMetadata: async () => beforeMetadata(),
        readNeonOwnerRoleMetadata: async () => roleMetadata(),
        revealNeonOwnerPassword: async () => CURRENT_PASSWORD,
        updateLocalDirectUrl: () => {},
        updateProductionDirectUrl: async () => { throw new Error("do not preserve"); },
      }),
      (error) => {
        const evidence = buildNeonOwnerRecoveryEvidence({
          neonRecoveryState: error.neonRecoveryState,
          neonRecoveryRoleMetadata: error.neonRecoveryRoleMetadata,
        }, "failed");
        assert.doesNotMatch(JSON.stringify(evidence), /npg_revealed|do not preserve/);
        assert.equal(evidence.checks.localDirectUrlUpdated, true);
        return true;
      },
    );
    const source = fs.readFileSync(
      "scripts/saved-search-phase-b-owner-neon-recovery.mjs",
      "utf8",
    );
    const mainBlock = source.slice(source.indexOf("async function main()"));
    assert.doesNotMatch(mainBlock, /error\.message|console\.(?:log|error)/);
    assert.doesNotMatch(mainBlock, /password.*JSON\.stringify/i);
  });
});
