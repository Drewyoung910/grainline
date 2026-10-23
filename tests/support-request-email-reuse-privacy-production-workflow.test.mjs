import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  CORRECTED_SOURCE_MD5,
  HELPER_IDENTITY,
  HELPER_SOURCE_MD5,
  MIGRATION,
  MIGRATION_SHA256,
  PREDECESSOR_SOURCE_MD5,
  REQUIRED_PREDECESSORS,
  UNCHANGED_SUPPORT_REQUEST_FUNCTIONS,
  supportRequestEmailReuseMigrationState,
  verifyCorrectionCatalog,
} from "../scripts/support-request-email-reuse-production-inspect.mjs";

const workflow = readFileSync(
  ".github/workflows/support-request-email-reuse-production.yml",
  "utf8",
);
const migrationSql = readFileSync(
  `prisma/migrations/${MIGRATION}/migration.sql`,
  "utf8",
);
const migrationSha256 = createHash("sha256").update(migrationSql).digest("hex");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.apply.steps.find(
  (step) =>
    step.name === "Bind release to exact main and completed push workflows",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function exactPushRuns(releaseSha, { omitPath, failingPath } = {}) {
  return [
    [201, "CI", ".github/workflows/ci.yml"],
    [
      202,
      "Conversation and Message RLS FORCE Proof",
      ".github/workflows/conversation-message-force-proof.yml",
    ],
    [
      203,
      "Notification RLS FORCE Proof",
      ".github/workflows/notification-rls-ephemeral-proof.yml",
    ],
    [
      204,
      "Account Deletion Worker Bootstrap Proof",
      ".github/workflows/account-deletion-worker-bootstrap-proof.yml",
    ],
    [
      205,
      "Order Staff Bootstrap Proof",
      ".github/workflows/order-staff-bootstrap-proof.yml",
    ],
    [
      206,
      "Order Paid Repair Lock Proof",
      ".github/workflows/order-paid-repair-lock-proof.yml",
    ],
    [
      207,
      "Order Account Deletion Concurrency Proof",
      ".github/workflows/order-account-deletion-concurrency-proof.yml",
    ],
  ]
    .map(([id, name, path]) => ({
      id,
      name,
      path,
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: path === failingPath ? "failure" : "success",
    }))
    .filter((run) => run.path !== omitPath);
}

async function runBinding(options = {}) {
  const releaseSha = "a".repeat(40);
  const listWorkflowRunsForRepo = () => {};
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha: releaseSha } } }),
      },
      actions: {
        getWorkflowRun: async () => ({
          data: {
            name: "CI",
            path: ".github/workflows/ci.yml",
            event: "push",
            head_branch: "main",
            head_sha: releaseSha,
            status: "completed",
            conclusion: "success",
          },
        }),
        listWorkflowRunsForRepo,
      },
    },
    paginate: async (method) => {
      assert.equal(method, listWorkflowRunsForRepo);
      return exactPushRuns(releaseSha, options);
    },
  };
  const context = {
    sha: releaseSha,
    repo: { owner: "test", repo: "grainline" },
  };
  const processStub = {
    env: {
      REVIEWED_RELEASE_COMMIT: releaseSha,
      REVIEWED_MAIN_CI_RUN_ID: "101",
    },
  };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

function functionRow(identity, sourceMd5) {
  const unchanged = UNCHANGED_SUPPORT_REQUEST_FUNCTIONS.get(identity);
  return {
    identity,
    owner_name: "neondb_owner",
    owner_superuser: false,
    owner_bypass_rls: true,
    language_name: unchanged?.language ?? "plpgsql",
    function_kind: "f",
    security_definer: true,
    leakproof: false,
    volatility:
      unchanged?.volatility ??
      (identity.endsWith("(text[],text[])") ? "v" : "s"),
    parallel_safety: "u",
    function_config: ["search_path=pg_catalog"],
    source_md5: sourceMd5,
    contains_dynamic_execute: false,
    nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
  };
}

