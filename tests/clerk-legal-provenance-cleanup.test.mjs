import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CLERK_LEGAL_ACCOUNT_STATE_CACHE_DRAIN_SECONDS,
  CLERK_LEGAL_ACCOUNT_STATE_CACHE_TTL_SECONDS,
  REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS,
  REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION,
  assertClerkLegalProvenanceCleanupGitState,
  buildClerkLegalProvenanceCleanupTargetSql,
  buildClerkLegalProvenanceClearSql,
  classifyClerkLegalProvenanceCleanupState,
  parseClerkLegalProvenanceCleanupConfig,
  writeClerkLegalProvenanceCleanupEvidence,
} from "../scripts/clerk-legal-provenance-cleanup.mjs";
import { parseClerkLegalProvenanceCleanupProofConfig } from "../scripts/clerk-legal-provenance-cleanup-postgres-proof.mjs";

const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const COMMIT = "a".repeat(40);
const RUNNER_TEMP = "/private/tmp/clerk-legal-provenance-cleanup-test";

function configEnv() {
  return {
    DIRECT_URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256")
      .update(DIRECT_URL)
      .digest("hex"),
    CLERK_LEGAL_PROVENANCE_CLEANUP_RELEASE_COMMIT: COMMIT,
    CLERK_LEGAL_PROVENANCE_INSPECTION_RUN_ID:
      REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION.runId,
    CLERK_LEGAL_PROVENANCE_INSPECTION_EVIDENCE_SHA256:
      REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION.evidenceSha256,
    CLERK_LEGAL_PROVENANCE_CLEANUP_CONFIRM:
      "clear-one-untrusted-clerk-legal-acceptance",
    RUNNER_TEMP,
    CLERK_LEGAL_PROVENANCE_CLEANUP_EVIDENCE_PATH:
      `${RUNNER_TEMP}/clerk-legal-provenance-cleanup-${COMMIT}.json`,
  };
}

