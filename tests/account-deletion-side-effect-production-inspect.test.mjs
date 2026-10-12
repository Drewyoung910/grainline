import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACCOUNT_DELETION_ACTIVATION_MIGRATION,
  ACCOUNT_DELETION_INSPECTION_CONFIRMATION,
  ACCOUNT_DELETION_MEDIA_KEY_MIGRATION,
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

function enabledGrantees(identity) {
  if (
    [
      "grainline_account_deletion_side_effect_claim(text)",
      "grainline_account_deletion_side_effect_complete(text, bigint, uuid)",
      "grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)",
    ].includes(identity)
  )
    return ["grainline_account_deletion_runtime"];
  if (
    [
      "grainline_account_deletion_media_enqueue_claimed(text, bigint, uuid, text[])",
      "grainline_account_deletion_claim_user(text, bigint, uuid)",
    ].includes(identity)
  )
    return [];
  return ["grainline_app_runtime"];
}

function functionRows(expectation, enabled = false) {
  return expectation.functions.map((entry) => {
    const grantees = enabled
      ? enabledGrantees(entry.identity)
      : entry.grantees;
    return {
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
      runtime_execute: grantees.includes("grainline_app_runtime"),
      worker_execute: grantees.includes(
        "grainline_account_deletion_runtime",
      ),
      public_execute: false,
      nonowner_acl: grantees
        .map((role) => `${role}:EXECUTE:false`)
        .sort(),
    };
  });
}

function catalog(expectation, state = "prepared") {
  const preparationApplied = state !== "pending";
  const mediaKeyApplied = state === "prepared" || state === "enabled";
  const activationApplied = state === "enabled";
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
      worker_schema_acl: preparationApplied ? ["USAGE:false"] : [],
      worker_unreviewed_membership: false,
    },
    migrations: preparationApplied
      ? [
          {
            migration_name: ACCOUNT_DELETION_PREPARATION_MIGRATION,
            checksum: expectation.checksum,
            finished: true,
            rolled_back: false,
            applied_steps_count: "1",
          },
          ...(mediaKeyApplied
            ? [{
                migration_name: ACCOUNT_DELETION_MEDIA_KEY_MIGRATION,
                checksum: expectation.mediaKey.checksum,
                finished: true,
                rolled_back: false,
                applied_steps_count: "1",
              }]
            : []),
          ...(activationApplied
            ? [
                {
                  migration_name: ACCOUNT_DELETION_ACTIVATION_MIGRATION,
                  checksum: expectation.activation.checksum,
                  finished: true,
                  rolled_back: false,
                  applied_steps_count: "1",
                },
              ]
            : []),
        ]
      : [],
    table: {
      table_name: "AccountDeletionSideEffect",
      owner_name: "neondb_owner",
      rls_enabled: activationApplied,
      rls_forced: false,
      policy_count: activationApplied ? 1 : 0,
      runtime_select: !activationApplied,
      runtime_insert: !activationApplied,
      runtime_update: !activationApplied,
      runtime_delete: !activationApplied,
      runtime_other: false,
      worker_select: preparationApplied,
      worker_insert: preparationApplied,
      worker_update: preparationApplied,
      worker_delete: preparationApplied,
      worker_other: false,
      worker_explicit_column_authority: false,
      public_column_authority: false,
      public_table_authority: false,
    },
    columns: preparationApplied
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
    constraints: preparationApplied
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
    indexes: preparationApplied
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
    functions: preparationApplied
      ? functionRows(
          {
            functions: mediaKeyApplied
              ? expectation.functions
              : expectation.preparationFunctions,
          },
          activationApplied,
        )
      : [],
    policies: activationApplied
      ? [
          {
            policy_name:
              "AccountDeletionSideEffect_account_deletion_runtime_all",
            command: "*",
            permissive: true,
            roles: ["grainline_account_deletion_runtime"],
            using_expression: "true",
            check_expression: "true",
          },
        ]
      : [],
    retiredFunctions: activationApplied
      ? [
          "grainline_case_account_deletion_redact(text)",
          "grainline_message_redact_for_account_deletion(text)",
          "grainline_order_account_deletion_scrub(text, text[])",
          "grainline_user_account_deletion_finalize(text)",
          "grainline_user_account_deletion_preflight(text)",
          "grainline_user_account_deletion_snapshot(text)",
        ].map((functionIdentity) => ({
          function_identity: functionIdentity,
          function_exists: true,
          runtime_execute: false,
          worker_execute: false,
          public_execute: false,
        }))
      : [],
    activationBlockerCount: 0,
    activationBlockers: [],
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
  const mediaKey = fs.readFileSync(
    `prisma/migrations/${ACCOUNT_DELETION_MEDIA_KEY_MIGRATION}/migration.sql`,
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
    expectation.mediaKey.checksum,
    createHash("sha256").update(mediaKey).digest("hex"),
  );
  assert.equal(
    expectation.mediaKey.checksum,
    "d132a70f9673815f8e789151761ed2da1031c5d58c8313c6dc25fe7c430a0ba9",
  );
  assert.equal(
    expectation.activation.checksum,
    createHash("sha256").update(activation).digest("hex"),
  );
  assert.equal(
    expectation.activation.checksum,
    "86b511f8fec0104c4ef3c1fbc7b2017d40847b286ac92bf26cdafc12518c5b3b",
  );
  assert.equal(expectation.functions.length, 12);
  assert.equal(expectation.preparationFunctions.length, 11);
  for (const entry of expectation.functions) {
    assert.equal(entry.volatility, "v");
    assert.equal(entry.parallelSafety, "u");
    assert.match(entry.sourceMd5, /^[0-9a-f]{32}$/u);
  }
  assert.deepEqual(
    expectation.functions.find(
      ({ identity }) =>
        identity ===
        "grainline_account_deletion_claim_user(text, bigint, uuid)",
    )?.grantees,
    [],
  );
});

