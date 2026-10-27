import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";

import {
  OWNER_TABLE_RLS_CONFIRMATION,
  ownerTableRlsActivation,
  verifyOwnerTableRlsPredecessor,
  verifyOwnerTableRlsActivationSource,
} from "../scripts/owner-table-rls-activation-catalog.mjs";
import {
  inspectOwnerTableRlsActivationProduction,
} from "../scripts/owner-table-rls-activation-production-inspect.mjs";

const releaseId = "saved_blog_post_v1";
const release = ownerTableRlsActivation(releaseId);
const verified = verifyOwnerTableRlsActivationSource(releaseId);
const cartReleaseId = "cart_cart_item_v1";
const cartRelease = ownerTableRlsActivation(cartReleaseId);
const cartVerified = verifyOwnerTableRlsActivationSource(cartReleaseId);
const workflow = readFileSync(
  ".github/workflows/owner-table-rls-activation-production.yml",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
const cartRollback = readFileSync(
  "docs/rls-drafts/cart-cartitem-activation-rollback.sql",
  "utf8",
);

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

function fakeClientClass({ active, unexpectedTableAclCount = 0 }) {
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
          noninternal_trigger_count: active ? 1 : 0,
          runtime_select: true,
          runtime_insert: true,
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
          finished_at: "2026-10-23T12:00:00.000Z",
          rolled_back_at: null,
          applied_steps_count: 1,
        }] : [] };
      }
      if (sql.includes("FROM pg_catalog.pg_policy AS policy")) {
        return { rows: active ? release.policies.map((policy) => ({
          name: policy.name,
          command: policy.command,
          permissive: true,
          role_oids: [20],
          using_expression: policy.command === "a"
            ? null
            : "(\"userId\" = NULLIF(current_setting('app.user_id'::text, true), ''::text))",
          check_expression: policy.command === "a"
            ? "(\"userId\" = NULLIF(current_setting('app.user_id'::text, true), ''::text))"
            : null,
        })) : [] };
      }
      if (sql.includes("trigger_state.tgfoid = procedure.oid")) {
        return { rows: [{
          function_name: release.guardFunction,
          identity_arguments: "",
          owner_name: "neondb_owner",
          owner_bypasses_rls: true,
          security_definer: true,
          volatility: "v",
          parallel_safety: "u",
          configuration: ["search_path=pg_catalog"],
          source: verified.guardFunctionSource,
          runtime_execute: false,
          public_execute: false,
          trigger_name: release.trigger,
          trigger_enabled: "O",
          trigger_internal: false,
        }] };
      }
      if (sql.includes("procedure.proname = ANY($1::text[])")) {
        return { rows: retainedRows };
      }
      if (sql.includes("FROM pg_catalog.pg_policy") && sql.includes("AS count")) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes("procedure.proname = $1")) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes("pg_catalog.format_type(attribute.atttypid")) {
        return { rows: [
          { name: "id", type: "text", nullable: false },
          { name: "userId", type: "text", nullable: false },
          { name: "blogPostId", type: "text", nullable: false },
          { name: "createdAt", type: "timestamp(3) without time zone", nullable: false },
        ] };
      }
      if (sql.includes("FROM pg_catalog.pg_index AS index_state")) {
        return { rows: [
          { name: "SavedBlogPost_blogPostId_idx", primary: false, unique: false, valid: true, partial: false, expression: false, columns: ["blogPostId"] },
          { name: "SavedBlogPost_pkey", primary: true, unique: true, valid: true, partial: false, expression: false, columns: ["id"] },
          { name: "SavedBlogPost_userId_blogPostId_key", primary: false, unique: true, valid: true, partial: false, expression: false, columns: ["userId", "blogPostId"] },
          { name: "SavedBlogPost_userId_idx", primary: false, unique: false, valid: true, partial: false, expression: false, columns: ["userId"] },
        ] };
      }
      if (sql.includes("constraint_state.contype = 'f'")) {
        return { rows: [
          {
            name: "SavedBlogPost_blogPostId_fkey",
            delete_action: "c",
            update_action: "c",
            referenced_table: '"BlogPost"',
            columns: ["blogPostId"],
            referenced_columns: ["id"],
          },
          {
            name: "SavedBlogPost_userId_fkey",
            delete_action: "c",
            update_action: "c",
            referenced_table: '"User"',
            columns: ["userId"],
            referenced_columns: ["id"],
          },
        ] };
      }
      if (sql.includes("WITH owner_counts AS")) {
        return { rows: [{
          total_rows: 4,
          distinct_users: 2,
          max_rows_per_user: 3,
          orphan_users: 0,
          orphan_posts: 0,
          unavailable_target_rows: 1,
        }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
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
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "c".repeat(40),
  };
}

test("catalog admits only the byte-sealed combined owner-policy activation", () => {
  assert.equal(verified.digest, release.migrationSha256);
  assert.equal(verified.retainedDigest, release.retainedFunctionMigrationSha256);
  assert.throws(
    () => verifyOwnerTableRlsActivationSource("unreviewed_release"),
    /release id is not reviewed/u,
  );
  const sql = readFileSync(verified.migrationPath, "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/u);
  assert.equal((sql.match(/\bCREATE POLICY\b/gu) ?? []).length, 3);
  assert.doesNotMatch(sql, /DROP (?:TABLE|COLUMN)/iu);
  assert.equal(
    verifyOwnerTableRlsPredecessor(
      releaseId,
      "dpl_9P14wnz14RfsVfaiALkUhR4eejph",
      "18bdcb7e59a435001e8a8c903606ff8b78819249",
    ),
    release,
  );
  assert.throws(
    () => verifyOwnerTableRlsPredecessor(
      releaseId,
      "dpl_B12345678901234567890123",
      "18bdcb7e59a435001e8a8c903606ff8b78819249",
    ),
    /predecessor deployment binding drifted/u,
  );
});

test("catalog admits the byte-sealed Cart and CartItem owner-policy group", () => {
  assert.equal(cartVerified.digest, cartRelease.migrationSha256);
  assert.deepEqual(cartRelease.tables, ["Cart", "CartItem"]);
  assert.equal(cartRelease.policies.length, 8);
  assert.equal(cartVerified.serviceFunctionSources.size, 2);
  const sql = readFileSync(cartVerified.migrationPath, "utf8");
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/gu) ?? []).length, 2);
  assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/gu) ?? []).length, 2);
  assert.equal((sql.match(/\bCREATE POLICY\b/gu) ?? []).length, 8);
  assert.doesNotMatch(sql, /DROP (?:TABLE|COLUMN)/iu);
  assert.equal((cartRollback.match(/NO FORCE ROW LEVEL SECURITY/gu) ?? []).length, 2);
  assert.doesNotMatch(cartRollback, /DISABLE ROW LEVEL SECURITY|DROP (?:TABLE|POLICY|FUNCTION)/iu);
  assert.equal(
    verifyOwnerTableRlsPredecessor(
      cartReleaseId,
      "dpl_CQzwxpZQzyxn4d9zHJy5o9JMN1Y1",
      "a0524648ec37b397d004e9b816eb933f55ab385a",
    ),
    cartRelease,
  );
});

