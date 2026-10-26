import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  COLUMN_EXPECTATIONS,
  CONSTRAINT_EXPECTATIONS,
  CONSTRAINT_NAMES,
  FUNCTION_EXPECTATIONS,
  MIGRATION,
  MIGRATION_SHA256,
  NEXT_MIGRATION,
  NEXT_MIGRATION_SHA256,
  preparationMigrationLedgerState,
  preparationSourceFamily,
  verifyPreparationCatalog,
} from "../scripts/email-delivery-ledger-preparation-production-inspect.mjs";
import {
  REVIEWED_MANUALLY_APPLIED_MIGRATIONS,
  isReviewedSuccessfulMigration,
} from "../scripts/reviewed-manually-applied-migrations.mjs";

const workflowPath =
  ".github/workflows/email-delivery-ledger-preparation-production.yml";
const workflow = readFileSync(workflowPath, "utf8");
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const migrationPath =
  process.env.EMAIL_DELIVERY_LEDGER_PREPARATION_MIGRATION_PATH?.trim() ||
  `prisma/migrations/${MIGRATION}/migration.sql`;
const nextMigrationDirectory =
  process.env.EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_PATH?.trim() ||
  `prisma/migrations/${NEXT_MIGRATION}`;
const migrationSql = readFileSync(
  migrationPath,
  "utf8",
);
const nextMigrationSql = readFileSync(
  `${nextMigrationDirectory}/migration.sql`,
  "utf8",
);
const bindingScript = parsed.jobs.apply.steps.find(
  (step) =>
    step.name === "Bind release to exact main and every exact-main push workflow",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function extractedFunctionMd5(identity) {
  const name = identity.slice("public.".length, identity.indexOf("("));
  const start = migrationSql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${identity} source start is absent`);
  const match = migrationSql.slice(start).match(
    /\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*?)\1\s*;/u,
  );
  assert.ok(match, `${identity} source body is absent`);
  return createHash("md5").update(match[2]).digest("hex");
}

function exactPushRuns(releaseSha, { omitPath, failingPath } = {}) {
  return [
    [201, "CI", ".github/workflows/ci.yml"],
    [202, "Conversation and Message RLS FORCE Proof", ".github/workflows/conversation-message-force-proof.yml"],
    [203, "Notification RLS FORCE Proof", ".github/workflows/notification-rls-ephemeral-proof.yml"],
    [204, "Account Deletion Worker Bootstrap Proof", ".github/workflows/account-deletion-worker-bootstrap-proof.yml"],
    [205, "Order Staff Bootstrap Proof", ".github/workflows/order-staff-bootstrap-proof.yml"],
    [206, "Order Paid Repair Lock Proof", ".github/workflows/order-paid-repair-lock-proof.yml"],
    [207, "Order Account Deletion Concurrency Proof", ".github/workflows/order-account-deletion-concurrency-proof.yml"],
  ]
    .map(([id, name, path]) => ({
      id,
      name,
      path,
      event: "push",
      head_branch: "main",
      head_sha: releaseSha,
      status: "completed",
      conclusion: path === failingPath ? "failure" : "success",
    }))
    .filter((run) => run.path !== omitPath);
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
        getWorkflowRun: async () => ({
          data: {
            name: "CI",
            path: ".github/workflows/ci.yml",
            event: "push",
            head_branch: "main",
            head_sha: releaseSha,
            status: "completed",
            conclusion: "success",
          },
        }),
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
  const processStub = {
    env: {
      REVIEWED_RELEASE_COMMIT: releaseSha,
      REVIEWED_MAIN_CI_RUN_ID: "101",
    },
  };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    context,
    processStub,
  );
}

function functionRow(identity, exists) {
  const expected = FUNCTION_EXPECTATIONS.get(identity);
  if (!exists) {
    return {
      identity,
      function_exists: false,
      function_config: [],
      nonowner_acl: [],
    };
  }
  return {
    identity,
    function_exists: true,
    owner_name: "neondb_owner",
    owner_superuser: false,
    owner_bypass_rls: true,
    language_name: expected.language,
    function_kind: "f",
    security_definer: expected.securityDefiner,
    leakproof: false,
    volatility: expected.volatility,
    parallel_safety: expected.parallelSafety,
    function_config: ["search_path=pg_catalog"],
    source_md5: expected.sourceMd5,
    contains_dynamic_execute: false,
    runtime_execute: expected.runtimeExecute,
    public_execute: false,
    nonowner_acl: expected.runtimeExecute
      ? ["grainline_app_runtime:EXECUTE:false"]
      : [],
  };
}

function baseCatalog() {
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
    tables: [
      "EmailOutbox",
      "EmailSuppression",
      "NewsletterSubscriber",
      "ResendWebhookEvent",
    ].map((table_name) => ({
      table_name,
      owner_name: "neondb_owner",
      owner_superuser: false,
      owner_bypass_rls: true,
      rls_enabled: false,
      rls_forced: false,
    })),
    legacyColumns: ["html", "subject"].map((column_name) => ({
      column_name,
      not_null: true,
    })),
  };
}

function predecessorCatalog() {
  return {
    ...baseCatalog(),
    columns: [],
    constraints: [],
    index: {
      index_exists: false,
      valid: false,
      ready: false,
      definition: null,
    },
    functions: [...FUNCTION_EXPECTATIONS.keys()].map((identity) =>
      functionRow(identity, false)),
    inactiveMissingDeactivatedAt: null,
  };
}

function successorCatalog() {
  const catalog = baseCatalog();
  catalog.legacyColumns = catalog.legacyColumns.map((row) => ({
    ...row,
    not_null: false,
  }));
  return {
    ...catalog,
    columns: COLUMN_EXPECTATIONS.map(
      ([tableName, columnName, type_name, not_null, default_expression]) => ({
        identity: `${tableName}.${columnName}`,
        type_name,
        not_null,
        default_expression,
      }),
    ).sort((left, right) => left.identity.localeCompare(right.identity)),
    constraints: CONSTRAINT_NAMES.map((name) => ({
      name,
      validated: true,
      definition: CONSTRAINT_EXPECTATIONS.get(name),
    })),
    index: {
      index_exists: true,
      valid: true,
      ready: true,
      definition:
        'CREATE INDEX "EmailOutbox_status_lane_nextAttemptAt_createdAt_id_idx" ON public."EmailOutbox" USING btree (status, lane, "nextAttemptAt", "createdAt", id)',
    },
    functions: [...FUNCTION_EXPECTATIONS.keys()].map((identity) =>
      functionRow(identity, true)),
    inactiveMissingDeactivatedAt: 0,
  };
}

test("preparation production workflow is exact-main, serialized, and fail-closed", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.concurrency["cancel-in-progress"], false);
  assert.equal(parsed.jobs.apply.environment, "Production");
  assert.match(workflow, /apply-reviewed-email-delivery-ledger-preparation/u);
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/u,
  );
  assert.match(workflow, /name: Ensure sanitized preparation evidence exists\n\s+if: always\(\)/u);
  assert.match(workflow, /name: Preserve sanitized preparation evidence\n\s+if: always\(\)/u);
  assert.match(
    workflow,
    /tests\/email-service-delivery-ledger-postgres-proof\.test\.mjs/u,
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

test("release applies only preparation and leaves the deletion fence pending", () => {
  assert.equal(createHash("sha256").update(migrationSql).digest("hex"), MIGRATION_SHA256);
  assert.equal(
    createHash("sha256").update(nextMigrationSql).digest("hex"),
    NEXT_MIGRATION_SHA256,
  );
  for (const [identity, expected] of FUNCTION_EXPECTATIONS) {
    assert.equal(extractedFunctionMd5(identity), expected.sourceMd5);
  }
  assert.match(
    workflow,
    /REVIEWED_PENDING_MIGRATIONS="\$preparation,\$fence"/u,
  );
  assert.match(
    workflow,
    /REVIEWED_PENDING_MIGRATIONS: 20261025020000_fence_email_provider_and_account_deletion/u,
  );
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  const apply = workflow.indexOf(
    "name: Apply reviewed preparation transaction outside Prisma's ledger",
  );
  const resolve = workflow.indexOf(
    "name: Record the committed preparation in Prisma's ledger",
  );
  const postflight = workflow.indexOf(
    "name: Read back exact preparation schema, functions, ACLs, and ledger",
  );
  assert.ok(apply >= 0);
  assert.ok(resolve > apply);
  assert.ok(postflight > resolve);
  assert.match(workflow.slice(apply, resolve), /psql "\$DIRECT_URL"/u);
  assert.match(
    workflow.slice(resolve, postflight),
    /20261025010000_prepare_email_delivery_ledger/u,
  );
  assert.doesNotMatch(
    workflow.slice(resolve, postflight),
    /20261025020000_fence_email_provider_and_account_deletion/u,
  );
  assert.doesNotMatch(workflow, /vercel|redis|upstash|resend\.com/iu);
});

test("catalog verifier accepts only complete predecessor and successor families", () => {
  const before = predecessorCatalog();
  assert.equal(preparationSourceFamily(before), "predecessor");
  assert.equal(
    verifyPreparationCatalog(before, "pending").sourceFamily,
    "predecessor",
  );
  const after = successorCatalog();
  assert.equal(preparationSourceFamily(after), "successor");
  assert.equal(
    verifyPreparationCatalog(after, "applied").sourceFamily,
    "successor",
  );

  const mixed = structuredClone(after);
  mixed.functions[0] = functionRow(mixed.functions[0].identity, false);
  assert.throws(() => preparationSourceFamily(mixed));

  const unsafe = structuredClone(after);
  unsafe.functions[5].public_execute = true;
  assert.throws(() => verifyPreparationCatalog(unsafe, "applied"));

  const incompleteBackfill = structuredClone(after);
  incompleteBackfill.inactiveMissingDeactivatedAt = 1;
  assert.throws(() => verifyPreparationCatalog(incompleteBackfill, "applied"));

  const wrongDefault = structuredClone(after);
  wrongDefault.columns.find(
    (row) => row.identity === "EmailOutbox.claimGeneration",
  ).default_expression = "1";
  assert.throws(() => verifyPreparationCatalog(wrongDefault, "applied"));

  const wrongConstraint = structuredClone(after);
  wrongConstraint.constraints.find(
    (row) => row.name === "EmailOutbox_claimGeneration_chk",
  ).definition = 'CHECK ("claimGeneration" >= -1)';
  assert.throws(() => verifyPreparationCatalog(wrongConstraint, "applied"));
});

test("ledger state accepts the pinned manual resolution and no partial failures", () => {
  assert.equal(
    REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(MIGRATION),
    MIGRATION_SHA256,
  );
  const resolved = {
    migration_name: MIGRATION,
    checksum: MIGRATION_SHA256,
    finished_at: new Date("2026-10-26T00:00:00Z"),
    rolled_back_at: null,
    applied_steps_count: "0",
  };
  assert.equal(isReviewedSuccessfulMigration(resolved), true);
  assert.equal(preparationMigrationLedgerState([]), "pending");
  assert.equal(preparationMigrationLedgerState([resolved]), "applied");
  for (const row of [
    { ...resolved, checksum: "0".repeat(64) },
    { ...resolved, finished_at: null },
    { ...resolved, rolled_back_at: new Date("2026-10-26T00:01:00Z") },
    { ...resolved, applied_steps_count: "2" },
  ]) {
    assert.throws(() => preparationMigrationLedgerState([row]));
  }
});
