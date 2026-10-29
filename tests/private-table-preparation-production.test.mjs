import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";

import {
  PRIVATE_TABLE_PREPARATION_CONFIRMATION,
  privateTablePreparation,
  verifyPrivateTablePreparationSource,
} from "../scripts/private-table-preparation-catalog.mjs";
import {
  REVIEWED_MANUALLY_APPLIED_MIGRATIONS,
  isReviewedSuccessfulMigration,
} from "../scripts/reviewed-manually-applied-migrations.mjs";
import {
  inspectPrivateTablePreparationProduction,
} from "../scripts/private-table-preparation-production-inspect.mjs";

const releaseId = "support_request_v1";
const release = privateTablePreparation(releaseId);
const verified = verifyPrivateTablePreparationSource(releaseId);
const workflow = readFileSync(
  ".github/workflows/private-table-preparation-production.yml",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const bindingScript = parsed.jobs.prepare.steps.find(
  (step) => step.name === "Bind preparation to exact main and every exact-main push workflow",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

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

async function runBinding(auxiliaryConclusion = "success") {
  const sha = "a".repeat(40);
  const listWorkflowRunsForRepo = () => {};
  const github = {
    rest: {
      repos: { getBranch: async () => ({ data: { commit: { sha } } }) },
      actions: {
        getWorkflowRun: async () => ({ data: {
          name: "CI",
          path: ".github/workflows/ci.yml",
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
      return exactPushRuns(sha, auxiliaryConclusion);
    },
  };
  await new AsyncFunction("github", "context", "process", bindingScript)(
    github,
    { sha, repo: { owner: "test", repo: "grainline" } },
    { env: { REVIEWED_RELEASE_COMMIT: sha, REVIEWED_MAIN_CI_RUN_ID: "101" } },
  );
}

function acceptedMigration() {
  return {
    migration_name: release.migration,
    checksum: release.migrationSha256,
    finished_at: "2026-10-23T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function fakeClientClass({ ledgerApplied, schemaApplied, partial = false }) {
  return class FakeClient {
    async connect() {}
    async end() {}

    async query(statement) {
      const sql = String(statement);
      if (/^(?:BEGIN|COMMIT|ROLLBACK)/u.test(sql.trim())) return { rows: [] };
      if (sql.includes("current_database() AS database_name")) {
        return { rows: [{
          database_name: "grainline",
          current_user_name: "neondb_owner",
          session_user_name: "neondb_owner",
          table_owner_name: "neondb_owner",
          owner_bypasses_rls: true,
          rls_enabled: false,
          rls_forced: false,
          table_acl: "{neondb_owner=arwdDxt/neondb_owner,grainline_app_runtime=arwd/neondb_owner}",
          policy_count: 0,
          runtime_select: true,
          runtime_insert: true,
          runtime_update: true,
          runtime_delete: true,
          staff_select: false,
          public_select: false,
        }] };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        return { rows: ledgerApplied ? [acceptedMigration()] : [] };
      }
      if (sql.includes("AS columns") && sql.includes("AS functions")) {
        return { rows: [{
          columns: schemaApplied ? release.addedColumns.length : 0,
          functions: schemaApplied
            ? release.functions.length - (partial ? 1 : 0)
            : 0,
        }] };
      }
      if (sql.includes("pg_catalog.format_type")) {
        return { rows: [{ name: "emailDeliveryToken", type: "uuid", nullable: true }] };
      }
      if (sql.includes("procedure.prosrc AS source")) {
        return { rows: release.functions
          .map((entry) => ({
            function_name: entry.name,
            identity_arguments: entry.arguments,
            owner_name: "neondb_owner",
            owner_bypasses_rls: true,
            security_definer: true,
            configuration: ["search_path=pg_catalog"],
            source: verified.functionSources.get(entry.name),
            runtime_execute: true,
            staff_execute: false,
            public_execute: false,
          }))
          .sort((left, right) => (
            left.function_name.localeCompare(right.function_name)
            || left.identity_arguments.localeCompare(right.identity_arguments)
          )) };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 100)}`);
    }
  };
}

function environment(directory, phase, previousPath) {
  return {
    DIRECT_URL: "postgresql://example.invalid/grainline",
    PRIVATE_TABLE_PREPARATION_RELEASE_ID: releaseId,
    PRIVATE_TABLE_PREPARATION_PHASE: phase,
    PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(directory, `${phase}.json`),
    PRIVATE_TABLE_PREPARATION_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "a".repeat(40),
  };
}

test("catalog admits only byte-sealed, additive reviewed preparations", () => {
  assert.equal(verified.digest, release.migrationSha256);
  assert.equal(verified.functionSources.size, 9);
  assert.equal(
    verifyPrivateTablePreparationSource(
      releaseId,
      process.cwd(),
      verified.migrationPath,
    ).digest,
    release.migrationSha256,
  );
  assert.throws(
    () => verifyPrivateTablePreparationSource("unreviewed_release"),
    /release id is not reviewed/u,
  );
  const sql = readFileSync(verified.migrationPath, "utf8");
  assert.doesNotMatch(sql, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/iu);
  assert.doesNotMatch(sql, /FORCE\s+ROW\s+LEVEL\s+SECURITY/iu);
  assert.doesNotMatch(sql, /DROP\s+COLUMN/iu);
});

test("Favorite preparation is byte-sealed and remains compatible", () => {
  const favorite = verifyPrivateTablePreparationSource("favorite_v1");
  assert.equal(favorite.release.table, "Favorite");
  assert.equal(favorite.functionSources.size, 8);
  assert.deepEqual(favorite.release.addedColumns, []);
  const sql = readFileSync(favorite.migrationPath, "utf8");
  assert.match(sql, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(sql, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(sql, /ADD COLUMN "favoriteCount" integer NOT NULL DEFAULT 0/u);
  assert.match(sql, /Favorite_count_after_insert/u);
  assert.match(sql, /Favorite_update_forbidden/u);
  assert.doesNotMatch(sql, /grainline_favorite_block_cleanup/u);
  assert.ok(
    sql.indexOf('LOCK TABLE public."Listing" IN SHARE ROW EXCLUSIVE MODE')
      < sql.indexOf('LOCK TABLE public."Favorite" IN SHARE ROW EXCLUSIVE MODE'),
    "Favorite preparation must follow the predecessor listing-delete lock order",
  );
  assert.doesNotMatch(sql, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/iu);
  assert.doesNotMatch(sql, /FORCE\s+ROW\s+LEVEL\s+SECURITY/iu);
  assert.doesNotMatch(sql, /REVOKE[\s\S]{0,500}\bON\s+TABLE/iu);
});

test("inspector proves pending and applied states without recording row data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-preparation-"));
  try {
    const pendingEnv = environment(directory, "preflight");
    const pending = await inspectPrivateTablePreparationProduction(
      pendingEnv,
      { Client: fakeClientClass({ ledgerApplied: false, schemaApplied: false }) },
    );
    assert.equal(pending.state, "pending");
    assert.equal(pending.containsRowData, false);
    assert.equal(statSync(pendingEnv.PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH).mode & 0o777, 0o600);

    const preAppliedEnv = {
      ...environment(directory, "preflight"),
      PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(directory, "applied-preflight.json"),
    };
    const preApplied = await inspectPrivateTablePreparationProduction(
      preAppliedEnv,
      { Client: fakeClientClass({ ledgerApplied: true, schemaApplied: true }) },
    );
    assert.equal(preApplied.state, "applied");
    assert.equal(preApplied.catalog.functions.length, 9);

    const postEnv = environment(
      directory,
      "postflight",
      preAppliedEnv.PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH,
    );
    const post = await inspectPrivateTablePreparationProduction(
      postEnv,
      { Client: fakeClientClass({ ledgerApplied: true, schemaApplied: true }) },
    );
    assert.equal(post.state, "applied");
    assert.deepEqual(post.posture, preApplied.posture);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inspector admits only an exact applied-but-unrecorded preparation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-preparation-restart-"));
  try {
    const restartEnv = environment(directory, "preflight");
    const restart = await inspectPrivateTablePreparationProduction(
      restartEnv,
      { Client: fakeClientClass({ ledgerApplied: false, schemaApplied: true }) },
    );
    assert.equal(restart.state, "applied_unrecorded");
    assert.equal(restart.catalog.functions.length, release.functions.length);

    await assert.rejects(
      inspectPrivateTablePreparationProduction(
        {
          ...environment(directory, "preflight"),
          PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH: join(directory, "partial.json"),
        },
        {
          Client: fakeClientClass({
            ledgerApplied: false,
            schemaApplied: true,
            partial: true,
          }),
        },
      ),
      /partially applied/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("all generic preparation releases admit only their exact manual ledger row", () => {
  for (const releaseId of [
    "support_request_v1",
    "stock_notification_v1",
    "favorite_v1",
  ]) {
    const candidate = privateTablePreparation(releaseId);
    assert.equal(
      REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(candidate.migration),
      candidate.migrationSha256,
    );
    assert.equal(isReviewedSuccessfulMigration({
      migration_name: candidate.migration,
      checksum: candidate.migrationSha256,
      finished_at: new Date("2026-10-28T00:00:00Z"),
      rolled_back_at: null,
      applied_steps_count: 0,
    }), true);
  }
});

test("Production workflow is exact-main bound and fails on another red push workflow", async () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.deepEqual(
    parsed.on.workflow_dispatch.inputs.release_id.options,
    ["support_request_v1", "stock_notification_v1", "favorite_v1"],
  );
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(workflow, new RegExp(PRIVATE_TABLE_PREPARATION_CONFIRMATION, "u"));
  assert.match(workflow, /private-table-preparation-catalog\.mjs --tests/u);
  assert.match(workflow, /tests\/stock-notification-preparation-production\.test\.mjs/u);
  await assert.doesNotReject(runBinding());
  await assert.rejects(runBinding("failure"), /push workflows are not all green/u);
});

test("Production workflow keeps preparation additive, restart-safe, and sole-pending", () => {
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.doesNotMatch(workflow, /npx prisma migrate deploy/u);
  assert.match(workflow, /psql "\$DIRECT_URL"/u);
  assert.match(workflow, /npx prisma migrate resolve --applied "\$migration"/u);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'pending'/u);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'applied_unrecorded'/u);
  assert.match(workflow, /PRIVATE_TABLE_PREPARATION_PHASE: postflight/u);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  const sourceCheck = workflow.indexOf("Verify reviewed preparation source before owner access");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Inspect restart-safe preparation state");
  const apply = workflow.indexOf("Apply reviewed preparation transaction outside Prisma's ledger");
  const record = workflow.indexOf("Record the committed preparation in Prisma's ledger");
  const postflight = workflow.indexOf("Read back exact compatible preparation catalog");
  assert.ok(sourceCheck >= 0 && sourceCheck < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < record && record < postflight);
});
