import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CASE_ACTIVATION_MIGRATION,
  CASE_ACTIVATION_POSTFLIGHT_CONFIRMATION,
  CASE_ACTIVATION_RUNTIME_FUNCTION,
  CASE_ACTIVATION_RUNTIME_FUNCTION_ARGUMENTS,
  parseCaseActivationPostflightConfig,
  writeCaseActivationPostflightEvidence,
} from "../scripts/case-activation-production-postflight.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RELEASE_COMMIT = "a".repeat(40);

function tempDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "case-activation-postflight-"),
  );
}

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: RUNTIME_URL,
    CASE_ACTIVATION_POSTFLIGHT_CONFIRM:
      CASE_ACTIVATION_POSTFLIGHT_CONFIRMATION,
    CASE_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `case-activation-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    CASE_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID: "30935572049",
    CASE_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID: "30940000001",
    CASE_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
    ...overrides,
  };
}

describe("Case activation production postflight", () => {
  it("accepts only the exact pooled runtime identity and release bindings", () => {
    const directory = tempDirectory();
    try {
      const config = parseCaseActivationPostflightConfig(
        environment(directory),
      );
      assert.equal(config.runtimeGuard.runtimeRole, "grainline_app_runtime");
      assert.equal(config.runtimeGuard.endpointId, "ep-plain-river-aaqg8gj4");
      assert.equal(config.mainCiRunId, 30935572049);
      assert.equal(config.migrationRunId, 30940000001);
      assert.equal(config.releaseCommit, RELEASE_COMMIT);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects identity, authority, run, confirmation, and evidence drift", () => {
    const cases = [
      { CASE_ACTIVATION_POSTFLIGHT_CONFIRM: "yes" },
      { CASE_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT: "short" },
      { CASE_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID: "0" },
      { CASE_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID: "not-a-run" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      { DATABASE_URL: RUNTIME_URL.replace("ep-plain-river-aaqg8gj4", "ep-other") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      { CASE_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH: "/tmp/wrong.json" },
    ];
    for (const drift of cases) {
      const directory = tempDirectory();
      try {
        assert.throws(
          () => parseCaseActivationPostflightConfig(
            environment(directory, drift),
          ),
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("writes sanitized evidence exactly once with mode 0600", () => {
    const directory = tempDirectory();
    try {
      const evidencePath =
        environment(directory).CASE_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH;
      writeCaseActivationPostflightEvidence(evidencePath, {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, "utf8")), {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.throws(
        () => writeCaseActivationPostflightEvidence(evidencePath, {}),
        { code: "EEXIST" },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("proves policyless ENABLE and direct denial inside an engine-read-only transaction", () => {
    const source = fs.readFileSync(
      "scripts/case-activation-production-postflight.mjs",
      "utf8",
    );
    assert.equal(CASE_ACTIVATION_MIGRATION, "20260804160000_enable_case_rls");
    assert.equal(
      CASE_ACTIVATION_RUNTIME_FUNCTION,
      "grainline_direct_upload_case_attachment_read",
    );
    assert.equal(
      CASE_ACTIVATION_RUNTIME_FUNCTION_ARGUMENTS,
      "text, text, text",
    );
    assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /verifyReadOnlyTransaction/);
    assert.match(source, /rls_enabled, true/);
    assert.match(source, /rls_forced, false/);
    assert.match(source, /policy_count, 0/);
    assert.match(source, /has_table_access, false/);
    assert.match(source, /has_column_access, false/);
    assert.match(source, /"CaseMessageAttachment"/);
    assert.match(source, /"42501"/);
    assert.match(source, /runtimeFunctionCount:[\s\S]*\.length \+ 1/);
    assert.match(source, /oidvectortypes\(procedure\.proargtypes\) = \$2/);
    assert.match(source, /productionChangedByPostflight: false/);
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
    );
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts?.["ops:case-activation-postflight"],
      "node scripts/case-activation-production-postflight.mjs",
    );
  });
});
