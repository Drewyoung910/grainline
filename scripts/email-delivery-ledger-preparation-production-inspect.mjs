#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { assertReviewedPeerMigrationLedger } from "./order-refund-immutable-event-production-ledger.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import { isReviewedSuccessfulMigration } from "./reviewed-manually-applied-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATION = "20261025010000_prepare_email_delivery_ledger";
export const MIGRATION_SHA256 =
  "4d30e75337b9713bca643b4b4c5db1a247e913995448ea89e09929e4fba0405d";
export const NEXT_MIGRATION =
  "20261025020000_fence_email_provider_and_account_deletion";
export const NEXT_MIGRATION_SHA256 =
  "4d30904d8cb094b403ef9adc4d4268f979d408137aeb228b59a95bca7858cace";

export const COLUMN_EXPECTATIONS = Object.freeze([
  ["EmailOutbox", "payloadVersion", "integer", false, null],
  ["EmailOutbox", "payload", "jsonb", false, null],
  ["EmailOutbox", "lane", "character varying(20)", false, null],
  ["EmailOutbox", "claimGeneration", "bigint", true, "0"],
  ["EmailOutbox", "claimToken", "uuid", false, null],
  ["EmailOutbox", "processingStartedAt", "timestamp(3) without time zone", false, null],
  ["EmailOutbox", "firstProviderAttemptAt", "timestamp(3) without time zone", false, null],
  ["EmailOutbox", "providerAttemptGeneration", "bigint", false, null],
  ["EmailOutbox", "providerMessageId", "character varying(255)", false, null],
  ["EmailOutbox", "acknowledgedAt", "timestamp(3) without time zone", false, null],
  ["EmailOutbox", "acknowledgedById", "character varying(191)", false, null],
  ["EmailOutbox", "acknowledgement", "character varying(1000)", false, null],
  ["ResendWebhookEvent", "claimGeneration", "bigint", true, "0"],
  ["ResendWebhookEvent", "claimToken", "uuid", false, null],
  ["ResendWebhookEvent", "attempts", "integer", true, "0"],
  ["ResendWebhookEvent", "nextAttemptAt", "timestamp(3) without time zone", false, null],
  ["ResendWebhookEvent", "acknowledgedAt", "timestamp(3) without time zone", false, null],
  ["ResendWebhookEvent", "acknowledgedById", "character varying(191)", false, null],
  ["ResendWebhookEvent", "acknowledgement", "character varying(1000)", false, null],
  ["NewsletterSubscriber", "deactivatedAt", "timestamp(3) without time zone", false, null],
]);

export const CONSTRAINT_NAMES = Object.freeze([
  "EmailOutbox_acknowledgement_pair_chk",
  "EmailOutbox_attempts_nonnegative_chk",
  "EmailOutbox_claimGeneration_chk",
  "EmailOutbox_claim_pair_chk",
  "EmailOutbox_lane_chk",
  "EmailOutbox_payloadVersion_chk",
  "EmailOutbox_payload_size_chk",
  "EmailOutbox_providerAttemptGeneration_chk",
  "EmailOutbox_representation_chk",
  "EmailOutbox_source_pair_chk",
  "ResendWebhookEvent_acknowledgement_pair_chk",
  "ResendWebhookEvent_attempts_nonnegative_chk",
  "ResendWebhookEvent_claimGeneration_chk",
  "ResendWebhookEvent_claim_pair_chk",
]);

