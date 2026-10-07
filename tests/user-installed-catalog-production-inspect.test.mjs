import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  USER_COMPLETE_AUTHORITY_MIGRATIONS,
  USER_INSTALLED_CATALOG_INSPECTION_CONFIRMATION,
  UserInstalledCatalogVerificationError,
  assertUserInstalledCatalogInspectionGitState,
  buildUserInstalledCatalogFailureEvidence,
  buildUserInstalledCatalogExpectation,
  parseUserInstalledCatalogInspectionConfig,
  readUserInstalledCatalog,
  verifyUserInstalledCatalog,
  writeUserInstalledCatalogInspectionEvidence,
} from "../scripts/user-installed-catalog-production-inspect.mjs";

const COMMIT = "a".repeat(40);
const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RUNNER_TEMP = "/private/tmp/user-installed-catalog-inspection-test";

function configEnv() {
  return {
    DIRECT_URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(DIRECT_URL).digest("hex"),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    RUNNER_TEMP,
    USER_INSTALLED_CATALOG_INSPECT_CONFIRM:
      USER_INSTALLED_CATALOG_INSPECTION_CONFIRMATION,
    USER_INSTALLED_CATALOG_INSPECT_EVIDENCE_PATH:
      `${RUNNER_TEMP}/user-installed-catalog-production-inspection-${COMMIT}.json`,
    USER_INSTALLED_CATALOG_INSPECT_RELEASE_COMMIT: COMMIT,
  };
}

function acceptedCatalog(expectation, appliedCount = 8) {
  const appliedGroups = expectation.groups.slice(0, appliedCount);
  const functions = appliedGroups.flatMap(({ functions: entries }) => entries);
  return {
    identity: {
      current_user: "neondb_owner",
      session_user: "neondb_owner",
      database_name: "neondb",
      read_only: "on",
      isolation: "repeatable read",
      owner_bypass_rls: true,
      runtime_bypass_rls: false,
      runtime_superuser: false,
      runtime_inherit: false,
      staff_bypass_rls: false,
      staff_superuser: false,
      staff_inherit: false,
    },
    migrations: appliedGroups.map((group) => ({
      migration_name: group.migration,
      checksum: group.checksum,
      finished: true,
      rolled_back: false,
      applied_steps_count: "1",
    })),
    table: {
      table_name: "User",
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
      staff_select: false,
      staff_insert: false,
      staff_update: false,
      staff_delete: false,
      nonowner_acl: [
        "grainline_app_runtime:DELETE:false",
        "grainline_app_runtime:INSERT:false",
        "grainline_app_runtime:SELECT:false",
        "grainline_app_runtime:UPDATE:false",
      ],
      column_acl: [],
    },
    functions: functions.map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.identityArguments,
      owner_name: "neondb_owner",
      language_name: entry.language,
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      volatility: entry.volatility,
      parallel_safety: entry.parallelSafety,
      function_config: [...entry.functionConfig],
      source_md5: entry.sourceMd5,
      contains_dynamic_execute: entry.containsDynamicExecute,
      runtime_execute: entry.runtimeExecute,
      staff_execute: entry.staffExecute,
      public_execute: false,
      nonowner_acl: [...entry.nonownerAcl],
    })),
  };
}

test("builds one complete exact source catalog including all snapshot triggers", () => {
  const expectation = buildUserInstalledCatalogExpectation();
  assert.equal(expectation.groups.length, 16);
  assert.equal(expectation.functions.length, 53);
  assert.equal(new Set(expectation.functions.map(({ identity }) => identity)).size, 53);
  assert.equal(expectation.functions.filter(({ runtimeExecute }) => runtimeExecute).length, 34);
  assert.equal(expectation.functions.filter(({ runtimeExecute }) => !runtimeExecute).length, 19);
  for (const group of expectation.groups) assert.match(group.checksum, /^[0-9a-f]{64}$/u);
  for (const entry of expectation.functions) {
    assert.match(entry.sourceMd5, /^[0-9a-f]{32}$/u);
    assert.deepEqual(entry.functionConfig, ["search_path=pg_catalog"]);
    assert.equal(entry.securityDefiner, true);
  }
});

