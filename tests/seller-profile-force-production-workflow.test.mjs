import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/seller-profile-force-production.yml",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20261020250000_force_seller_profile_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/seller-profile-force-rollback.sql",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.force.steps.find(
  (step) => step.name === "Bind FORCE to exact main, CI, and accepted ENABLE",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function exactPushRuns(releaseSha, conclusion = "success") {
  return [
    [201, "CI", ".github/workflows/ci.yml"],
    [202, "Conversation and Message RLS FORCE Proof", ".github/workflows/conversation-message-force-proof.yml"],
    [203, "Notification RLS FORCE Proof", ".github/workflows/notification-rls-ephemeral-proof.yml"],
    [204, "Account deletion worker bootstrap proof", ".github/workflows/account-deletion-worker-bootstrap-proof.yml"],
    [205, "Order staff bootstrap proof", ".github/workflows/order-staff-bootstrap-proof.yml"],
    [206, "Order paid repair lock proof", ".github/workflows/order-paid-repair-lock-proof.yml"],
    [207, "Order account deletion concurrency proof", ".github/workflows/order-account-deletion-concurrency-proof.yml"],
  ].map(([id, name, path]) => ({
    id,
    name,
    path,
    event: "push",
    head_branch: "main",
    head_sha: releaseSha,
    status: "completed",
    conclusion: path === ".github/workflows/account-deletion-worker-bootstrap-proof.yml"
      ? conclusion
      : "success",
  }));
}

async function runBinding({ auxiliaryConclusion = "success", compareStatus = "ahead" } = {}) {
  const releaseSha = "a".repeat(40);
  const compatibleSha = "b".repeat(40);
  const listJobsForWorkflowRun = () => {};
  const listWorkflowRunsForRepo = () => {};
  const runs = new Map([
    [101, {
      name: "CI", event: "push", head_branch: "main", head_sha: releaseSha,
      status: "completed", conclusion: "success",
    }],
    [102, {
      name: "Conversation and Message RLS FORCE Proof",
      path: ".github/workflows/conversation-message-force-proof.yml",
      event: "push", head_branch: "main", head_sha: releaseSha,
      status: "completed", conclusion: "success",
    }],
    [103, {
      name: "SellerProfile ENABLE Production",
      path: ".github/workflows/seller-profile-enable-production.yml",
      event: "workflow_dispatch", head_branch: "main", head_sha: compatibleSha,
      run_attempt: 1, status: "completed", conclusion: "success",
    }],
  ]);
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha: releaseSha } } }),
        compareCommits: async () => ({ data: { status: compareStatus } }),
      },
      actions: {
        getWorkflowRun: async ({ run_id }) => ({ data: runs.get(run_id) }),
        listJobsForWorkflowRun,
        listWorkflowRunsForRepo,
      },
    },
    paginate: async (method, { run_id }) => {
      if (method === listWorkflowRunsForRepo) {
        return exactPushRuns(releaseSha, auxiliaryConclusion);
      }
      if (run_id === 102) {
        return [{ name: "proof", status: "completed", conclusion: "success" }];
      }
      if (run_id === 103) {
        return [{
          name: "Enable policyless SellerProfile RLS",
          status: "completed",
          conclusion: "success",
        }];
      }
      return [];
    },
  };
  const context = { sha: releaseSha, repo: { owner: "test", repo: "grainline" } };
  const processStub = { env: {
    REVIEWED_RELEASE_COMMIT: releaseSha,
    REVIEWED_MAIN_CI_RUN_ID: "101",
    REVIEWED_CONVERSATION_FORCE_PROOF_RUN_ID: "102",
    REVIEWED_ENABLE_RUN_ID: "103",
    REVIEWED_COMPATIBLE_APP_COMMIT: compatibleSha,
    REVIEWED_PRODUCTION_DEPLOYMENT_ID: "dpl_DPS8x8vfkQqandrvAgVWxRLCgT43",
  } };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

test("FORCE workflow is exact-main, accepted-ENABLE, compatible-deployment, and Production bound", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /force-reviewed-seller-profile-rls/u);
  assert.match(workflow, /SellerProfile ENABLE Production/u);
  assert.match(workflow, /seller-profile-enable-production\.yml/u);
  assert.match(workflow, /enableRun\.head_sha !== compatibleAppCommit/u);
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(workflow, /REVIEWED_RELEASE_COMMIT: \$\{\{ inputs\.compatible_app_commit \}\}/u);
  await assert.doesNotReject(runBinding());
  await assert.rejects(
    runBinding({ auxiliaryConclusion: "failure" }),
    /Exact-main push workflows are not all green/u,
  );
  await assert.rejects(
    runBinding({ compareStatus: "diverged" }),
    /Accepted ENABLE run is not an ancestor/u,
  );
});

test("workflow admits exactly one restart-safe FORCE migration", () => {
  assert.match(workflow, /7f1daf72f956f84e81dd591b33230e76059f8e6445683eeac0f4359b363e3dd2/u);
  assert.match(workflow, /enabled-or-forced/u);
  assert.match(workflow, /Require only the reviewed SellerProfile FORCE pending[\s\S]*assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'enabled'/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|FORCE ROW LEVEL SECURITY/iu);
});

test("migration is policyless, posture-only, and rollback retains ENABLE", () => {
  assert.match(migration, /ALTER TABLE public\."SellerProfile" FORCE ROW LEVEL SECURITY/u);
  assert.match(migration, /20261020240000_enable_seller_profile_rls/u);
  assert.match(migration, /f5b4676735d005748b597220584ceecfb8af5539aa72a95a83ac56cd4151e9b5/u);
  assert.match(migration, /SellerProfilePrivate[\s\S]*relforcerowsecurity/u);
  assert.doesNotMatch(migration, /CREATE POLICY|INSERT INTO public\."SellerProfile"|UPDATE public\."SellerProfile"/iu);
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/u);
  assert.match(rollback, /REVOKE ALL ON TABLE public\."SellerProfile"/u);
  assert.doesNotMatch(rollback, /GRANT\s+/iu);
});

test("workflow orders source and deployment checks before owner access", () => {
  const source = workflow.indexOf("Verify exact SellerProfile FORCE source");
  const consumers = workflow.indexOf("Require zero residual SellerProfile base-table consumers");
  const deployment = workflow.indexOf("Verify exact compatible deployment is live");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Inspect restart-safe SellerProfile state before FORCE");
  const apply = workflow.indexOf("Apply only the reviewed SellerProfile FORCE migration");
  const postflight = workflow.indexOf("Read back forced SellerProfile catalog");
  assert.ok(source >= 0 && source < consumers && consumers < deployment);
  assert.ok(deployment < boundary && boundary < preflight && preflight < apply);
  assert.ok(apply < postflight);
});