export const CONSTRAINT_EXPECTATIONS = Object.freeze(new Map([
  ["EmailOutbox_acknowledgement_pair_chk", 'CHECK ("acknowledgedAt" IS NULL AND "acknowledgedById" IS NULL AND acknowledgement IS NULL OR "acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND acknowledgement IS NOT NULL)'],
  ["EmailOutbox_attempts_nonnegative_chk", "CHECK (attempts >= 0)"],
  ["EmailOutbox_claimGeneration_chk", 'CHECK ("claimGeneration" >= 0)'],
  ["EmailOutbox_claim_pair_chk", 'CHECK (("claimToken" IS NULL) = ("processingStartedAt" IS NULL))'],
  ["EmailOutbox_lane_chk", "CHECK (lane IS NULL OR (lane::text = ANY (ARRAY['TRANSACTIONAL'::character varying, 'OPTIONAL'::character varying]::text[])))"],
  ["EmailOutbox_payloadVersion_chk", 'CHECK ("payloadVersion" IS NULL OR "payloadVersion" > 0)'],
  ["EmailOutbox_payload_size_chk", "CHECK (payload IS NULL OR octet_length(payload::text) <= 131072)"],
  ["EmailOutbox_providerAttemptGeneration_chk", 'CHECK ("providerAttemptGeneration" IS NULL OR "providerAttemptGeneration" >= 1 AND "providerAttemptGeneration" <= "claimGeneration")'],
  ["EmailOutbox_representation_chk", 'CHECK (subject IS NOT NULL AND html IS NOT NULL AND payload IS NULL AND "payloadVersion" IS NULL OR subject IS NULL AND html IS NULL AND payload IS NOT NULL AND "payloadVersion" IS NOT NULL)'],
  ["EmailOutbox_source_pair_chk", 'CHECK (("sourceType" IS NULL) = ("sourceId" IS NULL))'],
  ["ResendWebhookEvent_acknowledgement_pair_chk", 'CHECK ("acknowledgedAt" IS NULL AND "acknowledgedById" IS NULL AND acknowledgement IS NULL OR "acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND acknowledgement IS NOT NULL)'],
  ["ResendWebhookEvent_attempts_nonnegative_chk", "CHECK (attempts >= 0)"],
  ["ResendWebhookEvent_claimGeneration_chk", 'CHECK ("claimGeneration" >= 0)'],
  ["ResendWebhookEvent_claim_pair_chk", 'CHECK (("claimToken" IS NULL) = ("processingStartedAt" IS NULL))'],
]));

export const FUNCTION_EXPECTATIONS = Object.freeze(new Map([
  ["public.grainline_email_outbox_safe_error(text)", {
    sourceMd5: "583278f5f0575cef6a1811d0919a6d03",
    language: "sql", securityDefiner: false, volatility: "i",
    parallelSafety: "s", runtimeExecute: false,
  }],
  ["public.grainline_email_outbox_effective_lane(text,text)", {
    sourceMd5: "55bbc20bd42b6dccb6cd6a0ffa328bd1",
    language: "plpgsql", securityDefiner: false, volatility: "i",
    parallelSafety: "s", runtimeExecute: false,
  }],
  ["public.grainline_email_delivery_is_hard_suppressed(text)", {
    sourceMd5: "6b750d9a2961792b8da8c117d9dec685",
    language: "sql", securityDefiner: true, volatility: "s",
    parallelSafety: "u", runtimeExecute: false,
  }],
  ["public.grainline_email_outbox_recipient_state(text,text,text,text)", {
    sourceMd5: "036514fdf0fc95a27bf9959380cb2f2c",
    language: "plpgsql", securityDefiner: true, volatility: "s",
    parallelSafety: "u", runtimeExecute: false,
  }],
  ["public.grainline_email_outbox_claim_core(text,integer)", {
    sourceMd5: "62aee9c9565d4b0c30556af129a28475",
    language: "plpgsql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: false,
  }],
  ["public.grainline_email_outbox_claim_batch(integer)", {
    sourceMd5: "4e033d776196709d8c17388b744c6f9e",
    language: "sql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: true,
  }],
  ["public.grainline_email_outbox_claim_one(text)", {
    sourceMd5: "35dd25c8223ef0e2bfd4c312c0380270",
    language: "sql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: true,
  }],
  ["public.grainline_email_outbox_defer(text,bigint,uuid,text)", {
    sourceMd5: "0c291ba6169c23491ec166210808a748",
    language: "plpgsql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: true,
  }],
  ["public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)", {
    sourceMd5: "b0abfa8d5e33ad55edd0ab3e10362c38",
    language: "plpgsql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: true,
  }],
  ["public.grainline_email_outbox_complete(text,bigint,uuid,text)", {
    sourceMd5: "e5d5e634e9e3245bcf305bd481571418",
    language: "plpgsql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: true,
  }],
  ["public.grainline_email_outbox_fail(text,bigint,uuid,text,text)", {
    sourceMd5: "c53166b8966de15f7f110cdbc46dd728",
    language: "plpgsql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: true,
  }],
  ["public.grainline_email_outbox_skip(text,bigint,uuid,text)", {
    sourceMd5: "286127a482a77d9c1506ee60550f90e8",
    language: "plpgsql", securityDefiner: true, volatility: "v",
    parallelSafety: "u", runtimeExecute: true,
  }],
]));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationPath(name) {
  return path.join(ROOT, "prisma/migrations", name, "migration.sql");
}

