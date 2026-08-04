#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
} from "./direct-upload-activation-catalog.mjs";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "./direct-upload-activation-failure-inspect.mjs";
import {
  readDirectUploadActivationDetailedFunctions,
} from "./direct-upload-activation-production-recovery.mjs";
import {
  readDirectUploadCleanupAuthority,
} from "./direct-upload-cleanup-worker.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "./verify-direct-upload-activation-release.mjs";

const { Client } = pg;
const DATABASE_NAME = "grainline_ci";
const DATABASE_ENV = "DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_DATABASE_URL";
const MODES = Object.freeze(["failed", "resolved", "activated"]);
const LISTING_VARIANTS_CHECKSUM = createHash("sha256").update(
  readFileSync(
    `prisma/migrations/${LISTING_VARIANTS_REVIEWED_MIGRATION}/migration.sql`,
    "utf8",
  ),
).digest("hex");

export const DIRECT_UPLOAD_ACTIVATION_REVIEWED_MEMBERSHIPS = Object.freeze([
  Object.freeze({
    admin_option: true,
    granted_role: "grainline_app_runtime",
    grantor_role: "cloud_admin",
    inherit_option: false,
    member_role: "neondb_owner",
    set_option: false,
  }),
  Object.freeze({
    admin_option: true,
    granted_role: "grainline_direct_upload_cleanup_v2",
    grantor_role: "cloud_admin",
    inherit_option: false,
    member_role: "neondb_owner",
    set_option: false,
  }),
]);

export function parseDirectUploadActivationRecoveryProofConfig(
  env = process.env,
  argv = process.argv.slice(2),
) {
  assert.equal(argv.length, 1, "DirectUpload recovery proof requires one mode");
  const mode = argv[0]?.replace(/^--/u, "");
  assert.ok(MODES.includes(mode), "DirectUpload recovery proof mode is invalid");
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "DirectUpload recovery proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `DirectUpload recovery proof requires ${DATABASE_NAME}`,
  );
  return Object.freeze({ databaseUrl, mode });
}

function assertExactMembership(rows) {
  assert.deepEqual(rows, DIRECT_UPLOAD_ACTIVATION_REVIEWED_MEMBERSHIPS);
}

function assertCompatibleTables(rows) {
  assert.deepEqual(rows, [
    {
      cleanup_crud: false,
      policy_count: 0,
      relforcerowsecurity: false,
      relname: "DirectUpload",
      relrowsecurity: false,
      runtime_crud: true,
    },
    {
      cleanup_crud: false,
      policy_count: 0,
      relforcerowsecurity: true,
      relname: "DirectUploadReference",
      relrowsecurity: true,
      runtime_crud: false,
    },
  ]);
}

function assertActivatedTables(rows) {
  assert.deepEqual(rows, [
    {
      cleanup_crud: false,
      policy_count: 0,
      relforcerowsecurity: true,
      relname: "DirectUpload",
      relrowsecurity: true,
      runtime_crud: false,
    },
    {
      cleanup_crud: false,
      policy_count: 0,
      relforcerowsecurity: true,
      relname: "DirectUploadReference",
      relrowsecurity: true,
      runtime_crud: false,
    },
  ]);
}

function assertLedger(mode, rows) {
  const oldRows = rows.filter(
    (row) => row.checksum === FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
  );
  const correctedRows = rows.filter(
    (row) => row.checksum === DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
  );
  assert.equal(oldRows.length, 1, "failed activation ledger row is not exact");
  const failed = oldRows[0];
  assert.equal(failed.finished, false);
  assert.equal(failed.applied_steps_count, 0);
  if (mode === "failed") {
    assert.equal(rows.length, 1);
    assert.equal(failed.rolled_back, false);
    assert.equal(correctedRows.length, 0);
    return;
  }
  assert.equal(failed.rolled_back, true);
  if (mode === "resolved") {
    assert.equal(rows.length, 1);
    assert.equal(correctedRows.length, 0);
    return;
  }
  assert.equal(rows.length, 2);
  assert.equal(correctedRows.length, 1);
  assert.deepEqual(correctedRows[0], {
    applied_steps_count: 1,
    checksum: DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
    finished: true,
    rolled_back: false,
  });
}

function assertListingVariantsLedgerAlias(rows) {
  assert.deepEqual(rows, [
    {
      applied_steps_count: 1,
      checksum: LISTING_VARIANTS_CHECKSUM,
      finished: true,
      migration_name: LISTING_VARIANTS_REVIEWED_MIGRATION,
      rolled_back: false,
    },
    {
      applied_steps_count: 0,
      checksum: LISTING_VARIANTS_CHECKSUM,
      finished: false,
      migration_name: LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
      rolled_back: true,
    },
  ]);
}

function assertTypeOnlyFunctionIdentities(rows, label) {
  const actual = rows
    .map((row) => ({
      function_name: row.function_name,
      identity_arguments: row.identity_arguments,
    }))
    .sort((left, right) =>
      left.function_name.localeCompare(right.function_name));
  const expected = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.identityArguments,
    }))
    .sort((left, right) =>
      left.function_name.localeCompare(right.function_name));
  assert.deepEqual(
    actual,
    expected,
    `${label} function identities are not type-only`,
  );
}

