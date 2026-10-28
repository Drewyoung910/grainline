import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OWNER_TABLE_RLS_ACTIVATIONS,
  OWNER_TABLE_RLS_CONFIRMATION,
  verifyOwnerTableRlsActivationSource,
  verifyOwnerTableRlsPredecessor,
} from "../scripts/owner-table-rls-activation-catalog.mjs";
import {
  inspectStockNotificationRlsActivationProduction,
} from "../scripts/stock-notification-rls-production-inspect.mjs";

const releaseId = "stock_notification_v1";
const release = OWNER_TABLE_RLS_ACTIVATIONS[releaseId];
const verified = verifyOwnerTableRlsActivationSource(releaseId);
const migration = readFileSync(verified.migrationPath, "utf8");
const rollback = readFileSync(
  "docs/rls-drafts/stock-notification-activation-rollback.sql",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/owner-table-rls-activation-production.yml",
  "utf8",
);
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

const retainedRows = release.retainedFunctions.map((entry) => ({
  function_name: entry.name,
  identity_arguments: entry.arguments,
  owner_name: "neondb_owner",
  owner_bypasses_rls: true,
  security_definer: true,
  configuration: ["search_path=pg_catalog"],
  source: verified.retainedFunctionSources.get(entry.name),
  runtime_execute: true,
  public_execute: false,
}));