function repositoryChecksum(name) {
  return sha256(readFileSync(migrationPath(name)));
}

function migrationDirectories() {
  return readdirSync(path.join(ROOT, "prisma/migrations"), {
    withFileTypes: true,
  })
    .filter(
      (entry) => entry.isDirectory() && /^[0-9]{14}_[a-z0-9_]+$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

function frozenRows(rows, arrayKeys = []) {
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    ...Object.fromEntries(
      arrayKeys.map((key) => [key, Object.freeze([...(row[key] ?? [])])]),
    ),
  })));
}

export async function readPreparationCatalog(client) {
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user,
           SESSION_USER::text AS session_user,
           pg_catalog.current_database()::text AS database_name,
           pg_catalog.current_setting('transaction_read_only') AS read_only,
           pg_catalog.current_setting('transaction_isolation') AS isolation,
           owner.rolsuper AS owner_superuser,
           owner.rolbypassrls AS owner_bypass_rls,
           runtime.rolsuper AS runtime_superuser,
           runtime.rolbypassrls AS runtime_bypass_rls,
           runtime.rolinherit AS runtime_inherit
      FROM pg_catalog.pg_roles AS owner
      JOIN pg_catalog.pg_roles AS runtime
        ON runtime.rolname = 'grainline_app_runtime'
     WHERE owner.rolname = CURRENT_USER
  `);
  assert.equal(identity.rows.length, 1, "database roles are missing or ambiguous");

  const tables = await client.query(`
    SELECT class.relname::text AS table_name,
           pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
           owner.rolsuper AS owner_superuser,
           owner.rolbypassrls AS owner_bypass_rls,
           class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = class.relowner
     WHERE namespace.nspname = 'public'
       AND class.relname = ANY($1::text[])
       AND class.relkind = 'r'
     ORDER BY class.relname
  `, [["EmailOutbox", "EmailSuppression", "NewsletterSubscriber", "ResendWebhookEvent"]]);

  const requestedColumns = COLUMN_EXPECTATIONS.map(([tableName, columnName]) =>
    `${tableName}.${columnName}`,
  );
  const columns = await client.query(`
    SELECT class.relname::text || '.' || attribute.attname::text AS identity,
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text AS type_name,
           attribute.attnotnull AS not_null,
           CASE WHEN definition.oid IS NULL THEN NULL
                ELSE pg_catalog.pg_get_expr(definition.adbin, definition.adrelid)
            END AS default_expression
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef AS definition
        ON definition.adrelid = attribute.attrelid
       AND definition.adnum = attribute.attnum
     WHERE namespace.nspname = 'public'
       AND class.relname || '.' || attribute.attname = ANY($1::text[])
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY 1
  `, [requestedColumns]);

  const legacyColumns = await client.query(`
    SELECT attribute.attname::text AS column_name,
           attribute.attnotnull AS not_null
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."EmailOutbox"'::pg_catalog.regclass
       AND attribute.attname = ANY($1::text[])
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY attribute.attname
  `, [["html", "subject"]]);

  const constraints = await client.query(`
    SELECT constraint_row.conname::text AS name,
           constraint_row.convalidated AS validated,
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)::text AS definition
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid IN (
       'public."EmailOutbox"'::pg_catalog.regclass,
       'public."ResendWebhookEvent"'::pg_catalog.regclass
     )
       AND constraint_row.conname = ANY($1::text[])
     ORDER BY constraint_row.conname
  `, [CONSTRAINT_NAMES]);

  const index = await client.query(`
    SELECT index_class.oid IS NOT NULL AS index_exists,
           COALESCE(index.indisvalid, false) AS valid,
           COALESCE(index.indisready, false) AS ready,
           CASE WHEN index_class.oid IS NULL THEN NULL
                ELSE pg_catalog.pg_get_indexdef(index_class.oid) END AS definition
      FROM (VALUES (1)) AS singleton(value)
      LEFT JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = pg_catalog.to_regclass(
          'public."EmailOutbox_status_lane_nextAttemptAt_createdAt_id_idx"'
        )
      LEFT JOIN pg_catalog.pg_index AS index ON index.indexrelid = index_class.oid
  `);

  const functions = await client.query(`
    WITH requested AS (
      SELECT identity, ordinal,
             pg_catalog.to_regprocedure(identity) AS oid
        FROM pg_catalog.unnest($1::text[]) WITH ORDINALITY AS item(identity, ordinal)
    )
    SELECT requested.identity,
           procedure.oid IS NOT NULL AS function_exists,
           pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
           owner.rolsuper AS owner_superuser,
           owner.rolbypassrls AS owner_bypass_rls,
           language.lanname::text AS language_name,
           procedure.prokind AS function_kind,
           procedure.prosecdef AS security_definer,
           procedure.proleakproof AS leakproof,
           procedure.provolatile AS volatility,
           procedure.proparallel AS parallel_safety,
           COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
             AS contains_dynamic_execute,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS runtime_execute,
           pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
             AS public_execute,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
              WHERE acl.grantee <> procedure.proowner
              ORDER BY 1
           ) AS nonowner_acl
      FROM requested
      LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = requested.oid
      LEFT JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     ORDER BY requested.ordinal
  `, [[...FUNCTION_EXPECTATIONS.keys()]]);

  const hasDeactivatedAt = columns.rows.some(
    (row) => row.identity === "NewsletterSubscriber.deactivatedAt",
  );
  let inactiveMissingDeactivatedAt = null;
  if (hasDeactivatedAt) {
    const posture = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."NewsletterSubscriber"
       WHERE active = false
         AND "deactivatedAt" IS NULL
    `);
    inactiveMissingDeactivatedAt = posture.rows[0].count;
  }

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    tables: frozenRows(tables.rows),
    columns: frozenRows(columns.rows),
    legacyColumns: frozenRows(legacyColumns.rows),
    constraints: frozenRows(constraints.rows),
    index: Object.freeze(index.rows[0]),
    functions: frozenRows(functions.rows, ["function_config", "nonowner_acl"]),
    inactiveMissingDeactivatedAt,
  });
}