test("inspector proves predecessor and active states without recording row data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "owner-table-rls-"));
  try {
    const preEnv = environment(directory, "preflight");
    const ready = await inspectOwnerTableRlsActivationProduction(
      preEnv,
      { Client: fakeClientClass({ active: false }) },
    );
    assert.equal(ready.state, "ready");
    assert.equal(ready.containsRowData, false);
    assert.equal(statSync(preEnv.OWNER_TABLE_RLS_EVIDENCE_PATH).mode & 0o777, 0o600);

    const postEnv = environment(
      directory,
      "postflight",
      preEnv.OWNER_TABLE_RLS_EVIDENCE_PATH,
    );
    const active = await inspectOwnerTableRlsActivationProduction(
      postEnv,
      { Client: fakeClientClass({ active: true }) },
    );
    assert.equal(active.state, "active");
    assert.equal(active.posture.rlsEnabled, true);
    assert.equal(active.posture.rlsForced, true);
    assert.equal(active.policies.length, 3);
    assert.equal(active.guard.triggerName, release.trigger);
    assert.equal(active.structure.indexes.length, 4);
    assert.equal(active.inventory.max_rows_per_user, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inspector rejects any unexpected direct table authority", async () => {
  const directory = mkdtempSync(join(tmpdir(), "owner-table-rls-acl-"));
  try {
    await assert.rejects(
      inspectOwnerTableRlsActivationProduction(
        environment(directory, "preflight"),
        { Client: fakeClientClass({ active: false, unexpectedTableAclCount: 1 }) },
      ),
      /table ACL drifted/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Production workflow is exact-bound, deployment-bound, and sole-pending", () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(workflow, new RegExp(OWNER_TABLE_RLS_CONFIRMATION, "u"));
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/u,
  );
  assert.deepEqual(parsed.on.workflow_dispatch.inputs.release_id.options, [
    "saved_blog_post_v1",
    "cart_cart_item_v1",
    "stock_notification_v1",
  ]);
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.ok(parsed.on.workflow_dispatch.inputs.superseded_app_deployment_id.required);
  assert.ok(parsed.on.workflow_dispatch.inputs.superseded_app_commit.required);
  assert.match(workflow, /REVIEWED_SUPERSEDED_DEPLOYMENT_ID/u);
  assert.match(workflow, /REVIEWED_SUPERSEDED_APP_COMMIT/u);
  assert.match(workflow, /supersededDeploymentId === deploymentId/u);
  assert.match(workflow, /predecessorComparison\.status !== 'ahead'/u);
  assert.match(workflow, /OWNER_TABLE_RLS_REVIEWED_PREDECESSOR_DEPLOYMENT_ID/u);
  assert.match(workflow, /compareCommits/u);
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'ready'/u);
  assert.match(workflow, /OWNER_TABLE_RLS_PHASE: postflight/u);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
});
