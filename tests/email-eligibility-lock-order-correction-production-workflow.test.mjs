import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  MIGRATION,
  MIGRATION_SHA256,
  OUTBOX_CORRECTION_MIGRATION,
  STOCK_NOTIFICATION_MIGRATION,
  expectedPendingMigrations,
  verifyCatalog,
} from "../scripts/email-eligibility-lock-order-correction-production-inspect.mjs";
import { REVIEWED_MANUALLY_APPLIED_MIGRATIONS } from "../scripts/reviewed-manually-applied-migrations.mjs";

const workflow = readFileSync(
  ".github/workflows/email-eligibility-lock-order-correction-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migrationSql = readFileSync(
  `prisma/migrations/${MIGRATION}/migration.sql`,
  "utf8",
);
const scenarioSource = readFileSync(
  "tools/database-full-chain/scenarios/email-provider-eligibility-fence.mjs",
  "utf8",
);
const inspectorSource = readFileSync(
  "scripts/email-eligibility-lock-order-correction-production-inspect.mjs",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.apply.steps.find((step) =>
  step.name === "Bind correction to exact live main and completed push workflows"
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

function catalog(schemaState = "predecessor") {
  const before = {
    grainline_user_clerk_identity_ensure: "980b4708924b99ce799e776ba5ae53e4",
    grainline_user_owner_notification_preference_update:
      "8c060b5283d62a66048258b72a010965",
    grainline_user_staff_ban_apply: "eb9f9b2504e4c82f4c2d70a40fd20470",
    grainline_user_unsubscribe_preferences_disable:
      "b4a20fbd4b9e6067390feb3a3a27f1cf",
  };
  const after = {
    grainline_user_clerk_identity_ensure: "a67fca98de5a426d9445db667f2c03f3",
    grainline_user_owner_notification_preference_update:
      "25721b79b417d5b9f248acb176e4874d",
    grainline_user_staff_ban_apply: "f137c30966d4db1711aa0d16eaf3295c",
    grainline_user_unsubscribe_preferences_disable:
      "0d7f3956b5171f1008edd01b45002dc3",
  };
  const hashes = schemaState === "corrected" ? after : before;
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
    routines: Object.entries(hashes).map(([name, source_hash]) => ({
      name,
      owner_name: "neondb_owner",
      security_definer: true,
      volatility: "v",
      parallel: "u",
      config: ["search_path=pg_catalog"],
      source_hash,
      runtime_execute: true,
      public_execute: false,
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

test("lock-order correction is exact-main, Production-bound, and checks all push workflows", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.jobs.apply.environment, "Production");
  assert.match(workflow, /apply-reviewed-email-eligibility-lock-order-correction/u);
  await assert.doesNotReject(runBinding());
  await assert.rejects(
    runBinding({ omitPath: ".github/workflows/notification-rls-ephemeral-proof.yml" }),
    /Required exact-main push workflows are absent/u,
  );
  await assert.rejects(
    runBinding({ failingPath: ".github/workflows/order-paid-repair-lock-proof.yml" }),
    /Exact-main push workflows are not all green/u,
  );
});

test("lock-order correction applies one exact successor after the outbox correction", () => {
  assert.equal(MIGRATION, "20261027030000_correct_email_eligibility_lock_order");
  assert.equal(
    createHash("sha256").update(migrationSql).digest("hex"),
    MIGRATION_SHA256,
  );
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.equal(REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(MIGRATION), MIGRATION_SHA256);
  assert.match(inspectorSource, new RegExp(OUTBOX_CORRECTION_MIGRATION, "u"));
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  assert.equal(expectedPendingMigrations({
    candidateState: "pending",
    stockState: "pending",
  }), `${STOCK_NOTIFICATION_MIGRATION},${MIGRATION}`);
  assert.equal(expectedPendingMigrations({
    candidateState: "applied",
    stockState: "pending",
  }), STOCK_NOTIFICATION_MIGRATION);
});

test("lock-order source is proved then isolated from historical release guards", () => {
  const verify = ciWorkflow.indexOf(
    "name: Verify email eligibility lock-order correction source package",
  );
  const isolate = ciWorkflow.indexOf(
    "name: Isolate email eligibility lock-order correction until historical release guards pass",
  );
  const historical = ciWorkflow.indexOf(
    "name: Verify OrderPaymentEvent activation migration tree",
  );
  const restore = ciWorkflow.indexOf(
    "name: Restore email eligibility lock-order correction after historical release guards",
  );
  assert.ok(verify >= 0);
  assert.ok(isolate > verify);
  assert.ok(historical > isolate);
  assert.ok(restore > historical);
  assert.match(
    ciWorkflow.slice(isolate, restore),
    /20261027030000_correct_email_eligibility_lock_order/u,
  );
});

test("final disposable build applies the lock-order correction after its predecessors", () => {
  const finalBuild = ciWorkflow.slice(ciWorkflow.indexOf(
    "name: Apply complete public SellerProfile chain for final Production build",
  ));
  const holdLockOrder = finalBuild.indexOf(
    'mv "prisma/migrations/$lock_order_correction_migration" "$holding/migrations/$lock_order_correction_migration"',
  );
  const restoreEligibility = finalBuild.indexOf(
    '"$holding/migrations/$eligibility_migration"',
    holdLockOrder + 1,
  );
  const restoreOutboxCorrection = finalBuild.lastIndexOf(
    '"$holding/migrations/$correction_migration"',
  );
  const restoreLockOrder = finalBuild.lastIndexOf(
    '"$holding/migrations/$lock_order_correction_migration"',
  );

  assert.ok(holdLockOrder >= 0);
  assert.ok(restoreEligibility > holdLockOrder);
  assert.ok(restoreOutboxCorrection > restoreEligibility);
  assert.ok(restoreLockOrder > restoreOutboxCorrection);
  assert.match(
    finalBuild.slice(restoreLockOrder),
    /EMAIL_ELIGIBILITY_LOCK_ORDER_CORRECTION_MIGRATION_PATH=/u,
  );
});

test("catalog proof pins predecessor and corrected function bodies, owners and ACLs", () => {
  assert.equal(verifyCatalog(catalog(), {
    candidateState: "pending",
    stockState: "pending",
  }).schemaState, "predecessor");
  assert.equal(verifyCatalog(catalog("corrected"), {
    candidateState: "pending",
    stockState: "pending",
  }).schemaState, "corrected");
  assert.equal(verifyCatalog(catalog("corrected"), {
    candidateState: "applied",
    stockState: "pending",
  }).routineCount, 4);
  assert.throws(() => verifyCatalog(catalog(), {
    candidateState: "applied",
    stockState: "pending",
  }), /applied correction ledger requires the corrected schema/u);
  const partiallyApplied = catalog();
  const corrected = catalog("corrected");
  partiallyApplied.routines[0] = corrected.routines[0];
  assert.throws(() => verifyCatalog(partiallyApplied, {
    candidateState: "pending",
    stockState: "pending",
  }), /partially applied/u);
  const drifted = catalog("corrected");
  drifted.routines[0] = { ...drifted.routines[0], owner_name: "other" };
  assert.throws(() => verifyCatalog(drifted, {
    candidateState: "applied",
    stockState: "pending",
  }));
});

test("production workflow resumes after committed SQL without executing it twice", () => {
  const applyStep = parsed.jobs.apply.steps.find((step) =>
    step.name === "Apply reviewed correction transaction outside Prisma's ledger"
  );
  const resolveStep = parsed.jobs.apply.steps.find((step) =>
    step.name === "Record the committed correction in Prisma's ledger"
  );
  assert.equal(
    applyStep.if,
    "steps.preflight.outputs.state == 'pending' && steps.preflight.outputs.schema_state == 'predecessor'",
  );
  assert.equal(resolveStep.if, "steps.preflight.outputs.state == 'pending'");
  assert.match(
    inspectorSource,
    /appendFileSync\(process\.env\.GITHUB_OUTPUT, `schema_state=\$\{result\.schemaState\}\\n`\)/u,
  );
});

test("migration is atomic and the full-chain behavior proof exercises both lock orders", () => {
  assert.match(migrationSql, /^BEGIN;/mu);
  assert.match(migrationSql, /LOCK TABLE public\."User" IN SHARE ROW EXCLUSIVE MODE/u);
  assert.match(migrationSql, /pg_catalog\.md5\(routine\.prosrc\)/u);
  assert.match(migrationSql, /ORDER BY address_owner\.id[\s\S]*FOR UPDATE/u);
  assert.match(migrationSql, /ORDER BY account_user\.id[\s\S]*FOR UPDATE/u);
  assert.match(scenarioSource, /proveEmailEligibilityAccountDeletionLockOrder/u);
  assert.match(scenarioSource, /runDeletionFirstLockOrder/u);
  assert.match(scenarioSource, /runMutationFirstLockOrder/u);
  assert.match(migrationSql, /COMMIT;\s*$/u);
});

test("production release remains read-only outside the exact migration and saves evidence", () => {
  assert.match(
    workflow,
    /name: Upload sanitized email eligibility lock-order evidence\n\s+if: always\(\)/u,
  );
  assert.match(inspectorSource, /containsRowData: false/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /resend\s+(?:emails|webhooks|domains)/iu);
});
