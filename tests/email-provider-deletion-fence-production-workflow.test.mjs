import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

import {
  FUNCTION_EXPECTATIONS,
  MIGRATION,
  MIGRATION_SHA256,
  REQUIRED_PREDECESSORS,
  fenceMigrationLedgerState,
  fenceSourceFamily,
  verifyFenceCatalog,
} from "../scripts/email-provider-deletion-fence-production-inspect.mjs";
import { isReviewedSuccessfulMigration } from "../scripts/reviewed-manually-applied-migrations.mjs";

const workflowPath =
  ".github/workflows/email-provider-deletion-fence-production.yml";
const workflow = readFileSync(workflowPath, "utf8");
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const migrationDirectory =
  process.env.EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_PATH?.trim() ||
  `prisma/migrations/${MIGRATION}`;
const migrationSql = readFileSync(
  `${migrationDirectory}/migration.sql`,
  "utf8",
);
const bindingScript = parsed.jobs.apply.steps.find(
  (step) =>
    step.name === "Bind release to exact main and every exact-main push workflow",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function extractedFunctionMd5(name) {
  const delimiter = `$${name}$`;
  const start = migrationSql.indexOf(`AS ${delimiter}`);
  assert.ok(start >= 0, `${name} source start is absent`);
  const bodyStart = start + `AS ${delimiter}`.length;
  const end = migrationSql.indexOf(`${delimiter};`, bodyStart);
  assert.ok(end > bodyStart, `${name} source end is absent`);
  return createHash("md5")
    .update(migrationSql.slice(bodyStart, end))
    .digest("hex");
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

function functionRow(identity, family) {
  const expected = FUNCTION_EXPECTATIONS.get(identity);
  const sourceMd5 =
    family === "successor"
      ? expected.successorMd5
      : expected.predecessorMd5;
  if (sourceMd5 === null) {
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
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: expected.securityDefiner,
    leakproof: false,
    volatility: expected.volatility,
    parallel_safety: "u",
    function_config: ["search_path=pg_catalog"],
    source_md5: sourceMd5,
    contains_dynamic_execute: false,
    runtime_execute: expected.runtimeExecute,
    public_execute: false,
    nonowner_acl: expected.runtimeExecute
      ? ["grainline_app_runtime:EXECUTE:false"]
      : [],
  };
}

function catalog(family) {
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
      owner_superuser: false,
      owner_bypass_rls: true,
      rls_enabled: false,
      rls_forced: false,
      required_column_count: 23,
    },
    functions: [...FUNCTION_EXPECTATIONS.keys()].map((identity) =>
      functionRow(identity, family),
    ),
    posture: {
      active_unresolved_source_count: family === "successor" ? 0 : 2,
      ambiguous_unresolved_source_count: family === "successor" ? 0 : 1,
    },
  };
}

test("production workflow is exact-main, serialized, fail-closed, and preserves evidence", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.concurrency["cancel-in-progress"], false);
  assert.equal(parsed.jobs.apply.environment, "Production");
  assert.match(workflow, /apply-reviewed-email-provider-deletion-fence/u);
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/u,
  );
  assert.match(workflow, /name: Preserve sanitized fence evidence\n\s+if: always\(\)/u);
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

test("release applies only the immutable latest fence and handles commit-before-ledger restart", () => {
  assert.equal(
    createHash("sha256").update(migrationSql).digest("hex"),
    MIGRATION_SHA256,
  );
  assert.deepEqual([...REQUIRED_PREDECESSORS], [[
    "20261025010000_prepare_email_delivery_ledger",
    "4d30e75337b9713bca643b4b4c5db1a247e913995448ea89e09929e4fba0405d",
  ]]);
  for (const [identity, expected] of FUNCTION_EXPECTATIONS) {
    const name = identity.slice("public.".length, identity.indexOf("("));
    assert.equal(extractedFunctionMd5(name), expected.successorMd5);
  }
  assert.match(workflow, new RegExp(MIGRATION_SHA256, "u"));
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  const apply = workflow.indexOf(
    "name: Apply reviewed fence transaction outside Prisma's ledger",
  );
  const resolve = workflow.indexOf(
    "name: Record the committed fence in Prisma's ledger",
  );
  const postflight = workflow.indexOf(
    "name: Read back exact functions, ACLs, data posture, and ledger",
  );
  assert.ok(apply >= 0);
  assert.ok(resolve > apply);
  assert.ok(postflight > resolve);
  assert.match(workflow.slice(apply, resolve), /psql "\$DIRECT_URL"/u);
  assert.match(workflow.slice(resolve, postflight), /applied_unrecorded/u);
});

test("catalog verifier accepts only complete predecessor or successor families", () => {
  const before = catalog("predecessor");
  assert.equal(fenceSourceFamily(before), "predecessor");
  assert.equal(verifyFenceCatalog(before, "pending").sourceFamily, "predecessor");
  const after = catalog("successor");
  assert.equal(fenceSourceFamily(after), "successor");
  assert.equal(verifyFenceCatalog(after, "applied").sourceFamily, "successor");

  const mixed = structuredClone(after);
  mixed.functions[0] = functionRow(mixed.functions[0].identity, "predecessor");
  assert.throws(() => fenceSourceFamily(mixed), /mixed or drifted/u);

  const unsafe = structuredClone(after);
  unsafe.functions[2].public_execute = true;
  assert.throws(() => verifyFenceCatalog(unsafe, "applied"));

  const unresolved = structuredClone(after);
  unresolved.posture.active_unresolved_source_count = 1;
  assert.throws(() => verifyFenceCatalog(unresolved, "applied"));
});

test("ledger state accepts only the exact migration and reviewed manual-resolution row", () => {
  const resolved = {
    migration_name: MIGRATION,
    checksum: MIGRATION_SHA256,
    finished_at: new Date("2026-10-25T00:00:00Z"),
    rolled_back_at: null,
    applied_steps_count: "0",
  };
  assert.equal(isReviewedSuccessfulMigration(resolved), true);
  assert.equal(fenceMigrationLedgerState([]), "pending");
  assert.equal(fenceMigrationLedgerState([resolved]), "applied");
  for (const row of [
    { ...resolved, checksum: "0".repeat(64) },
    { ...resolved, finished_at: null },
    { ...resolved, rolled_back_at: new Date("2026-10-25T00:01:00Z") },
    { ...resolved, applied_steps_count: "2" },
  ]) {
    assert.throws(() => fenceMigrationLedgerState([row]));
  }
});
