import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";

import {
  PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const workflow = readFileSync(
  ".github/workflows/private-table-rls-activation-production.yml",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.activate.steps.find(
  (step) => step.name
    === "Bind activation to exact main, preparation, green checks, and compatible app",
).with.script;
const preparationEvidenceScript = parsed.jobs.activate.steps.find(
  (step) => step.name === "Download accepted preparation evidence",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const nodeRequire = createRequire(import.meta.url);

function exactPushRuns(sha, conclusion = "success") {
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
    head_sha: sha,
    status: "completed",
    conclusion: path === ".github/workflows/order-staff-bootstrap-proof.yml"
      ? conclusion
      : "success",
  }));
}

async function runBinding({
  auxiliaryConclusion = "success",
  ancestry = "ahead",
  minimumAncestry = ancestry,
} = {}) {
  const sha = "a".repeat(40);
  const compatible = "b".repeat(40);
  const predecessor = "c".repeat(40);
  const preparationHead = "d".repeat(40);
  const minimumCompatible = "0c0e9e67081c2ad7b27d97bc3f5956ecd2090549";
  const listJobsForWorkflowRun = () => {};
  const listWorkflowRunsForRepo = () => {};
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha } } }),
        compareCommits: async ({ base }) => ({
          data: {
            status: base === minimumCompatible ? minimumAncestry : ancestry,
          },
        }),
      },
      actions: {
        getWorkflowRun: async ({ run_id: runId }) => ({
          data: runId === 101
            ? {
              name: "CI",
              path: ".github/workflows/ci.yml",
              event: "push",
              head_branch: "main",
              head_sha: sha,
              status: "completed",
              conclusion: "success",
            }
            : {
              name: "Private Table Preparation Production",
              path: ".github/workflows/private-table-preparation-production.yml",
              event: "workflow_dispatch",
              head_branch: "main",
              head_sha: preparationHead,
              run_attempt: 1,
              status: "completed",
              conclusion: "success",
            },
        }),
        listJobsForWorkflowRun,
        listWorkflowRunsForRepo,
      },
    },
    paginate: async (method) => {
      if (method === listJobsForWorkflowRun) {
        return [{
          name: "Apply reviewed private-table compatibility preparation",
          status: "completed",
          conclusion: "success",
        }];
      }
      assert.equal(method, listWorkflowRunsForRepo);
      return exactPushRuns(sha, auxiliaryConclusion);
    },
  };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    { sha, repo: { owner: "test", repo: "grainline" } },
    {
      env: {
        REVIEWED_RELEASE_COMMIT: sha,
        REVIEWED_MAIN_CI_RUN_ID: "101",
        REVIEWED_PREPARATION_RUN_ID: "102",
        REVIEWED_COMPATIBLE_APP_COMMIT: compatible,
        REVIEWED_MINIMUM_COMPATIBLE_APP_COMMIT: minimumCompatible,
        REVIEWED_PRODUCTION_DEPLOYMENT_ID: "dpl_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234",
        REVIEWED_SUPERSEDED_DEPLOYMENT_ID: "dpl_1234567890ABCDEFGHIJKLMNOPQRST",
        REVIEWED_SUPERSEDED_APP_COMMIT: predecessor,
      },
    },
  );
}

