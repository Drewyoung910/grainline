import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/order-refund-immutable-event-repair-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migration = readFileSync(
  process.env.ORDER_REFUND_IMMUTABLE_EVENT_MIGRATION_PATH ??
    "prisma/migrations/20261015020000_repair_immutable_order_refund_recording/migration.sql",
  "utf8",
);
const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsedWorkflow.jobs.apply.steps.find(
  (step) => step.name === "Bind release to exact main and completed push CI",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runBindingScript({ omitRequiredPath, auxiliaryConclusion = "success" } = {}) {
  const releaseSha = "a".repeat(40);
  const ciRunId = 101;
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
    conclusion: path === ".github/workflows/order-paid-repair-lock-proof.yml"
      ? auxiliaryConclusion
      : "success",
  })).filter((run) => run.path !== omitRequiredPath);
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
      return runs;
    },
  };
  const context = { sha: releaseSha, repo: { owner: "test", repo: "grainline" } };
  const processStub = { env: {
    REVIEWED_RELEASE_COMMIT: releaseSha,
    REVIEWED_MAIN_CI_RUN_ID: String(ciRunId),
  } };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

test("immutable refund-event release has one protected Production boundary", () => {
  assert.ok(parsedWorkflow.on.workflow_dispatch);
  assert.equal(parsedWorkflow.permissions.actions, "read");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.concurrency.group, "production-database-migrations");
  assert.equal(parsedWorkflow.concurrency["cancel-in-progress"], false);
  assert.equal(parsedWorkflow.jobs.apply.environment, "Production");
});

test("Production binding accepts only an all-green exact-main workflow set", async () => {
  await assert.doesNotReject(runBindingScript());
  await assert.rejects(
    runBindingScript({ auxiliaryConclusion: "failure" }),
    /Exact-main push workflows are not all green/u,
  );
  await assert.rejects(
    runBindingScript({ omitRequiredPath: ".github/workflows/notification-rls-ephemeral-proof.yml" }),
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

test("release is exact-main, exact-CI, exact-candidate and restart safe", () => {
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-order-refund-immutable-event-repair'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u);
  assert.match(workflow, /directories\.includes\(migration\)/u);
  assert.match(workflow, /peer ledger count drifted/u);
  assert.doesNotMatch(workflow, /candidate is not the exact latest migration/u);
  assert.match(workflow, /REVIEWED_PENDING_MIGRATIONS="\$migration" node scripts\/assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/\bnpx prisma migrate deploy\b/gu) ?? []).length, 1);
});

test("postflight proves exact functions and preserves ACL and immutability posture", () => {
  assert.match(workflow, /grainline_blocked_checkout_refund_record_core\(text,bigint,text,bigint,text,text,text,integer\)/u);
  assert.match(workflow, /grainline_seller_refund_record\(text,text,bigint,text,text,text,integer\)/u);
  assert.match(workflow, /assert\.equal\(row\.owner, 'neondb_owner'\)/u);
  assert.match(workflow, /assert\.equal\(row\.prosrc, expected\.get\(row\.identity\)\)/u);
  assert.match(workflow, /assert\.deepEqual\(row\.proconfig, \['search_path=pg_catalog'\]\)/u);
  assert.match(workflow, /assert\.deepEqual\(acl\.rows, before\.acl\)/u);
  assert.equal(
    (workflow.match(/trigger\.tgname = 'grainline_order_payment_event_immutable'/gu) ?? [])
      .length,
    2,
  );
  assert.match(workflow, /assert\.deepEqual\(paymentEvent\.rows, before\.paymentEvent\)/u);
  assert.doesNotMatch(migration, /UPDATE public\."OrderPaymentEvent"/u);
});

test("workflow cannot deploy the app or invoke Stripe", () => {
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /stripe\s+(?:charges|transfers|refunds|events)/iu);
});

test("CI isolates historical guards and replays the repair after live predecessors", () => {
  const verify = ciWorkflow.indexOf(
    "name: Verify immutable Order refund-event repair source package",
  );
  const isolate = ciWorkflow.indexOf(
    "name: Isolate immutable Order refund-event repair until current Production predecessors pass",
  );
  const historical = ciWorkflow.indexOf(
    "name: Verify compatible Order checkout receipt authority release",
  );
  const tests = ciWorkflow.indexOf("name: Tests");
  const force = ciWorkflow.indexOf(
    "name: Apply SellerProfilePrivate policyless FORCE in disposable PostgreSQL",
  );
  const restore = ciWorkflow.indexOf(
    "name: Restore immutable Order refund-event repair after current Production predecessors",
  );
  const apply = ciWorkflow.indexOf(
    "name: Apply immutable Order refund-event repair after current Production predecessors",
  );
  const prove = ciWorkflow.indexOf(
    "name: Prove immutable Order refund-event repair in current Production order",
  );
  const build = ciWorkflow.indexOf("name: Production build");

  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < historical && historical < tests);
  assert.ok(tests < force && force < restore);
  assert.ok(restore < apply && apply < prove && prove < build);
  assert.match(
    ciWorkflow.slice(isolate, historical),
    /echo "ORDER_REFUND_IMMUTABLE_EVENT_MIGRATION_PATH=\$holding\/\$migration\/migration\.sql" >> "\$GITHUB_ENV"/u,
  );
});
