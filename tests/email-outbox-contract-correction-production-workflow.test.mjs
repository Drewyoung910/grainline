import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import yaml from "js-yaml";

import {
  MIGRATION,
  MIGRATION_SHA256,
  STOCK_NOTIFICATION_MIGRATION,
  expectedPendingMigrations,
  verifyCatalog,
} from "../scripts/email-outbox-contract-correction-production-inspect.mjs";
import { REVIEWED_MANUALLY_APPLIED_MIGRATIONS } from "../scripts/reviewed-manually-applied-migrations.mjs";

const workflow = readFileSync(
  ".github/workflows/email-outbox-contract-correction-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migrationDirectory =
  process.env.EMAIL_OUTBOX_CONTRACT_CORRECTION_MIGRATION_PATH
  ?? `prisma/migrations/${MIGRATION}`;
const migrationSql = readFileSync(
  path.join(migrationDirectory, "migration.sql"),
  "utf8",
);
const emailOutboxSource = readFileSync("src/lib/emailOutbox.ts", "utf8");
const inspectorSource = readFileSync(
  "scripts/email-outbox-contract-correction-production-inspect.mjs",
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
    grainline_email_outbox_enqueue_legacy: "c175b462cf5427e2f15dddbcc9a4ec1a",
    grainline_email_outbox_account_deletion_fence: "508a22265993fde9d14c062a76630d76",
    grainline_email_outbox_fail: "cdfdfc38a37e4f7eda3df91fc1e98021",
  };
  const after = {
    grainline_email_outbox_enqueue_legacy: "f6ca99becfbc71f48f629ef008a012c6",
    grainline_email_outbox_account_deletion_fence: "2f40c6c4dacfca2f786dff06424d717e",
    grainline_email_outbox_fail: "ab04f794d057ed823ffe1e47ffb9e25e",
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

test("email correction is exact-main, Production-bound, and checks required push workflows", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.jobs.apply.environment, "Production");
  assert.match(workflow, /apply-reviewed-email-outbox-contract-correction/u);
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

test("email correction applies one exact migration after C-1180 while preserving StockNotification", () => {
  assert.equal(MIGRATION, "20261027020000_correct_email_outbox_contracts");
  assert.equal(
    createHash("sha256").update(migrationSql).digest("hex"),
    MIGRATION_SHA256,
  );
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.equal(REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(MIGRATION), MIGRATION_SHA256);
  assert.match(inspectorSource, /20261027010000_restore_resend_webhook_receipts/u);
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

test("email correction source is proved then isolated from historical release guards", () => {
  const verify = ciWorkflow.indexOf(
    "name: Verify email outbox contract correction source package",
  );
  const isolate = ciWorkflow.indexOf(
    "name: Isolate email outbox contract correction until historical release guards pass",
  );
  const historical = ciWorkflow.indexOf(
    "name: Verify OrderPaymentEvent activation migration tree",
  );
  const restore = ciWorkflow.indexOf(
    "name: Restore email outbox contract correction after historical release guards",
  );
  assert.ok(verify >= 0);
  assert.ok(isolate > verify);
  assert.ok(historical > isolate);
  assert.ok(restore > historical);
  assert.match(
    ciWorkflow.slice(isolate, restore),
    /20261027020000_correct_email_outbox_contracts/u,
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
  }).routineCount, 3);
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
  drifted.routines[0] = { ...drifted.routines[0], runtime_execute: false };
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
    /appendFileSync\(outputPath, `schema_state=\$\{result\.schemaState\}\\n`\)/u,
  );
});

test("migration is atomic, exact-body guarded and restores all three contracts", () => {
  assert.match(migrationSql, /^BEGIN;/mu);
  assert.match(migrationSql, /LOCK TABLE public\."EmailOutbox" IN SHARE ROW EXCLUSIVE MODE/u);
  assert.match(migrationSql, /pg_catalog\.md5\(routine\.prosrc\)/u);
  for (const sourceType of [
    "seller_broadcast",
    "followed_maker_new_listing",
    "order_payment",
    "order_fulfillment",
    "case",
  ]) {
    assert.match(migrationSql, new RegExp(`'${sourceType}'`, "u"));
    assert.match(emailOutboxSource, new RegExp(`"${sourceType}"`, "u"));
  }
  assert.doesNotMatch(migrationSql, /cardinality\(p_email_keys\).*20/u);
  assert.match(migrationSql, /2 \^ LEAST\(9,/u);
  assert.match(migrationSql, /COMMIT;\s*$/u);
});

test("production workflow rolls back smoke writes and always uploads sanitized evidence", () => {
  assert.match(
    workflow,
    /name: Upload sanitized email outbox correction evidence\n\s+if: always\(\)/u,
  );
  assert.match(
    inspectorSource,
    /writesRolledBack: true/u,
  );
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /resend\s+(?:emails|webhooks|domains)/iu);
});

test("final CI replay applies the correction only after both provider fences", () => {
  const finalBuildStart = ciWorkflow.indexOf(
    "name: Apply complete public SellerProfile chain for final Production build",
  );
  const finalBuildEnd = ciWorkflow.indexOf("name: Production build", finalBuildStart);
  assert.ok(finalBuildStart >= 0 && finalBuildEnd > finalBuildStart);
  const replay = ciWorkflow.slice(finalBuildStart, finalBuildEnd);

  const holdCorrection = replay.indexOf(
    'mv "prisma/migrations/$correction_migration" "$holding/migrations/$correction_migration"',
  );
  const restoreEligibility = replay.indexOf(
    '"$holding/migrations/$eligibility_migration" \\\n            "prisma/migrations/$eligibility_migration"',
  );
  const applyEligibility = replay.indexOf("npx prisma migrate deploy", restoreEligibility);
  const restoreCorrection = replay.indexOf(
    '"$holding/migrations/$correction_migration" \\\n            "prisma/migrations/$correction_migration"',
  );
  const applyCorrection = replay.indexOf("npx prisma migrate deploy", restoreCorrection);

  assert.ok(holdCorrection >= 0);
  assert.ok(holdCorrection < restoreEligibility);
  assert.ok(restoreEligibility < applyEligibility);
  assert.ok(applyEligibility < restoreCorrection);
  assert.ok(restoreCorrection < applyCorrection);
});
