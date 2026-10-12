import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACCOUNT_DELETION_ACTIVATION_MIGRATION,
  ACCOUNT_DELETION_INSPECTION_CONFIRMATION,
  ACCOUNT_DELETION_PREPARATION_MIGRATION,
  AccountDeletionCatalogVerificationError,
  assertAccountDeletionInspectionGitState,
  buildAccountDeletionFailureEvidence,
  buildAccountDeletionPreparationExpectation,
  parseAccountDeletionInspectionConfig,
  readAccountDeletionCatalog,
  verifyAccountDeletionCatalog,
  writeAccountDeletionInspectionEvidence,
} from "../scripts/account-deletion-side-effect-production-inspect.mjs";

const COMMIT = "a".repeat(40);
const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";

function env(root, state = "compatible") {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: COMMIT,
    ACCOUNT_DELETION_INSPECT_RELEASE_COMMIT: COMMIT,
    ACCOUNT_DELETION_INSPECT_CONFIRM: ACCOUNT_DELETION_INSPECTION_CONFIRMATION,
    ACCOUNT_DELETION_EXPECTED_STATE: state,
    ACCOUNT_DELETION_INSPECT_EVIDENCE_PATH: path.join(
      root,
      `account-deletion-side-effect-production-inspection-${COMMIT}-${state}.json`,
    ),
    DIRECT_URL,
    MIGRATION_DB_ROLE: "neondb_owner",
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256")
      .update(DIRECT_URL)
      .digest("hex"),
    RUNNER_TEMP: root,
    PGAPPNAME: "account-deletion-side-effect-inspection-test",
    PGCONNECT_TIMEOUT: "10",
  };
}

function functionRows(expectation) {
  return expectation.functions.map((entry) => ({
    function_name: entry.name,
    identity_arguments: entry.identityArguments,
    owner_name: "neondb_owner",
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: true,
    leakproof: false,
    volatility: entry.volatility,
    parallel_safety: entry.parallelSafety,
    function_config: ["search_path=pg_catalog"],
    source_md5: entry.sourceMd5,
    runtime_execute: entry.grantees.includes("grainline_app_runtime"),
    worker_execute: entry.grantees.includes(
      "grainline_account_deletion_runtime",
    ),
    public_execute: false,
    nonowner_acl: entry.grantees.map((role) => `${role}:EXECUTE:false`).sort(),
  }));
}

function catalog(expectation, state = "prepared") {
  const prepared = state === "prepared";
  return {
    identity: {
      current_user: "neondb_owner",
      session_user: "neondb_owner",
      database_name: "neondb",
      read_only: "on",
      isolation: "repeatable read",
      owner_bypass_rls: true,
      runtime_superuser: false,
      runtime_inherit: false,
      runtime_bypass_rls: false,
      worker_superuser: false,
      worker_inherit: false,
      worker_login: true,
      worker_createdb: false,
      worker_createrole: false,
      worker_replication: false,
      worker_bypass_rls: false,
      worker_schema_acl: prepared ? ["USAGE:false"] : [],
      worker_unreviewed_membership: false,
    },
    migrations: prepared
      ? [
          {
            migration_name: ACCOUNT_DELETION_PREPARATION_MIGRATION,
            checksum: expectation.checksum,
            finished: true,
            rolled_back: false,
            applied_steps_count: "1",
          },
        ]
      : [],
    table: {
      table_name: "AccountDeletionSideEffect",
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
      runtime_other: false,
      worker_select: prepared,
      worker_insert: prepared,
      worker_update: prepared,
      worker_delete: prepared,
      worker_other: false,
      worker_explicit_column_authority: false,
      public_column_authority: false,
      public_table_authority: false,
    },
    columns: prepared
      ? [
          {
            column_name: "claimGeneration",
            data_type: "bigint",
            not_null: true,
            default_expression: "'0'::bigint",
          },
          {
            column_name: "claimToken",
            data_type: "uuid",
            not_null: false,
            default_expression: null,
          },
          {
            column_name: "processingStartedAt",
            data_type: "timestamp(3) without time zone",
            not_null: false,
            default_expression: null,
          },
        ]
      : [],
    constraints: prepared
      ? [
          {
            constraint_name: "AccountDeletionSideEffect_attempts_check",
            constraint_type: "c",
            validated: true,
            definition: "CHECK ((attempts >= 0))",
          },
          {
            constraint_name: "AccountDeletionSideEffect_claimGeneration_check",
            constraint_type: "c",
            validated: true,
            definition: 'CHECK (("claimGeneration" >= 0))',
          },
        ]
      : [],
    indexes: prepared
      ? [
          {
            index_name:
              "AccountDeletionSideEffect_status_processingStartedAt_idx",
            valid: true,
            ready: true,
            definition:
              'CREATE INDEX "AccountDeletionSideEffect_status_processingStartedAt_idx" ON public."AccountDeletionSideEffect" USING btree (status, "processingStartedAt")',
          },
        ]
      : [],
    functions: prepared ? functionRows(expectation) : [],
  };
}