function catalog(sourceMap = PREDECESSOR_SOURCE_MD5) {
  return {
    identity: {
      current_user: "neondb_owner",
      session_user: "neondb_owner",
      database_name: "neondb",
      read_only: "on",
      isolation: "repeatable read",
      owner_superuser: false,
      owner_bypass_rls: true,
      runtime_superuser: false,
      runtime_bypass_rls: false,
      runtime_inherit: false,
      staff_superuser: false,
      staff_bypass_rls: false,
      staff_inherit: false,
    },
    table: {
      owner_name: "neondb_owner",
      owner_superuser: false,
      owner_bypass_rls: true,
      rls_enabled: true,
      rls_forced: false,
      policy_count: 0,
      nonowner_table_acl: [],
      nonowner_column_acl: [],
    },
    functions: [
      functionRow(HELPER_IDENTITY, HELPER_SOURCE_MD5),
      ...[...UNCHANGED_SUPPORT_REQUEST_FUNCTIONS].map(([identity, expected]) =>
        functionRow(identity, expected.sourceMd5),
      ),
      ...[...sourceMap].map(([identity, sourceMd5]) =>
        functionRow(identity, sourceMd5),
      ),
    ],
    overloads: [
      {
        proname: "grainline_support_request_account_deletion_redact_batch",
        overload_count: 1,
      },
      {
        proname: "grainline_support_request_delivery_record",
        overload_count: 1,
      },
      { proname: "grainline_support_request_owner_export", overload_count: 1 },
      { proname: "grainline_support_request_overdue_count", overload_count: 1 },
      {
        proname: "grainline_support_request_provider_deletion_upsert",
        overload_count: 1,
      },
      {
        proname: "grainline_support_request_retention_delete_batch",
        overload_count: 1,
      },
      { proname: "grainline_support_request_staff_state", overload_count: 1 },
      {
        proname: "grainline_support_request_staff_transition",
        overload_count: 1,
      },
      { proname: "grainline_support_request_submit", overload_count: 1 },
      { proname: "grainline_user_email_fallback_addresses", overload_count: 1 },
    ].sort((left, right) => left.proname.localeCompare(right.proname)),
  };
}

test("C-1150 release is exact-main, Production-bound, and checks every required push workflow", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.concurrency["cancel-in-progress"], false);
  assert.equal(parsed.jobs.apply.environment, "Production");
  assert.match(workflow, /apply-reviewed-support-request-email-reuse-privacy/u);
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/u,
  );
  await assert.doesNotReject(runBinding());
  await assert.rejects(
    runBinding({
      omitPath: ".github/workflows/notification-rls-ephemeral-proof.yml",
    }),
    /Required exact-main push workflows are absent/u,
  );
  await assert.rejects(
    runBinding({
      failingPath: ".github/workflows/order-paid-repair-lock-proof.yml",
    }),
    /Exact-main push workflows are not all green/u,
  );
});

