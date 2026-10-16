import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/blocked-pair-paid-checkout-completion-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migration = readFileSync(
  process.env.BLOCKED_PAIR_PAID_CHECKOUT_COMPLETION_MIGRATION_PATH?.trim() ||
    "prisma/migrations/20261016000000_correct_blocked_pair_paid_checkout_completion/migration.sql",
  "utf8",
);
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

test("blocked-pair completion release has one protected Production boundary", () => {
  assert.ok(parsedWorkflow.on.workflow_dispatch);
  assert.equal(parsedWorkflow.permissions.actions, "read");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.concurrency.group, "production-database-migrations");
  assert.equal(parsedWorkflow.concurrency["cancel-in-progress"], false);
  assert.equal(parsedWorkflow.jobs.apply.environment, "Production");
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-blocked-pair-paid-checkout-completion'/u,
  );
});

test("Production binding requires every exact-main push workflow green", async () => {
  await assert.doesNotReject(runBindingScript());
  await assert.rejects(
    runBindingScript({ failingPath: ".github/workflows/order-paid-repair-lock-proof.yml" }),
    /Exact-main push workflows are not all green/u,
  );
  await assert.rejects(
    runBindingScript({ omitPath: ".github/workflows/notification-rls-ephemeral-proof.yml" }),
    /Required exact-main push workflows are absent/u,
  );
});

test("inline catalog programs are syntactically valid modules", () => {
  const scripts = [
    ...workflow.matchAll(/node --input-type=module - <<'NODE'\n([\s\S]*?)\n\s+NODE/gu),
  ].map((match) => match[1].replace(/^ {10}/gmu, ""));
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    const checked = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      input: script,
      encoding: "utf8",
    });
    assert.equal(checked.status, 0, checked.stderr);
  }
});

test("release is exact-candidate, restart-safe, read-backed and non-provider", () => {
  assert.match(workflow, /13609ac11af84c3052f7d828519ff35984b7f58b2d6aa8956e21898d22923745/u);
  assert.match(workflow, /assertReviewedPeerMigrationLedger/u);
  assert.match(
    workflow,
    /REVIEWED_PENDING_MIGRATIONS="\$migration" node scripts\/assert-reviewed-pending-migrations\.mjs/u,
  );
  assert.equal((workflow.match(/\bnpx prisma migrate deploy\b/gu) ?? []).length, 1);
  assert.match(workflow, /1859c7ba941e6ba891d1869b90a83403/u);
  assert.match(workflow, /678c10b71969b2caaf57b6321dc29c9e/u);
  assert.match(workflow, /runtime_execute: true/u);
  assert.match(workflow, /staff_execute: false/u);
  assert.match(workflow, /public_execute: false/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /stripe\s+(?:charges|transfers|refunds|events)/iu);
  assert.doesNotMatch(migration, /UPDATE public\."(?:Order|Block|User)"/u);
});

test("CI isolates the candidate, then restores and proves it after its live predecessor", () => {
  const verify = ciWorkflow.indexOf(
    "name: Verify blocked-pair paid-checkout completion source package",
  );
  const isolate = ciWorkflow.indexOf(
    "name: Isolate blocked-pair paid-checkout completion until refund witness passes",
  );
  const tests = ciWorkflow.indexOf("name: Tests");
  const bannedBuyer = ciWorkflow.indexOf(
    "name: Apply CI-adapted Order banned-buyer correction in disposable PostgreSQL",
  );
  const remainingOrderSuccessors = ciWorkflow.indexOf(
    "name: Apply remaining reviewed Order successors in disposable PostgreSQL",
  );
  const predecessor = ciWorkflow.indexOf(
    "name: Apply blocked-checkout refund witness after immutable refund repair",
  );
  const restore = ciWorkflow.indexOf(
    "name: Restore blocked-pair paid-checkout completion after refund witness",
  );
  const apply = ciWorkflow.indexOf(
    "name: Apply blocked-pair paid-checkout completion after refund witness",
  );
  const prove = ciWorkflow.indexOf(
    "name: Prove blocked-pair paid-checkout completion in current Production order",
  );
  const build = ciWorkflow.indexOf("name: Production build");

  assert.ok(verify >= 0 && verify < isolate && isolate < tests);
  assert.ok(
    tests < bannedBuyer &&
      bannedBuyer < remainingOrderSuccessors &&
      remainingOrderSuccessors < predecessor &&
      predecessor < restore,
  );
  assert.ok(restore < apply && apply < prove && prove < build);
  assert.match(
    ciWorkflow.slice(isolate, tests),
    /BLOCKED_PAIR_PAID_CHECKOUT_COMPLETION_MIGRATION_PATH/u,
  );
  assert.match(
    ciWorkflow.slice(bannedBuyer, remainingOrderSuccessors),
    /prepareMigrationSql[\s\S]*?ci-owner-literal[\s\S]*?count: 4[\s\S]*?psql "\$DIRECT_URL"/u,
  );
});