describe("Clerk legal acceptance provenance cleanup", () => {
  const source = fs.readFileSync(
    "scripts/clerk-legal-provenance-cleanup.mjs",
    "utf8",
  );
  const proof = fs.readFileSync(
    "scripts/clerk-legal-provenance-cleanup-postgres-proof.mjs",
    "utf8",
  );
  const workflow = fs.readFileSync(
    ".github/workflows/clerk-legal-provenance-cleanup.yml",
    "utf8",
  );
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const recovery = fs.readFileSync(
    "docs/clerk-webhook-secret-credential-recovery.md",
    "utf8",
  );
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  it("binds the cleanup to the exact accepted aggregate inspection", () => {
    assert.deepEqual(REVIEWED_CLERK_LEGAL_PROVENANCE_INSPECTION, {
      runId: "33886609425",
      releaseCommit: "1e4e0c786a9fe4259cbd3d6e79bec39aabc9de2d",
      evidenceSha256:
        "6b9819119b1c20e3f386546e623c98f894181a294c3f8dc9932e37c747bb50ca",
    });
    assert.equal(
      parseClerkLegalProvenanceCleanupConfig(configEnv()).inspectionRunId,
      "33886609425",
    );
    for (const drift of [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_SHA: "b".repeat(40) },
      { CLERK_LEGAL_PROVENANCE_INSPECTION_RUN_ID: "33886609426" },
      { CLERK_LEGAL_PROVENANCE_INSPECTION_EVIDENCE_SHA256: "0".repeat(64) },
      { CLERK_LEGAL_PROVENANCE_CLEANUP_CONFIRM: "yes" },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
      { MIGRATION_DB_ROLE: "grainline_app_runtime" },
    ]) {
      assert.throws(() =>
        parseClerkLegalProvenanceCleanupConfig({
          ...configEnv(),
          ...drift,
        }));
    }
    assert.deepEqual(
      assertClerkLegalProvenanceCleanupGitState(
        { head: COMMIT, status: "" },
        COMMIT,
      ),
      { head: COMMIT, clean: true },
    );
    assert.throws(() =>
      assertClerkLegalProvenanceCleanupGitState(
        { head: COMMIT, status: "?? unexpected" },
        COMMIT,
      ));
  });

  it("classifies exact reviewed states and harmless zero-untrusted drift", () => {
    assert.equal(
      classifyClerkLegalProvenanceCleanupState(
        REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS.inspected,
      ),
      "cleanup-required",
    );
    assert.equal(
      classifyClerkLegalProvenanceCleanupState(
        REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS.cleared,
      ),
      "already-cleared",
    );
    assert.equal(
      classifyClerkLegalProvenanceCleanupState(
        REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS.reaccepted,
      ),
      "already-reaccepted",
    );
    assert.equal(
      classifyClerkLegalProvenanceCleanupState({
        ...REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS.cleared,
        totalUsers: 10,
        activeUsers: 10,
        activeNoLegalState: 3,
      }),
      "already-converged",
    );
    assert.throws(
      () => classifyClerkLegalProvenanceCleanupState({
        ...REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS.inspected,
        activeUntrustedCurrentAccepted: 2,
      }),
      /not an exact reviewed state/,
    );
  });

  it("locks and clears only the exact untrusted active current acceptance", () => {
    const targetSql = buildClerkLegalProvenanceCleanupTargetSql();
    const clearSql = buildClerkLegalProvenanceClearSql();
    assert.match(targetSql, /subject\."deletedAt" IS NULL/);
    assert.match(targetSql, /subject\."termsAcceptedAt" IS NOT NULL/);
    assert.match(targetSql, /subject\."ageAttestedAt" IS NOT NULL/);
    assert.match(targetSql, /subject\."termsVersion" IS NOT DISTINCT FROM '2026-06-14'/);
    assert.match(targetSql, /audit\."adminId" = subject\.id/);
    assert.match(targetSql, /audit\."targetId" = subject\.id/);
    assert.match(targetSql, /audit\.metadata->>'actorKind' = 'user'/);
    assert.match(targetSql, /audit\.metadata->>'route' = '\/api\/account\/accept-terms'/);
    assert.match(targetSql, /FOR UPDATE OF subject/);
    assert.match(clearSql, /"termsAcceptedAt" = NULL/);
    assert.match(clearSql, /"termsVersion" = NULL/);
    assert.match(clearSql, /"ageAttestedAt" = NULL/);
    assert.match(clearSql, /WHERE id = \$1/);
    assert.doesNotMatch(source, /INSERT INTO public\."AdminAuditLog"/);
    assert.doesNotMatch(source, /DELETE FROM public\."User"/);
  });

  it("uses a serializable transaction, advisory lock, and bounded cache drain", () => {
    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
    assert.match(source, /transaction_isolation/);
    assert.match(source, /pg_advisory_xact_lock/);
    assert.match(source, /FOR UPDATE OF subject/);
    assert.match(source, /await client\.query\("COMMIT"\)/);
    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.equal(CLERK_LEGAL_ACCOUNT_STATE_CACHE_TTL_SECONDS, 60);
    assert.equal(CLERK_LEGAL_ACCOUNT_STATE_CACHE_DRAIN_SECONDS, 65);
    assert.ok(
      CLERK_LEGAL_ACCOUNT_STATE_CACHE_DRAIN_SECONDS
        > CLERK_LEGAL_ACCOUNT_STATE_CACHE_TTL_SECONDS,
    );
  });

  it("writes only private sanitized aggregate evidence", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "clerk-legal-provenance-cleanup-evidence-"),
    );
    const evidencePath = path.join(directory, "evidence.json");
    writeClerkLegalProvenanceCleanupEvidence(evidencePath, {
      status: "passed",
      changedRows: 1,
      finalCounts: REVIEWED_CLERK_LEGAL_PROVENANCE_COUNTS.cleared,
      retained: { aggregateCountsOnly: true },
    });
    const stat = fs.lstatSync(evidencePath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o077, 0);
    assert.throws(
      () =>
        writeClerkLegalProvenanceCleanupEvidence(
          path.join(directory, "bad.json"),
          { clerkId: "private" },
        ),
      /contains private data/,
    );
  });

  it("proves cleanup, restart, and multi-target rollback in ephemeral PostgreSQL", () => {
    assert.throws(
      () => parseClerkLegalProvenanceCleanupProofConfig({}),
      /PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseClerkLegalProvenanceCleanupProofConfig({
          CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.match(proof, /firstChangedRows: first\.changedRows/);
    assert.match(proof, /restartChangedRows: second\.changedRows/);
    assert.match(proof, /twoTargetFailureRolledBack: true/);
    assert.match(
      ci,
      /Prove Clerk legal acceptance provenance cleanup in ephemeral PostgreSQL/,
    );
    assert.equal(
      packageJson.scripts["audit:clerk-legal-provenance-cleanup-postgres"],
      "node scripts/clerk-legal-provenance-cleanup-postgres-proof.mjs",
    );
  });

  it("uses a serialized protected workflow and records the production hold", () => {
    assert.match(workflow, /^\s*workflow_dispatch:/m);
    assert.match(workflow, /^\s+environment: Production$/m);
    assert.match(workflow, /group: production-database-migrations/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /secrets\.PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /vars\.PRODUCTION_MIGRATION_DIRECT_URL_SHA256/);
    assert.match(workflow, /inspection_run_id/);
    assert.match(workflow, /inspection_evidence_sha256/);
    assert.doesNotMatch(workflow, /secrets\.(?:DIRECT_URL|DATABASE_URL)\b/);
    assert.match(workflow, /upload-artifact@v4/);
    assert.match(workflow, /retention-days: 30/);
    assert.equal(
      packageJson.scripts["ops:clerk-legal-provenance-cleanup"],
      "node scripts/clerk-legal-provenance-cleanup.mjs",
    );
    assert.match(recovery, /33886609425/);
    assert.match(recovery, /activeUntrustedCurrentAccepted.*1/);
    assert.match(
      recovery.replace(/\s+/g, " "),
      /provider rotation remains paused/i,
    );
  });
});
