import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  FUNCTION_SPECS,
  MIGRATION,
  MIGRATION_SHA256,
  reviewedSources,
} from "../scripts/dispute-first-event-case-production-inspect.mjs";

const workflow = readFileSync(
  ".github/workflows/dispute-first-event-case-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsedWorkflow.jobs.apply.steps.find(
  (step) => step.name === "Bind release to exact main and completed push workflows",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runBindingScript({ omitPath, failingPath } = {}) {
  const releaseSha = "a".repeat(40);
  const listWorkflowRunsForRepo = () => {};
  const runs = [
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
    conclusion: path === failingPath ? "failure" : "success",
  })).filter((run) => run.path !== omitPath);
  const github = {
    rest: {
      repos: { getBranch: async () => ({ data: { commit: { sha: releaseSha } } }) },
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
      return runs;
    },
  };
  const context = { sha: releaseSha, repo: { owner: "test", repo: "grainline" } };
  const processStub = { env: {
    REVIEWED_RELEASE_COMMIT: releaseSha,
    REVIEWED_MAIN_CI_RUN_ID: "101",
  } };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

test("#662 release has one exact protected Production boundary", () => {
  assert.ok(parsedWorkflow.on.workflow_dispatch);
  assert.equal(parsedWorkflow.permissions.actions, "read");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.concurrency.group, "production-database-migrations");
  assert.equal(parsedWorkflow.concurrency["cancel-in-progress"], false);
  assert.equal(parsedWorkflow.jobs.apply.environment, "Production");
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-dispute-first-event-case'/u,
  );
  assert.equal((workflow.match(/\bnpx prisma migrate deploy\b/gu) ?? []).length, 1);
});

test("#662 Production binding rejects missing or red exact-main workflows", async () => {
  await assert.doesNotReject(runBindingScript());
  await assert.rejects(
    runBindingScript({
      failingPath: ".github/workflows/order-paid-repair-lock-proof.yml",
    }),
    /Exact-main push workflows are not all green/u,
  );
  await assert.rejects(
    runBindingScript({
      omitPath: ".github/workflows/notification-rls-ephemeral-proof.yml",
    }),
    /Required exact-main push workflows are absent/u,
  );
});

test("#662 release scripts and reviewed sources are exact", () => {
  const checked = spawnSync(
    process.execPath,
    ["--check", "scripts/dispute-first-event-case-production-inspect.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(MIGRATION, "20261017010000_correct_dispute_first_event_case");
  assert.equal(
    MIGRATION_SHA256,
    "714c73d9321b60e6deda6b6300ac1b4cd04f71555bbe962f7edd5c0243945505",
  );
  const sources = reviewedSources();
  assert.equal(sources.size, 4);
  assert.deepEqual([...sources.keys()], FUNCTION_SPECS.map(({ identity }) => identity));
  for (const source of sources.values()) {
    assert.notEqual(source.before, source.after);
    assert.match(createHash("md5").update(source.after).digest("hex"), /^[0-9a-f]{32}$/u);
  }
});

test("#662 release is restart-safe, catalog-backed, and provider-free", () => {
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.match(workflow, /dispute-first-event-case-production-inspect\.mjs preflight/u);
  assert.match(workflow, /dispute-first-event-case-production-inspect\.mjs postflight/u);
  assert.match(workflow, /Read back exact functions, ACLs, ledger, and repaired gaps/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /stripe\s+(?:charges|transfers|refunds|events)/iu);
});

test("CI preserves held #595 and #662 sources through the global tests", () => {
  const verify = ciWorkflow.indexOf(
    "name: Verify Case refund recovery source package",
  );
  const isolate = ciWorkflow.indexOf(
    "name: Isolate Case refund recovery until earlier money corrections pass",
  );
  const tests = ciWorkflow.indexOf("name: Tests");
  const restore = ciWorkflow.indexOf(
    "name: Restore Case refund recovery after earlier money corrections",
  );
  const reverify = ciWorkflow.indexOf(
    "name: Re-verify Case refund recovery source package",
  );
  const apply = ciWorkflow.indexOf(
    "name: Apply Case refund recovery in reviewed order",
  );
  assert.ok(verify >= 0 && verify < isolate && isolate < tests);
  assert.ok(tests < restore && restore < reverify && reverify < apply);
  assert.equal(
    (ciWorkflow.match(/tests\/dispute-first-event-case-production-workflow\.test\.mjs/gu) ?? [])
      .length,
    2,
  );
  assert.match(
    ciWorkflow.slice(isolate, tests),
    /CASE_REFUND_FOLLOWUP_MIGRATION_PATH[\s\S]*DISPUTE_FIRST_EVENT_CASE_MIGRATION_PATH/u,
  );
  assert.match(
    ciWorkflow.slice(restore, reverify),
    /CASE_REFUND_FOLLOWUP_MIGRATION_PATH="[\s\S]*DISPUTE_FIRST_EVENT_CASE_MIGRATION_PATH="/u,
  );
});

test("CI rolls back disposable #662 rows before later current-schema proofs", () => {
  const currentProof = ciWorkflow.indexOf(
    "name: Prove Case refund recovery on the restored current schema",
  );
  const laterReplay = ciWorkflow.indexOf(
    "name: Re-prove SellerProfile-touching fixtures on the restored current schema",
  );
  assert.ok(currentProof >= 0 && currentProof < laterReplay);
  const proofStep = ciWorkflow.slice(currentProof, laterReplay);
  assert.match(
    proofStep,
    /await client\.query\('BEGIN'\);[\s\S]*proveDisputeFirstEventCaseCorrection\([\s\S]*await client\.query\('ROLLBACK'\)\.catch\(\(\) => \{\}\);/u,
  );
});
