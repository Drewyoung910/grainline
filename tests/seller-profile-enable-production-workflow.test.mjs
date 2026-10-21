import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/seller-profile-enable-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const inspector = readFileSync(
  "scripts/seller-profile-enable-production-inspect.mjs",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20261020240000_enable_seller_profile_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/seller-profile-enable-rollback.sql",
  "utf8",
);
const migrationDigest = "c3c9e80cb67322a650de3974219815cc178491568146150563e8d71b6a65bc22";
const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsedWorkflow.jobs.enable.steps.find(
  (step) => step.name === "Bind ENABLE to exact live main and successful checks",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function exactRuns(releaseSha, auxiliaryConclusion = "success") {
  return [
    [201, "CI", ".github/workflows/ci.yml", "success"],
    [202, "Conversation and Message RLS FORCE Proof", ".github/workflows/conversation-message-force-proof.yml", "success"],
    [203, "Notification RLS FORCE Proof", ".github/workflows/notification-rls-ephemeral-proof.yml", "success"],
    [204, "Account deletion worker bootstrap proof", ".github/workflows/account-deletion-worker-bootstrap-proof.yml", auxiliaryConclusion],
    [205, "Order staff bootstrap proof", ".github/workflows/order-staff-bootstrap-proof.yml", "success"],
    [206, "Order paid repair lock proof", ".github/workflows/order-paid-repair-lock-proof.yml", "success"],
    [207, "Order account deletion concurrency proof", ".github/workflows/order-account-deletion-concurrency-proof.yml", "success"],
  ].map(([id, name, path, conclusion]) => ({
    id,
    name,
    path,
    event: "push",
    head_branch: "main",
    head_sha: releaseSha,
    status: "completed",
    conclusion,
  }));
}

async function runBindingScript({
  auxiliaryConclusion = "success",
  conversationHeadSha,
  omitRequiredPath,
} = {}) {
  const releaseSha = "a".repeat(40);
  const ciRunId = 101;
  const conversationRunId = 102;
  const deploymentId = "dpl_A12345678901234567890123";
  const listJobsForWorkflowRun = () => {};
  const listWorkflowRunsForRepo = () => {};
  const visibleRuns = exactRuns(releaseSha, auxiliaryConclusion)
    .filter((run) => run.path !== omitRequiredPath);
  const workflowRuns = new Map([
    [ciRunId, {
      name: "CI",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: "success",
    }],
    [conversationRunId, {
      name: "Conversation and Message RLS FORCE Proof",
      path: ".github/workflows/conversation-message-force-proof.yml",
      event: "push",
      head_branch: "main",
      head_sha: conversationHeadSha ?? releaseSha,
      status: "completed",
      conclusion: "success",
    }],
  ]);
  const github = {
    rest: {
      repos: { getBranch: async () => ({ data: { commit: { sha: releaseSha } } }) },
      actions: {
        getWorkflowRun: async ({ run_id }) => ({ data: workflowRuns.get(run_id) }),
        listJobsForWorkflowRun,
        listWorkflowRunsForRepo,
      },
    },
    paginate: async (method, { run_id }) => {
      if (method === listWorkflowRunsForRepo) return visibleRuns;
      if (method === listJobsForWorkflowRun && run_id === conversationRunId) {
        return [{ name: "proof", status: "completed", conclusion: "success" }];
      }
      throw new Error("unexpected pagination request");
    },
  };
  const context = { sha: releaseSha, repo: { owner: "test", repo: "grainline" } };
  const processStub = { env: {
    REVIEWED_RELEASE_COMMIT: releaseSha,
    REVIEWED_MAIN_CI_RUN_ID: String(ciRunId),
    REVIEWED_CONVERSATION_FORCE_PROOF_RUN_ID: String(conversationRunId),
    REVIEWED_PRODUCTION_DEPLOYMENT_ID: deploymentId,
  } };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

test("public SellerProfile ENABLE is exact-main, live-deployment, and Production bound", () => {
  assert.ok(parsedWorkflow.on.workflow_dispatch);
  assert.equal(parsedWorkflow.permissions.actions, "read");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.concurrency.group, "production-database-migrations");
  assert.match(workflow, /name: SellerProfile ENABLE Production/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /production_deployment_id:/u);
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /conversation_force_proof_run_id/u);
  assert.match(workflow, /listWorkflowRunsForRepo/u);
  assert.match(workflow, /Exact-main push workflows are not all green/u);
});