function verifyIdentityAndTables(catalog) {
  assert.equal(catalog.identity.current_user, "neondb_owner");
  assert.equal(catalog.identity.session_user, "neondb_owner");
  assert.equal(catalog.identity.database_name, "neondb");
  assert.equal(catalog.identity.read_only, "on");
  assert.equal(catalog.identity.isolation, "repeatable read");
  assert.equal(
    catalog.identity.owner_superuser || catalog.identity.owner_bypass_rls,
    true,
  );
  assert.equal(catalog.identity.runtime_superuser, false);
  assert.equal(catalog.identity.runtime_bypass_rls, false);
  assert.equal(catalog.identity.runtime_inherit, false);
  assert.deepEqual(
    catalog.tables.map((row) => row.table_name),
    ["EmailOutbox", "EmailSuppression", "NewsletterSubscriber", "ResendWebhookEvent"],
  );
  for (const table of catalog.tables) {
    assert.equal(table.owner_name, "neondb_owner");
    assert.equal(table.owner_superuser || table.owner_bypass_rls, true);
    assert.equal(table.rls_enabled, false);
    assert.equal(table.rls_forced, false);
  }
  assert.deepEqual(catalog.legacyColumns.map((row) => row.column_name), ["html", "subject"]);
}

function verifyFunction(row, expected) {
  assert.equal(row.function_exists, true, `${row.identity} is absent`);
  assert.equal(row.owner_name, "neondb_owner");
  assert.equal(row.owner_superuser || row.owner_bypass_rls, true);
  assert.equal(row.language_name, expected.language);
  assert.equal(row.function_kind, "f");
  assert.equal(row.security_definer, expected.securityDefiner);
  assert.equal(row.leakproof, false);
  assert.equal(row.volatility, expected.volatility);
  assert.equal(row.parallel_safety, expected.parallelSafety);
  assert.deepEqual(row.function_config, ["search_path=pg_catalog"]);
  assert.equal(row.source_md5, expected.sourceMd5, `${row.identity} body drifted`);
  assert.equal(row.contains_dynamic_execute, false);
  assert.equal(row.runtime_execute, expected.runtimeExecute);
  assert.equal(row.public_execute, false);
  assert.deepEqual(
    row.nonowner_acl,
    expected.runtimeExecute
      ? ["grainline_app_runtime:EXECUTE:false"]
      : [],
  );
}

