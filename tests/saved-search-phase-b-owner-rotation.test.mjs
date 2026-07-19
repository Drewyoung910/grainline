import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  PHASE_B_CANARY_BUCKET,
  PHASE_B_RELEASE_COMMIT,
  assertExactPostSkewCanary,
  buildEvidence,
  buildRotatedDirectUrl,
  buildScramSha256Verifier,
  parseOwnerRotationConfig,
  replaceReviewedLocalDirectUrl,
  runOwnerRotation,
} from "../scripts/saved-search-phase-b-owner-rotation.mjs";

const OWNER_URL = "postgresql://neondb_owner:old-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const AFTER_GATE = new Date("2026-07-20T06:25:01.000Z");
const GENERATED_PASSWORD = "A_secure_generated_owner_password_0123456789_xyz";

function canary() {
  return {
    bucket: PHASE_B_CANARY_BUCKET,
    status: "COMPLETED",
    started_at: new Date("2026-07-20T06:20:10.000Z"),
    completed_at: new Date("2026-07-20T06:20:11.000Z"),
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

function ownerState() {
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
      rls_forced: false,
      owner_name: "neondb_owner",
      policy_count: 3,
    },
    canary: canary(),
  };
}

function config(mode = "rotate") {
  return {
    mode,
    now: AFTER_GATE,
    currentDirectUrl: OWNER_URL,
    evidencePath: "/Users/drewyoung/grainline-rollout-evidence/test.json",
    vercelProjectDirectory: "/Users/drewyoung/grainline",
  };
}

function configEnv(mode = "rotate") {
  return {
    PHASE_B_OWNER_ROTATION_MODE: mode,
    PHASE_B_OWNER_ROTATION_CONFIRM: mode === "rotate"
      ? "rotate-production-owner-after-post-skew-canary"
      : "verify-production-phase-b-after-post-skew-canary",
    PHASE_B_OWNER_ROTATION_RELEASE_COMMIT: PHASE_B_RELEASE_COMMIT,
    PHASE_B_OWNER_ROTATION_EVIDENCE_PATH: "/Users/drewyoung/grainline-rollout-evidence/test.json",
    PHASE_B_VERCEL_PROJECT_DIRECTORY: "/Users/drewyoung/grainline",
    DIRECT_URL: OWNER_URL,
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    MIGRATION_DB_ROLE: "neondb_owner",
  };
}

function vercelMetadata(directUpdatedAt, runtimeUpdatedAt = 50) {
  return {
    directUrl: { updatedAt: directUpdatedAt },
    databaseUrl: { updatedAt: runtimeUpdatedAt },
  };
}