export async function proveDirectUploadActivationRecovery(config) {
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: `grainline-direct-upload-activation-recovery-${config.mode}`,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const identity = (await client.query(`
      SELECT
        current_database() AS database_name,
        current_user AS current_user,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `)).rows[0];
    assert.deepEqual(identity, {
      current_user: "ci",
      database_name: DATABASE_NAME,
      read_only: "on",
    });
    const listingVariantsLedger = (await client.query(`
      SELECT
        migration_name,
        checksum,
        finished_at IS NOT NULL AS finished,
        rolled_back_at IS NOT NULL AS rolled_back,
        applied_steps_count::integer AS applied_steps_count
      FROM public._prisma_migrations
      WHERE migration_name = ANY($1::text[])
      ORDER BY pg_catalog.array_position($1::text[], migration_name), id
    `, [[
      LISTING_VARIANTS_REVIEWED_MIGRATION,
      LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
    ]])).rows;
    assertListingVariantsLedgerAlias(listingVariantsLedger);
    const ledger = (await client.query(`
      SELECT
        checksum,
        finished_at IS NOT NULL AS finished,
        rolled_back_at IS NOT NULL AS rolled_back,
        applied_steps_count::integer AS applied_steps_count
      FROM public._prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at, id
    `, [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName])).rows;
    assertLedger(config.mode, ledger);
    const memberships = (await client.query(`
      SELECT
        granted_role.rolname AS granted_role,
        member.rolname AS member_role,
        grantor.rolname AS grantor_role,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor
        ON grantor.oid = membership.grantor
      WHERE member.rolname IN (
              'grainline_app_runtime',
              'grainline_direct_upload_cleanup_v2'
            )
         OR granted_role.rolname IN (
              'grainline_app_runtime',
              'grainline_direct_upload_cleanup_v2'
            )
      ORDER BY granted_role.rolname, member.rolname, grantor.rolname
    `)).rows;
    assertExactMembership(memberships);
    const tables = (await client.query(`
      SELECT
        class.relname,
        class.relrowsecurity,
        class.relforcerowsecurity,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid) AS policy_count,
        (
          pg_catalog.has_table_privilege(
            'grainline_app_runtime', class.oid, 'SELECT'
          )
          AND pg_catalog.has_table_privilege(
            'grainline_app_runtime', class.oid, 'INSERT'
          )
          AND pg_catalog.has_table_privilege(
            'grainline_app_runtime', class.oid, 'UPDATE'
          )
          AND pg_catalog.has_table_privilege(
            'grainline_app_runtime', class.oid, 'DELETE'
          )
        ) AS runtime_crud,
        (
          pg_catalog.has_table_privilege(
            'grainline_direct_upload_cleanup_v2', class.oid, 'SELECT'
          )
          OR pg_catalog.has_table_privilege(
            'grainline_direct_upload_cleanup_v2', class.oid, 'INSERT'
          )
          OR pg_catalog.has_table_privilege(
            'grainline_direct_upload_cleanup_v2', class.oid, 'UPDATE'
          )
          OR pg_catalog.has_table_privilege(
            'grainline_direct_upload_cleanup_v2', class.oid, 'DELETE'
          )
        ) AS cleanup_crud
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relname IN ('DirectUpload', 'DirectUploadReference')
      ORDER BY class.relname
    `)).rows;
    if (config.mode === "activated") assertActivatedTables(tables);
    else assertCompatibleTables(tables);
    const functionCount = Number((await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname LIKE 'grainline\\_direct\\_upload\\_%'
          ESCAPE '\\'
    `)).rows[0]?.count);
    assert.equal(functionCount, 35);
    const recoveryFunctions =
      await readDirectUploadActivationDetailedFunctions(client);
    assertTypeOnlyFunctionIdentities(
      recoveryFunctions,
      "production recovery reader",
    );
    const cleanupSnapshot = await readDirectUploadCleanupAuthority(client);
    assertTypeOnlyFunctionIdentities(
      cleanupSnapshot.functions,
      "cleanup and activation-postflight reader",
    );
    const namedArgumentFunctionCount = Number((await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname LIKE 'grainline\\_direct\\_upload\\_%'
          ESCAPE '\\'
        AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
              IS DISTINCT FROM
            pg_catalog.oidvectortypes(procedure.proargtypes)
    `)).rows[0]?.count);
    assert.equal(
      namedArgumentFunctionCount,
      DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
        .filter((entry) => entry.identityArguments !== "").length,
      "named-argument fixture no longer exercises type-only normalization",
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      correctedChecksum: DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
      failedChecksum: FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
      functionCount,
      historicalListingVariantsAliasRows: listingVariantsLedger.length,
      ledgerRows: ledger.length,
      mode: config.mode,
      namedArgumentFunctionCount,
      persistentEnvironmentChanged: false,
      productionChanged: false,
      signatureReaderFunctionCount: recoveryFunctions.length,
      status: "passed",
      transactionReadOnly: true,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const config = parseDirectUploadActivationRecoveryProofConfig();
    const result = await proveDirectUploadActivationRecovery(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation recovery proof failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