export function preparationSourceFamily(catalog) {
  verifyIdentityAndTables(catalog);
  const existingFunctions = catalog.functions.filter((row) => row.function_exists);
  if (
    catalog.columns.length === 0
    && existingFunctions.length === 0
    && catalog.constraints.length === 0
    && catalog.index.index_exists === false
  ) {
    assert.deepEqual(
      catalog.legacyColumns.map((row) => row.not_null),
      [true, true],
    );
    assert.equal(catalog.inactiveMissingDeactivatedAt, null);
    return "predecessor";
  }

  assert.equal(catalog.columns.length, COLUMN_EXPECTATIONS.length);
  const actualColumns = new Map(catalog.columns.map((row) => [row.identity, row]));
  for (const [tableName, columnName, typeName, notNull, defaultExpression] of COLUMN_EXPECTATIONS) {
    const identity = `${tableName}.${columnName}`;
    const row = actualColumns.get(identity);
    assert.ok(row, `${identity} is absent`);
    assert.equal(row.type_name, typeName, `${identity} type drifted`);
    assert.equal(row.not_null, notNull, `${identity} nullability drifted`);
    assert.equal(
      row.default_expression,
      defaultExpression,
      `${identity} default drifted`,
    );
  }
  assert.deepEqual(catalog.legacyColumns.map((row) => row.not_null), [false, false]);
  assert.deepEqual(
    catalog.constraints.map((row) => row.name),
    [...CONSTRAINT_NAMES],
  );
  assert.ok(catalog.constraints.every((row) => row.validated));
  for (const row of catalog.constraints) {
    assert.equal(
      row.definition,
      CONSTRAINT_EXPECTATIONS.get(row.name),
      `${row.name} definition drifted`,
    );
  }
  assert.equal(catalog.index.index_exists, true);
  assert.equal(catalog.index.valid, true);
  assert.equal(catalog.index.ready, true);
  assert.match(
    catalog.index.definition,
    /USING btree \(status, lane, "nextAttemptAt", "createdAt", id\)$/u,
  );
  assert.equal(catalog.functions.length, FUNCTION_EXPECTATIONS.size);
  for (const row of catalog.functions) {
    verifyFunction(row, FUNCTION_EXPECTATIONS.get(row.identity));
  }
  assert.equal(catalog.inactiveMissingDeactivatedAt, 0);
  return "successor";
}

export function verifyPreparationCatalog(catalog, ledgerState) {
  const sourceFamily = preparationSourceFamily(catalog);
  if (ledgerState === "pending") assert.equal(sourceFamily, "predecessor");
  if (ledgerState === "applied") assert.equal(sourceFamily, "successor");
  return Object.freeze({
    ledgerState,
    sourceFamily,
    tableCount: catalog.tables.length,
    columnCount: catalog.columns.length,
    constraintCount: catalog.constraints.length,
    functionCount: catalog.functions.filter((row) => row.function_exists).length,
    inactiveMissingDeactivatedAt: catalog.inactiveMissingDeactivatedAt,
    containsRowData: false,
    productionChanged: false,
  });
}