test("config requires exact first-attempt main, owner target, digest, state, and fresh path", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "account-deletion-inspect-"),
  );
  assert.deepEqual(
    parseAccountDeletionInspectionConfig(env(root)).acceptedStates,
    ["pending", "preparation_only", "prepared"],
  );
  assert.deepEqual(
    parseAccountDeletionInspectionConfig(env(root, "prepared")).acceptedStates,
    ["prepared"],
  );
  assert.equal(
    parseAccountDeletionInspectionConfig(env(root, "activation-compatible"))
      .requireActivationReady,
    true,
  );
  assert.deepEqual(
    parseAccountDeletionInspectionConfig(env(root, "activation-compatible"))
      .acceptedStates,
    ["prepared", "enabled"],
  );
  assert.deepEqual(
    parseAccountDeletionInspectionConfig(env(root, "enabled")).acceptedStates,
    ["enabled"],
  );
  for (const [key, value] of [
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_REF", "refs/heads/other"],
    ["GITHUB_SHA", "b".repeat(40)],
    ["ACCOUNT_DELETION_INSPECT_CONFIRM", "wrong"],
    ["ACCOUNT_DELETION_EXPECTED_STATE", "invalid"],
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

test("pending, partial, and prepared catalogs are accepted only in their reviewed states", () => {
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
      mediaKeyApplied: true,
      activationApplied: false,
      installedFunctionCount: 12,
      reviewedFunctionCount: 12,
      activationBlockerCount: null,
      rlsEnabled: false,
      rlsForced: false,
      rowDataRead: false,
      sanitizedActivationBlockers: false,
      productionChanged: false,
    },
  );
  assert.deepEqual(
    verifyAccountDeletionCatalog(
      catalog(expectation, "preparation_only"),
      expectation,
    ),
    {
      state: "preparation_only",
      preparationApplied: true,
      mediaKeyApplied: false,
      activationApplied: false,
      installedFunctionCount: 11,
      reviewedFunctionCount: 11,
      activationBlockerCount: null,
      rlsEnabled: false,
      rlsForced: false,
      rowDataRead: false,
      sanitizedActivationBlockers: false,
      productionChanged: false,
    },
  );
  assert.throws(() =>
    verifyAccountDeletionCatalog(catalog(expectation), expectation, [
      "pending",
    ]),
  );
  assert.equal(
    verifyAccountDeletionCatalog(
      catalog(expectation, "enabled"),
      expectation,
      ["enabled"],
      true,
    ).state,
    "enabled",
  );
  const reversedPartial = structuredClone(catalog(expectation));
  reversedPartial.migrations = reversedPartial.migrations.filter(
    ({ migration_name }) =>
      migration_name !== ACCOUNT_DELETION_PREPARATION_MIGRATION,
  );
  assert.throws(() =>
    verifyAccountDeletionCatalog(reversedPartial, expectation),
  );
});