test("C-1150 release admits one exact forward-only migration after C-875 and C-715", () => {
  assert.equal(
    MIGRATION,
    "20261023050000_correct_support_request_email_reuse_privacy",
  );
  assert.equal(
    MIGRATION_SHA256,
    "9db6f9bf2db0dc1d8b96199e4381a33cea51233521e0a59ba9328caa59d337a1",
  );
  assert.equal(migrationSha256, MIGRATION_SHA256);
  assert.deepEqual(
    [...REQUIRED_PREDECESSORS],
    [
      [
        "20261023030000_correct_user_unsubscribe_optional_email_preferences",
        "996378ebae18adffe66dedab3ca9f02f80b0a1907eee162db1f9692d040d65c7",
      ],
      [
        "20261023040000_repair_resend_failed_event_suppressions",
        "7f438ca723b05cf2e91a581f48223c0a577fc58715e22ff7176de4206ad8a2c8",
      ],
    ],
  );
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  const apply = workflow.indexOf(
    "name: Apply reviewed correction transaction outside Prisma's ledger",
  );
  const resolve = workflow.indexOf(
    "name: Record the committed correction in Prisma's ledger",
  );
  assert.ok(apply >= 0);
  assert.ok(resolve > apply);
  assert.match(workflow.slice(apply, resolve), /psql "\$DIRECT_URL"/u);
  assert.match(
    workflow.slice(resolve),
    /npx prisma migrate resolve --applied "\$migration"/u,
  );
  assert.doesNotMatch(workflow, /migrate resolve --rolled-back/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(
    workflow,
    /stripe\s+(?:charges|transfers|refunds|events)/iu,
  );
});

test("C-1150 inspector accepts predecessor and interrupted corrected state, but never drift", () => {
  assert.equal(
    verifyCorrectionCatalog(catalog(), "pending").sourceFamily,
    "predecessor",
  );
  assert.equal(
    verifyCorrectionCatalog(catalog(CORRECTED_SOURCE_MD5), "pending")
      .sourceFamily,
    "corrected",
  );
  assert.equal(
    verifyCorrectionCatalog(catalog(CORRECTED_SOURCE_MD5), "applied")
      .sourceFamily,
    "corrected",
  );
  assert.throws(
    () => verifyCorrectionCatalog(catalog(), "applied"),
    /applied ledger has predecessor bodies/u,
  );
  const mixed = new Map(PREDECESSOR_SOURCE_MD5);
  const first = [...mixed.keys()][0];
  mixed.set(first, CORRECTED_SOURCE_MD5.get(first));
  assert.throws(
    () => verifyCorrectionCatalog(catalog(mixed), "pending"),
    /correction bodies are mixed/u,
  );
  const wrongOwner = catalog();
  wrongOwner.functions[0] = {
    ...wrongOwner.functions[0],
    owner_name: "other_owner",
  };
  assert.throws(
    () => verifyCorrectionCatalog(wrongOwner, "pending"),
    /Expected values to be strictly equal/u,
  );
  const driftedUnchangedBody = catalog();
  const unchangedIndex = driftedUnchangedBody.functions.findIndex((row) =>
    UNCHANGED_SUPPORT_REQUEST_FUNCTIONS.has(row.identity),
  );
  driftedUnchangedBody.functions[unchangedIndex] = {
    ...driftedUnchangedBody.functions[unchangedIndex],
    source_md5: "0".repeat(32),
  };
  assert.throws(
    () => verifyCorrectionCatalog(driftedUnchangedBody, "pending"),
    /body drifted/u,
  );
  const directGrant = catalog();
  directGrant.table = {
    ...directGrant.table,
    nonowner_table_acl: ["grainline_app_runtime:SELECT:false"],
  };
  assert.throws(
    () => verifyCorrectionCatalog(directGrant, "pending"),
    /Expected values to be strictly deep-equal/u,
  );
});

test("C-1150 ledger accepts only its exact reviewed zero-step resolve", () => {
  const resolved = {
    migration_name: MIGRATION,
    checksum: MIGRATION_SHA256,
    finished_at: new Date("2026-10-23T12:00:00.000Z"),
    rolled_back_at: null,
    applied_steps_count: 0,
  };
  assert.equal(supportRequestEmailReuseMigrationState([resolved]), "applied");
  for (const row of [
    { ...resolved, migration_name: "20261023050000_unreviewed" },
    { ...resolved, checksum: "0".repeat(64) },
    { ...resolved, finished_at: null },
    { ...resolved, rolled_back_at: new Date("2026-10-23T12:01:00.000Z") },
    { ...resolved, applied_steps_count: 2 },
  ]) {
    assert.throws(
      () => supportRequestEmailReuseMigrationState([row]),
      /candidate/u,
    );
  }
});

test("C-1150 migration is atomic, restart-safe, and self-verifying", () => {
  assert.match(migrationSql, /^BEGIN;/mu);
  assert.match(migrationSql, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migrationSql, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(migrationSql, /pg_advisory_xact_lock/u);
  assert.match(migrationSql, /support_request_email_reuse_preflight/u);
  assert.match(migrationSql, /accepted_predecessor_count/u);
  assert.match(migrationSql, /accepted_corrected_count/u);
  assert.match(migrationSql, /support_request_email_reuse_postflight/u);
  assert.match(migrationSql, /COMMIT;\s*$/u);
  assert.doesNotMatch(migrationSql, /DROP (?:TABLE|COLUMN|FUNCTION)/iu);
});

test("C-1150 release proof runs before SupportRequest candidate isolation", () => {
  const verify = ciWorkflow.indexOf(
    "name: Verify SupportRequest preparation",
  );
  const isolate = ciWorkflow.indexOf(
    "name: Isolate SupportRequest candidate until historical release guards pass",
  );
  const restore = ciWorkflow.indexOf(
    "name: Restore SupportRequest candidate after historical release guards",
  );
  assert.ok(verify >= 0);
  assert.ok(verify < isolate);
  assert.ok(restore > isolate);
  assert.match(
    ciWorkflow.slice(verify, isolate),
    /tests\/support-request-email-reuse-privacy-production-workflow\.test\.mjs/u,
  );
  assert.match(
    ciWorkflow.slice(isolate, restore),
    /tests\/support-request-email-reuse-privacy-production-workflow\.test\.mjs/u,
  );
});

test("C-1150 inspector parses and stores catalog evidence without row data", () => {
  const checked = spawnSync(
    process.execPath,
    ["--check", "scripts/support-request-email-reuse-production-inspect.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
  const source = readFileSync(
    "scripts/support-request-email-reuse-production-inspect.mjs",
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /SELECT\s+(?:request\.)?(?:email|message|name)\b/iu,
  );
  assert.match(source, /mode: 0o600/u);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
});