function isTerminalZeroStepRollback(row) {
  return row?.finished_at === null
    && row?.rolled_back_at !== null
    && row?.rolled_back_at !== undefined
    && Number(row?.applied_steps_count) === 0;
}

export function preparationMigrationLedgerState(candidateRows) {
  assert.ok(Array.isArray(candidateRows), "candidate ledger rows are invalid");
  const successful = candidateRows.filter(isReviewedSuccessfulMigration);
  assert.ok(successful.length <= 1, "candidate has duplicate successful rows");
  if (successful.length === 1) {
    assert.equal(successful[0].migration_name, MIGRATION);
    assert.equal(successful[0].checksum, MIGRATION_SHA256);
  }
  const accepted = successful[0];
  assert.ok(
    candidateRows
      .filter((row) => row !== accepted)
      .every(isTerminalZeroStepRollback),
    "candidate has an unresolved or partial failed attempt",
  );
  return successful.length === 1 ? "applied" : "pending";
}

async function inspectLedger(client) {
  const directories = migrationDirectories();
  assert.equal(directories.at(-2), MIGRATION, "preparation is not the penultimate migration");
  assert.equal(directories.at(-1), NEXT_MIGRATION, "fence is not the latest migration");
  assert.equal(repositoryChecksum(MIGRATION), MIGRATION_SHA256);
  assert.equal(repositoryChecksum(NEXT_MIGRATION), NEXT_MIGRATION_SHA256);
  const ledger = await client.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name, started_at
  `, [directories]);
  const byName = new Map();
  for (const row of ledger.rows) {
    const rows = byName.get(row.migration_name) ?? [];
    rows.push(row);
    byName.set(row.migration_name, rows);
  }
  for (const peer of directories.filter(
    (name) => name !== MIGRATION && name !== NEXT_MIGRATION,
  )) {
    assertReviewedPeerMigrationLedger({
      migrationName: peer,
      repositoryChecksum: repositoryChecksum(peer),
      rows: byName.get(peer) ?? [],
    });
  }
  assert.deepEqual(byName.get(NEXT_MIGRATION) ?? [], [], "fence ledger is not pending");
  return preparationMigrationLedgerState(byName.get(MIGRATION) ?? []);
}

function releaseState(ledgerState, sourceFamily) {
  if (ledgerState === "applied") return "applied";
  return sourceFamily === "successor" ? "applied_unrecorded" : "pending";
}

async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "preflight" || mode === "postflight", "mode is invalid");
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is missing");
  assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is missing");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.match(
    process.env.PRODUCTION_MIGRATION_RELEASE_COMMIT ?? "",
    /^[0-9a-f]{40}$/u,
  );
  assert.equal(Object.hasOwn(process.env, "DATABASE_URL"), false);

  const beforePath = path.join(
    process.env.RUNNER_TEMP,
    "email-delivery-ledger-preparation-preflight.json",
  );
  const parsedUrl = new URL(process.env.DIRECT_URL);
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 45_000,
    query_timeout: 50_000,
    application_name: "grainline-email-delivery-ledger-preparation-release",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const ledgerState = await inspectLedger(client);
    const catalog = await readPreparationCatalog(client);
    const result = verifyPreparationCatalog(catalog, ledgerState);
    const state = releaseState(ledgerState, result.sourceFamily);
    if (mode === "preflight") {
      writeFileSync(beforePath, JSON.stringify({ state, result }, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    } else {
      assert.equal(state, "applied", "preparation migration is not fully recorded");
      assert.equal(result.sourceFamily, "successor");
      const before = JSON.parse(readFileSync(beforePath, "utf8"));
      assert.ok(["pending", "applied_unrecorded", "applied"].includes(before.state));
      writeFileSync(
        path.join(
          process.env.RUNNER_TEMP,
          "email-delivery-ledger-preparation-result.json",
        ),
        JSON.stringify(
          {
            status: "passed",
            migration: MIGRATION,
            migrationSha256: MIGRATION_SHA256,
            releaseCommit: process.env.PRODUCTION_MIGRATION_RELEASE_COMMIT,
            before: before.result,
            after: result,
            containsRowData: false,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
