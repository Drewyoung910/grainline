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
    "cf61924b1d3bb6f944432b584b39990aee344e25e867a9f06046c4421c521dca",
  );
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /email-suppression-recovery-production-inspect\.mjs preflight/u);
  assert.match(workflow, /email-suppression-recovery-production-inspect\.mjs postflight/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /resend\s+(?:emails|webhooks|domains)/iu);
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
