import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_ROLE,
} from "../scripts/direct-upload-activation-catalog.mjs";
import {
  DIRECT_UPLOAD_CLEANUP_CONFIRMATION,
  collectDirectUploadCleanupAuthorityIssues,
  directUploadCleanupProviderErrorCode,
  parseDirectUploadCleanupWorkerConfig,
  runDirectUploadCleanup,
} from "../scripts/direct-upload-cleanup-worker.mjs";
import {
  directUploadFunctionSourceHashes,
  directUploadFunctionSources,
} from "../scripts/direct-upload-function-source-catalog.mjs";

const reviewedFunctionSources = directUploadFunctionSources();

function source(relativePath) {
  return readFileSync(relativePath, "utf8");
}

function baseEnv(runnerTemp) {
  const databaseUrl =
    "postgresql://grainline_direct_upload_cleanup_v2:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
  return {
    DIRECT_UPLOAD_CLEANUP_CONFIRM: DIRECT_UPLOAD_CLEANUP_CONFIRMATION,
    DIRECT_UPLOAD_CLEANUP_DATABASE_URL: databaseUrl,
    DIRECT_UPLOAD_CLEANUP_DATABASE_URL_SHA256:
      "aa1cbebec5e2691cd0bb7b6d3b708f099db6358f34e4c77ce1e53f2ffce8f1e7",
    DIRECT_UPLOAD_CLEANUP_EVIDENCE_PATH: path.join(
      runnerTemp,
      "direct-upload-cleanup-123-1.json",
    ),
    DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID: "cleanup-access-key",
    DIRECT_UPLOAD_CLEANUP_R2_ACCOUNT_ID:
      "0123456789abcdef0123456789abcdef",
    DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET: "grainline-private-cleanup",
    DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET: "grainline-public-cleanup",
    DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY: "cleanup-secret-key",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "123",
    GITHUB_SHA: "a".repeat(40),
    RUNNER_TEMP: runnerTemp,
  };
}

function functionRow(name) {
  const expected = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.find(
    (entry) => entry.name === name,
  );
  const worker = DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.includes(name);
  const runtime =
    DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.includes(name);
  return {
    function_config: ["search_path=pg_catalog"],
    function_kind: "f",
    function_name: name,
    function_source: reviewedFunctionSources[name],
    identity_arguments: expected.identityArguments,
    leakproof: false,
    other_role_execute: [],
    other_role_execute_grantable: [],
    owner_name: "neondb_owner",
    public_execute: false,
    runtime_direct_execute: runtime,
    runtime_execute: runtime,
    runtime_execute_grantable: false,
    security_definer:
      !DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES.includes(name),
    worker_direct_execute: worker,
    worker_execute: worker,
    worker_execute_grantable: false,
  };
}

function acceptedAuthoritySnapshot() {
  return {
    columnPrivileges: [],
    currentUser: DIRECT_UPLOAD_CLEANUP_ROLE,
    databaseCreate: false,
    defaultPrivileges: [],
    functions: DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES.map(functionRow),
    memberRoleEdges: [],
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
    sequencePrivileges: [],
    sessionUser: DIRECT_UPLOAD_CLEANUP_ROLE,
    tablePrivileges: [],
    unexpectedFunctionPrivileges: [],
  };
}