test("accepts a checksum-exact installed prefix and exact predecessor User grants", () => {
  const expectation = buildUserInstalledCatalogExpectation();
  const result = verifyUserInstalledCatalog(acceptedCatalog(expectation), expectation);
  assert.deepEqual(result, {
    databaseMode: "owner-catalog-read-only",
    appliedMigrationCount: 8,
    pendingMigrationCount: 8,
    installedFunctionCount: 19,
    reviewedFunctionCount: 53,
    runtimeFunctionCount: 17,
    privateFunctionCount: 2,
    userRlsEnabled: false,
    userRlsForced: false,
    predecessorRuntimeCrudRetained: true,
    rowDataRead: false,
    productionChanged: false,
  });
});

test("accepts only contiguous reviewed successor progress and the complete catalog", () => {
  const expectation = buildUserInstalledCatalogExpectation();
  const progressCounts = Array.from({ length: 9 }, (_, index) => 8 + index);
  const partial = verifyUserInstalledCatalog(
    acceptedCatalog(expectation, 12),
    expectation,
    progressCounts,
  );
  assert.equal(partial.appliedMigrationCount, 12);
  assert.equal(partial.pendingMigrationCount, 4);

  const complete = verifyUserInstalledCatalog(
    acceptedCatalog(expectation, 16),
    expectation,
    [USER_COMPLETE_AUTHORITY_MIGRATIONS.length],
  );
  assert.equal(complete.appliedMigrationCount, 16);
  assert.equal(complete.pendingMigrationCount, 0);
  assert.equal(complete.installedFunctionCount, 53);

  assert.throws(
    () => verifyUserInstalledCatalog(acceptedCatalog(expectation, 7), expectation, progressCounts),
    /outside the reviewed release state/u,
  );
});

test("rejects ledger gaps, body drift, grant drift, overloads, and premature RLS", () => {
  const expectation = buildUserInstalledCatalogExpectation();

  assert.throws(
    () => verifyUserInstalledCatalog(acceptedCatalog(expectation, 7), expectation),
    /outside the reviewed release state/u,
  );
  assert.throws(
    () => verifyUserInstalledCatalog(acceptedCatalog(expectation, 9), expectation),
    /outside the reviewed release state/u,
  );

  const ledgerGap = acceptedCatalog(expectation, 9);
  ledgerGap.migrations.splice(7, 1);
  assert.throws(
    () => verifyUserInstalledCatalog(ledgerGap, expectation),
    /bypassed a pending predecessor/u,
  );

  const bodyDrift = acceptedCatalog(expectation);
  bodyDrift.functions[0].source_md5 = "0".repeat(32);
  assert.throws(() => verifyUserInstalledCatalog(bodyDrift, expectation), /body drifted/u);

  const publicGrant = acceptedCatalog(expectation);
  publicGrant.functions[0].public_execute = true;
  publicGrant.functions[0].nonowner_acl.unshift("PUBLIC:EXECUTE:false");
  assert.throws(() => verifyUserInstalledCatalog(publicGrant, expectation), /PUBLIC/u);

  const overload = acceptedCatalog(expectation);
  overload.functions.push({ ...overload.functions[0], identity_arguments: "integer" });
  assert.throws(() => verifyUserInstalledCatalog(overload, expectation), /function count/u);

  const rls = acceptedCatalog(expectation);
  rls.table.rls_enabled = true;
  assert.throws(() => verifyUserInstalledCatalog(rls, expectation));
});

