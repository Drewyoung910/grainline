import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECTION_CONFIRMATION,
  classifyDirectUploadActivationFailure,
  classifyDirectUploadActivationPreflightError,
  extractDirectUploadActivationReadOnlyPreflight,
  parseDirectUploadActivationFailureInspectionConfig,
  writeDirectUploadActivationFailureEvidence,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";

const RELEASE_COMMIT = "e".repeat(40);
const OWNER_URL =
  "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "direct-upload-failure-inspection-"));
}

function environment(directory, overrides = {}) {
  return {
    DIRECT_URL: OWNER_URL,
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(OWNER_URL).digest("hex"),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    MIGRATION_DB_ROLE: "neondb_owner",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ID: "30730000002",
    GITHUB_SHA: RELEASE_COMMIT,
    RUNNER_TEMP: directory,
    DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_RELEASE_COMMIT: RELEASE_COMMIT,
    DIRECT_UPLOAD_ACTIVATION_FAILED_MIGRATION_RUN_ID: "30729632410",
    DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_CONFIRM:
      DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECTION_CONFIRMATION,
    DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_EVIDENCE_PATH: path.join(
      directory,
      `direct-upload-activation-failure-inspection-${RELEASE_COMMIT}.json`,
    ),
    ...overrides,
  };
}

describe("DirectUpload activation failure inspection", () => {
  it("accepts only the exact owner-only manual main context", () => {
    const directory = temporaryDirectory();
    try {
      const config = parseDirectUploadActivationFailureInspectionConfig(
        environment(directory),
      );
      assert.equal(config.releaseCommit, RELEASE_COMMIT);
      assert.equal(config.failedMigrationRunId, "30729632410");
      assert.equal(config.identity.username, "neondb_owner");
      assert.equal(config.identity.isPooler, false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects source, confirmation, credentials, ids, digest, and path drift", () => {
    const directory = temporaryDirectory();
    try {
      const cases = [
        { GITHUB_REF: "refs/heads/feature" },
        { GITHUB_SHA: "d".repeat(40) },
        { DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_CONFIRM: "yes" },
        { DIRECT_UPLOAD_ACTIVATION_FAILED_MIGRATION_RUN_ID: "0" },
        { DATABASE_URL: "present" },
        { DIRECT_UPLOAD_CLEANUP_DATABASE_URL: "present" },
        { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
        {
          DIRECT_UPLOAD_ACTIVATION_FAILURE_INSPECT_EVIDENCE_PATH:
            path.join(directory, "wrong.json"),
        },
      ];
      for (const overrides of cases) {
        assert.throws(() =>
          parseDirectUploadActivationFailureInspectionConfig(
            environment(directory, overrides),
          ));
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("classifies reviewed migration errors without retaining raw logs", () => {
    const migration = "DO $$ BEGIN RAISE EXCEPTION 'DirectUpload constraints must all exist: %', 5; END $$;";
    const logs = "DbError { code: SqlState(E12345), message: \"DirectUpload constraints must all exist: 5\" }";
    const result = classifyDirectUploadActivationFailure(logs, migration);
    assert.equal(result.databaseMessage, "DirectUpload constraints must all exist:");
    assert.equal(result.matchedMigrationException, true);
    assert.equal(result.sqlState, "12345");
    assert.equal(result.rawLogRetained, false);
    assert.equal(result.logSha256.length, 64);
  });

  it("extracts only the two exact read-only migration preflight blocks", () => {
    const migration = fs.readFileSync(
      "prisma/migrations/20260801194000_enable_direct_upload_rls/migration.sql",
      "utf8",
    );
    const preflight = extractDirectUploadActivationReadOnlyPreflight(migration);
    assert.match(
      preflight,
      /^DO \$grainline_direct_upload_activation_role_preflight\$/u,
    );
    assert.match(
      preflight,
      /\$grainline_direct_upload_activation_function_preflight\$;$/u,
    );
    assert.equal((preflight.match(/^DO /gmu) ?? []).length, 2);
    assert.doesNotMatch(
      preflight,
      /^\s*(?:ALTER|CALL|COMMENT|COPY|CREATE|DELETE|DROP|GRANT|INSERT|LOCK|MERGE|REFRESH|REINDEX|REVOKE|SECURITY\s+LABEL|TRUNCATE|UPDATE|VACUUM)\b/imu,
    );
    assert.doesNotMatch(preflight, /pg_advisory_xact_lock/u);
    assert.doesNotMatch(preflight, /COMMIT;/u);
  });

  it("classifies a live PostgreSQL preflight error without retaining it", () => {
    const migration = "DO $$ BEGIN RAISE EXCEPTION 'DirectUpload function catalog count drifted: %', 34; END $$;";
    const error = Object.assign(
      new Error("DirectUpload function catalog count drifted: 34"),
      { code: "P0001" },
    );
    const result = classifyDirectUploadActivationPreflightError(error, migration);
    assert.deepEqual(result, {
      databaseMessage: "DirectUpload function catalog count drifted:",
      matchedMigrationException: true,
      sqlState: "P0001",
      rawErrorRetained: false,
    });
  });

  it("classifies an allowlisted bare node-postgres error message", () => {
    const result = classifyDirectUploadActivationPreflightError(
      Object.assign(new Error("function public.missing() does not exist"), {
        code: "42883",
      }),
      "DO $$ BEGIN NULL; END $$;",
    );
    assert.deepEqual(result, {
      databaseMessage: "function public.missing() does not exist",
      matchedMigrationException: false,
      sqlState: "42883",
      rawErrorRetained: false,
    });
  });

  it("writes a new private evidence file and rejects sensitive shapes", () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "evidence.json");
    try {
      writeDirectUploadActivationFailureEvidence(target, {
        status: "inspected",
        retained: { migrationLog: false },
      });
      assert.equal(fs.statSync(target).mode & 0o777, 0o600);
      assert.throws(() =>
        writeDirectUploadActivationFailureEvidence(
          path.join(directory, "unsafe.json"),
          { value: OWNER_URL },
        ));
      assert.throws(() =>
        writeDirectUploadActivationFailureEvidence(
          path.join(directory, "raw-error.json"),
          { rawError: "unexpected database failure" },
        ));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins a read-only, main-only protected workflow with separated credentials", () => {
    const workflow = fs.readFileSync(
      ".github/workflows/direct-upload-activation-failure-inspection.yml",
      "utf8",
    );
    const script = fs.readFileSync(
      "scripts/direct-upload-activation-failure-inspect.mjs",
      "utf8",
    );
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
    assert.match(workflow, /environment: Production/u);
    assert.match(workflow, /DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/u);
    assert.doesNotMatch(workflow, /DATABASE_URL:|DIRECT_UPLOAD_CLEANUP_DATABASE_URL:/u);
    assert.match(script, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
    assert.match(script, /extractDirectUploadActivationReadOnlyPreflight/u);
    assert.match(script, /schemaVersion: 2/u);
    assert.match(script, /productionChangedByInspection: false/u);
    assert.doesNotMatch(script, /client\.query\(`?(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)/u);
  });
});
