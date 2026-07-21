import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  buildOwnerReconciliationEvidence,
  runOwnerReconciliation,
} from "../scripts/saved-search-phase-b-owner-reconciliation.mjs";

const PROPOSED_URL = "postgresql://neondb_owner:proposed-secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const LEGACY_URL = "postgresql://neondb_owner:legacy-secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const NOW = new Date("2026-07-21T19:00:00.000Z");

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
    evidencePath: "/Users/drewyoung/grainline-rollout-evidence/test.json",
    proposedDirectUrl: PROPOSED_URL,
    proposedPassword: "proposed-secret",
    legacyDirectUrl: LEGACY_URL,
  };
}

function metadata(directUrlUpdatedAt = 1784659428583, databaseUrlUpdatedAt = 1784476074964) {
  return {
    directUrl: { updatedAt: directUrlUpdatedAt },
    databaseUrl: { updatedAt: databaseUrlUpdatedAt },
  };
}

function dependencies(database, calls) {
  return {
    database,
    verifyVercelProject: () => calls.push("verify-vercel-project"),
    readVercelMetadata: async () => {
      calls.push("read-vercel-metadata");
      return metadata();
    },
    wait: async () => calls.push("wait"),
  };
}

describe("SavedSearch Phase B owner reconciliation operator", () => {
  it("applies only when proposed rejects and the exact legacy state accepts", async () => {
    const calls = [];
    let proposedReads = 0;
    const database = {
      readOwnerState: async (url) => {
        if (url === PROPOSED_URL) {
          proposedReads += 1;
          calls.push(proposedReads === 1 ? "proposed-rejected-before" : "proposed-accepted-after");
          if (proposedReads === 1) rejectedPassword();
          return ownerState();
        }
        calls.push("legacy-accepted-before");
        return ownerState();
      },
      alterCurrentOwnerPassword: async (url, verifier) => {
        assert.equal(url, LEGACY_URL);
        assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
        assert.doesNotMatch(verifier, /proposed-secret/);
        calls.push("alter-with-scram");
        throw new Error("ambiguous connection result");
      },
      proveOldCredentialRejected: async (url) => {
        assert.equal(url, LEGACY_URL);
        calls.push("legacy-rejected-after");
      },
      readOtherOwnerSessionCount: async () => {
        calls.push("owner-session-count");
        return 0;
      },
    };
    const result = await runOwnerReconciliation(
      config(),
      dependencies(database, calls),
    );
    assert.equal(result.reconciliationMode, "apply");
    assert.equal(result.checks.databaseCredentialRotationAttempted, true);
    assert.equal(buildOwnerReconciliationEvidence(result).acceptanceEligible, true);
    assert.deepEqual(calls, [
      "verify-vercel-project",
      "read-vercel-metadata",
      "proposed-rejected-before",
      "legacy-accepted-before",
      "alter-with-scram",
      "proposed-accepted-after",
      "legacy-rejected-after",
      "owner-session-count",
    ]);
  });

  it("reruns as verification-only after an ambiguous committed change", async () => {
    const calls = [];
    const database = {
      readOwnerState: async (url) => {
        if (url === LEGACY_URL) {
          calls.push("legacy-rejected-before");
          rejectedPassword();
        }
        calls.push("proposed-accepted");
        return ownerState();
      },
      alterCurrentOwnerPassword: async () => assert.fail("must not alter in verify-only mode"),
      proveOldCredentialRejected: async () => calls.push("legacy-rejected-after"),
      readOtherOwnerSessionCount: async () => {
        calls.push("owner-session-count");
        return 0;
      },
    };
    const result = await runOwnerReconciliation(
      config(),
      dependencies(database, calls),
    );
    assert.equal(result.reconciliationMode, "verify-only");
    assert.equal(result.checks.databaseCredentialRotationAttempted, false);
    assert.equal(result.checks.proposedCredentialVerifiedAfter, true);
  });

  it("blocks before database inspection if either Vercel timestamp drifts", async () => {
    for (const drifted of [metadata(1784659428584), metadata(1784659428583, 1784476074965)]) {
      const calls = [];
      await assert.rejects(
        () => runOwnerReconciliation(config(), {
          verifyVercelProject: () => {},
          readVercelMetadata: async () => drifted,
          database: { readOwnerState: async () => calls.push("database-read") },
        }),
      );
      assert.deepEqual(calls, []);
    }
  });

  it("fails closed when the ALTER is ambiguous and proposed authentication stays rejected", async () => {
    let proposedReads = 0;
    let waits = 0;
    await assert.rejects(
      () => runOwnerReconciliation(config(), {
        verifyVercelProject: () => {},
        readVercelMetadata: async () => metadata(),
        database: {
          readOwnerState: async (url) => {
            if (url === PROPOSED_URL) {
              proposedReads += 1;
              rejectedPassword();
            }
            return ownerState();
          },
          alterCurrentOwnerPassword: async () => {
            throw new Error("ambiguous connection result");
          },
        },
        wait: async () => { waits += 1; },
      }),
      (error) => {
        assert.equal(error.reconciliationChecks.databaseCredentialRotationAttempted, true);
        assert.equal(error.reconciliationChecks.proposedCredentialVerifiedAfter, false);
        return true;
      },
    );
    assert.equal(proposedReads, 8);
    assert.equal(waits, 6);
  });

  it("rejects mixed credential acceptance and never emits credential material", async () => {
    await assert.rejects(
      () => runOwnerReconciliation(config(), {
        verifyVercelProject: () => {},
        readVercelMetadata: async () => metadata(),
        database: { readOwnerState: async () => ownerState() },
      }),
      /not an approved reconciliation state/,
    );
    const source = fs.readFileSync(
      "scripts/saved-search-phase-b-owner-reconciliation.mjs",
      "utf8",
    );
    const mainBlock = source.slice(source.indexOf("async function main()"));
    assert.doesNotMatch(mainBlock, /error\.message|console\.(?:log|error)/);
    assert.doesNotMatch(mainBlock, /DIRECT_URL.*JSON\.stringify|password.*JSON\.stringify/i);
    assert.doesNotMatch(
      JSON.stringify(buildOwnerReconciliationEvidence({
        reconciliationChecks: { ownerSessionsDrained: false },
      }, "failed")),
      /proposed-secret|legacy-secret/,
    );
  });
});
