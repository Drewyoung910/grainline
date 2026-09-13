import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_ACTIVATION_ACCEPTED_COMMIT,
  DIRECT_UPLOAD_ACTIVATION_CLEANUP_POSTFLIGHT_CONFIRMATION,
  DIRECT_UPLOAD_ACTIVATION_RECOVERY_RUN_ID,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_POSTFLIGHT_CONFIRMATION,
  assertDirectUploadActivationPostflightGitState,
  collectDirectUploadRuntimeActivationIssues,
  parseDirectUploadActivationPostflightConfig,
  writeDirectUploadActivationPostflightEvidence,
} from "../scripts/direct-upload-activation-production-postflight.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
} from "../scripts/direct-upload-activation-catalog.mjs";
import {
  directUploadFunctionSources,
} from "../scripts/direct-upload-function-source-catalog.mjs";

const RELEASE_COMMIT = "e".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const CLEANUP_URL =
  "postgresql://grainline_direct_upload_cleanup_v2:cleanup@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const reviewedSources = directUploadFunctionSources();

function temporaryDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-activation-postflight-"),
  );
}

function sharedEnvironment(directory, mode) {
  return {
    DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_CONFIRM:
      mode === "runtime"
        ? DIRECT_UPLOAD_ACTIVATION_RUNTIME_POSTFLIGHT_CONFIRMATION
        : DIRECT_UPLOAD_ACTIVATION_CLEANUP_POSTFLIGHT_CONFIRMATION,
    DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `direct-upload-activation-${mode}-postflight-${RELEASE_COMMIT}.json`,
    ),
    DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_ACTIVATION_COMMIT:
      DIRECT_UPLOAD_ACTIVATION_ACCEPTED_COMMIT,
    DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID: "30726387850",
    DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_RECOVERY_RUN_ID:
      String(DIRECT_UPLOAD_ACTIVATION_RECOVERY_RUN_ID),
    DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

function runtimeEnvironment(directory, overrides = {}) {
  return {
    ...sharedEnvironment(directory, "runtime"),
    DATABASE_URL: RUNTIME_URL,
    ...overrides,
  };
}

function cleanupEnvironment(directory, overrides = {}) {
  return {
    ...sharedEnvironment(directory, "cleanup"),
    DIRECT_UPLOAD_CLEANUP_DATABASE_URL: CLEANUP_URL,
    DIRECT_UPLOAD_CLEANUP_DATABASE_URL_SHA256:
      createHash("sha256").update(CLEANUP_URL).digest("hex"),
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ID: "30730000002",
    GITHUB_SHA: RELEASE_COMMIT,
    RUNNER_TEMP: directory,
    ...overrides,
  };
}

function functionRow(expected) {
  return {
    function_config: ["search_path=pg_catalog"],
    function_kind: "f",
    function_name: expected.name,
    function_source: reviewedSources[expected.name],
    identity_arguments: expected.identityArguments,
    leakproof: false,
    other_role_execute: [],
    other_role_execute_grantable: [],
    owner_name: "neondb_owner",
    public_execute: false,
    runtime_direct_execute: expected.runtimeExecute,
    runtime_execute: expected.runtimeExecute,
    runtime_execute_grantable: false,
    security_definer: expected.securityDefiner,
    worker_direct_execute: expected.cleanupExecute,
    worker_execute: expected.cleanupExecute,
    worker_execute_grantable: false,
  };
}

function validRuntimeSnapshot() {
  return {
    columnPrivileges: ["Order.id"],
    currentUser: "grainline_app_runtime",
    databaseCreate: false,
    functions: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map(functionRow),
    memberships: [],
    role: {
      rolbypassrls: false,
      rolcanlogin: true,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolname: "grainline_app_runtime",
      rolreplication: false,
      rolsuper: false,
    },
    rlsTables: [
      {
        policy_count: 0,
        relforcerowsecurity: true,
        relname: "DirectUpload",
        relrowsecurity: true,
      },
      {
        policy_count: 0,
        relforcerowsecurity: true,
        relname: "DirectUploadReference",
        relrowsecurity: true,
      },
    ],
    schemaCreate: false,
    schemaUsage: true,
    sessionUser: "grainline_app_runtime",
    tablePrivileges: ["Order"],
  };
}

describe("DirectUpload activation production postflight", () => {
  it("accepts only the reviewed pooled runtime target", () => {
    const directory = temporaryDirectory();
    try {
      const config = parseDirectUploadActivationPostflightConfig(
        runtimeEnvironment(directory),
        "runtime",
      );
      assert.equal(config.mode, "runtime");
      assert.equal(config.targetIdentity.runtimeRole, "grainline_app_runtime");
      assert.equal(config.targetIdentity.endpointId, "ep-plain-river-aaqg8gj4");
      assert.equal(config.mainCiRunId, 30726387850);
      assert.equal(config.recoveryRunId, 30877508811);
      assert.equal(
        config.activationCommit,
        "64409058d0023a434b36f1af31655caeb4915ac3",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts only the protected direct cleanup-role target", () => {
    const directory = temporaryDirectory();
    try {
      const config = parseDirectUploadActivationPostflightConfig(
        cleanupEnvironment(directory),
        "cleanup",
      );
      assert.equal(config.mode, "cleanup");
      assert.equal(
        config.targetIdentity.username,
        "grainline_direct_upload_cleanup_v2",
      );
      assert.equal(config.targetIdentity.isPooler, false);
      assert.equal(config.runId, "30730000002");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects mode, source, credential, identity, digest, and evidence drift", () => {
    const cases = [
      ["runtime", { DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_CONFIRM: "yes" }],
      ["runtime", { DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT: "short" }],
      ["runtime", { DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID: "0" }],
      ["runtime", {
        DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_ACTIVATION_COMMIT: "f".repeat(40),
      }],
      ["runtime", { DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_RECOVERY_RUN_ID: "1" }],
      ["runtime", { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") }],
      ["runtime", { DIRECT_URL: "present" }],
      ["cleanup", { GITHUB_REF: "refs/heads/feature" }],
      ["cleanup", { GITHUB_SHA: "f".repeat(40) }],
      ["cleanup", { DATABASE_URL: RUNTIME_URL }],
      ["cleanup", { UNREVIEWED_DATABASE_URL: RUNTIME_URL }],
      ["cleanup", { DIRECT_UPLOAD_CLEANUP_DATABASE_URL_SHA256: "0".repeat(64) }],
      ["cleanup", {
        DIRECT_UPLOAD_CLEANUP_DATABASE_URL:
          CLEANUP_URL.replace("grainline_direct_upload_cleanup_v2", "neondb_owner"),
      }],
    ];
    for (const [mode, drift] of cases) {
      const directory = temporaryDirectory();
      try {
        const env = mode === "runtime"
          ? runtimeEnvironment(directory, drift)
          : cleanupEnvironment(directory, drift);
        assert.throws(
          () => parseDirectUploadActivationPostflightConfig(env, mode),
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("requires an exact clean release checkout", () => {
    assert.deepEqual(
      assertDirectUploadActivationPostflightGitState(
        { head: RELEASE_COMMIT, status: "" },
        RELEASE_COMMIT,
      ),
      { clean: true, head: RELEASE_COMMIT },
    );
    assert.throws(
      () => assertDirectUploadActivationPostflightGitState(
        { head: RELEASE_COMMIT, status: " M migration.sql" },
        RELEASE_COMMIT,
      ),
      /exact clean release commit/,
    );
  });

  it("accepts the exact activated pooled-runtime authority", () => {
    assert.deepEqual(
      collectDirectUploadRuntimeActivationIssues(validRuntimeSnapshot()),
      [],
    );
    assert.equal(DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES.length, 35);
    assert.equal(DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.length, 17);
    assert.equal(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.length, 3);
  });

  it("rejects runtime table, function-signature, ACL, source, and RLS drift", () => {
    const drifted = structuredClone(validRuntimeSnapshot());
    drifted.tablePrivileges.push("DirectUpload");
    drifted.rlsTables[0].relforcerowsecurity = false;
    drifted.functions[0].identity_arguments = "text, text";
    drifted.functions[1].runtime_execute = true;
    drifted.functions[2].function_source += "\n-- drift";
    const issues = collectDirectUploadRuntimeActivationIssues(drifted);
    assert.ok(issues.some((issue) => issue.includes("table or column")));
    assert.ok(issues.some((issue) => issue.includes("ENABLE plus FORCE")));
    assert.ok(issues.some((issue) => issue.includes("identity arguments")));
    assert.ok(issues.some((issue) => issue.includes("ACL drifted")));
    assert.ok(issues.some((issue) => issue.includes("source drifted")));
  });

  it("writes sanitized evidence once with owner-only permissions", () => {
    const directory = temporaryDirectory();
    try {
      const evidencePath = runtimeEnvironment(directory)
        .DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH;
      writeDirectUploadActivationPostflightEvidence(evidencePath, {
        productionChangedByPostflight: false,
        status: "passed",
      });
      assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, "utf8")), {
        productionChangedByPostflight: false,
        status: "passed",
      });
      assert.throws(
        () => writeDirectUploadActivationPostflightEvidence(evidencePath, {}),
        { code: "EEXIST" },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins split credentials, read-only probes, exact workflow, and no cleanup", () => {
    const operator = fs.readFileSync(
      "scripts/direct-upload-activation-production-postflight.mjs",
      "utf8",
    );
    const workflow = fs.readFileSync(
      ".github/workflows/direct-upload-activation-postflight.yml",
      "utf8",
    );
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

    assert.match(operator, /BEGIN TRANSACTION READ ONLY/);
    assert.match(operator, /transaction_read_only/);
    assert.match(operator, /"42501"/);
    assert.match(operator, /"25006"/);
    assert.doesNotMatch(operator, /_prisma_migrations/);
    assert.doesNotMatch(
      operator,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
    );
    assert.match(operator, /productionChangedByPostflight: false/);
    assert.match(workflow, /environment: Production DirectUpload Cleanup/);
    assert.match(workflow, /actions: read/);
    assert.match(workflow, /group: production-database-migrations/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(
      workflow,
      /REVIEWED_ACTIVATION_COMMIT: 64409058d0023a434b36f1af31655caeb4915ac3/,
    );
    assert.match(workflow, /REVIEWED_RECOVERY_RUN_ID: "30877508811"/);
    assert.match(workflow, /name: 'DirectUpload Activation Production Recovery'/);
    assert.match(workflow, /github\.rest\.actions\.getWorkflowRun/);
    assert.match(workflow, /DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_RECOVERY_RUN_ID/);
    assert.doesNotMatch(workflow, /migration_run_id|POSTFLIGHT_MIGRATION_RUN_ID/);
    assert.match(workflow, /DIRECT_UPLOAD_CLEANUP_DATABASE_URL/);
    assert.doesNotMatch(workflow, /PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.doesNotMatch(workflow, /DIRECT_UPLOAD_CLEANUP_R2_/);
    assert.equal(
      packageJson.scripts?.["ops:direct-upload-activation-postflight"],
      "node scripts/direct-upload-activation-production-postflight.mjs",
    );
  });
});
