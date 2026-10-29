import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  privateTableRlsActivation,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";
import {
  inspectPrivateTableRlsActivationProduction,
} from "../scripts/private-table-rls-activation-production-inspect.mjs";
import {
  isReviewedSuccessfulMigration,
  REVIEWED_MANUALLY_APPLIED_MIGRATIONS,
} from "../scripts/reviewed-manually-applied-migrations.mjs";

const releaseId = "maker_verification_v1";
const release = privateTableRlsActivation(releaseId);
const verified = verifyPrivateTableRlsActivationSource(releaseId);

function migrationRow(entry, appliedStepsCount = 1) {
  return {
    migration_name: entry.migration,
    checksum: entry.migrationSha256,
    finished_at: "2026-10-28T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: appliedStepsCount,
  };
}

function tableRow(active, overrides = {}) {
  return {
    database_name: "grainline",
    current_user_name: "neondb_owner",
    session_user_name: "neondb_owner",
    table_owner_name: "neondb_owner",
    owner_bypasses_rls: true,
    rls_enabled: active,
    rls_forced: active,
    policy_count: 0,
    runtime_select: !active,
    runtime_insert: !active,
    runtime_update: !active,
    runtime_delete: !active,
    runtime_truncate: false,
    runtime_references: false,
    runtime_trigger: false,
    staff_select: false,
    staff_insert: false,
    staff_update: false,
    staff_delete: false,
    staff_truncate: false,
    staff_references: false,
    staff_trigger: false,
    public_select: false,
    public_insert: false,
    public_update: false,
    public_delete: false,
    public_truncate: false,
    public_references: false,
    public_trigger: false,
    runtime_any_column: !active,
    staff_any_column: false,
    public_any_column: false,
    non_owner_table_acl_count: active ? 0 : 4,
    non_owner_column_acl_count: 0,
    ...overrides,
  };
}

function roleRows() {
  return ["grainline_app_runtime", "grainline_staff_read_runtime"].map((rolname) => ({
    rolname,
    rolsuper: false,
    rolinherit: false,
    rolcanlogin: true,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
  }));
}

function functionRows() {
  return release.preparation.functions
    .map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.arguments,
      owner_name: "neondb_owner",
      owner_bypasses_rls: true,
      security_definer: true,
      configuration: ["search_path=pg_catalog"],
      source: verified.preparation.functionSources.get(entry.name),
      runtime_execute: entry.executeRole !== "staff",
      staff_execute: entry.executeRole === "staff",
      public_execute: false,
    }))
    .sort((left, right) => (
      left.function_name.localeCompare(right.function_name)
      || left.identity_arguments.localeCompare(right.identity_arguments)
    ));
}

function fakeClientClass({
  active,
  recorded = active,
  tableOverrides = {},
  roleOverrides = {},
}) {
  return class FakeClient {
    async connect() {}
    async end() {}

    async query(statement) {
      const sql = String(statement);
      if (/^(?:BEGIN|COMMIT|ROLLBACK)/u.test(sql.trim())) return { rows: [] };
      if (sql.includes("current_database() AS database_name")) {
        return { rows: [tableRow(active, tableOverrides)] };
      }
      if (sql.includes("rolname, rolsuper, rolinherit")) {
        return {
          rows: roleRows().map((row) => (
            row.rolname === roleOverrides.rolname
              ? { ...row, ...roleOverrides }
              : row
          )),
        };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        return {
          rows: recorded
            ? [migrationRow(release.preparation), migrationRow(release, 0)]
            : [migrationRow(release.preparation)],
        };
      }
      if (sql.includes("procedure.prosrc AS source")) {
        return { rows: functionRows() };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
    }
  };
}

function environment(directory, phase, previousPath) {
  return {
    DIRECT_URL: "postgresql://example.invalid/grainline",
    PRIVATE_TABLE_RLS_ACTIVATION_RELEASE_ID: releaseId,
    PRIVATE_TABLE_RLS_ACTIVATION_PHASE: phase,
    PRIVATE_TABLE_RLS_ACTIVATION_EVIDENCE_PATH: join(directory, `${phase}.json`),
    PRIVATE_TABLE_RLS_ACTIVATION_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "a".repeat(40),
  };
}

test("inspector proves ready and active states without row data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-rls-activation-"));
  try {
    const preEnv = environment(directory, "preflight");
    const ready = await inspectPrivateTableRlsActivationProduction(
      preEnv,
      { Client: fakeClientClass({ active: false }) },
    );
    assert.equal(ready.state, "ready");
    assert.equal(ready.containsRowData, false);
    assert.equal(ready.posture.runtimeSelect, true);
    assert.equal(ready.posture.rlsEnabled, false);
    assert.equal(statSync(preEnv.PRIVATE_TABLE_RLS_ACTIVATION_EVIDENCE_PATH).mode & 0o777, 0o600);

    const postEnv = environment(
      directory,
      "postflight",
      preEnv.PRIVATE_TABLE_RLS_ACTIVATION_EVIDENCE_PATH,
    );
    const active = await inspectPrivateTableRlsActivationProduction(
      postEnv,
      { Client: fakeClientClass({ active: true }) },
    );
    assert.equal(active.state, "active");
    assert.equal(active.posture.rlsEnabled, true);
    assert.equal(active.posture.rlsForced, true);
    assert.equal(active.posture.policyCount, 0);
    assert.equal(active.posture.nonOwnerTableAclCount, 0);
    assert.equal(active.functions.length, 13);
    assert.equal(active.functions.filter((entry) => entry.staffExecute).length, 7);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inspector rejects partial activation and elevated runtime roles", async () => {
  const firstDirectory = mkdtempSync(join(tmpdir(), "private-table-rls-partial-"));
  const secondDirectory = mkdtempSync(join(tmpdir(), "private-table-rls-role-"));
  try {
    await assert.rejects(
      inspectPrivateTableRlsActivationProduction(
        environment(firstDirectory, "preflight"),
        {
          Client: fakeClientClass({
            active: true,
            tableOverrides: { rls_forced: false },
          }),
        },
      ),
      /RLS is not forced/u,
    );
    await assert.rejects(
      inspectPrivateTableRlsActivationProduction(
        environment(secondDirectory, "preflight"),
        {
          Client: fakeClientClass({
            active: false,
            roleOverrides: {
              rolname: "grainline_app_runtime",
              rolinherit: true,
            },
          }),
        },
      ),
      /grainline_app_runtime inherits privileges/u,
    );
  } finally {
    rmSync(firstDirectory, { recursive: true, force: true });
    rmSync(secondDirectory, { recursive: true, force: true });
  }
});

test("inspector detects committed activation before Prisma ledger recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-rls-unrecorded-"));
  try {
    const evidence = await inspectPrivateTableRlsActivationProduction(
      environment(directory, "preflight"),
      { Client: fakeClientClass({ active: true, recorded: false }) },
    );
    assert.equal(evidence.state, "active_unrecorded");
    assert.equal(
      REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(release.migration),
      release.migrationSha256,
    );
    assert.equal(isReviewedSuccessfulMigration(migrationRow(release, 0)), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inspector rejects direct authority after activation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-table-rls-authority-"));
  try {
    await assert.rejects(
      inspectPrivateTableRlsActivationProduction(
        environment(directory, "preflight"),
        {
          Client: fakeClientClass({
            active: true,
            tableOverrides: {
              staff_select: true,
              non_owner_table_acl_count: 1,
            },
          }),
        },
      ),
      /staffSelect drifted/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
