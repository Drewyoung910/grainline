import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS,
} from "../scripts/direct-upload-authority-catalog.mjs";
import {
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_ROLE,
} from "../scripts/direct-upload-activation-catalog.mjs";
import {
  DIRECT_UPLOAD_CLEANUP_ROLE_PROVISION_CONFIRMATION,
  collectDirectUploadCleanupRoleProvisionIssues,
  parseDirectUploadCleanupRoleProvisionConfig,
  writeDirectUploadCleanupRoleProvisionEvidence,
} from "../scripts/direct-upload-cleanup-role-production-provision.mjs";

const OWNER_URL =
  "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RELEASE_COMMIT = "a".repeat(40);

function temporaryDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-cleanup-role-provision-"),
  );
}

function environment(directory, overrides = {}) {
  return {
    DIRECT_URL: OWNER_URL,
    DIRECT_UPLOAD_CLEANUP_ROLE_EVIDENCE_PATH: path.join(
      directory,
      `direct-upload-cleanup-role-provision-${RELEASE_COMMIT}.json`,
    ),
    DIRECT_UPLOAD_CLEANUP_ROLE_PROVISION_CONFIRM:
      DIRECT_UPLOAD_CLEANUP_ROLE_PROVISION_CONFIRMATION,
    DIRECT_UPLOAD_CLEANUP_ROLE_RELEASE_COMMIT: RELEASE_COMMIT,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ID: "30395000000",
    GITHUB_SHA: RELEASE_COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(OWNER_URL).digest("hex"),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    RUNNER_TEMP: directory,
    ...overrides,
  };
}

function validSnapshot() {
  const cleanupNames = new Set(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES);
  return {
    columnPrivileges: [],
    currentUser: "neondb_owner",
    databaseCreate: false,
    defaultPrivileges: [],
    functions: DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.map((entry) => ({
      cleanup_direct_execute: cleanupNames.has(entry.name),
      cleanup_execute: cleanupNames.has(entry.name),
      cleanup_execute_grantable: false,
      function_name: entry.name,
      owner_name: "neondb_owner",
      public_execute: false,
      runtime_direct_execute: entry.runtimeExecute,
      runtime_execute: entry.runtimeExecute,
      runtime_execute_grantable: false,
    })),
    incompleteMigrationCount: 0,
    memberRoles: [],
    memberships: [],
    role: {
      rolbypassrls: false,
      rolcanlogin: true,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolname: DIRECT_UPLOAD_CLEANUP_ROLE,
      rolreplication: false,
      rolsuper: false,
    },
    schemaCreate: false,
    schemaUsage: true,
    sequencePrivileges: [],
    sessionUser: "neondb_owner",
    tablePrivileges: [],
    tables: [
      {
        cleanup_delete: false,
        cleanup_insert: false,
        cleanup_select: false,
        cleanup_update: false,
        owner_name: "neondb_owner",
        policy_count: 0,
        rls_enabled: false,
        rls_forced: false,
        runtime_delete: true,
        runtime_insert: true,
        runtime_select: true,
        runtime_update: true,
        table_name: "DirectUpload",
      },
      {
        cleanup_delete: false,
        cleanup_insert: false,
        cleanup_select: false,
        cleanup_update: false,
        owner_name: "neondb_owner",
        policy_count: 0,
        rls_enabled: true,
        rls_forced: true,
        runtime_delete: false,
        runtime_insert: false,
        runtime_select: false,
        runtime_update: false,
        table_name: "DirectUploadReference",
      },
    ],
    transactionReadOnly: "on",
    unexpectedFunctionPrivileges: [],
  };
}

