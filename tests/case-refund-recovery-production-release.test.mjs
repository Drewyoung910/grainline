import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import yaml from "js-yaml";

import {
  assertPrivateSafeCaseRefundInventory,
  CASE_REFUND_FOLLOWUP_MIGRATION,
  CASE_REFUND_FOLLOWUP_SHA256,
  CASE_REFUND_RECOVERY_CORE_MIGRATION,
  CASE_REFUND_RECOVERY_CORE_SHA256,
  caseRefundMigrationPath,
  caseRefundReleaseSpecs,
  executeCaseRefundInventory,
} from "../scripts/case-refund-recovery-production-verify.mjs";

const workflow = fs.readFileSync(
  ".github/workflows/case-refund-recovery-correction-production.yml",
  "utf8",
);
const parsedWorkflow = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const conversationProofWorkflow = fs.readFileSync(
  ".github/workflows/conversation-message-force-proof.yml",
  "utf8",
);
const parsedConversationProofWorkflow = yaml.load(
  conversationProofWorkflow,
  { schema: yaml.JSON_SCHEMA },
);
const bindingScript = parsedWorkflow.jobs.apply.steps.find(
  (step) => step.name === "Bind release to exact main and completed push workflows",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function createInventoryDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TYPE public."CaseResolutionClaimStatus" AS ENUM (
      'PROVIDER_PENDING', 'PROVIDER_RECORDED', 'RECONCILIATION_REQUIRED',
      'FINALIZED'
    );
    CREATE TABLE public."CaseResolutionClaim" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL,
      status public."CaseResolutionClaimStatus" NOT NULL,
      "orderPaymentEventId" text,
      "refundAmountCents" integer NOT NULL,
      currency text NOT NULL,
      "createdAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "caseResolutionClaimId" text,
      "sellerRefundId" text,
      "sellerRefundLockedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL,
      "eventType" text NOT NULL,
      "stripeObjectType" text,
      "stripeEventId" text NOT NULL,
      "stripeObjectId" text,
      currency text,
      status text,
      metadata jsonb NOT NULL,
      "createdAt" timestamp(3) without time zone NOT NULL
    );
    INSERT INTO public."CaseResolutionClaim" (
      id, "orderId", status, "orderPaymentEventId", "refundAmountCents",
      currency, "createdAt"
    ) VALUES
      ('repairable', 'order-repairable', 'RECONCILIATION_REQUIRED', NULL,
       1000, 'usd', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
      ('unrepairable', 'order-unrepairable', 'RECONCILIATION_REQUIRED', NULL,
       700, 'usd', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
      ('active-marker', 'order-active', 'RECONCILIATION_REQUIRED', NULL,
       500, 'usd', CURRENT_TIMESTAMP - INTERVAL '1 hour');
    INSERT INTO public."Order" (
      id, "caseResolutionClaimId", "sellerRefundId", "sellerRefundLockedAt"
    ) VALUES
      ('order-repairable', 'repairable', 're_good', NULL),
      ('order-unrepairable', 'unrepairable', 're_partial', NULL),
      ('order-active', 'active-marker', 'pending', CURRENT_TIMESTAMP);
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "eventType", "stripeObjectType", "stripeEventId",
      "stripeObjectId", currency, status, metadata, "createdAt"
    ) VALUES
      ('event-good', 'order-repairable', 'REFUND', 'refund', 'evt_good',
       're_good', 'usd', 'succeeded',
       '{"totalRefundedCents":"1000","pendingLocalRefundLock":"false"}'::jsonb,
       CURRENT_TIMESTAMP),
      ('event-partial', 'order-unrepairable', 'REFUND', 'refund', 'evt_partial',
       're_partial', 'usd', 'succeeded',
       '{"totalRefundedCents":"400","pendingLocalRefundLock":"false"}'::jsonb,
       CURRENT_TIMESTAMP);
  `);
  return database;
}

async function runBindingScript({ omitPath, failingPath } = {}) {
  const sha = "a".repeat(40);
  const runs = [
    [201, "CI", ".github/workflows/ci.yml"],
    [202, "Account Deletion Worker Bootstrap Proof", ".github/workflows/account-deletion-worker-bootstrap-proof.yml"],
    [203, "Conversation and Message RLS FORCE Proof", ".github/workflows/conversation-message-force-proof.yml"],
    [204, "Order Staff Bootstrap Proof", ".github/workflows/order-staff-bootstrap-proof.yml"],
    [205, "Order Paid Repair Lock Proof", ".github/workflows/order-paid-repair-lock-proof.yml"],
    [206, "Order Account Deletion Concurrency Proof", ".github/workflows/order-account-deletion-concurrency-proof.yml"],
  ].map(([id, name, path]) => ({
    id,
    name,
    path,
    event: "push",
    head_branch: "main",
    head_sha: sha,
    status: "completed",
    conclusion: path === failingPath ? "failure" : "success",
  })).filter((run) => run.path !== omitPath);
  const listWorkflowRunsForRepo = () => {};
  const github = {
    rest: {
      repos: { getBranch: async () => ({ data: { commit: { sha } } }) },
      actions: {
        getWorkflowRun: async () => ({ data: {
          name: "CI",
          event: "push",
          head_branch: "main",
          head_sha: sha,
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
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    { sha, repo: { owner: "test", repo: "grainline" } },
    { env: {
      REVIEWED_RELEASE_COMMIT: sha,
      REVIEWED_MAIN_CI_RUN_ID: "101",
    } },
  );
}

test("#710 inventory separates repairable and unrepairable aggregate claims", async () => {
  const database = await createInventoryDatabase();
  try {
    const summary = await executeCaseRefundInventory(database, process.cwd());
    assert.deepEqual({
      ...summary,
      repairable_refund_amount_cents: Number(
        summary.repairable_refund_amount_cents,
      ),
      unrepairable_refund_amount_cents: Number(
        summary.unrepairable_refund_amount_cents,
      ),
    }, {
      repairable_claims: 1,
      repairable_refund_amount_cents: 1000,
      unrepairable_claims: 1,
      unrepairable_refund_amount_cents: 700,
    });
  } finally {
    await database.close();
  }
});

test("#710 evidence rejects identifiers and unexpected fields", () => {
  const summary = {
    repairable_claims: "1",
    repairable_refund_amount_cents: "1000",
    unrepairable_claims: "0",
    unrepairable_refund_amount_cents: "0",
  };
  assert.doesNotThrow(() => assertPrivateSafeCaseRefundInventory(summary));
  assert.throws(
    () => assertPrivateSafeCaseRefundInventory({
      ...summary,
      order_id: "private-order-id",
    }),
    /Expected values to be strictly deep-equal/u,
  );
});

test("Production release pins both reviewed migrations byte-for-byte", () => {
  for (const [migration, expected] of [
    [CASE_REFUND_RECOVERY_CORE_MIGRATION, CASE_REFUND_RECOVERY_CORE_SHA256],
    [CASE_REFUND_FOLLOWUP_MIGRATION, CASE_REFUND_FOLLOWUP_SHA256],
  ]) {
    const source = fs.readFileSync(
      caseRefundMigrationPath(process.cwd(), migration),
    );
    assert.equal(createHash("sha256").update(source).digest("hex"), expected);
    assert.match(workflow, new RegExp(`${expected}  prisma/migrations/\\$`, "u"));
  }
});

test("Production verifier composes the core and follow-up source states", () => {
  const specs = caseRefundReleaseSpecs(process.cwd());
  assert.equal(specs.beforeCore.size, 15);
  assert.equal(specs.afterCore.size, 15);
  assert.equal(specs.finalSuccessor.size, 15);
  assert.equal(specs.executionPosture.size, 15);
  assert.equal(specs.runtimeExecute.size, 15);
  assert.equal(
    [...specs.runtimeExecute.values()].filter((value) => value === false).length,
    1,
  );
  assert.deepEqual(
    specs.executionPosture.get(
      "public.grainline_order_ops_health_summary()",
    ),
    { parallel: "s", volatility: "s" },
  );
  assert.equal(
    [...specs.executionPosture.values()].filter(
      (posture) => posture.volatility === "s" && posture.parallel === "s",
    ).length,
    1,
  );
  assert.equal(
    [...specs.executionPosture.values()].filter(
      (posture) => posture.volatility === "v" && posture.parallel === "u",
    ).length,
    14,
  );
});

test("Production workflow requires all exact-main push workflows green", async () => {
  await assert.doesNotReject(runBindingScript());
  await assert.rejects(
    runBindingScript({
      failingPath: ".github/workflows/order-paid-repair-lock-proof.yml",
    }),
    /Exact-main push workflows are not all green/u,
  );
  await assert.rejects(
    runBindingScript({
      omitPath: ".github/workflows/conversation-message-force-proof.yml",
    }),
    /Required exact-main push workflows are absent/u,
  );
});

test("required Conversation proof runs on every main push", () => {
  assert.ok(parsedConversationProofWorkflow.on.push.branches.includes("main"));
  assert.equal(parsedConversationProofWorkflow.on.push.paths, undefined);
});

test("Production workflow gates SQL on inventory and exact pending suffix", () => {
  assert.ok(parsedWorkflow.on.workflow_dispatch);
  assert.equal(parsedWorkflow.permissions.actions, "read");
  assert.equal(parsedWorkflow.permissions.contents, "read");
  assert.equal(parsedWorkflow.concurrency.group, "production-database-migrations");
  assert.equal(parsedWorkflow.jobs.apply.environment, "Production");
  assert.match(
    workflow,
    /test "\$UNREPAIRABLE_CLAIMS" = "0"/u,
  );
  assert.match(
    workflow,
    /REVIEWED_PENDING_MIGRATIONS="\$core,\$followup"/u,
  );
  assert.match(workflow, /case-refund-recovery-production-verify\.mjs preflight/u);
  assert.match(workflow, /case-refund-recovery-production-verify\.mjs postflight/u);
  assert.equal((workflow.match(/\bnpx prisma migrate deploy\b/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /stripe\s+(?:charges|transfers|refunds)/iu);
});

test("Production verifier is syntactically valid", () => {
  const checked = spawnSync(
    process.execPath,
    ["--check", "scripts/case-refund-recovery-production-verify.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
});