describe("isolated DirectUpload cleanup worker", () => {
  it("partitions every reviewed function into runtime, worker, or private authority", () => {
    const all = new Set(DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES);
    const runtime = new Set(DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES);
    const worker = new Set(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES);
    const privateFunctions = new Set(
      DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES,
    );

    assert.equal(all.size, 35);
    assert.equal(runtime.size, 17);
    assert.equal(worker.size, 3);
    assert.equal(privateFunctions.size, 15);
    assert.equal(DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES.length, 4);
    assert.equal(
      new Set([...runtime, ...worker, ...privateFunctions]).size,
      all.size,
    );
    for (const name of all) {
      assert.equal(
        Number(runtime.has(name))
          + Number(worker.has(name))
          + Number(privateFunctions.has(name)),
        1,
        name,
      );
    }
    assert.equal(
      runtime.has("grainline_direct_upload_record_private_message"),
      false,
    );
    assert.equal(
      Object.keys(directUploadFunctionSourceHashes()).length,
      all.size,
    );
  });

  it("accepts only the exact protected direct production worker target", () => {
    const runnerTemp = mkdtempSync(
      path.join(tmpdir(), "grainline-cleanup-worker-test-"),
    );
    try {
      const env = baseEnv(runnerTemp);
      const config = parseDirectUploadCleanupWorkerConfig(env);
      assert.equal(config.identity.username, DIRECT_UPLOAD_CLEANUP_ROLE);
      assert.equal(config.identity.isPooler, false);
      assert.equal(config.releaseCommit, "a".repeat(40));

      const scheduled = parseDirectUploadCleanupWorkerConfig({
        ...env,
        DIRECT_UPLOAD_CLEANUP_CONFIRM: "",
        GITHUB_EVENT_NAME: "schedule",
      });
      assert.equal(scheduled.runId, "123");

      assert.throws(
        () =>
          parseDirectUploadCleanupWorkerConfig({
            ...env,
            DATABASE_URL: env.DIRECT_UPLOAD_CLEANUP_DATABASE_URL,
          }),
        /forbidden shared credentials: DATABASE_URL/,
      );
      assert.throws(
        () =>
          parseDirectUploadCleanupWorkerConfig({
            ...env,
            DIRECT_UPLOAD_CLEANUP_CONFIRM: "close-enough",
          }),
        /confirmation is not exact/,
      );
      assert.throws(
        () =>
          parseDirectUploadCleanupWorkerConfig({
            ...env,
            DIRECT_UPLOAD_CLEANUP_DATABASE_URL:
              env.DIRECT_UPLOAD_CLEANUP_DATABASE_URL.replace(
                ".westus3",
                "-pooler.westus3",
              ),
          }),
        /protected digest/,
      );
      assert.throws(
        () =>
          parseDirectUploadCleanupWorkerConfig({
            ...env,
            DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET:
              env.DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET,
          }),
        /two distinct valid R2 bucket names/,
      );
    } finally {
      rmSync(runnerTemp, { force: true, recursive: true });
    }
  });

  it("fails closed on role, RLS, table, runtime, and worker authority drift", () => {
    assert.deepEqual(
      collectDirectUploadCleanupAuthorityIssues(
        acceptedAuthoritySnapshot(),
      ),
      [],
    );
    assert.deepEqual(
      collectDirectUploadCleanupAuthorityIssues({
        ...acceptedAuthoritySnapshot(),
        memberRoleEdges: [{ ...DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE }],
        memberRoles: ["neondb_owner"],
      }),
      [],
    );

    const drifted = structuredClone(acceptedAuthoritySnapshot());
    drifted.role.rolbypassrls = true;
    drifted.tablePrivileges.push("DirectUpload");
    drifted.columnPrivileges.push("DirectUpload.key");
    drifted.memberRoles.push("grainline_app_runtime");
    drifted.memberRoleEdges.push({
      ...DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE,
      set_option: true,
    });
    drifted.defaultPrivileges.push("neondb_owner:public:EXECUTE");
    drifted.unexpectedFunctionPrivileges.push(
      "public.grainline_notification_create_core(text)",
    );
    drifted.rlsTables[0].relforcerowsecurity = false;
    const cleanupLease = drifted.functions.find(
      (row) =>
        row.function_name === "grainline_direct_upload_cleanup_lease",
    );
    cleanupLease.runtime_execute = true;
    cleanupLease.runtime_direct_execute = true;
    cleanupLease.identity_arguments = "text";
    cleanupLease.other_role_execute.push("unexpected_service");
    cleanupLease.leakproof = true;
    const ordinaryFunction = drifted.functions.find(
      (row) =>
        row.function_name ===
        "grainline_direct_upload_record_processed_public",
    );
    ordinaryFunction.worker_execute = true;
    ordinaryFunction.worker_direct_execute = true;
    ordinaryFunction.security_definer = false;
    const privateMessage = drifted.functions.find(
      (row) =>
        row.function_name ===
        "grainline_direct_upload_record_private_message",
    );
    privateMessage.runtime_execute = true;
    privateMessage.runtime_direct_execute = true;
    privateMessage.function_source += "\n-- drift";

    const issues = collectDirectUploadCleanupAuthorityIssues(drifted);
    assert.ok(issues.some((issue) => issue.includes("rolbypassrls")));
    assert.ok(
      issues.some((issue) => issue.includes("effective table authority")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("effective column authority")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("member-role posture")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("default privilege grants")),
    );
    assert.ok(
      issues.some((issue) =>
        issue.includes("unexpected privileged function authority"),
      ),
    );
    assert.ok(
      issues.some((issue) => issue.includes("DirectUpload must have")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("must be runtime-inaccessible")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("unexpected role")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("identity arguments")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("must not be LEAKPROOF")),
    );
    assert.ok(
      issues.some((issue) =>
        issue.includes("must be cleanup-worker-inaccessible"),
      ),
    );
    assert.ok(
      issues.some((issue) => issue.includes("must be SECURITY DEFINER")),
    );
    assert.ok(
      issues.some((issue) => issue.includes("source hash does not match")),
    );
  });

  it("deletes only leased keys, fences completion, and records bounded provider failure codes", async () => {
    const calls = [];
    let leaseCalls = 0;
    const client = {
      async query(sql, params = []) {
        calls.push({ params, sql });
        if (sql.includes("cleanup_lease")) {
          leaseCalls += 1;
          return leaseCalls === 1
            ? {
                rows: [
                  {
                    id: "upload-a",
                    key: "listingImage/actor/a.webp",
                    leaseId: "lease-a",
                    storageClass: "PUBLIC",
                  },
                  {
                    id: "upload-b",
                    key: "caseEvidenceImage/actor/case/b.webp",
                    leaseId: "lease-b",
                    storageClass: "PRIVATE",
                  },
                ],
              }
            : { rows: [] };
        }
        if (sql.includes("cleanup_complete")) {
          return { rows: [{ completed: true }] };
        }
        if (sql.includes("cleanup_fail")) {
          return { rows: [{ failed: true }] };
        }
        throw new Error("unexpected query");
      },
    };
    const deleted = [];
    const result = await runDirectUploadCleanup({
      client,
      deleteObject: async (target) => {
        deleted.push(target);
        if (target.storageClass === "PRIVATE") {
          const error = new Error("raw key must never be retained");
          error.name = "AccessDenied";
          error.$metadata = { httpStatusCode: 403 };
          throw error;
        }
      },
    });

    assert.deepEqual(deleted, [
      { key: "listingImage/actor/a.webp", storageClass: "PUBLIC" },
      {
        key: "caseEvidenceImage/actor/case/b.webp",
        storageClass: "PRIVATE",
      },
    ]);
    assert.deepEqual(result, {
      batches: 1,
      checked: 2,
      complete: true,
      deleted: 1,
      failed: 1,
      failureCodes: {
        R2_DELETE_403_ACCESSDENIED: 1,
      },
      skipped: 0,
    });
    assert.ok(
      calls.some(
        (call) =>
          call.sql.includes("cleanup_complete")
          && call.params.join(",") === "upload-a,lease-a",
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.sql.includes("cleanup_fail")
          && call.params[2] === "R2_DELETE_403_ACCESSDENIED",
      ),
    );
    assert.equal(
      JSON.stringify(result).includes("raw key must never be retained"),
      false,
    );
  });

  it("normalizes provider failures without retaining messages or object identity", () => {
    const error = new Error(
      "Access denied for caseEvidenceImage/actor/private-object.webp",
    );
    error.name = "AccessDenied";
    error.$metadata = { httpStatusCode: 403 };
    assert.equal(
      directUploadCleanupProviderErrorCode(error),
      "R2_DELETE_403_ACCESSDENIED",
    );
  });

  it("keeps the manual worker outside Vercel after runtime cleanup retirement", () => {
    const workflow = source(
      ".github/workflows/direct-upload-cleanup.yml",
    );
    const runtimeGuard = source("scripts/guard-runtime-db-env.mjs");
    const worker = source("scripts/direct-upload-cleanup-worker.mjs");
    const vercel = source("vercel.json");
    const runtimeLifecycle = source("src/lib/directUploadLifecycle.ts");

    assert.match(workflow, /environment: Production DirectUpload Cleanup/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s*schedule:/m);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /npm ci --ignore-scripts/);
    assert.match(workflow, /DIRECT_UPLOAD_CLEANUP_DATABASE_URL:/);
    assert.match(workflow, /DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID:/);
    assert.doesNotMatch(workflow, /PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.doesNotMatch(workflow, /\bDATABASE_URL:/);
    assert.match(runtimeGuard, /PostgreSQL URLs outside DATABASE_URL/);
    assert.doesNotMatch(vercel, /\/api\/cron\/direct-upload-cleanup/);
    assert.doesNotMatch(
      runtimeLifecycle,
      /grainline_direct_upload_cleanup_(?:lease|complete|fail)/,
    );
    assert.doesNotMatch(worker, /ListObjects/);
    assert.match(worker, /DeleteObjectCommand/);
    assert.match(worker, /DirectUpload cleanup evidence mode is not 0600/);
    assert.match(worker, /result\.failed > 0 \|\| result\.skipped > 0/);
  });

  it("provisions no password and converges only the three cleanup functions", () => {
    const provision = source(
      "scripts/provision-direct-upload-cleanup-role.sql",
    );

    assert.doesNotMatch(provision, /\bCREATE ROLE\b/);
    assert.doesNotMatch(provision, /\bPASSWORD\s+(?:'|:)/i);
    for (const attribute of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolcanlogin",
      "rolreplication",
      "rolbypassrls",
    ]) {
      assert.match(provision, new RegExp(`role\\.${attribute}`));
    }
    assert.match(
      provision,
      /reviewed provider-created attributes/,
    );
    assert.doesNotMatch(
      provision,
      /ALTER ROLE[\s\S]*?(?:SUPERUSER|REPLICATION|BYPASSRLS)/,
    );
    assert.match(
      provision,
      /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public/,
    );
    assert.match(
      provision,
      /REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public/,
    );
    assert.match(
      provision,
      /unexpected role %s is transitively a member of cleanup role %s/,
    );
    assert.match(provision, /grantor_role = 'cloud_admin'/);
    assert.match(provision, /AND NOT inherit_option/);
    assert.match(provision, /AND NOT set_option/);
    for (const name of DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES) {
      assert.match(
        provision,
        new RegExp(`GRANT EXECUTE ON FUNCTION[\\s\\S]*${name}`),
      );
    }
    assert.match(
      provision,
      /cleanup role DirectUpload function authority is not exact/,
    );
    assert.match(
      provision,
      /cleanup role retains unexpected privileged function authority/,
    );
    assert.match(
      provision,
      /cleanup role retains effective column authority/,
    );
    assert.match(
      provision,
      /cleanup role retains default privilege grants/,
    );
    assert.match(
      provision,
      /WHEN class\.relkind IN \('r', 'p'\) THEN[\s\S]*has_table_privilege/,
    );
    assert.match(
      provision,
      /WHEN class\.relkind = 'S' THEN[\s\S]*has_sequence_privilege/,
    );
    assert.match(provision, /\bBEGIN;/);
    assert.match(provision, /\bCOMMIT;/);
  });

  it("kind-guards catalog privilege helpers against planner reordering", () => {
    const worker = source("scripts/direct-upload-cleanup-worker.mjs");
    const proof = source(
      "scripts/direct-upload-authority-postgres-proof.mjs",
    );
    const provision = source(
      "scripts/provision-direct-upload-cleanup-role.sql",
    );

    assert.match(
      worker,
      /WHEN class\.relkind IN \('r', 'p'\) THEN[\s\S]*has_table_privilege/,
    );
    assert.match(
      worker,
      /WHEN class\.relkind = 'S' THEN[\s\S]*has_sequence_privilege/,
    );
    assert.match(
      proof,
      /WHEN class\.relkind IN \('r', 'p'\) THEN[\s\S]*has_table_privilege/,
    );
    assert.doesNotMatch(
      `${worker}\n${proof}\n${provision}`,
      /AND\s+pg_catalog\.has_(?:table|sequence)_privilege/,
    );
    for (const catalogSource of [worker, proof, provision]) {
      assert.match(catalogSource, /AND procedure\.prosecdef/);
      assert.doesNotMatch(
        catalogSource,
        /procedure\.prosecdef\s+OR\s+procedure\.proname LIKE/,
      );
    }
  });
});
