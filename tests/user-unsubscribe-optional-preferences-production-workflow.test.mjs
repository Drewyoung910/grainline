import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  CORRECTED_SOURCE_MD5,
  FUNCTION_IDENTITY,
  MIGRATION,
  MIGRATION_SHA256,
  PREDECESSOR_SOURCE_MD5,
  verifyCorrectionCatalog,
} from "../scripts/user-unsubscribe-optional-preferences-production-inspect.mjs";

const workflow = readFileSync(
  ".github/workflows/user-unsubscribe-optional-preferences-production.yml",
  "utf8",
);
const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsedWorkflow.jobs.apply.steps.find(
  (step) => step.name === "Bind release to exact main and completed push workflows",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function catalog(sourceMd5) {
  return {
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
    table: {
      owner_name: "neondb_owner",
      rls_enabled: true,
      rls_forced: true,
      policy_count: 0,
    },
    function: {
      identity: FUNCTION_IDENTITY,
      owner_name: "neondb_owner",
      owner_superuser: false,
      owner_bypass_rls: true,
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: ["search_path=pg_catalog"],
      source_md5: sourceMd5,
      contains_dynamic_execute: false,
      nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
    },
  };
}

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
  ].map(([id, name, workflowPath]) => ({
    id,
    name,
    path: workflowPath,
    event: "push",
    head_branch: "main",
    head_sha: releaseSha,
    status: "completed",
    conclusion: workflowPath === failingPath ? "failure" : "success",
  })).filter((run) => run.path !== omitPath);
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
  const context = {
    sha: releaseSha,
    repo: { owner: "test", repo: "grainline" },
  };
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

test("C-875 production release has one exact protected boundary", () => {
  assert.ok(parsedWorkflow.on.workflow_dispatch);
  assert.equal(parsedWorkflow.permissions.actions, "read");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.concurrency.group, "production-database-migrations");
  assert.equal(parsedWorkflow.concurrency["cancel-in-progress"], false);
  assert.equal(parsedWorkflow.jobs.apply.environment, "Production");
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-unsubscribe-optional-preferences'/u,
  );
  assert.equal((workflow.match(/\bnpx prisma migrate deploy\b/gu) ?? []).length, 1);
});

test("C-875 binding rejects missing or red exact-main workflows", async () => {
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

test("C-875 inspector accepts only the reviewed predecessor and corrected catalogs", () => {
  assert.equal(
    verifyCorrectionCatalog(catalog(PREDECESSOR_SOURCE_MD5), "pending").state,
    "pending",
  );
  assert.equal(
    verifyCorrectionCatalog(catalog(CORRECTED_SOURCE_MD5), "applied").state,
    "applied",
  );
  assert.throws(
    () => verifyCorrectionCatalog(catalog(CORRECTED_SOURCE_MD5), "pending"),
    /Expected values to be strictly equal/u,
  );
});

test("C-875 release pins exact bytes and has no provider effect", () => {
  const checked = spawnSync(
    process.execPath,
    ["--check", "scripts/user-unsubscribe-optional-preferences-production-inspect.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(
    MIGRATION,
    "20261023030000_correct_user_unsubscribe_optional_email_preferences",
  );
  assert.equal(
    MIGRATION_SHA256,
    "996378ebae18adffe66dedab3ca9f02f80b0a1907eee162db1f9692d040d65c7",
  );
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.match(
    workflow,
    /user-unsubscribe-optional-preferences-production-inspect\.mjs preflight/u,
  );
  assert.match(
    workflow,
    /user-unsubscribe-optional-preferences-production-inspect\.mjs postflight/u,
  );
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /stripe\s+(?:charges|transfers|refunds|events)/iu);
});