test("expectation is derived from exact preparation, activation, and function bytes", () => {
  const expectation = buildAccountDeletionPreparationExpectation();
  const preparation = fs.readFileSync(
    `prisma/migrations/${ACCOUNT_DELETION_PREPARATION_MIGRATION}/migration.sql`,
  );
  const activation = fs.readFileSync(
    `prisma/migrations/${ACCOUNT_DELETION_ACTIVATION_MIGRATION}/migration.sql`,
  );
  assert.equal(
    expectation.checksum,
    createHash("sha256").update(preparation).digest("hex"),
  );
  assert.equal(
    expectation.checksum,
    "2b79282ad52c8f4f5c417eebeb1593b157bd66b8fd66d792185865383e1f5924",
  );
  assert.equal(
    expectation.activation.checksum,
    createHash("sha256").update(activation).digest("hex"),
  );
  assert.equal(
    expectation.activation.checksum,
    "2aa2f45bb9c2464651a828755a03adb99c6e88633eb31578aaeeeb585a0a3048",
  );
  assert.equal(expectation.functions.length, 11);
  for (const entry of expectation.functions) {
    assert.equal(entry.volatility, "v");
    assert.equal(entry.parallelSafety, "u");
    assert.match(entry.sourceMd5, /^[0-9a-f]{32}$/u);
  }
});

test("config requires exact first-attempt main, owner target, digest, state, and fresh path", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "account-deletion-inspect-"),
  );
  assert.deepEqual(
    parseAccountDeletionInspectionConfig(env(root)).acceptedStates,
    ["pending", "prepared"],
  );
  assert.deepEqual(
    parseAccountDeletionInspectionConfig(env(root, "prepared")).acceptedStates,
    ["prepared"],
  );
  for (const [key, value] of [
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_REF", "refs/heads/other"],
    ["GITHUB_SHA", "b".repeat(40)],
    ["ACCOUNT_DELETION_INSPECT_CONFIRM", "wrong"],
    ["ACCOUNT_DELETION_EXPECTED_STATE", "enabled"],
    ["MIGRATION_DB_ROLE", "wrong"],
    ["PRODUCTION_MIGRATION_DIRECT_URL_SHA256", "b".repeat(64)],
  ])
    assert.throws(() =>
      parseAccountDeletionInspectionConfig({ ...env(root), [key]: value }),
    );
  for (const key of [
    "DATABASE_URL",
    "GRANT_AUDIT_DATABASE_URL",
    "ACCOUNT_DELETION_DATABASE_URL",
  ]) {
    assert.throws(() =>
      parseAccountDeletionInspectionConfig({ ...env(root), [key]: DIRECT_URL }),
    );
  }
  fs.writeFileSync(
    env(root).ACCOUNT_DELETION_INSPECT_EVIDENCE_PATH,
    "occupied",
  );
  assert.throws(() => parseAccountDeletionInspectionConfig(env(root)));
});

test("git state must be exact and clean", () => {
  assert.deepEqual(
    assertAccountDeletionInspectionGitState(
      { head: COMMIT, status: "" },
      COMMIT,
    ),
    { head: COMMIT, clean: true },
  );
  assert.throws(() =>
    assertAccountDeletionInspectionGitState(
      { head: "b".repeat(40), status: "" },
      COMMIT,
    ),
  );
  assert.throws(() =>
    assertAccountDeletionInspectionGitState(
      { head: COMMIT, status: " M file" },
      COMMIT,
    ),
  );
});

