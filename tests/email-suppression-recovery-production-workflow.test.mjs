import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  MIGRATION,
  MIGRATION_SHA256,
  verifyRecoveryCatalog,
} from "../scripts/email-suppression-recovery-production-inspect.mjs";

const workflow = readFileSync(
  ".github/workflows/email-suppression-recovery-production.yml",
  "utf8",
);
const migrationSql = readFileSync(
  "prisma/migrations/20261023040000_repair_resend_failed_event_suppressions/migration.sql",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.apply.steps.find(
  (step) =>
    step.name === "Bind release to exact live main and completed push workflows",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function exactPushRuns(releaseSha, conclusion = "success") {
  return [
    [201, "CI", ".github/workflows/ci.yml"],
    [202, "Conversation and Message RLS FORCE Proof", ".github/workflows/conversation-message-force-proof.yml"],
    [203, "Notification RLS FORCE Proof", ".github/workflows/notification-rls-ephemeral-proof.yml"],
    [204, "Account Deletion Worker Bootstrap Proof", ".github/workflows/account-deletion-worker-bootstrap-proof.yml"],
    [205, "Order Staff Bootstrap Proof", ".github/workflows/order-staff-bootstrap-proof.yml"],
    [206, "Order Paid Repair Lock Proof", ".github/workflows/order-paid-repair-lock-proof.yml"],
    [207, "Order Account Deletion Concurrency Proof", ".github/workflows/order-account-deletion-concurrency-proof.yml"],
  ].map(([id, name, path]) => ({
    id,
    name,
    path,
    event: "push",
    head_branch: "main",
    head_sha: releaseSha,
    status: "completed",
    conclusion: path === ".github/workflows/order-paid-repair-lock-proof.yml"
      ? conclusion
      : "success",
  }));
}

async function runBinding({ auxiliaryConclusion = "success" } = {}) {
  const releaseSha = "a".repeat(40);
  const listWorkflowRunsForRepo = () => {};
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha: releaseSha } } }),
      },
      actions: {
        getWorkflowRun: async () => ({ data: {
          name: "CI",
          event: "push",
          head_branch: "main",
          head_sha: releaseSha,
          status: "completed",
          conclusion: "success",
        } }),
        listWorkflowRunsForRepo,
      },
    },
    paginate: async (method) => {
      assert.equal(method, listWorkflowRunsForRepo);
      return exactPushRuns(releaseSha, auxiliaryConclusion);
    },
  };
  const context = { sha: releaseSha, repo: { owner: "test", repo: "grainline" } };
  const processStub = { env: {
    REVIEWED_RELEASE_COMMIT: releaseSha,
    REVIEWED_MAIN_CI_RUN_ID: "101",
    REVIEWED_PRODUCTION_DEPLOYMENT_ID: "dpl_AP1z7xeSJE6biQHgw9VchzzLJTg7",
  } };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

test("C-715 production release is exact-main, exact-deployment, and Production bound", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.jobs.apply.environment, "Production");
  assert.match(workflow, /apply-reviewed-email-suppression-recovery/u);
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/u,
    "the Production workflow must pin checkout to the reviewed v7.0.1 commit",
  );
  assert.match(
    workflow,
    /uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020\s+# v7\.0\.0/u,
    "the Production workflow must pin setup-node to the reviewed v7.0.0 commit",
  );
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(
    workflow,
    /REVIEWED_RELEASE_COMMIT: \$\{\{ inputs\.release_commit \}\}/u,
  );
  await assert.doesNotReject(runBinding());
  await assert.rejects(
    runBinding({ auxiliaryConclusion: "failure" }),
    /Exact-main push workflows are not all green/u,
  );
});