function fakeClientClass({
  active,
  policyExpression = release.policies[0].usingExpression,
  unexpectedTableAclCount = 0,
}) {
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
          table_owner_oid: 10,
          table_owner_name: "neondb_owner",
          owner_bypasses_rls: true,
          runtime_oid: 20,
          runtime_superuser: false,
          runtime_create_database: false,
          runtime_create_role: false,
          runtime_inherit: false,
          runtime_replication: false,
          runtime_bypass_rls: false,
          runtime_membership_count: 0,
          rls_enabled: active,
          rls_forced: active,
          policy_count: active ? 2 : 0,
          trigger_count: 0,
          runtime_select: true,
          runtime_insert: !active,
          runtime_update: !active,
          runtime_delete: true,
          runtime_truncate: false,
          runtime_references: false,
          runtime_trigger: false,
          staff_select: false,
          public_select: false,
          unexpected_table_acl_count: unexpectedTableAclCount,
          column_acl_count: 0,
        }] };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        return { rows: active ? [{
          migration_name: release.migration,
          checksum: release.migrationSha256,
          finished_at: "2026-10-27T12:00:00.000Z",
          rolled_back_at: null,
          applied_steps_count: 1,
        }] : [] };
      }
      if (sql.includes("pg_catalog.format_type(attribute.atttypid")) {
        return { rows: [
          { name: "id", type: "text", nullable: false },
          { name: "listingId", type: "text", nullable: false },
          { name: "userId", type: "text", nullable: false },
          {
            name: "createdAt",
            type: "timestamp(3) without time zone",
            nullable: false,
          },
        ] };
      }
      if (sql.includes("FROM pg_catalog.pg_index AS index_state")) {
        return { rows: [
          { name: "StockNotification_listingId_idx", primary: false, unique: false, valid: true, ready: true, partial: false, expression: false, no_includes: true, columns: ["listingId"] },
          { name: "StockNotification_listingId_userId_key", primary: false, unique: true, valid: true, ready: true, partial: false, expression: false, no_includes: true, columns: ["listingId", "userId"] },
          { name: "StockNotification_pkey", primary: true, unique: true, valid: true, ready: true, partial: false, expression: false, no_includes: true, columns: ["id"] },
          { name: "StockNotification_userId_idx", primary: false, unique: false, valid: true, ready: true, partial: false, expression: false, no_includes: true, columns: ["userId"] },
        ] };
      }
      if (sql.includes("constraint_state.contype = 'f'")) {
        return { rows: [
          {
            name: "StockNotification_listingId_fkey",
            delete_action: "c",
            update_action: "c",
            referenced_table: '"Listing"',
            valid: true,
            columns: ["listingId"],
            referenced_columns: ["id"],
          },
          {
            name: "StockNotification_userId_fkey",
            delete_action: "c",
            update_action: "c",
            referenced_table: '"User"',
            valid: true,
            columns: ["userId"],
            referenced_columns: ["id"],
          },
        ] };
      }
      if (sql.includes("procedure.proname = ANY($1::text[])")) {
        return { rows: retainedRows };
      }
      if (sql.includes("FROM pg_catalog.pg_policy AS policy")) {
        return { rows: active ? release.policies.map((policy) => ({
          name: policy.name,
          command: policy.command,
          permissive: true,
          role_oids: [20],
          using_expression: policyExpression,
          check_expression: null,
        })) : [] };
      }
      if (sql.includes("AS self_subscriptions")) {
        return { rows: [{
          total_rows: 4,
          self_subscriptions: 0,
          orphaned_rows: 0,
        }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 140)}`);
    }
  };
}

function environment(directory, phase, previousPath) {
  return {
    DIRECT_URL: "postgresql://example.invalid/grainline",
    OWNER_TABLE_RLS_RELEASE_ID: releaseId,
    OWNER_TABLE_RLS_PHASE: phase,
    OWNER_TABLE_RLS_EVIDENCE_PATH: join(directory, `${phase}.json`),
    OWNER_TABLE_RLS_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "e".repeat(40),
  };
}

test("StockNotification activation is the byte-sealed owner SELECT/DELETE shape", () => {
  assert.equal(release.shape, "stock_notification");
  assert.equal(
    release.minimumCompatibleAppCommit,
    "e57362b515f41f0f72d7d483dc79a651de6bb711",
  );
  assert.equal(verified.digest, release.migrationSha256);
  assert.equal(verified.retainedDigest, release.retainedFunctionMigrationSha256);
  assert.equal(verified.retainedFunctionSources.size, 9);
  assert.deepEqual(release.policies, [
    {
      name: "stock_notification_owner_delete",
      command: "d",
      usingExpression:
        '("userId" = NULLIF(current_setting(\'app.user_id\'::text, true), \'\'::text))',
    },
    {
      name: "stock_notification_owner_select",
      command: "r",
      usingExpression:
        '("userId" = NULLIF(current_setting(\'app.user_id\'::text, true), \'\'::text))',
    },
  ]);
  assert.equal((migration.match(/ENABLE ROW LEVEL SECURITY/gu) ?? []).length, 1);
  assert.equal((migration.match(/FORCE ROW LEVEL SECURITY/gu) ?? []).length, 1);
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 2);
  assert.match(
    migration,
    /GRANT SELECT, DELETE ON TABLE public\."StockNotification"/u,
  );
  assert.doesNotMatch(
    migration,
    /GRANT (?:INSERT|UPDATE)[\s\S]{0,120}public\."StockNotification"/iu,
  );
  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN)/iu);
});

test("StockNotification release CLI exposes only the reviewed compatibility floor", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/owner-table-rls-activation-catalog.mjs",
      "--minimum-compatible-app-commit",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OWNER_TABLE_RLS_RELEASE_ID: releaseId,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim(), release.minimumCompatibleAppCommit);
});

test("StockNotification rollback restores the exact predecessor before disabling RLS", () => {
  const grant = rollback.indexOf(
    'GRANT INSERT, UPDATE ON TABLE public."StockNotification"',
  );
  const disable = rollback.indexOf(
    'ALTER TABLE public."StockNotification" DISABLE ROW LEVEL SECURITY',
  );
  assert.ok(grant >= 0 && disable > grant, "rollback must restore grants first");
  assert.match(rollback, /DROP POLICY stock_notification_owner_select/u);
  assert.match(rollback, /DROP POLICY stock_notification_owner_delete/u);
  assert.match(
    rollback,
    /migrate resolve --rolled-back 20261027040000_activate_stock_notification_rls/u,
  );
  assert.doesNotMatch(rollback, /DROP (?:TABLE|COLUMN)/iu);
});

test("generic release path includes StockNotification and remains exact-bound", () => {
  assert.match(workflow, /- stock_notification_v1/u);
  assert.match(workflow, new RegExp(OWNER_TABLE_RLS_CONFIRMATION, "u"));
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.match(workflow, /stock-notification-route\.test\.mjs/u);
  assert.match(workflow, /stock-notification-state\.test\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(
    release.predecessorDeploymentId,
    /^dpl_[A-Za-z0-9]{20,64}$/u,
    "candidate must remain production-inadmissible until the predecessor is bound",
  );
  assert.equal(
    verifyOwnerTableRlsPredecessor(
      releaseId,
      release.predecessorDeploymentId,
      release.predecessorSourceCommit,
    ),
    release,
  );
});

test("runtime provisioning preserves the activated StockNotification boundary", () => {
  assert.match(
    provisioning,
    /StockNotification keeps direct owner SELECT\/DELETE after activation/u,
  );
  assert.match(
    provisioning,
    /stock_notification_owner_delete:d[\s\S]*stock_notification_owner_select:r/u,
  );
  assert.match(
    provisioning,
    /GRANT SELECT, DELETE ON TABLE public\."StockNotification"/u,
  );
  assert.match(
    provisioning,
    /pg_get_expr\(policy\.polqual, policy\.polrelid\)[\s\S]*app\.user_id/u,
  );
});

test("StockNotification inspector proves ready and active states without row data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stock-notification-rls-"));
  try {
    const preEnv = environment(directory, "preflight");
    const ready = await inspectStockNotificationRlsActivationProduction(
      preEnv,
      { Client: fakeClientClass({ active: false }) },
    );
    assert.equal(ready.state, "ready");
    assert.equal(ready.containsRowData, false);
    assert.equal(ready.retainedFunctions.length, 9);
    assert.equal(statSync(preEnv.OWNER_TABLE_RLS_EVIDENCE_PATH).mode & 0o777, 0o600);

    const postEnv = environment(
      directory,
      "postflight",
      preEnv.OWNER_TABLE_RLS_EVIDENCE_PATH,
    );
    const active = await inspectStockNotificationRlsActivationProduction(
      postEnv,
      { Client: fakeClientClass({ active: true }) },
    );
    assert.equal(active.state, "active");
    assert.equal(active.posture.rlsEnabled, true);
    assert.equal(active.posture.runtimeInsert, false);
    assert.equal(active.policies.length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("StockNotification inspector rejects a drifted owner predicate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stock-notification-rls-drift-"));
  try {
    await assert.rejects(
      inspectStockNotificationRlsActivationProduction(
        environment(directory, "preflight"),
        {
          Client: fakeClientClass({
            active: true,
            policyExpression: "true",
          }),
        },
      ),
      /owner expression drifted/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("StockNotification inspector rejects unexpected direct authority", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stock-notification-rls-acl-"));
  try {
    await assert.rejects(
      inspectStockNotificationRlsActivationProduction(
        environment(directory, "preflight"),
        {
          Client: fakeClientClass({
            active: true,
            unexpectedTableAclCount: 1,
          }),
        },
      ),
      /table ACL drifted/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