test("pending and prepared catalogs are accepted only in their reviewed states", () => {
  const expectation = buildAccountDeletionPreparationExpectation();
  assert.equal(
    verifyAccountDeletionCatalog(catalog(expectation, "pending"), expectation)
      .state,
    "pending",
  );
  assert.deepEqual(
    verifyAccountDeletionCatalog(catalog(expectation), expectation),
    {
      state: "prepared",
      preparationApplied: true,
      activationApplied: false,
      installedFunctionCount: 11,
      reviewedFunctionCount: 11,
      rlsEnabled: false,
      rlsForced: false,
      rowDataRead: false,
      productionChanged: false,
    },
  );
  assert.throws(() =>
    verifyAccountDeletionCatalog(catalog(expectation), expectation, [
      "pending",
    ]),
  );
  const activated = structuredClone(catalog(expectation));
  activated.migrations.push({
    migration_name: ACCOUNT_DELETION_ACTIVATION_MIGRATION,
    checksum: expectation.activation.checksum,
    finished: true,
    rolled_back: false,
    applied_steps_count: "1",
  });
  assert.throws(() => verifyAccountDeletionCatalog(activated, expectation));
});

test("catalog verification rejects role, schema, migration, table, column, constraint, index, function, grant, and RLS drift", () => {
  const expectation = buildAccountDeletionPreparationExpectation();
  const mutations = [
    (value) => {
      value.identity.worker_bypass_rls = true;
    },
    (value) => {
      value.identity.worker_schema_acl = ["CREATE:false", "USAGE:false"];
    },
    (value) => {
      value.migrations[0].checksum = "b".repeat(64);
    },
    (value) => {
      value.table.worker_delete = false;
    },
    (value) => {
      value.table.worker_explicit_column_authority = true;
    },
    (value) => {
      value.table.public_table_authority = true;
    },
    (value) => {
      value.table.rls_enabled = true;
    },
    (value) => {
      value.columns[0].default_expression = "1";
    },
    (value) => {
      value.columns[1].default_expression = "gen_random_uuid()";
    },
    (value) => {
      value.constraints[0].validated = false;
    },
    (value) => {
      value.constraints[0].definition = "CHECK (true)";
    },
    (value) => {
      value.indexes[0].definition =
        'CREATE INDEX wrong ON public."AccountDeletionSideEffect" (status)';
    },
    (value) => {
      value.functions[0].source_md5 = "0".repeat(32);
    },
    (value) => {
      value.functions[0].public_execute = true;
    },
    (value) => {
      value.functions[0].worker_execute = false;
    },
    (value) => {
      value.functions[0].function_config = [];
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(catalog(expectation));
    mutate(value);
    assert.throws(() => verifyAccountDeletionCatalog(value, expectation));
  }
});

test("catalog reader issues metadata-only queries and retains no table rows", async () => {
  const expectation = buildAccountDeletionPreparationExpectation();
  const value = catalog(expectation);
  const results = [
    value.identity,
    value.migrations,
    value.table,
    value.columns,
    value.constraints,
    value.indexes,
    value.functions,
  ];
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      const result = results.shift();
      return { rows: Array.isArray(result) ? result : [result] };
    },
  };
  const actual = await readAccountDeletionCatalog(client, expectation);
  assert.equal(actual.functions.length, 11);
  assert.equal(calls.length, 7);
  const combined = calls.map(({ sql }) => sql).join("\n");
  assert.match(combined, /pg_catalog\.pg_proc/u);
  assert.match(combined, /public\._prisma_migrations/u);
  assert.doesNotMatch(
    combined,
    /SELECT\s+\*\s+FROM\s+public\."AccountDeletionSideEffect"/iu,
  );
});

test("failure evidence is sanitized and written once as a private regular file", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "account-deletion-evidence-"),
  );
  const file = path.join(root, "evidence.json");
  const expectation = buildAccountDeletionPreparationExpectation();
  const error = new AccountDeletionCatalogVerificationError(
    new Error("catalog drift"),
    catalog(expectation, "pending"),
  );
  const evidence = buildAccountDeletionFailureEvidence(
    { releaseCommit: COMMIT, directUrlSha256: "c".repeat(64) },
    { head: COMMIT, clean: true },
    error,
  );
  writeAccountDeletionInspectionEvidence(file, evidence);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const saved = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(saved, /postgres(?:ql)?:\/\//iu);
  assert.doesNotMatch(saved, /functionBodies"\s*:\s*true/iu);
  assert.throws(() => writeAccountDeletionInspectionEvidence(file, evidence));
  assert.throws(() =>
    writeAccountDeletionInspectionEvidence(path.join(root, "bad.json"), {
      leaked: DIRECT_URL,
    }),
  );
});
