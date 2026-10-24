import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";

import {
  PRIVATE_TABLE_FORCE_CONFIRMATION,
  privateTableForce,
  verifyPrivateTableForceSource,
} from "../scripts/private-table-force-catalog.mjs";
import {
  inspectPrivateTableForceProduction,
} from "../scripts/private-table-force-production-inspect.mjs";
import {
  functionSourceFromMigration,
  verifyPrivateTablePreparationSource,
} from "../scripts/private-table-preparation-catalog.mjs";

const releaseId = "support_request_v1";
const release = privateTableForce(releaseId);
const verified = verifyPrivateTableForceSource(releaseId);
const preparation = verifyPrivateTablePreparationSource(
  release.enable.preparationReleaseId,
);
const correctionSql = readFileSync(
  verified.prerequisites[0].migrationPath,
  "utf8",
);
const reviewedSources = new Map(preparation.functionSources);
for (const entry of preparation.release.functions) {
  if (correctionSql.includes(`CREATE OR REPLACE FUNCTION public.${entry.name}(`)) {
    reviewedSources.set(entry.name, functionSourceFromMigration(correctionSql, entry.name));
  }
}
const workflow = readFileSync(
  ".github/workflows/private-table-force-production.yml",
  "utf8",
);
const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });

function acceptedMigration(entry, appliedStepsCount = 1) {
  return {
    migration_name: entry.migration,
    checksum: entry.migrationSha256,
    finished_at: "2026-10-23T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: appliedStepsCount,
  };
}

function fakeClientClass({ forced, nonOwnerTableAclCount = 0 }) {
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
          rls_enabled: true,
          rls_forced: forced,
          policy_count: 0,
          runtime_select: false,
          runtime_insert: false,
          runtime_update: false,
          runtime_delete: false,
          staff_select: false,
          public_select: false,
          non_owner_table_acl_count: nonOwnerTableAclCount,
          non_owner_column_acl_count: 0,
        }] };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        return { rows: [
          acceptedMigration(release.enable.preparation),
          acceptedMigration(release.enable),
          ...release.prerequisites.map((entry) => acceptedMigration(entry, 0)),
          ...(forced ? [acceptedMigration(release)] : []),
        ] };
      }
      if (sql.includes("procedure.prosrc AS source")) {
        return { rows: preparation.release.functions
          .map((entry) => ({
            function_name: entry.name,
            identity_arguments: entry.arguments,
            owner_name: "neondb_owner",
            owner_bypasses_rls: true,
            security_definer: true,
            configuration: ["search_path=pg_catalog"],
            source: reviewedSources.get(entry.name),
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
    PRIVATE_TABLE_FORCE_RELEASE_ID: releaseId,
    PRIVATE_TABLE_FORCE_PHASE: phase,
    PRIVATE_TABLE_FORCE_EVIDENCE_PATH: join(directory, `${phase}.json`),
    PRIVATE_TABLE_FORCE_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "c".repeat(40),
  };
}

test("catalog admits only the byte-sealed posture-only FORCE migration", () => {
  assert.equal(verified.digest, release.migrationSha256);
  assert.throws(
    () => verifyPrivateTableForceSource("unreviewed_release"),
    /release id is not reviewed/u,
  );
  const sql = readFileSync(verified.migrationPath, "utf8");
  assert.match(sql, /FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(sql, /NO FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(sql, /CREATE (?:POLICY|FUNCTION|TRIGGER)/iu);
  assert.doesNotMatch(sql, /DROP (?:TABLE|COLUMN|POLICY|FUNCTION|TRIGGER)/iu);
});

test("inspector proves ready and forced states without recording row data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-force-"));
  try {
    const readyEnv = environment(directory, "preflight");
    const ready = await inspectPrivateTableForceProduction(
      readyEnv,
      { Client: fakeClientClass({ forced: false }) },
    );
    assert.equal(ready.state, "ready");
    assert.equal(ready.containsRowData, false);
    assert.equal(statSync(readyEnv.PRIVATE_TABLE_FORCE_EVIDENCE_PATH).mode & 0o777, 0o600);

    const postEnv = environment(
      directory,
      "postflight",
      readyEnv.PRIVATE_TABLE_FORCE_EVIDENCE_PATH,
    );
    const forced = await inspectPrivateTableForceProduction(
      postEnv,
      { Client: fakeClientClass({ forced: true }) },
    );
    assert.equal(forced.state, "forced");
    assert.equal(forced.posture.rlsEnabled, true);
    assert.equal(forced.posture.rlsForced, true);
    assert.equal(forced.functions.length, 9);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inspector rejects any restored direct table authority", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-force-acl-"));
  try {
    await assert.rejects(
      inspectPrivateTableForceProduction(
        environment(directory, "preflight"),
        { Client: fakeClientClass({ forced: false, nonOwnerTableAclCount: 1 }) },
      ),
      /table ACL drifted/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Production workflow is exact-bound, restart-safe, and sole-pending", () => {
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/u,
  );
  assert.match(workflow, new RegExp(PRIVATE_TABLE_FORCE_CONFIRMATION, "u"));
  assert.match(workflow, /Private Table ENABLE Production/u);
  assert.match(workflow, /Support Request Email Reuse Privacy Production/u);
  assert.match(workflow, /compareCommits/u);
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'ready'/u);
  assert.match(workflow, /PRIVATE_TABLE_FORCE_PHASE: postflight/u);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
});
