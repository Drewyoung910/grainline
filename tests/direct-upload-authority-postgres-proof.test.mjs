import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseProofConfig,
} from "../scripts/direct-upload-authority-postgres-proof.mjs";

const proof = readFileSync(
  "scripts/direct-upload-authority-postgres-proof.mjs",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/direct-upload-authority-postgres-proof.yml",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("DirectUpload authority PostgreSQL proof harness", () => {
  it("refuses every non-loopback or non-disposable database target", () => {
    assert.throws(
      () => parseProofConfig({}),
      /DIRECT_UPLOAD_AUTHORITY_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseProofConfig({
          DIRECT_UPLOAD_AUTHORITY_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseProofConfig({
          DIRECT_UPLOAD_AUTHORITY_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires the grainline_ci database/,
    );
    assert.deepEqual(
      parseProofConfig({
        DIRECT_UPLOAD_AUTHORITY_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("pins fixed authority, zero generic authority and exact compatibility posture", () => {
    assert.match(proof, /runtimeFunctions = DIRECT_UPLOAD_RUNTIME_FUNCTION_NAMES/);
    assert.match(proof, /CLEANUP_ROLE = "grainline_direct_upload_cleanup"/);
    assert.match(proof, /cleanupExecuteNames/);
    assert.match(
      proof,
      /must remain runtime-compatible during preparation/,
    );
    assert.match(proof, /cleanupMemberships/);
    assert.match(proof, /cleanupColumns/);
    assert.match(proof, /cleanupDefaultPrivileges/);
    assert.match(proof, /cleanupUnexpectedFunctions/);
    assert.match(proof, /cleanup_role_production_postflight_query/);
    assert.match(proof, /readDirectUploadCleanupRoleProvisionSnapshot/);
    assert.match(
      proof,
      /DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES/,
    );
    assert.match(proof, /runtimeFunctions\.length \+ privateFunctions\.length/);
    assert.match(proof, /DirectUploadReference[\s\S]*runtime_crud: false/);
    assert.match(proof, /DirectUpload[\s\S]*relrowsecurity: false/);
    assert.match(proof, /runtime generic source sync/);
    assert.match(proof, /forged DirectUpload actor key segment/);
    assert.match(proof, /foreign Listing fixed sync/);
    assert.match(proof, /untracked: 1/);
    assert.match(proof, /activeReferenceCount\(owner, uploadA\), 1/);
    assert.match(proof, /case_attachment_compatibility_and_lifecycle/);
    assert.match(proof, /const oldClaim = await runtime\.query/);
    assert.match(proof, /const oldLink = await runtime\.query/);
    assert.match(proof, /assert\.equal\(oldLink\.rowCount, 1\)/);
    assert.match(proof, /const newReference = await runtime\.query/);
    assert.match(proof, /mismatched Case attachment key and DirectUpload id/);
    assert.match(proof, /mutable Case attachment parent/);
    assert.match(proof, /grainline_direct_upload_case_attachment_read/);
    assert.match(proof, /releaseReason: "SOURCE_DELETED"/);
    assert.match(proof, /banned_account_lifecycle_cleanup/);
    assert.match(proof, /grainline_direct_upload_account_public_urls/);
    assert.match(proof, /grainline_direct_upload_release_for_account/);
    assert.match(proof, /grainline_direct_upload_export/);
  });

  it("forces real lock waits and proves cleanup SKIP LOCKED ordering", () => {
    assert.match(proof, /pg_catalog\.pg_stat_activity/);
    assert.match(proof, /wait_event_type === "Lock"/);
    assert.match(proof, /stable_swap_lock_order/);
    assert.match(proof, /reference_cleanup_winner_orderings/);
    assert.match(proof, /reference-first/);
    assert.match(proof, /cleanup-first/);
    assert.match(proof, /skippedLease\.rows/);
    assert.match(proof, /wrong-lease/);
  });

  it("cleans every fixture and records that no persistent environment changed", () => {
    assert.match(proof, /async function cleanupFixtures/);
    assert.match(proof, /await cleanupFixtures\(owner\)\.catch/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /example\.invalid/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  });

  it("runs the current migration tree in branch-scoped PostgreSQL 16", () => {
    assert.match(
      workflow,
      /agent\/direct-upload-rls-preparation-20260726/,
    );
    assert.match(
      workflow,
      /agent\/direct-upload-rls-activation-20260726/,
    );
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /POSTGRES_DB: grainline_ci/);
    assert.match(workflow, /npx prisma migrate deploy/);
    assert.match(
      workflow,
      /provision-direct-upload-cleanup-role\.sql/,
    );
    assert.match(workflow, /npm run audit:rls-direct-upload-authority/);
    assert.equal(
      packageJson.scripts["audit:rls-direct-upload-authority"],
      "node scripts/direct-upload-authority-postgres-proof.mjs",
    );
  });
});
