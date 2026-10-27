import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  MIGRATION,
  MIGRATION_SHA256,
  STOCK_NOTIFICATION_MIGRATION,
  expectedPendingMigrations,
  verifyCatalog,
} from "../scripts/resend-webhook-receipt-recovery-production-inspect.mjs";

const workflow = readFileSync(
  ".github/workflows/resend-webhook-receipt-recovery-production.yml",
  "utf8",
);
const migrationSql = readFileSync(
  `prisma/migrations/${MIGRATION}/migration.sql`,
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.apply.steps.find((step) =>
  step.name === "Bind recovery to exact live main and completed push workflows"
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function exactPushRuns(releaseSha, { omitPath, failingPath } = {}) {
  return [
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
}

async function runBinding(options = {}) {
  const releaseSha = "a".repeat(40);
  const listWorkflowRunsForRepo = () => {};
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha: releaseSha } } }),
      },
      actions: {
        getWorkflowRun: async () => ({ data: {
          name: "CI",
          path: ".github/workflows/ci.yml",
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
      return exactPushRuns(releaseSha, options);
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

function catalog({ incompatible = true, readOnly = true } = {}) {
  const constraints = [
    {
      name: "ResendWebhookEvent_acknowledgement_pair_chk",
      validated: true,
      definition: 'CHECK ("acknowledgedAt" IS NULL AND "acknowledgedById" IS NULL AND acknowledgement IS NULL OR "acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND acknowledgement IS NOT NULL)',
    },
    {
      name: "ResendWebhookEvent_attempts_nonnegative_chk",
      validated: true,
      definition: "CHECK (attempts >= 0)",
    },
    {
      name: "ResendWebhookEvent_claimGeneration_chk",
      validated: true,
      definition: 'CHECK ("claimGeneration" >= 0)',
    },
  ];
  if (incompatible) constraints.push({
    name: "ResendWebhookEvent_claim_pair_chk",
    validated: true,
    definition: 'CHECK (("claimToken" IS NULL) = ("processingStartedAt" IS NULL))',
  });
  return {
    identity: {
      current_user: "neondb_owner",
      session_user: "neondb_owner",
      database_name: "neondb",
      read_only: readOnly ? "on" : "off",
      isolation: "repeatable read",
      owner_superuser: false,
      owner_bypass_rls: true,
      runtime_superuser: false,
      runtime_bypass_rls: false,
      runtime_inherit: false,
    },
    table: {
      owner_name: "neondb_owner",
      owner_superuser: false,
      owner_bypass_rls: true,
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
    },
    constraints,
  };
}

test("C-1180 recovery is exact-main, Production-bound, and checks every required push workflow", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.concurrency["cancel-in-progress"], false);
  assert.equal(parsed.jobs.apply.environment, "Production");
  assert.match(workflow, /apply-reviewed-resend-webhook-receipt-recovery/u);
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/u,
  );
  await assert.doesNotReject(runBinding());
  await assert.rejects(
    runBinding({
      omitPath: ".github/workflows/notification-rls-ephemeral-proof.yml",
    }),
    /Required exact-main push workflows are absent/u,
  );
  await assert.rejects(
    runBinding({
      failingPath: ".github/workflows/order-paid-repair-lock-proof.yml",
    }),
    /Exact-main push workflows are not all green/u,
  );
});

test("C-1180 recovery applies only its exact migration while preserving the StockNotification pending state", () => {
  assert.equal(MIGRATION, "20261027010000_restore_resend_webhook_receipts");
  assert.equal(
    createHash("sha256").update(migrationSql).digest("hex"),
    MIGRATION_SHA256,
  );
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  const apply = workflow.indexOf(
    "name: Apply reviewed recovery transaction outside Prisma's ledger",
  );
  const resolve = workflow.indexOf(
    "name: Record the committed recovery in Prisma's ledger",
  );
  const postflight = workflow.indexOf(
    "name: Read back constraint removal, route write compatibility, and ledger",
  );
  assert.ok(apply >= 0);
  assert.ok(resolve > apply);
  assert.ok(postflight > resolve);
  assert.match(workflow.slice(apply, resolve), /psql "\$DIRECT_URL"/u);
  assert.match(
    workflow.slice(resolve, postflight),
    /20261027010000_restore_resend_webhook_receipts/u,
  );
  assert.equal(expectedPendingMigrations({
    candidateState: "pending",
    stockState: "pending",
  }), `${STOCK_NOTIFICATION_MIGRATION},${MIGRATION}`);
  assert.equal(expectedPendingMigrations({
    candidateState: "applied",
    stockState: "pending",
  }), STOCK_NOTIFICATION_MIGRATION);
});

test("C-1180 catalog requires the exact predecessor before recovery and its absence afterward", () => {
  assert.equal(verifyCatalog(catalog(), {
    candidateState: "pending",
    stockState: "pending",
  }).incompatibleConstraintPresent, true);
  assert.equal(verifyCatalog(catalog({ incompatible: false }), {
    candidateState: "applied",
    stockState: "pending",
  }, {
    readOnly: true,
  }).incompatibleConstraintPresent, false);
  assert.equal(verifyCatalog(catalog({ incompatible: false, readOnly: false }), {
    candidateState: "applied",
    stockState: "pending",
  }, {
    readOnly: false,
  }).runtimeReceiptAuthority, true);
  const drifted = catalog();
  drifted.constraints[0] = {
    ...drifted.constraints[0],
    definition: "CHECK (true)",
  };
  assert.throws(() => verifyCatalog(drifted, {
    candidateState: "pending",
    stockState: "pending",
  }));
  const missingGrant = catalog();
  missingGrant.table = { ...missingGrant.table, runtime_insert: false };
  assert.throws(() => verifyCatalog(missingGrant, {
    candidateState: "pending",
    stockState: "pending",
  }));
});

test("C-1180 migration is atomic, serialized, narrow, and self-verifying", () => {
  assert.match(migrationSql, /^BEGIN;/mu);
  assert.match(migrationSql, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migrationSql, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(migrationSql, /pg_advisory_xact_lock/u);
  assert.match(migrationSql, /LOCK TABLE public\."ResendWebhookEvent" IN ACCESS EXCLUSIVE MODE/u);
  assert.match(
    migrationSql,
    /DROP CONSTRAINT "ResendWebhookEvent_claim_pair_chk"/u,
  );
  assert.match(migrationSql, /resend_webhook_receipt_preflight/u);
  assert.match(migrationSql, /resend_webhook_receipt_postflight/u);
  assert.match(migrationSql, /COMMIT;\s*$/u);
  assert.doesNotMatch(migrationSql, /DROP TABLE|DELETE FROM|UPDATE public/u);
});

test("C-1180 evidence is always uploaded and never deploys app/provider changes", () => {
  assert.match(
    workflow,
    /name: Upload sanitized C-1180 recovery evidence\n\s+if: always\(\)/u,
  );
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /resend\s+(?:emails|webhooks|domains)/iu);
});