describe("DirectUpload cleanup-role production provision operator", () => {
  it("accepts only the exact owner-only manual main context", () => {
    const directory = temporaryDirectory();
    try {
      const config = parseDirectUploadCleanupRoleProvisionConfig(
        environment(directory),
      );
      assert.equal(config.releaseCommit, RELEASE_COMMIT);
      assert.equal(config.identity.username, "neondb_owner");
      assert.equal(config.runId, "30395000000");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects confirmation, source, owner, shared credential, and evidence drift", () => {
    const cases = [
      { DIRECT_UPLOAD_CLEANUP_ROLE_PROVISION_CONFIRM: "yes" },
      { DIRECT_UPLOAD_CLEANUP_ROLE_RELEASE_COMMIT: "short" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_RUN_ID: "0" },
      { GITHUB_SHA: "b".repeat(40) },
      { DIRECT_URL: OWNER_URL.replace("neondb_owner", "grainline_app_runtime") },
      { DATABASE_URL: "present" },
      { DIRECT_UPLOAD_CLEANUP_DATABASE_URL: "present" },
      { DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY: "present" },
      {
        DIRECT_UPLOAD_CLEANUP_ROLE_EVIDENCE_PATH:
          "/tmp/wrong-cleanup-role-evidence.json",
      },
    ];
    for (const drift of cases) {
      const directory = temporaryDirectory();
      try {
        assert.throws(
          () => parseDirectUploadCleanupRoleProvisionConfig(
            environment(directory, drift),
          ),
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("accepts the exact cleanup-role and compatible-runtime authority snapshot", () => {
    assert.deepEqual(
      collectDirectUploadCleanupRoleProvisionIssues(validSnapshot()),
      [],
    );
  });

  it("rejects authority, membership, RLS, runtime, and transaction drift", () => {
    const cases = [
      { role: { ...validSnapshot().role, rolbypassrls: true } },
      { memberships: ["neondb_owner"] },
      { memberRoles: ["grainline_app_runtime"] },
      { tablePrivileges: ["public.DirectUpload:SELECT"] },
      { columnPrivileges: ["public.DirectUpload.userId:SELECT"] },
      { sequencePrivileges: ["public.example:USAGE"] },
      { defaultPrivileges: ["neondb_owner:public:EXECUTE"] },
      { schemaCreate: true },
      { databaseCreate: true },
      { transactionReadOnly: "off" },
      { incompleteMigrationCount: 1 },
      {
        functions: validSnapshot().functions.map((entry, index) =>
          index === 0 ? { ...entry, public_execute: true } : entry),
      },
      {
        functions: validSnapshot().functions.map((entry) =>
          entry.function_name === DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES[0]
            ? { ...entry, cleanup_execute: false }
            : entry),
      },
      {
        functions: validSnapshot().functions.map((entry) =>
          entry.runtime_execute
            ? { ...entry, runtime_execute: false }
            : entry),
      },
      {
        tables: validSnapshot().tables.map((entry) =>
          entry.table_name === "DirectUpload"
            ? { ...entry, rls_enabled: true }
            : entry),
      },
    ];
    for (const drift of cases) {
      assert.ok(
        collectDirectUploadCleanupRoleProvisionIssues({
          ...validSnapshot(),
          ...drift,
        }).length > 0,
      );
    }
  });

  it("writes sanitized evidence once with mode 0600", () => {
    const directory = temporaryDirectory();
    try {
      const evidencePath =
        environment(directory).DIRECT_UPLOAD_CLEANUP_ROLE_EVIDENCE_PATH;
      writeDirectUploadCleanupRoleProvisionEvidence(evidencePath, {
        productionChangedByPostflight: false,
        status: "passed",
      });
      assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, "utf8")), {
        productionChangedByPostflight: false,
        status: "passed",
      });
      assert.throws(
        () => writeDirectUploadCleanupRoleProvisionEvidence(evidencePath, {}),
        { code: "EEXIST" },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins the protected workflow and read-only postflight contracts", () => {
    const workflow = fs.readFileSync(
      ".github/workflows/direct-upload-cleanup-role-provision.yml",
      "utf8",
    );
    const operator = fs.readFileSync(
      "scripts/direct-upload-cleanup-role-production-provision.mjs",
      "utf8",
    );
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

    assert.match(workflow, /environment: Production/);
    assert.match(workflow, /group: production-database-migrations/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /provision-direct-upload-cleanup-role\.sql/);
    assert.match(
      workflow,
      /Converge cleanup role to three-function authority[\s\S]*PGSSLROOTCERT: system/,
    );
    assert.doesNotMatch(workflow, /DIRECT_UPLOAD_CLEANUP_DATABASE_URL/);
    assert.doesNotMatch(workflow, /DIRECT_UPLOAD_CLEANUP_R2_/);
    assert.match(operator, /BEGIN TRANSACTION READ ONLY/);
    assert.match(operator, /transaction_read_only/);
    assert.match(operator, /productionChangedByPostflight: false/);
    assert.equal(
      packageJson.scripts?.["ops:direct-upload-cleanup-role-provision"],
      "node scripts/direct-upload-cleanup-role-production-provision.mjs",
    );
  });
});
