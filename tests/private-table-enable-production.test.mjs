import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";

import {
  PRIVATE_TABLE_ENABLE_CONFIRMATION,
  privateTableEnable,
  verifyPrivateTableEnableSqlShape,
  verifyPrivateTableEnableSource,
} from "../scripts/private-table-enable-catalog.mjs";
import {
  inspectPrivateTableEnableProduction,
} from "../scripts/private-table-enable-production-inspect.mjs";
import {
  verifyPrivateTablePreparationSource,
} from "../scripts/private-table-preparation-catalog.mjs";

const releaseId = "support_request_v1";
const release = privateTableEnable(releaseId);
const verified = verifyPrivateTableEnableSource(releaseId);
const preparation = verifyPrivateTablePreparationSource(release.preparationReleaseId);
const workflow = readFileSync(
  ".github/workflows/private-table-enable-production.yml",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });

function acceptedMigration(name, checksum) {
  return {
    migration_name: name,
    checksum,
    finished_at: "2026-10-23T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function fakeClientClass({ enabled, nonOwnerTableAclCount = enabled ? 0 : 4 }) {
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
          rls_enabled: enabled,
          rls_forced: false,
          policy_count: 0,
          runtime_select: !enabled,
          runtime_insert: !enabled,
          runtime_update: !enabled,
          runtime_delete: !enabled,
          staff_select: false,
          public_select: false,
          runtime_any_column: !enabled,
          staff_any_column: false,
          non_owner_table_acl_count: nonOwnerTableAclCount,
          non_owner_column_acl_count: 0,
        }] };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        return { rows: [
          acceptedMigration(
            release.preparation.migration,
            release.preparation.migrationSha256,
          ),
          ...(enabled ? [acceptedMigration(release.migration, release.migrationSha256)] : []),
        ] };
      }
      if (sql.includes("procedure.prosrc AS source")) {
        return { rows: release.preparation.functions
          .map((entry) => ({
            function_name: entry.name,
            identity_arguments: entry.arguments,
            owner_name: "neondb_owner",
            owner_bypasses_rls: true,
            security_definer: true,
            configuration: ["search_path=pg_catalog"],
            source: preparation.functionSources.get(entry.name),
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
    PRIVATE_TABLE_ENABLE_RELEASE_ID: releaseId,
    PRIVATE_TABLE_ENABLE_PHASE: phase,
    PRIVATE_TABLE_ENABLE_EVIDENCE_PATH: join(directory, `${phase}.json`),
    PRIVATE_TABLE_ENABLE_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "b".repeat(40),
  };
}

test("catalog admits only the byte-sealed policyless ENABLE migration", () => {
  assert.equal(verified.digest, release.migrationSha256);
  assert.throws(
    () => verifyPrivateTableEnableSource("unreviewed_release"),
    /release id is not reviewed/u,
  );
  const sql = readFileSync(verified.migrationPath, "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /NO FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(sql, /CREATE POLICY/iu);
  assert.doesNotMatch(sql, /DROP (?:TABLE|COLUMN|FUNCTION)/iu);
});

test("catalog derives the reviewed ENABLE shape from each table entry", () => {
  const syntheticRelease = Object.freeze({ table: "SyntheticPrivateRecord" });
  const sql = `
    ALTER TABLE public."SyntheticPrivateRecord" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."SyntheticPrivateRecord" NO FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public."SyntheticPrivateRecord" FROM grainline_app_runtime;
  `;

  assert.doesNotThrow(() => verifyPrivateTableEnableSqlShape(sql, syntheticRelease));
  assert.throws(
    () => verifyPrivateTableEnableSqlShape(
      sql.replaceAll("SyntheticPrivateRecord", "SupportRequest"),
      syntheticRelease,
    ),
    /migration is not the reviewed policyless ENABLE shape/u,
  );
  assert.throws(
    () => verifyPrivateTableEnableSqlShape(sql, { table: 'SyntheticPrivateRecord".*' }),
    /reviewed table name is invalid/u,
  );
});

test("inspector proves ready and enabled states without recording row data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-enable-"));
  try {
    const readyEnv = environment(directory, "preflight");
    const ready = await inspectPrivateTableEnableProduction(
      readyEnv,
      { Client: fakeClientClass({ enabled: false }) },
    );
    assert.equal(ready.state, "ready");
    assert.equal(ready.containsRowData, false);
    assert.equal(statSync(readyEnv.PRIVATE_TABLE_ENABLE_EVIDENCE_PATH).mode & 0o777, 0o600);

    const postEnv = environment(
      directory,
      "postflight",
      readyEnv.PRIVATE_TABLE_ENABLE_EVIDENCE_PATH,
    );
    const enabled = await inspectPrivateTableEnableProduction(
      postEnv,
      { Client: fakeClientClass({ enabled: true }) },
    );
    assert.equal(enabled.state, "enabled");
    assert.equal(enabled.posture.rlsEnabled, true);
    assert.equal(enabled.posture.runtimeSelect, false);
    assert.equal(enabled.functions.length, 9);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inspector rejects extra predecessor table authority before ENABLE", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-enable-acl-"));
  try {
    const env = environment(directory, "preflight");
    await assert.rejects(
      inspectPrivateTableEnableProduction(
        env,
        { Client: fakeClientClass({ enabled: false, nonOwnerTableAclCount: 5 }) },
      ),
      /table ACL drifted before ENABLE/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Production workflow is exact-bound, restart-safe, and sole-pending", () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(workflow, new RegExp(PRIVATE_TABLE_ENABLE_CONFIRMATION, "u"));
  assert.match(workflow, /Private Table Preparation Production/u);
  assert.match(workflow, /compareCommits/u);
  assert.match(workflow, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'ready'/u);
  assert.match(workflow, /PRIVATE_TABLE_ENABLE_PHASE: postflight/u);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
});