test("C-715 production release admits one exact restart-safe migration", () => {
  assert.equal(MIGRATION, "20261023040000_repair_resend_failed_event_suppressions");
  assert.equal(
    MIGRATION_SHA256,
    "7f438ca723b05cf2e91a581f48223c0a577fc58715e22ff7176de4206ad8a2c8",
  );
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  const applySql = workflow.indexOf("name: Apply reviewed recovery transaction outside Prisma's ledger");
  const recordLedger = workflow.indexOf("name: Record the committed recovery in Prisma's ledger");
  assert.ok(applySql >= 0);
  assert.ok(recordLedger > applySql);
  assert.match(
    workflow.slice(applySql, recordLedger),
    /psql "\$DIRECT_URL"[\s\S]*--set=ON_ERROR_STOP=on[\s\S]*--file="prisma\/migrations\/\$migration\/migration\.sql"/u,
  );
  assert.match(
    workflow.slice(recordLedger),
    /npx prisma migrate resolve --applied "\$migration"/u,
  );
  assert.match(workflow, /email-suppression-recovery-production-inspect\.mjs preflight/u);
  assert.match(workflow, /email-suppression-recovery-production-inspect\.mjs postflight/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /resend\s+(?:emails|webhooks|domains)/iu);
});

test("C-715 repair is atomic, serialized, and self-verifying", () => {
  assert.match(migrationSql, /^BEGIN;/mu);
  assert.match(migrationSql, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migrationSql, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(migrationSql, /pg_advisory_xact_lock/u);
  assert.match(
    migrationSql,
    /LOCK TABLE[\s\S]*public\."EmailFailureCount"[\s\S]*public\."EmailSuppression"[\s\S]*IN SHARE ROW EXCLUSIVE MODE/u,
  );
  assert.match(migrationSql, /email_suppression_recovery_preflight/u);
  assert.match(migrationSql, /email_suppression_recovery_postflight/u);
  assert.match(migrationSql, /COMMIT;\s*$/u);
  assert.doesNotMatch(migrationSql, /DROP TABLE/u);
});

test("C-715 CI proves then isolates the correction from historical release guards", () => {
  const verify = ciWorkflow.indexOf(
    "name: Verify C-715 email suppression recovery source package",
  );
  const isolate = ciWorkflow.indexOf(
    "name: Isolate C-715 email suppression recovery until historical release guards pass",
  );
  const historical = ciWorkflow.indexOf(
    "name: Verify compatible Order checkout receipt authority release",
  );
  const restore = ciWorkflow.indexOf(
    "name: Restore C-715 email suppression recovery after historical release guards",
  );
  const finalBuild = ciWorkflow.indexOf(
    "name: Apply complete public SellerProfile chain for final Production build",
  );

  assert.ok(verify >= 0);
  assert.ok(verify < isolate);
  assert.ok(isolate < historical);
  assert.ok(historical < restore);
  assert.ok(restore < finalBuild);
  assert.match(
    ciWorkflow.slice(isolate, historical),
    /mv "prisma\/migrations\/\$migration" "\$holding\/\$migration"/u,
  );
  assert.match(
    ciWorkflow.slice(restore, finalBuild),
    /mv "\$holding\/\$migration" "prisma\/migrations\/\$migration"/u,
  );
});

test("C-715 production inspector accepts counts before repair and requires zero after", () => {
  const catalog = {
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
    },
    tables: [
      { table_name: "EmailFailureCount", owner_name: "neondb_owner" },
      { table_name: "EmailSuppression", owner_name: "neondb_owner" },
    ],
    counts: {
      incorrect_suppression_count: 3,
      unexpected_legacy_source_count: 0,
      obsolete_counter_count: 7,
    },
  };
  assert.deepEqual(verifyRecoveryCatalog(catalog, "pending"), {
    state: "pending",
    incorrectSuppressionCount: 3,
    unexpectedLegacySourceCount: 0,
    obsoleteCounterCount: 7,
    rowDataRead: false,
    productionChanged: false,
  });
  assert.throws(
    () => verifyRecoveryCatalog(catalog, "applied"),
    /3 !== 0/u,
  );
  assert.equal(
    verifyRecoveryCatalog({
      ...catalog,
      counts: {
        incorrect_suppression_count: 0,
        unexpected_legacy_source_count: 0,
        obsolete_counter_count: 0,
      },
    }, "applied").state,
    "applied",
  );
});

test("C-715 production inspector parses and source evidence stays aggregate-only", () => {
  const checked = spawnSync(
    process.execPath,
    ["--check", "scripts/email-suppression-recovery-production-inspect.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
  assert.doesNotMatch(
    readFileSync(
      "scripts/email-suppression-recovery-production-inspect.mjs",
      "utf8",
    ),
    /SELECT\s+email\b/iu,
  );
});
