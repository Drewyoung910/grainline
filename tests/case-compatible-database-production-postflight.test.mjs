import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CASE_COMPATIBLE_DATABASE_POSTFLIGHT_CONFIRMATION,
  CASE_COMPATIBLE_PRIVATE_FUNCTIONS,
  CASE_COMPATIBLE_RUNTIME_FUNCTIONS,
  assertCaseCompatibleDatabaseGitState,
  parseCaseCompatibleDatabasePostflightConfig,
  writeCaseCompatibleDatabasePostflightEvidence,
} from "../scripts/case-compatible-database-production-postflight.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RELEASE_COMMIT = "e".repeat(40);

function tempDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "case-compatible-database-postflight-"),
  );
}

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CASE_COMPATIBLE_DB_MAIN_CI_RUN_ID: "30505456409",
    CASE_COMPATIBLE_DB_MIGRATION_RUN_ID: "30510000001",
    CASE_COMPATIBLE_DB_POSTFLIGHT_CONFIRM:
      CASE_COMPATIBLE_DATABASE_POSTFLIGHT_CONFIRMATION,
    CASE_COMPATIBLE_DB_POSTFLIGHT_EVIDENCE_PATH:
      path.join(
        directory,
        `case-compatible-database-production-postflight-${RELEASE_COMMIT}.json`,
      ),
    CASE_COMPATIBLE_DB_RELEASE_COMMIT: RELEASE_COMMIT,
    ...overrides,
  };
}

describe("Case compatible database production postflight", () => {
  it("accepts only the reviewed pooled runtime identity and exact evidence binding", () => {
    const directory = tempDirectory();
    try {
      const config = parseCaseCompatibleDatabasePostflightConfig(
        environment(directory),
      );
      assert.equal(config.runtimeGuard.runtimeRole, "grainline_app_runtime");
      assert.equal(config.runtimeGuard.endpointId, "ep-plain-river-aaqg8gj4");
      assert.equal(config.mainCiRunId, 30505456409);
      assert.equal(config.migrationRunId, 30510000001);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects confirmation, identity, credential, run, and evidence drift", () => {
    const cases = [
      { CASE_COMPATIBLE_DB_POSTFLIGHT_CONFIRM: "yes" },
      { CASE_COMPATIBLE_DB_RELEASE_COMMIT: "short" },
      { CASE_COMPATIBLE_DB_MAIN_CI_RUN_ID: "0" },
      { CASE_COMPATIBLE_DB_MIGRATION_RUN_ID: "not-a-run" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      { DATABASE_URL: RUNTIME_URL.replace("ep-plain-river-aaqg8gj4", "ep-other") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      {
        CASE_COMPATIBLE_DB_POSTFLIGHT_EVIDENCE_PATH:
          "/tmp/wrong-name.json",
      },
    ];
    for (const drift of cases) {
      const directory = tempDirectory();
      try {
        assert.throws(
          () => parseCaseCompatibleDatabasePostflightConfig(
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
      assertCaseCompatibleDatabaseGitState(
        { head: RELEASE_COMMIT, status: "" },
        RELEASE_COMMIT,
      ),
      { clean: true, head: RELEASE_COMMIT },
    );
    assert.throws(
      () => assertCaseCompatibleDatabaseGitState(
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
        environment(directory).CASE_COMPATIBLE_DB_POSTFLIGHT_EVIDENCE_PATH;
      writeCaseCompatibleDatabasePostflightEvidence(evidencePath, {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, "utf8")), {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.throws(
        () => writeCaseCompatibleDatabasePostflightEvidence(evidencePath, {}),
        { code: "EEXIST" },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins a read-only compatible boundary and the complete function catalog", () => {
    const source = fs.readFileSync(
      "scripts/case-compatible-database-production-postflight.mjs",
      "utf8",
    );
    assert.match(
      source,
      /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(source, /transaction_read_only/);
    assert.match(
      source,
      /pg_has_role\(\s*CURRENT_USER,\s*\$1,\s*'MEMBER'/,
    );
    assert.doesNotMatch(
      source,
      /pg_has_role\(\s*CURRENT_USER,\s*'neondb_owner'/,
    );
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
    );
    assert.match(source, /caseFamilyRlsEnabled: false/);
    assert.match(source, /legacyCaseCrudRetained: true/);
    assert.match(source, /privateLedgersRlsForced: true/);
    assert.match(source, /privateLedgerRuntimeTableAccess: false/);
    assert.match(source, /grainline_account_deletion_redact_text_core/);
    assert.match(
      source,
      /const SECURITY_INVOKER_FUNCTIONS = new Set\(\[[\s\S]{0,500}grainline_case_get_by_order[\s\S]{0,500}grainline_case_resolution_claim_immutable[\s\S]{0,500}\]\);/,
    );
    assert.doesNotMatch(
      source.match(
        /const SECURITY_INVOKER_FUNCTIONS = new Set\(\[[\s\S]*?\]\);/,
      )?.[0] ?? "",
      /grainline_case_(?:message_page|message_preflight|staff_queue)/,
    );
    assert.match(source, /"42501"/);
    assert.match(source, /productionChangedByPostflight: false/);
    assert.equal(CASE_COMPATIBLE_RUNTIME_FUNCTIONS.length, 26);
    assert.equal(CASE_COMPATIBLE_PRIVATE_FUNCTIONS.length, 3);
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts?.["ops:case-compatible-db-postflight"],
      "node scripts/case-compatible-database-production-postflight.mjs",
    );
    const release = fs.readFileSync(
      "docs/case-compatible-database-preparation-release.md",
      "utf8",
    );
    assert.match(
      release,
      /verify-production-case-compatible-database-read-only/,
    );
    assert.match(release, /transaction_read_only=on/);
    assert.match(release, /mode `0600`/);
    assert.match(release, /contains no connection string/);
  });
});