test("activation-compatible inspection rejects every sanitized invalid-row blocker", () => {
  const expectation = buildAccountDeletionPreparationExpectation();
  assert.equal(
    verifyAccountDeletionCatalog(
      catalog(expectation),
      expectation,
      ["prepared"],
      true,
    ).activationBlockerCount,
    0,
  );
  const blocked = structuredClone(catalog(expectation));
  blocked.activationBlockerCount = 1;
  blocked.activationBlockers = [
    {
      row_id_sha256: "a".repeat(64),
      kind: "MEDIA_DELETE",
      status: "PENDING",
      attempts: 0,
      claim_generation: "0",
      claim_token_present: false,
      processing_started_at_present: false,
      processed_at_present: false,
      payload_sha256: "b".repeat(64),
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
      legacy_url_only: true,
    },
  ];
  assert.throws(() =>
    verifyAccountDeletionCatalog(
      blocked,
      expectation,
      ["prepared"],
      true,
    ),
  );
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
  assert.equal(actual.functions.length, 12);
  assert.equal(calls.length, 7);
  const combined = calls.map(({ sql }) => sql).join("\n");
  assert.match(combined, /pg_catalog\.pg_proc/u);
  assert.match(
    combined,
    /pg_catalog\.oidvectortypes\(procedure\.proargtypes\)::text AS identity_arguments/u,
  );
  assert.doesNotMatch(
    combined,
    /pg_catalog\.pg_get_function_identity_arguments\(procedure\.oid\)::text AS identity_arguments/u,
  );
  assert.match(combined, /public\._prisma_migrations/u);
  assert.doesNotMatch(
    combined,
    /SELECT\s+\*\s+FROM\s+public\."AccountDeletionSideEffect"/iu,
  );
});

test("activation-ready reader retains only a bounded sanitized blocker inventory", async () => {
  const expectation = buildAccountDeletionPreparationExpectation();
  const value = catalog(expectation);
  const blocker = {
    row_id_sha256: "a".repeat(64),
    kind: "MEDIA_DELETE",
    status: "PENDING",
    attempts: 0,
    claim_generation: "0",
    claim_token_present: false,
    processing_started_at_present: false,
    processed_at_present: false,
    payload_sha256: "b".repeat(64),
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    legacy_url_only: true,
    total_count: 1,
  };
  const results = [
    value.identity,
    value.migrations,
    value.table,
    value.columns,
    value.constraints,
    value.indexes,
    value.functions,
    value.policies,
    value.retiredFunctions,
    [blocker],
  ];
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      const result = results.shift();
      return { rows: Array.isArray(result) ? result : [result] };
    },
  };
  const actual = await readAccountDeletionCatalog(client, expectation, {
    inspectActivationBlockers: true,
  });
  assert.equal(calls.length, 10);
  assert.equal(actual.activationBlockerCount, 1);
  assert.deepEqual(actual.activationBlockers, [
    Object.fromEntries(
      Object.entries(blocker).filter(([key]) => key !== "total_count"),
    ),
  ]);
  const blockerQuery = calls.at(-1).sql;
  assert.match(blockerQuery, /effect\.kind NOT IN/u);
  assert.match(blockerQuery, /effect\."dedupKey"/u);
  assert.match(blockerQuery, /LIMIT 500/u);
  assert.doesNotMatch(blockerQuery, /AS user_id|AS payload\b|AS url\b/iu);
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
    {
      releaseCommit: COMMIT,
      directUrlSha256: "c".repeat(64),
      requireActivationReady: false,
    },
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