test("Production binding accepts exact successful main workflows", async () => {
  await assert.doesNotReject(runBindingScript());
});

test("Production binding rejects a failed auxiliary exact-main workflow", async () => {
  await assert.rejects(
    runBindingScript({ auxiliaryConclusion: "failure" }),
    /Exact-main push workflows are not all green/u,
  );
});

test("Production binding rejects a missing exact-main workflow", async () => {
  await assert.rejects(
    runBindingScript({ omitRequiredPath: ".github/workflows/notification-rls-ephemeral-proof.yml" }),
    /Required exact-main push workflows are absent/u,
  );
});

test("Production binding rejects a Conversation proof from another commit", async () => {
  await assert.rejects(
    runBindingScript({ conversationHeadSha: "c".repeat(40) }),
    /Conversation and Message FORCE proof readback drifted/u,
  );
});

test("workflow admits only the restart-safe public ENABLE migration", () => {
  assert.match(workflow, new RegExp(`${migrationDigest}  prisma/migrations/\\$migration/migration\\.sql`, "u"));
  assert.match(workflow, /ready-or-enabled/u);
  assert.match(workflow, /Require only the reviewed SellerProfile ENABLE pending[\s\S]*assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'ready'/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|FORCE ROW LEVEL SECURITY/iu);
});

test("workflow checks live source before any owner database access", () => {
  const source = workflow.indexOf("Verify exact SellerProfile ENABLE source");
  const readiness = workflow.indexOf("Require zero residual SellerProfile base-table consumers");
  const live = workflow.indexOf("Verify exact compatible deployment is live");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Inspect restart-safe SellerProfile state before ENABLE");
  const apply = workflow.indexOf("Apply only the reviewed SellerProfile ENABLE migration");
  const postflight = workflow.indexOf("Read back enabled SellerProfile catalog");
  const audit = workflow.indexOf("Audit global runtime grants after SellerProfile ENABLE");
  assert.ok(source >= 0 && source < readiness && readiness < live);
  assert.ok(live < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < postflight && postflight < audit);
});

test("inspector is read-only, count-only, and distinguishes ready from enabled", () => {
  assert.match(inspector, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(inspector, /state = enableApplied \? "enabled" : "ready"/u);
  assert.match(inspector, /runtime_crud_grant_count/u);
  assert.match(inspector, /assert\.equal\(posture\.private_force, true\)/u);
  assert.match(inspector, /containsRowData: false/u);
  assert.doesNotMatch(inspector, /SELECT\s+\*/iu);
});

test("migration remains policyless ENABLE and rollback retains zero direct grants", () => {
  assert.match(migration, /ALTER TABLE public\."SellerProfile" ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /ALTER TABLE public\."SellerProfile" NO FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /CREATE POLICY|ALTER TABLE public\."SellerProfile" FORCE ROW LEVEL SECURITY/u);
  assert.match(migration, /accepted private-companion FORCE posture/u);
  assert.match(rollback, /ALTER TABLE public\."SellerProfile" DISABLE ROW LEVEL SECURITY/u);
  assert.match(rollback, /REVOKE ALL ON TABLE public\."SellerProfile"/u);
});

test("main CI runs the public release workflow and inspector checks", () => {
  assert.match(ci, /seller-profile-enable-production-inspect\.test\.mjs/u);
  assert.match(ci, /seller-profile-enable-production-workflow\.test\.mjs/u);
});
