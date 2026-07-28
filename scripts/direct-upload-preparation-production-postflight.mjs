#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS,
  DIRECT_UPLOAD_PRIVATE_FUNCTION_NAMES,
} from "./direct-upload-authority-catalog.mjs";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_CONFIRMATION =
  "verify-production-direct-upload-preparation-read-only";
const REVIEWED_MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;
const EVIDENCE_PREFIX = "direct-upload-preparation-production-postflight-";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function parseSafePositiveInteger(env, key) {
  const raw = required(env, key);
  if (!SAFE_POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  return value;
}

export function parseDirectUploadPreparationPostflightConfig(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "DirectUpload preparation production postflight",
  );
  if (
    env.DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_CONFIRM !==
    DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error(
      "DirectUpload preparation postflight confirmation is invalid",
    );
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `DirectUpload preparation postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `DirectUpload preparation postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_PREPARATION_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("DirectUpload preparation release commit is invalid");
  }
  const mainCiRunId = parseSafePositiveInteger(
    env,
    "DIRECT_UPLOAD_PREPARATION_MAIN_CI_RUN_ID",
  );
  const migrationRunId = parseSafePositiveInteger(
    env,
    "DIRECT_UPLOAD_PREPARATION_MIGRATION_RUN_ID",
  );

  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeGuard = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });

  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_PREPARATION_POSTFLIGHT_EVIDENCE_PATH"),
  );
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json` ||
    existsSync(evidencePath)
  ) {
    throw new Error(
      "DirectUpload preparation evidence path is not the fresh reviewed path",
    );
  }

  return Object.freeze({
    databaseUrl,
    evidencePath,
    mainCiRunId,
    migrationRunId,
    releaseCommit,
    runtimeGuard,
  });
}

export function readDirectUploadPreparationGitState(cwd = process.cwd()) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertDirectUploadPreparationGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "DirectUpload preparation postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function verifyRuntimeIdentity(client) {
  const result = await client.query(`
    SELECT
      pg_catalog.current_database() AS database_name,
      CURRENT_USER AS current_user_name,
      SESSION_USER AS session_user_name,
      role.rolsuper,
      role.rolbypassrls,
      role.rolinherit,
      role.rolcanlogin,
      pg_catalog.pg_has_role(
        CURRENT_USER,
        'neondb_owner',
        'MEMBER'
      ) AS member_of_owner
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER
  `);
  assert.deepEqual(result.rows, [
    {
      database_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.databaseName,
      current_user_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
      session_user_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcanlogin: true,
      member_of_owner: false,
    },
  ]);
}

async function verifyTablePosture(
  client,
  migrationRole = REVIEWED_MIGRATION_ROLE,
) {
  const result = await client.query(`
    SELECT
      relation.relname AS table_name,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
      (
        SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = relation.oid
      ) AS policy_count,
      pg_catalog.has_table_privilege(
        CURRENT_USER, relation.oid, 'SELECT'
      ) AS can_select,
      pg_catalog.has_table_privilege(
        CURRENT_USER, relation.oid, 'INSERT'
      ) AS can_insert,
      pg_catalog.has_table_privilege(
        CURRENT_USER, relation.oid, 'UPDATE'
      ) AS can_update,
      pg_catalog.has_table_privilege(
        CURRENT_USER, relation.oid, 'DELETE'
      ) AS can_delete
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind = 'r'
      AND relation.relname IN ('DirectUpload', 'DirectUploadReference')
    ORDER BY relation.relname
  `);
  assert.deepEqual(result.rows, [
    {
      table_name: "DirectUpload",
      rls_enabled: false,
      rls_forced: false,
      owner_name: migrationRole,
      policy_count: 0,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    },
    {
      table_name: "DirectUploadReference",
      rls_enabled: true,
      rls_forced: true,
      owner_name: migrationRole,
      policy_count: 0,
      can_select: false,
      can_insert: false,
      can_update: false,
      can_delete: false,
    },
  ]);
}

async function verifyCompatibilityCatalog(client) {
  const columns = await client.query(`
    SELECT
      attribute.attname AS column_name,
      attribute.attnotnull AS not_null,
      pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) AS data_type
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
            'public."CaseMessageAttachment"'::pg_catalog.regclass
      AND attribute.attname IN ('objectKey', 'directUploadId')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY attribute.attname
  `);
  assert.deepEqual(columns.rows, [
    {
      column_name: "directUploadId",
      not_null: true,
      data_type: "text",
    },
    {
      column_name: "objectKey",
      not_null: true,
      data_type: "character varying(500)",
    },
  ]);

  const directUploadConstraints = await client.query(`
    SELECT
      constraint_entry.conname AS constraint_name,
      constraint_entry.contype AS constraint_type,
      constraint_entry.convalidated AS validated,
      referenced_relation.relname AS referenced_table
    FROM pg_catalog.pg_constraint AS constraint_entry
    LEFT JOIN pg_catalog.pg_class AS referenced_relation
      ON referenced_relation.oid = constraint_entry.confrelid
     AND constraint_entry.confrelid <> 0
    WHERE constraint_entry.conrelid =
            'public."DirectUpload"'::pg_catalog.regclass
      AND constraint_entry.conname IN (
        'DirectUpload_cleanup_lease_pair_check',
        'DirectUpload_endpoint_check',
        'DirectUpload_endpoint_storage_content_size_check',
        'DirectUpload_key_endpoint_check',
        'DirectUpload_public_url_key_check',
        'DirectUpload_userId_fkey'
      )
    ORDER BY constraint_entry.conname
  `);
  assert.deepEqual(directUploadConstraints.rows, [
    {
      constraint_name: "DirectUpload_cleanup_lease_pair_check",
      constraint_type: "c",
      validated: false,
      referenced_table: null,
    },
    {
      constraint_name: "DirectUpload_endpoint_check",
      constraint_type: "c",
      validated: false,
      referenced_table: null,
    },
    {
      constraint_name: "DirectUpload_endpoint_storage_content_size_check",
      constraint_type: "c",
      validated: false,
      referenced_table: null,
    },
    {
      constraint_name: "DirectUpload_key_endpoint_check",
      constraint_type: "c",
      validated: false,
      referenced_table: null,
    },
    {
      constraint_name: "DirectUpload_public_url_key_check",
      constraint_type: "c",
      validated: false,
      referenced_table: null,
    },
    {
      constraint_name: "DirectUpload_userId_fkey",
      constraint_type: "f",
      validated: false,
      referenced_table: "User",
    },
  ]);

  const caseAttachmentConstraints = await client.query(`
    SELECT
      constraint_entry.conname AS constraint_name,
      constraint_entry.contype AS constraint_type,
      constraint_entry.convalidated AS validated,
      referenced_relation.relname AS referenced_table
    FROM pg_catalog.pg_constraint AS constraint_entry
    LEFT JOIN pg_catalog.pg_class AS referenced_relation
      ON referenced_relation.oid = constraint_entry.confrelid
     AND constraint_entry.confrelid <> 0
    WHERE constraint_entry.conrelid =
            'public."CaseMessageAttachment"'::pg_catalog.regclass
      AND constraint_entry.conname IN (
        'CaseMessageAttachment_directUploadId_fkey',
        'CaseMessageAttachment_directUploadId_key'
      )
    ORDER BY constraint_entry.conname
  `);
  assert.deepEqual(caseAttachmentConstraints.rows, [
    {
      constraint_name: "CaseMessageAttachment_directUploadId_fkey",
      constraint_type: "f",
      validated: true,
      referenced_table: "DirectUpload",
    },
    {
      constraint_name: "CaseMessageAttachment_directUploadId_key",
      constraint_type: "u",
      validated: true,
      referenced_table: null,
    },
  ]);

  const triggers = await client.query(`
    SELECT
      trigger.tgname AS trigger_name,
      relation.relname AS table_name,
      procedure.proname AS function_name,
      trigger.tgenabled AS enabled,
      trigger.tgdeferrable AS deferrable,
      trigger.tginitdeferred AS initially_deferred
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger.tgfoid
    WHERE namespace.nspname = 'public'
      AND NOT trigger.tgisinternal
      AND trigger.tgname IN (
        'grainline_direct_upload_case_attachment_bind',
        'grainline_direct_upload_identity_immutable',
        'grainline_direct_upload_reference_case_attachment_insert',
        'grainline_direct_upload_reference_guard',
        'grainline_direct_upload_release_blog_post_delete',
        'grainline_direct_upload_release_case_attachment_delete',
        'grainline_direct_upload_release_commission_request_delete',
        'grainline_direct_upload_release_legacy_message_delete',
        'grainline_direct_upload_release_listing_delete',
        'grainline_direct_upload_release_review_delete',
        'grainline_direct_upload_release_seller_broadcast_delete',
        'grainline_direct_upload_release_seller_profile_delete',
        'grainline_direct_upload_status_transition'
      )
    ORDER BY trigger.tgname
  `);
  assert.deepEqual(triggers.rows, [
    {
      trigger_name: "grainline_direct_upload_case_attachment_bind",
      table_name: "CaseMessageAttachment",
      function_name: "grainline_direct_upload_case_attachment_bind",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_identity_immutable",
      table_name: "DirectUpload",
      function_name: "grainline_direct_upload_identity_immutable",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_reference_case_attachment_insert",
      table_name: "CaseMessageAttachment",
      function_name:
        "grainline_direct_upload_case_attachment_reference_trigger",
      enabled: "O",
      deferrable: true,
      initially_deferred: true,
    },
    {
      trigger_name: "grainline_direct_upload_reference_guard",
      table_name: "DirectUploadReference",
      function_name: "grainline_direct_upload_reference_guard",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_blog_post_delete",
      table_name: "BlogPost",
      function_name: "grainline_direct_upload_source_delete_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_case_attachment_delete",
      table_name: "CaseMessageAttachment",
      function_name:
        "grainline_direct_upload_case_attachment_reference_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_commission_request_delete",
      table_name: "CommissionRequest",
      function_name: "grainline_direct_upload_source_delete_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_legacy_message_delete",
      table_name: "Message",
      function_name: "grainline_direct_upload_source_delete_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_listing_delete",
      table_name: "Listing",
      function_name: "grainline_direct_upload_source_delete_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_review_delete",
      table_name: "Review",
      function_name: "grainline_direct_upload_source_delete_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_seller_broadcast_delete",
      table_name: "SellerBroadcast",
      function_name: "grainline_direct_upload_source_delete_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_release_seller_profile_delete",
      table_name: "SellerProfile",
      function_name: "grainline_direct_upload_source_delete_trigger",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_direct_upload_status_transition",
      table_name: "DirectUpload",
      function_name: "grainline_direct_upload_status_transition",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
  ]);
}

async function verifyFunctionCatalog(
  client,
  migrationRole = REVIEWED_MIGRATION_ROLE,
) {
  const functionNames = DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.map(
    (entry) => entry.name,
  );
  const result = await client.query(
    `
      SELECT
        procedure.proname AS function_name,
        pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
        procedure.prosecdef AS security_definer,
        procedure.proconfig AS function_config,
        pg_catalog.has_function_privilege(
          CURRENT_USER,
          procedure.oid,
          'EXECUTE'
        ) AS runtime_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = ANY($1::text[])
      ORDER BY procedure.proname
    `,
    [functionNames],
  );
  assert.equal(result.rows.length, DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.length);
  const securityInvoker = new Set([
    "grainline_direct_upload_identity_immutable",
    "grainline_direct_upload_message_url_core",
    "grainline_direct_upload_status_transition",
    "grainline_direct_upload_utc_now",
  ]);
  for (const expected of DIRECT_UPLOAD_AUTHORITY_FUNCTIONS) {
    const row = result.rows.find(
      (candidate) => candidate.function_name === expected.name,
    );
    assert.ok(row, `missing DirectUpload function ${expected.name}`);
    assert.equal(row.owner_name, migrationRole);
    assert.deepEqual(row.function_config, ["search_path=pg_catalog"]);
    assert.equal(row.runtime_execute, expected.runtimeExecute);
    assert.equal(row.public_execute, false);
    assert.equal(row.security_definer, !securityInvoker.has(expected.name));
  }
}

async function expectInsufficientPrivilege(client, operation, label) {
  await client.query("SAVEPOINT direct_upload_expected_denial");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT direct_upload_expected_denial");
  await client.query("RELEASE SAVEPOINT direct_upload_expected_denial");
  assert.equal(caught?.code, "42501", `${label} did not fail with 42501`);
}

async function proveReadOnlyRuntimeBoundary(client) {
  await client.query("SET LOCAL statement_timeout = '10s'");
  await expectInsufficientPrivilege(
    client,
    () => client.query(`SELECT * FROM public."DirectUploadReference" LIMIT 1`),
    "DirectUploadReference direct read",
  );
  await expectInsufficientPrivilege(
    client,
    () =>
      client.query(`
        SELECT public.grainline_direct_upload_sync_public_core(
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::text[],
          NULL::text[]
        )
      `),
    "generic DirectUpload reference core",
  );

  const ownedLookup = await client.query(`
    SELECT *
    FROM public.grainline_direct_upload_owned_lookup(
      'direct-upload-postflight-invalid-actor',
      'direct-upload-postflight/invalid-key'
    )
  `);
  assert.equal(ownedLookup.rows.length, 0);
  const privateRead = await client.query(`
    SELECT *
    FROM public.grainline_direct_upload_case_attachment_read(
      'direct-upload-postflight-invalid-actor',
      'direct-upload-postflight-invalid-case',
      'direct-upload-postflight-invalid-attachment'
    )
  `);
  assert.equal(privateRead.rows.length, 0);
}

async function assertReadOnlyTransaction(client) {
  const result = await client.query(`
    SELECT pg_catalog.current_setting('transaction_read_only') AS read_only
  `);
  assert.equal(
    result.rows[0]?.read_only,
    "on",
    "DirectUpload production postflight transaction is not read-only",
  );
}

export async function proveDirectUploadPreparationRuntimeCatalog(
  client,
  {
    migrationRole = REVIEWED_MIGRATION_ROLE,
    verifyProductionIdentity = false,
  } = {},
) {
  await client.query("BEGIN TRANSACTION READ ONLY");
  let transactionOpen = true;
  try {
    await assertReadOnlyTransaction(client);
    if (verifyProductionIdentity) await verifyRuntimeIdentity(client);
    await verifyTablePosture(client, migrationRole);
    await verifyCompatibilityCatalog(client);
    await verifyFunctionCatalog(client, migrationRole);
    await proveReadOnlyRuntimeBoundary(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
  }
}

export async function runDirectUploadPreparationPostflight(config) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-direct-upload-preparation-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  try {
    await proveDirectUploadPreparationRuntimeCatalog(client, {
      verifyProductionIdentity: true,
    });
    return Object.freeze({
      status: "passed",
      releaseCommit: config.releaseCommit,
      mainCiRunId: config.mainCiRunId,
      migrationRunId: config.migrationRunId,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      directUploadRlsEnabled: false,
      directUploadRlsForced: false,
      legacyDirectUploadCrudRetained: true,
      referenceLedgerRlsEnabled: true,
      referenceLedgerRlsForced: true,
      referenceLedgerPolicyCount: 0,
      referenceLedgerRuntimeTableAccess: false,
      reviewedUnvalidatedDirectUploadConstraintCount: 6,
      validatedCaseAttachmentDirectUploadConstraintCount: 2,
      reviewedTriggerCount: 13,
      functionCount: DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.length,
      privateFunctionCount: DIRECT_UPLOAD_PRIVATE_FUNCTION_NAMES.length,
      wholePostflightTransactionReadOnly: true,
      postflightReadOnly: true,
      productionChangedByPostflight: false,
      completedChecks: [
        "whole_postflight_read_only_transaction",
        "actual_pooled_runtime_role_identity",
        "compatible_direct_upload_and_service_only_reference_table_posture",
        "dual_column_exact_constraint_and_full_trigger_catalog",
        "exact_direct_upload_function_acl_and_search_path_catalog",
        "reference_table_and_generic_core_direct_denial",
        "fixed_lookup_and_private_read_fail_closed_for_invalid_actor",
      ],
    });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function writeDirectUploadPreparationPostflightEvidence(
  evidencePath,
  evidence,
) {
  const handle = openSync(evidencePath, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  chmodSync(evidencePath, 0o600);
}

async function main() {
  try {
    const config = parseDirectUploadPreparationPostflightConfig(process.env);
    assertDirectUploadPreparationGitState(
      readDirectUploadPreparationGitState(),
      config.releaseCommit,
    );
    const evidence = await runDirectUploadPreparationPostflight(config);
    writeDirectUploadPreparationPostflightEvidence(
      config.evidencePath,
      evidence,
    );
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload preparation production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