test("requires an exact first-attempt main dispatch, protected owner URL, and fresh path", () => {
  const config = parseUserInstalledCatalogInspectionConfig(configEnv());
  assert.equal(config.mode, "production-owner-catalog-read-only");
  assert.equal(config.releaseCommit, COMMIT);
  for (const drift of [
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_SHA: "b".repeat(40) },
    { USER_INSTALLED_CATALOG_INSPECT_CONFIRM: "yes" },
    { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
    { DATABASE_URL: "present" },
    { GRANT_AUDIT_DATABASE_URL: "present" },
    { MIGRATION_DB_ROLE: "grainline_app_runtime" },
    { USER_INSTALLED_CATALOG_INSPECT_EVIDENCE_PATH: "/private/tmp/wrong.json" },
  ]) {
    assert.throws(() => parseUserInstalledCatalogInspectionConfig({ ...configEnv(), ...drift }));
  }

  const progress = parseUserInstalledCatalogInspectionConfig({
    ...configEnv(),
    USER_INSTALLED_CATALOG_EXPECTED_PREFIX: "successor-progress",
    USER_INSTALLED_CATALOG_INSPECT_EVIDENCE_PATH:
      `${RUNNER_TEMP}/user-installed-catalog-production-inspection-${COMMIT}-successor-progress.json`,
  });
  assert.deepEqual(progress.acceptedAppliedCounts, [8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(progress.prefixMode, "successor-progress");

  assert.throws(() => parseUserInstalledCatalogInspectionConfig({
    ...configEnv(),
    USER_INSTALLED_CATALOG_EXPECTED_PREFIX: "anything",
  }), /prefix mode is invalid/u);
});

test("requires a clean exact checkout and writes private sanitized evidence", () => {
  assert.deepEqual(
    assertUserInstalledCatalogInspectionGitState({ head: COMMIT, status: "" }, COMMIT),
    { head: COMMIT, clean: true },
  );
  assert.throws(
    () => assertUserInstalledCatalogInspectionGitState(
      { head: COMMIT, status: "?? unexpected.sql" },
      COMMIT,
    ),
    /exact and clean/u,
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "user-installed-catalog-evidence-"));
  try {
    const evidencePath = path.join(root, "evidence.json");
    writeUserInstalledCatalogInspectionEvidence(evidencePath, {
      status: "passed",
      result: { installedFunctionCount: 19 },
    });
    assert.equal(fs.statSync(evidencePath).mode & 0o077, 0);
    assert.throws(() => writeUserInstalledCatalogInspectionEvidence(
      path.join(root, "secret.json"),
      { connection: DIRECT_URL },
    ), /private data/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retains only sanitized catalog metadata when verification rejects Production", () => {
  const expectation = buildUserInstalledCatalogExpectation();
  const catalog = acceptedCatalog(expectation);
  catalog.table.runtime_select = false;
  let cause;
  try {
    verifyUserInstalledCatalog(catalog, expectation);
  } catch (error) {
    cause = error;
  }
  assert.ok(cause instanceof Error);
  const failure = new UserInstalledCatalogVerificationError(cause, catalog);
  const config = {
    mode: "production-owner-catalog-read-only",
    releaseCommit: COMMIT,
    directUrlSha256: createHash("sha256").update(DIRECT_URL).digest("hex"),
  };
  const evidence = buildUserInstalledCatalogFailureEvidence(
    config,
    { head: COMMIT, clean: true },
    failure,
  );
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.failure.code, "CATALOG_VERIFICATION_REJECTED");
  assert.equal(evidence.catalog.table.runtime_select, false);
  assert.deepEqual(evidence.transaction, {
    isolation: "repeatable read",
    readOnly: true,
    rolledBack: true,
  });
  assert.deepEqual(evidence.retained, {
    catalogMetadataOnly: true,
    rowData: false,
    identifiers: false,
    credentials: false,
    functionBodies: false,
  });
  assert.equal(evidence.productionChanged, false);
  assert.equal(JSON.stringify(evidence).includes(DIRECT_URL), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "user-installed-catalog-failure-"));
  try {
    const evidencePath = path.join(root, "failure.json");
    writeUserInstalledCatalogInspectionEvidence(evidencePath, evidence);
    assert.equal(fs.statSync(evidencePath).mode & 0o077, 0);
    const retained = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    assert.equal(retained.status, "failed");
    assert.equal(JSON.stringify(retained).includes(DIRECT_URL), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("catalog queries execute inside a read-only PostgreSQL transaction", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime;
      CREATE ROLE grainline_staff_read_runtime;
      CREATE TABLE public."User" (id text PRIMARY KEY);
      GRANT SELECT, INSERT, UPDATE, DELETE ON public."User"
        TO grainline_app_runtime;
      CREATE TABLE public._prisma_migrations (
        migration_name text,
        checksum text,
        finished_at timestamptz,
        rolled_back_at timestamptz,
        applied_steps_count integer
      );
      INSERT INTO public._prisma_migrations
      VALUES ('fixture', repeat('a', 64), now(), null, 1);
      CREATE FUNCTION public.grainline_fixture() RETURNS integer
      LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog
      AS $$ SELECT 1 $$;
      REVOKE ALL ON FUNCTION public.grainline_fixture()
        FROM PUBLIC, grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION public.grainline_fixture()
        TO grainline_app_runtime;
    `);
    await database.exec("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const catalog = await readUserInstalledCatalog(database, {
      groups: [{ migration: "fixture", functions: [] }],
      functions: [{ name: "grainline_fixture" }],
    });
    await database.exec("ROLLBACK");
    assert.equal(catalog.migrations.length, 1);
    assert.equal(catalog.functions.length, 1);
    assert.equal(catalog.table.table_name, "User");
    assert.equal(catalog.table.rls_enabled, false);
    assert.equal(catalog.functions[0].public_execute, false);
  } finally {
    await database.close();
  }
});
