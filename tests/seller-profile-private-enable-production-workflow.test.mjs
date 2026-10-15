import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-enable-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const inspector = readFileSync(
  "scripts/seller-profile-private-enable-production-inspect.mjs",
  "utf8",
);
const migration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261015100000_enable_seller_profile_private_rls",
  ),
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/seller-profile-private-enable-rollback.sql",
  "utf8",
);
const digest = "3a5d128c6a5d5a7bd4bc768fe0d57d674b24a35a07ae776e442722481f26426c";
const phoneConstraintDefinition =
  `CHECK ("shipFromPhone" IS NULL OR "shipFromPhone"::text ~ '^[+][1-9][0-9]{7,14}$'::text)`;
const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsedWorkflow.jobs.enable.steps.find(
  (step) => step.name === "Bind ENABLE to exact main, CI, and accepted invariant restoration",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runBindingScript({
  auxiliaryConclusion = "success",
  conversationHeadSha,
  exactPushRuns,
  omitRequiredPath,
} = {}) {
  const releaseSha = "a".repeat(40);
  const invariantSha = "b".repeat(40);
  const ciRunId = 101;
  const conversationRunId = 102;
  const invariantRunId = 103;
  const listJobsForWorkflowRun = () => {};
  const listWorkflowRunsForRepo = () => {};
  const runs = exactPushRuns ?? [
    {
      id: 201,
      name: "CI",
      path: ".github/workflows/ci.yml",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: "success",
    },
    {
      id: 202,
      name: "Conversation and Message RLS FORCE Proof",
      path: ".github/workflows/conversation-message-force-proof.yml",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: "success",
    },
    {
      id: 203,
      name: "Notification RLS FORCE Proof",
      path: ".github/workflows/notification-rls-ephemeral-proof.yml",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: "success",
    },
    {
      id: 204,
      name: "Auxiliary proof",
      path: ".github/workflows/account-deletion-worker-bootstrap-proof.yml",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: auxiliaryConclusion,
    },
    {
      id: 205,
      name: "Order Staff Bootstrap Proof",
      path: ".github/workflows/order-staff-bootstrap-proof.yml",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: "success",
    },
    {
      id: 206,
      name: "Order Paid Repair Lock Proof",
      path: ".github/workflows/order-paid-repair-lock-proof.yml",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: "success",
    },
    {
      id: 207,
      name: "Order Account Deletion Concurrency Proof",
      path: ".github/workflows/order-account-deletion-concurrency-proof.yml",
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: "success",
    },
  ];
  const visibleRuns = omitRequiredPath
    ? runs.filter((run) => run.path !== omitRequiredPath)
    : runs;
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
    [invariantRunId, {
      name: "SellerProfile Private Invariants Production",
      path: ".github/workflows/seller-profile-private-invariants-production.yml",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: invariantSha,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
    }],
  ]);
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha: releaseSha } } }),
        compareCommits: async () => ({ data: { status: "ahead" } }),
      },
      actions: {
        getWorkflowRun: async ({ run_id }) => ({ data: workflowRuns.get(run_id) }),
        listJobsForWorkflowRun,
        listWorkflowRunsForRepo,
      },
    },
    paginate: async (method, { run_id }) => {
      if (method === listWorkflowRunsForRepo) return visibleRuns;
      if (method !== listJobsForWorkflowRun) throw new Error("unexpected pagination method");
      if (run_id === conversationRunId) {
        return [{ name: "proof", status: "completed", conclusion: "success" }];
      }
      if (run_id === invariantRunId) {
        return [{
          name: "Restore SellerProfile private invariants",
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
    REVIEWED_MAIN_CI_RUN_ID: String(ciRunId),
    REVIEWED_CONVERSATION_FORCE_PROOF_RUN_ID: String(conversationRunId),
    REVIEWED_INVARIANT_RUN_ID: String(invariantRunId),
  } };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

test("SellerProfilePrivate ENABLE workflow is exact-main, invariant-bound, and Production-serialized", () => {
  assert.ok(parsedWorkflow.on.workflow_dispatch);
  assert.equal(parsedWorkflow.permissions.actions, "read");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.concurrency.group, "production-database-migrations");
  assert.match(workflow, /name: SellerProfilePrivate ENABLE Production/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /ci\.head_sha !== sha/u);
  assert.match(workflow, /conversation_force_proof_run_id/u);
  assert.match(workflow, /Conversation and Message RLS FORCE Proof/u);
  assert.match(workflow, /conversation\.head_sha !== sha/u);
  assert.match(workflow, /listWorkflowRunsForRepo/u);
  assert.match(workflow, /head_sha: sha/u);
  assert.match(workflow, /Exact-main push workflows are not all green/u);
  assert.match(workflow, /SellerProfile Private Invariants Production/u);
  assert.match(workflow, /seller-profile-private-invariants-production\.yml/u);
  assert.match(workflow, /Accepted invariant run is not an ancestor/u);
  assert.match(workflow, /Restore SellerProfile private invariants/u);
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

test("Production binding rejects an absent required exact-main workflow", async () => {
  await assert.rejects(
    runBindingScript({
      omitRequiredPath: ".github/workflows/notification-rls-ephemeral-proof.yml",
    }),
    /Required exact-main push workflows are absent/u,
  );
});

test("Production binding rejects a Conversation proof from another commit", async () => {
  await assert.rejects(
    runBindingScript({ conversationHeadSha: "c".repeat(40) }),
    /Conversation and Message FORCE proof readback drifted/u,
  );
});

test("workflow admits exactly one restart-safe migration and keeps FORCE separate", () => {
  assert.match(workflow, new RegExp(`${digest}  prisma/migrations/\\$migration/migration\\.sql`, "u"));
  assert.match(workflow, /ready-or-enabled/u);
  assert.match(workflow, /Require only the reviewed SellerProfilePrivate ENABLE pending[\s\S]*assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'ready'/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|FORCE ROW LEVEL SECURITY/iu);
});

test("workflow proves source before owner access and inspect-apply-postflight-audit in order", () => {
  const source = workflow.indexOf("Verify exact SellerProfilePrivate ENABLE source");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Inspect restart-safe SellerProfilePrivate state before ENABLE");
  const apply = workflow.indexOf("Apply only the reviewed SellerProfilePrivate ENABLE migration");
  const postflight = workflow.indexOf("Read back enabled SellerProfilePrivate catalog");
  const audit = workflow.indexOf("Audit global runtime grants after SellerProfilePrivate ENABLE");
  assert.ok(source >= 0 && source < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < postflight && postflight < audit);
});

test("main CI restores invariants before ENABLE and replays current-schema proofs afterward", () => {
  const restore = ci.indexOf(
    "Apply SellerProfile private invariant restoration in disposable PostgreSQL",
  );
  const enable = ci.indexOf(
    "Apply SellerProfilePrivate policyless ENABLE in disposable PostgreSQL",
  );
  const replay = ci.indexOf(
    "Re-prove SellerProfile-touching fixtures on the restored current schema",
  );
  const invariantMigration = ci.indexOf(
    "migration=20261015080000_restore_seller_profile_private_invariants",
    restore,
  );
  const enableMigration = ci.indexOf(
    "migration=20261015100000_enable_seller_profile_private_rls",
    enable,
  );
  assert.ok(restore >= 0 && restore < invariantMigration);
  assert.ok(invariantMigration < enable && enable < enableMigration);
  assert.ok(enableMigration < replay);
});

test("inspector is read-only, count-only, and distinguishes ready from enabled", () => {
  assert.match(inspector, /20261015080000_restore_seller_profile_private_invariants/u);
  assert.match(inspector, /20261015100000_enable_seller_profile_private_rls/u);
  assert.match(inspector, new RegExp(digest, "u"));
  assert.match(inspector, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(inspector, /state = enableApplied \? "enabled" : "ready"/u);
  assert.match(inspector, /public_rls: false/u);
  assert.match(inspector, /private_rls: enableApplied/u);
  assert.match(inspector, /policy_count: 0/u);
  assert.match(inspector, /EXPECTED_PHONE_CONSTRAINT_DEFINITION/u);
  assert.ok(inspector.includes(phoneConstraintDefinition));
  assert.match(inspector, /containsRowData: false/u);
  assert.doesNotMatch(inspector, /SELECT\s+\*/iu);
});

test("migration is policyless ENABLE only and rollback restores the predecessor posture", () => {
  assert.match(migration, /ALTER TABLE public\."SellerProfilePrivate" ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /ALTER TABLE public\."SellerProfilePrivate" NO FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(
    migration,
    /CREATE POLICY|ALTER TABLE public\."SellerProfilePrivate" FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(migration, /SellerProfilePrivate ENABLE crossed the public SellerProfile boundary/u);
  assert.ok(
    migration.includes(`$constraint$${phoneConstraintDefinition}$constraint$`),
  );
  assert.match(rollback, /ALTER TABLE public\."SellerProfilePrivate" DISABLE ROW LEVEL SECURITY/u);
  assert.match(rollback, /REVOKE ALL ON TABLE public\."SellerProfilePrivate"/u);
});