async function runPreparationEvidenceDownload({ artifacts } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "private-preparation-download-"));
  const outputs = new Map();
  const runId = 102;
  const preparationHead = "d".repeat(40);
  const resolvedArtifacts = artifacts ?? [{
    id: 301,
    name: `private-table-preparation-production-${runId}`,
    expired: false,
    size_in_bytes: 4,
  }];
  const github = {
    rest: {
      actions: {
        getWorkflowRun: async () => ({
          data: {
            name: "Private Table Preparation Production",
            path: ".github/workflows/private-table-preparation-production.yml",
            event: "workflow_dispatch",
            head_branch: "main",
            head_sha: preparationHead,
            run_attempt: 1,
            status: "completed",
            conclusion: "success",
          },
        }),
        listWorkflowRunArtifacts: () => {},
        downloadArtifact: async ({ artifact_id: artifactId }) => {
          assert.equal(artifactId, 301);
          return { data: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]) };
        },
      },
    },
    paginate: async () => resolvedArtifacts,
  };
  try {
    await new AsyncFunction(
      "github",
      "context",
      "process",
      "core",
      "require",
      preparationEvidenceScript,
    )(
      github,
      { repo: { owner: "test", repo: "grainline" } },
      {
        env: {
          REVIEWED_PREPARATION_RUN_ID: String(runId),
          RUNNER_TEMP: directory,
        },
      },
      { setOutput: (name, value) => outputs.set(name, value) },
      nodeRequire,
    );
    assert.deepEqual(
      [...readFileSync(outputs.get("archive"))],
      [0x50, 0x4b, 0x03, 0x04],
    );
    assert.equal(outputs.get("preparation_commit"), preparationHead);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("workflow binds reviewed activations to exact main and Production", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.jobs.activate.environment, "Production");
  assert.deepEqual(parsed.on.workflow_dispatch.inputs.release_id.options, [
    "favorite_v1",
    "follow_v1",
    "review_vote_v1",
    "maker_verification_v1",
    "owner_social_verification_v1",
  ]);
  assert.match(workflow, new RegExp(PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION, "u"));
  assert.match(workflow, /PRIVATE_TABLE_RLS_ACTIVATION_RELEASE_ID/u);
  assert.match(workflow, /minimum-compatible-app-commit/u);
  assert.match(workflow, /REVIEWED_MINIMUM_COMPATIBLE_APP_COMMIT/u);
  assert.match(workflow, /minimumToPreparation\.data\.status/u);
  assert.match(workflow, /PRIVATE_TABLE_RLS_ACTIVATION_PHASE=postflight/u);
  assert.match(workflow, /private-table-rls-activation-production-inspect\.mjs/u);
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(workflow, /REVIEWED_SUPERSEDED_DEPLOYMENT_ID/u);
  assert.match(workflow, /predecessorToApp\.data\.status !== 'ahead'/u);
  assert.match(workflow, /listWorkflowRunArtifacts/u);
  assert.match(workflow, /downloadArtifact/u);
  assert.match(workflow, /private-table-preparation-production-\$\{runId\}/u);
  assert.match(workflow, /private-table-preparation-evidence-verify\.mjs/u);
  assert.doesNotThrow(() => new AsyncFunction(
    "github",
    "context",
    "process",
    "core",
    "require",
    preparationEvidenceScript,
  ));
  await assert.doesNotReject(runBinding());
});

test("workflow rejects red exact-main proofs and invalid ancestry", async () => {
  await assert.rejects(
    runBinding({ auxiliaryConclusion: "failure" }),
    /push workflows are not all green/u,
  );
  await assert.rejects(
    runBinding({ minimumAncestry: "diverged" }),
    /ancestry drifted/u,
  );
});

test("workflow downloads one exact non-expired preparation artifact", async () => {
  await assert.doesNotReject(runPreparationEvidenceDownload());
  await assert.rejects(
    runPreparationEvidenceDownload({ artifacts: [] }),
    /evidence artifact is absent or ambiguous/u,
  );
});

test("workflow is sole-pending, restart-aware, readback-bound, and evidence-retaining", () => {
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  assert.match(workflow, /psql "\$DIRECT_URL"/u);
  assert.match(workflow, /npx prisma migrate resolve --applied "\$migration"/u);
  assert.match(
    workflow,
    /case "\$state" in[\s\S]*ready\|active_unrecorded\)[\s\S]*active\)/u,
  );
  assert.match(workflow, /private-table-rls-activation-state\.tsv/u);
  assert.match(workflow, /owner_social_verification_v1/u);
  assert.match(workflow, /--release-ids/u);
  assert.match(workflow, /--migrations/u);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
  assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  const source = workflow.indexOf("Verify reviewed private-table activation source before owner access");
  const evidence = workflow.indexOf("Bind activation to accepted preparation evidence");
  const deployment = workflow.indexOf("Verify exact compatible deployment is live");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Inspect restart-safe private-table state");
  const apply = workflow.indexOf("Apply reviewed private-table activation outside Prisma's ledger");
  const resolve = workflow.indexOf("Record the committed private-table activation in Prisma's ledger");
  const postflight = workflow.indexOf("Read back exact private-table RLS catalog");
  assert.ok(evidence >= 0 && evidence < source);
  assert.ok(source >= 0 && source < deployment && deployment < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < resolve && resolve < postflight);
});

test("workflow pins every external action by full commit SHA", () => {
  for (const match of workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    assert.match(match[1], /@[0-9a-f]{40}$/u, `${match[1]} is not SHA-pinned`);
  }
});
