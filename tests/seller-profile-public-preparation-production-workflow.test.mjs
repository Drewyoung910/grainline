import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/seller-profile-public-preparation-production.yml",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.prepare.steps.find(
  (step) => step.name === "Bind preparations to exact main and successful checks",
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

async function runBindingScript({ auxiliaryConclusion = "success" } = {}) {
  const releaseSha = "a".repeat(40);
  const ciRunId = 101;
  const conversationRunId = 102;
  const listJobsForWorkflowRun = () => {};
  const listWorkflowRunsForRepo = () => {};
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
      head_sha: releaseSha,
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
      if (method === listWorkflowRunsForRepo) {
        return exactRuns(releaseSha, auxiliaryConclusion);
      }
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
  } };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

test("SellerProfile preparation workflow is exact-main and Production bound", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(workflow, /github\.repository == 'Drewyoung910\/grainline'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /apply-reviewed-seller-profile-public-preparations/u);
  assert.match(workflow, /listWorkflowRunsForRepo/u);
  assert.match(workflow, /Exact-main push workflows are not all green/u);
  await assert.doesNotReject(runBindingScript());
  await assert.rejects(
    runBindingScript({ auxiliaryConclusion: "failure" }),
    /Exact-main push workflows are not all green/u,
  );
});

test("workflow holds ENABLE and applies only the reviewed restart-safe suffix", () => {
  assert.match(workflow, /verifySellerProfilePublicPreparationSources/u);
  assert.match(workflow, /SELLER_PROFILE_PREPARATION_EXPECTED_STATE: restart-safe/u);
  assert.match(workflow, /Hold SellerProfile ENABLE outside the preparation release/u);
  assert.match(workflow, /mv "prisma\/migrations\/\$migration" "\$holding\/\$migration"/u);
  assert.match(workflow, /REVIEWED_PENDING_MIGRATIONS: \$\{\{ steps\.preflight\.outputs\.pending \}\}/u);
  assert.match(workflow, /steps\.preflight\.outputs\.state != 'prepared'/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /Restore held SellerProfile ENABLE source/u);
  assert.match(workflow, /REVIEWED_PENDING_MIGRATIONS: 20261020240000_enable_seller_profile_rls/u);
  assert.match(workflow, /SELLER_PROFILE_PREPARATION_EXPECTED_STATE: prepared/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|ENABLE ROW LEVEL SECURITY/iu);
});

test("workflow orders source checks before owner access and postflight after restoration", () => {
  const source = workflow.indexOf("Verify exact SellerProfile preparation source");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Inspect restart-safe SellerProfile preparation prefix");
  const hold = workflow.indexOf("Hold SellerProfile ENABLE outside the preparation release");
  const apply = workflow.indexOf("Apply only the reviewed SellerProfile preparation suffix");
  const restore = workflow.indexOf("Restore held SellerProfile ENABLE source");
  const pending = workflow.indexOf("Require only SellerProfile ENABLE pending after preparation");
  const postflight = workflow.indexOf("Read back complete SellerProfile preparation catalog");
  const audit = workflow.indexOf("Audit global runtime grants after SellerProfile preparations");
  assert.ok(source >= 0 && source < boundary && boundary < preflight);
  assert.ok(preflight < hold && hold < apply && apply < restore);
  assert.ok(restore < pending && pending < postflight && postflight < audit);
});

test("main CI proves and isolates the public SellerProfile candidate around historical guards", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const generate = ci.indexOf("Generate Prisma client for candidate behavior tests");
  const verify = ci.indexOf("Verify public SellerProfile candidate source package");
  const isolate = ci.indexOf(
    "Isolate public SellerProfile candidate from historical release guards",
  );
  const historical = ci.indexOf("- name: Tests");
  const restore = ci.indexOf(
    "Restore public SellerProfile candidate after historical release guards",
  );
  const applyForBuild = ci.indexOf(
    "Apply public SellerProfile preparations for final Production build",
  );
  const pendingForBuild = ci.indexOf(
    "Require only SellerProfile ENABLE pending for final Production build",
  );
  const finalHistoricalAudit = ci.indexOf(
    "Audit runtime grants after SellerProfile private boundary",
  );
  const prepareHistoricalSchema = ci.indexOf(
    "Prepare SellerProfile public predecessor schema for historical audit replay",
  );
  const installHistoricalAudit = ci.indexOf(
    "Restore accumulated User access source package",
  );
  const restoreCurrentAudit = ci.indexOf(
    "Restore SellerProfile private-boundary migration after all predecessors",
  );
  const build = ci.indexOf("- name: Production build");
  assert.ok(
    generate >= 0 &&
      generate < verify &&
      verify < isolate &&
      isolate < historical &&
      historical < prepareHistoricalSchema &&
      prepareHistoricalSchema < installHistoricalAudit &&
      installHistoricalAudit < restoreCurrentAudit &&
      historical < finalHistoricalAudit &&
      finalHistoricalAudit < restore &&
      restore < applyForBuild &&
      applyForBuild < pendingForBuild &&
      pendingForBuild < build,
  );
  assert.match(
    ci.slice(applyForBuild, pendingForBuild),
    /20261020240000_enable_seller_profile_rls[\s\S]*dropdb[\s\S]*createdb[\s\S]*npx prisma migrate deploy/u,
  );
  assert.match(ci, /SELLER_PROFILE_PUBLIC_CANDIDATE_ISOLATED=true/u);
  assert.match(
    ci,
    /predecessor=e92b7a329cf3f7c1d45e8c2857e26b336d26ff65[\s\S]*git show "\$predecessor:prisma\/schema\.prisma" > "\$holding\/predecessor-schema\.prisma"/u,
  );
  assert.match(
    ci,
    /predecessor_staff_blob=43e85a986eb4790e222482e81a00afbfcc91dce5[\s\S]*"\$predecessor:scripts\/provision-order-staff-read-role\.sql"[\s\S]*"\$holding\/predecessor-provision-order-staff-read-role\.sql"/u,
  );
  assert.match(
    ci,
    /test "\$\(git hash-object "\$schema"\)" = c69a15bb7e921be14fcd19eea6b139d4ddca7fa4[\s\S]*trap cleanup EXIT[\s\S]*cp "\$holding\/predecessor-schema\.prisma" "\$schema"/u,
  );
  assert.equal(
    [
      ...ci.matchAll(
        /"\$RUNNER_TEMP\/seller-profile-public-candidate\/with-predecessor-schema\.sh"/gu,
      ),
    ].length,
    9,
  );
  assert.match(
    ci,
    /Converge staff grants after SellerProfile private boundary[\s\S]*--file="\$RUNNER_TEMP\/seller-profile-public-candidate\/predecessor-provision-order-staff-read-role\.sql"/u,
  );
  assert.match(ci, /SELLER_PROFILE_PUBLIC_PREPARATIONS/u);
  assert.match(ci, /SELLER_PROFILE_PUBLIC_ENABLE/u);
});