describe("SavedSearch Phase B owner rotation operator", () => {
  it("rejects execution before the reviewed time gate", () => {
    assert.throws(
      () => parseOwnerRotationConfig(configEnv(), new Date("2026-07-20T06:24:59.999Z")),
      /barred before the reviewed promotion time/,
    );
  });

  it("requires the exact healthy scheduled post-skew canary", () => {
    const verified = assertExactPostSkewCanary(canary(), AFTER_GATE);
    assert.equal(verified.bucket, PHASE_B_CANARY_BUCKET);
    assert.equal(verified.savedSearchRlsCanaryStatus, "healthy");

    const unhealthy = canary();
    unhealthy.result.savedSearchRlsCanaryIssueCount = 1;
    assert.throws(() => assertExactPostSkewCanary(unhealthy, AFTER_GATE), /not healthy/);

    const otherIssue = canary();
    otherIssue.result.deadEmailOutboxCount = 1;
    assert.throws(() => assertExactPostSkewCanary(otherIssue, AFTER_GATE), /actionable count/);
  });

  it("changes only the direct URL password", () => {
    const rotated = buildRotatedDirectUrl(OWNER_URL, GENERATED_PASSWORD);
    const before = new URL(OWNER_URL);
    const after = new URL(rotated);
    assert.notEqual(after.password, before.password);
    assert.equal(after.username, before.username);
    assert.equal(after.hostname, before.hostname);
    assert.equal(after.port, before.port);
    assert.equal(after.pathname, before.pathname);
    assert.equal(after.search, before.search);
  });

  it("replaces exactly one local DIRECT_URL assignment without touching other lines", () => {
    const rotated = buildRotatedDirectUrl(OWNER_URL, GENERATED_PASSWORD);
    const source = `DATABASE_URL="legacy-owner-url"\nDIRECT_URL="${OWNER_URL}"\nOTHER=value\n`;
    assert.equal(
      replaceReviewedLocalDirectUrl(source, rotated),
      `DATABASE_URL="legacy-owner-url"\nDIRECT_URL="${rotated}"\nOTHER=value\n`,
    );
    assert.throws(
      () => replaceReviewedLocalDirectUrl("DATABASE_URL=only\n", rotated),
      /exactly one DIRECT_URL assignment/,
    );
  });

  it("matches PostgreSQL's published SCRAM-SHA-256 verifier example", () => {
    const salt = Buffer.from("44560wPMLfjqiAzyPDZ/eQ==", "base64");
    assert.equal(
      buildScramSha256Verifier("xyzzy", salt),
      "SCRAM-SHA-256$4096:44560wPMLfjqiAzyPDZ/eQ==$4CA054rZlSFEq8Z3FEhToBTa2X6KnWFxFkPwIbKoDe0=:L/nbSZRCjp6RhOhKK56GoR1zibCCSePKshCJ9lnl3yw=",
    );
  });

  it("runs preflight without changing Vercel or the database", async () => {
    const calls = [];
    const result = await runOwnerRotation(config("preflight-only"), {
      verifyVercelProject: () => calls.push("verify-vercel-project"),
      readProductionDatabaseMetadata: async () => {
        calls.push("read-vercel-metadata");
        return vercelMetadata(100);
      },
      database: {
        readOwnerState: async () => {
          calls.push("read-owner");
          return ownerState();
        },
      },
      updateProductionDirectUrl: async () => calls.push("update-vercel"),
    });
    assert.deepEqual(calls, [
      "verify-vercel-project",
      "read-vercel-metadata",
      "read-owner",
    ]);
    assert.equal(result.acceptanceEligible, false);
    assert.equal(result.state.vercelProjectVerified, true);
    assert.equal(result.state.databaseCredentialRotationAttempted, false);
  });

  it("verifies Vercel first, sends only SCRAM to PostgreSQL, then proves owner credentials, role posture, and drain state", async () => {
    const calls = [];
    const database = {
      readOwnerState: async (url) => {
        calls.push(url === OWNER_URL ? "owner-before" : "owner-after");
        return ownerState();
      },
      alterCurrentOwnerPassword: async (url, verifier) => {
        assert.equal(url, OWNER_URL);
        assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
        assert.doesNotMatch(verifier, new RegExp(GENERATED_PASSWORD));
        calls.push("rotate-db-with-scram");
        throw new Error("ambiguous connection result after PostgreSQL acceptance");
      },
      proveOldCredentialRejected: async (url) => {
        assert.equal(url, OWNER_URL);
        calls.push("reject-old");
      },
      readOtherOwnerSessionCount: async () => {
        calls.push("drain");
        return 0;
      },
    };
    const result = await runOwnerRotation(config(), {
      verifyVercelProject: () => calls.push("verify-vercel-project"),
      readProductionDatabaseMetadata: async () => {
        const priorReads = calls.filter((call) => call === "read-vercel-metadata").length;
        calls.push("read-vercel-metadata");
        return vercelMetadata(priorReads === 0 ? 100 : 101);
      },
      database,
      updateLocalDirectUrl: (url) => {
        assert.notEqual(url, OWNER_URL);
        calls.push("update-local-direct-url");
      },
      updateProductionDirectUrl: async (url, directory) => {
        assert.notEqual(url, OWNER_URL);
        assert.equal(directory, "/Users/drewyoung/grainline");
        calls.push("update-vercel");
      },
      generatePassword: () => GENERATED_PASSWORD,
      wait: async () => assert.fail("zero-session proof must not wait"),
    });
    assert.deepEqual(calls, [
      "verify-vercel-project",
      "read-vercel-metadata",
      "owner-before",
      "update-local-direct-url",
      "update-vercel",
      "read-vercel-metadata",
      "rotate-db-with-scram",
      "owner-after",
      "reject-old",
      "drain",
    ]);
    assert.equal(result.acceptanceEligible, true);
    assert.deepEqual(result.state, {
      vercelProjectVerified: true,
      vercelDatabaseSensitiveMetadataVerified: true,
      localDirectUrlUpdated: true,
      vercelDirectUrlUpdated: true,
      vercelDirectUrlUpdateVerified: true,
      runtimeDatabaseUrlMetadataUnchanged: true,
      databaseCredentialRotationAttempted: true,
      databaseCredentialRotated: true,
      newCredentialVerified: true,
      oldCredentialRejected: true,
      runtimeRolePostureUnchanged: true,
      ownerSessionsDrained: true,
    });
    assert.equal(buildEvidence(config(), result).issueCount, 0);
  });

  it("does not alter PostgreSQL when Vercel metadata proof fails", async () => {
    const calls = [];
    await assert.rejects(
      () => runOwnerRotation(config(), {
        verifyVercelProject: () => {},
        readProductionDatabaseMetadata: async () => vercelMetadata(100),
        database: {
          readOwnerState: async () => ownerState(),
          alterCurrentOwnerPassword: async () => calls.push("rotate-db"),
        },
        updateLocalDirectUrl: () => {},
        updateProductionDirectUrl: async () => true,
        generatePassword: () => GENERATED_PASSWORD,
      }),
      (error) => {
        assert.deepEqual(calls, []);
        assert.equal(error.rotationState.vercelDirectUrlUpdated, true);
        assert.equal(error.rotationState.vercelDirectUrlUpdateVerified, false);
        assert.equal(error.rotationState.databaseCredentialRotationAttempted, false);
        return true;
      },
    );
  });

  it("does not alter PostgreSQL when the Vercel CLI reports failure", async () => {
    const calls = [];
    await assert.rejects(
      () => runOwnerRotation(config(), {
        verifyVercelProject: () => {},
        readProductionDatabaseMetadata: async () => vercelMetadata(100),
        database: {
          readOwnerState: async () => ownerState(),
          alterCurrentOwnerPassword: async () => calls.push("rotate-db"),
        },
        updateLocalDirectUrl: () => {},
        updateProductionDirectUrl: async () => {
          throw new Error("ambiguous CLI result");
        },
        generatePassword: () => GENERATED_PASSWORD,
      }),
      (error) => {
        assert.deepEqual(calls, []);
        assert.equal(error.rotationState.localDirectUrlUpdated, true);
        assert.equal(error.rotationState.vercelDirectUrlUpdated, false);
        assert.equal(error.rotationState.databaseCredentialRotationAttempted, false);
        return true;
      },
    );
  });

  it("does not alter PostgreSQL when DATABASE_URL metadata changes concurrently", async () => {
    const calls = [];
    await assert.rejects(
      () => runOwnerRotation(config(), {
        verifyVercelProject: () => {},
        readProductionDatabaseMetadata: (() => {
          let callCount = 0;
          return async () => callCount++ === 0
            ? vercelMetadata(100, 50)
            : vercelMetadata(101, 51);
        })(),
        database: {
          readOwnerState: async () => ownerState(),
          alterCurrentOwnerPassword: async () => calls.push("rotate-db"),
        },
        updateLocalDirectUrl: () => {},
        updateProductionDirectUrl: async () => true,
        generatePassword: () => GENERATED_PASSWORD,
      }),
      (error) => {
        assert.deepEqual(calls, []);
        assert.equal(error.rotationState.vercelDirectUrlUpdated, true);
        assert.equal(error.rotationState.runtimeDatabaseUrlMetadataUnchanged, false);
        assert.equal(error.rotationState.databaseCredentialRotationAttempted, false);
        return true;
      },
    );
  });

  it("retains explicit reconciliation state if Vercel is new but database acceptance is unproved", async () => {
    await assert.rejects(
      () => runOwnerRotation(config(), {
        verifyVercelProject: () => {},
        readProductionDatabaseMetadata: (() => {
          let callCount = 0;
          return async () => vercelMetadata(callCount++ === 0 ? 100 : 101);
        })(),
        database: {
          readOwnerState: async (url) => {
            if (url === OWNER_URL) return ownerState();
            throw new Error("new authentication rejected");
          },
          alterCurrentOwnerPassword: async () => {
            throw new Error("ambiguous result");
          },
        },
        updateLocalDirectUrl: () => {},
        updateProductionDirectUrl: async () => true,
        generatePassword: () => GENERATED_PASSWORD,
      }),
      (error) => {
        assert.equal(error.rotationState.vercelDirectUrlUpdateVerified, true);
        assert.equal(error.rotationState.databaseCredentialRotationAttempted, true);
        assert.equal(error.rotationState.newCredentialVerified, false);
        const failed = buildEvidence(config(), { rotationState: error.rotationState }, "failed");
        assert.equal(failed.issueCount, 3);
        return true;
      },
    );
  });

  it("rejects the former owner membership-free assumption", async () => {
    const drifted = ownerState();
    drifted.ownerRole.memberships = [];
    await assert.rejects(
      () => runOwnerRotation(config("preflight-only"), {
        verifyVercelProject: () => {},
        readProductionDatabaseMetadata: async () => vercelMetadata(100),
        database: { readOwnerState: async () => drifted },
      }),
      /production owner, runtime role, or SavedSearch Phase-A state drifted/,
    );
  });

  it("never sends a cleartext password through SQL or emits secrets and caught errors", () => {
    const source = fs.readFileSync("scripts/saved-search-phase-b-owner-rotation.mjs", "utf8");
    const mainBlock = source.slice(source.indexOf("async function main()"));
    assert.doesNotMatch(source, /PASSWORD '\$\{password\}'/);
    assert.match(source, /PASSWORD '\$\{verifier\}'/);
    assert.doesNotMatch(mainBlock, /error\.message|console\.(?:log|error)/);
    assert.doesNotMatch(mainBlock, /DIRECT_URL.*JSON\.stringify|password.*JSON\.stringify/i);
    const failed = buildEvidence(config(), { rotationState: { vercelDirectUrlUpdated: true } }, "failed");
    assert.doesNotMatch(JSON.stringify(failed), /old-password|secret material/);
  });
});
