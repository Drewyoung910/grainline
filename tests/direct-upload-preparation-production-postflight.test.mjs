import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_CONFIRMATION,
  assertDirectUploadPreparationGitState,
  parseDirectUploadPreparationPostflightConfig,
  proveDirectUploadPreparationRuntimeCatalog,
  writeDirectUploadPreparationPostflightEvidence,
} from "../scripts/direct-upload-preparation-production-postflight.mjs";
import {
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS,
  DIRECT_UPLOAD_PRIVATE_FUNCTION_NAMES,
} from "../scripts/direct-upload-authority-catalog.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RELEASE_COMMIT = "d".repeat(40);

function tempDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-preparation-postflight-"),
  );
}

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    DIRECT_UPLOAD_PREPARATION_MAIN_CI_RUN_ID: "30230000001",
    DIRECT_UPLOAD_PREPARATION_MIGRATION_RUN_ID: "30230000002",
    DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_CONFIRM:
      DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_CONFIRMATION,
    DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `direct-upload-preparation-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    DIRECT_UPLOAD_PREPARATION_RELEASE_COMMIT: RELEASE_COMMIT,
    ...overrides,
  };
}

describe("DirectUpload preparation production postflight", () => {
  it("accepts only the reviewed pooled runtime identity and exact release evidence binding", () => {
    const directory = tempDirectory();
    try {
      const config = parseDirectUploadPreparationPostflightConfig(
        environment(directory),
      );
      assert.equal(config.runtimeGuard.runtimeRole, "grainline_app_runtime");
      assert.equal(config.runtimeGuard.endpointId, "ep-plain-river-aaqg8gj4");
      assert.equal(config.mainCiRunId, 30230000001);
      assert.equal(config.migrationRunId, 30230000002);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects confirmation, identity, credential, run, and evidence drift", () => {
    const cases = [
      { DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_CONFIRM: "yes" },
      { DIRECT_UPLOAD_PREPARATION_RELEASE_COMMIT: "short" },
      { DIRECT_UPLOAD_PREPARATION_MAIN_CI_RUN_ID: "0" },
      { DIRECT_UPLOAD_PREPARATION_MIGRATION_RUN_ID: "not-a-run" },
      {
        DATABASE_URL: RUNTIME_URL.replace(
          "grainline_app_runtime",
          "neondb_owner",
        ),
      },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      {
        DATABASE_URL: RUNTIME_URL.replace(
          "ep-plain-river-aaqg8gj4",
          "ep-other",
        ),
      },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      {
        DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_EVIDENCE_PATH:
          "/tmp/wrong-name.json",
      },
    ];
    for (const drift of cases) {
      const directory = tempDirectory();
      try {
        assert.throws(() =>
          parseDirectUploadPreparationPostflightConfig(
            environment(directory, drift),
          ),
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("requires an exact clean release checkout", () => {
    assert.deepEqual(
      assertDirectUploadPreparationGitState(
        { head: RELEASE_COMMIT, status: "" },
        RELEASE_COMMIT,
      ),
      { clean: true, head: RELEASE_COMMIT },
    );
    assert.throws(
      () =>
        assertDirectUploadPreparationGitState(
          { head: RELEASE_COMMIT, status: "?? unreviewed.sql" },
          RELEASE_COMMIT,
        ),
      /exact clean release commit/,
    );
  });

  it("writes sanitized evidence once with owner-only permissions", () => {
    const directory = tempDirectory();
    try {
      const evidencePath =
        environment(
          directory,
        ).DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_EVIDENCE_PATH;
      writeDirectUploadPreparationPostflightEvidence(evidencePath, {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, "utf8")), {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.throws(
        () => writeDirectUploadPreparationPostflightEvidence(evidencePath, {}),
        { code: "EEXIST" },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("is read-only and pins the compatible catalog plus direct denial", () => {
    const source = fs.readFileSync(
      "scripts/direct-upload-preparation-production-postflight.mjs",
      "utf8",
    );
    assert.match(source, /BEGIN TRANSACTION READ ONLY/);
    assert.match(
      source,
      /BEGIN TRANSACTION READ ONLY[\s\S]*await assertReadOnlyTransaction\(client\)[\s\S]*if \(verifyProductionIdentity\) await verifyRuntimeIdentity\(client\)[\s\S]*await verifyTablePosture\(client, migrationRole\)[\s\S]*await verifyCompatibilityCatalog\(client\)[\s\S]*await verifyFunctionCatalog\(client, migrationRole\)[\s\S]*await proveReadOnlyRuntimeBoundary\(client\)[\s\S]*await client\.query\("ROLLBACK"\)/,
    );
    assert.match(
      source,
      /pg_catalog\.current_setting\('transaction_read_only'\) AS read_only/,
    );
    assert.match(source, /result\.rows\[0\]\?\.read_only,\s+"on"/);
    assert.match(source, /wholePostflightTransactionReadOnly: true/);
    assert.match(source, /whole_postflight_read_only_transaction/);
    assert.doesNotMatch(
      source,
      /await verifyRuntimeIdentity\(client\);\s+await proveDirectUploadPreparationRuntimeCatalog/,
    );
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
    );
    assert.match(source, /legacyDirectUploadCrudRetained: true/);
    assert.match(source, /referenceLedgerRuntimeTableAccess: false/);
    assert.match(source, /rls_enabled: false/);
    assert.match(source, /rls_forced: true/);
    assert.match(source, /convalidated AS validated/);
    assert.match(source, /DirectUpload_userId_fkey/);
    assert.match(source, /CaseMessageAttachment_directUploadId_fkey/);
    assert.match(source, /reviewedUnvalidatedDirectUploadConstraintCount: 6/);
    assert.match(
      source,
      /validatedCaseAttachmentDirectUploadConstraintCount: 2/,
    );
    assert.match(source, /reviewedTriggerCount: 13/);
    assert.match(source, /tgdeferrable AS deferrable/);
    assert.match(source, /tginitdeferred AS initially_deferred/);
    assert.match(source, /procedure\.proname AS function_name/);
    assert.match(source, /grainline_direct_upload_identity_immutable/);
    assert.match(source, /grainline_direct_upload_reference_guard/);
    assert.match(source, /grainline_direct_upload_release_listing_delete/);
    assert.match(
      source,
      /grainline_direct_upload_release_seller_profile_delete/,
    );
    assert.match(source, /grainline_direct_upload_release_review_delete/);
    assert.match(source, /grainline_direct_upload_release_blog_post_delete/);
    assert.match(
      source,
      /grainline_direct_upload_release_commission_request_delete/,
    );
    assert.match(
      source,
      /grainline_direct_upload_release_seller_broadcast_delete/,
    );
    assert.match(
      source,
      /grainline_direct_upload_release_legacy_message_delete/,
    );
    assert.match(source, /grainline_direct_upload_sync_public_core/);
    assert.match(source, /"42501"/);
    assert.equal(typeof proveDirectUploadPreparationRuntimeCatalog, "function");
    assert.match(
      source,
      /proveDirectUploadPreparationRuntimeCatalog\(client, \{/,
    );
    assert.match(source, /productionChangedByPostflight: false/);
    assert.equal(DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.length, 35);
    assert.equal(DIRECT_UPLOAD_PRIVATE_FUNCTION_NAMES.length, 14);
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts?.["ops:direct-upload-preparation-postflight"],
      "node scripts/direct-upload-preparation-production-postflight.mjs",
    );
    const audit = fs.readFileSync("docs/direct-upload-rls-audit.md", "utf8");
    assert.match(audit, /Production preparation postflight scaffold/);
    assert.match(
      audit,
      /does\s+\*\*not\*\*\s+verify the Vercel deployment/,
    );
  });
});
