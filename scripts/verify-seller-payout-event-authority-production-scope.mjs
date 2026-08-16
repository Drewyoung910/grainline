#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "./direct-upload-activation-failure-inspect.mjs";
import {
  parseVercelRuntimeDatabaseIdentity,
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "./verify-direct-upload-activation-release.mjs";
import {
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
} from "./verify-seller-payout-event-authority-release.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const MIGRATIONS_DIRECTORY = path.join("prisma", "migrations");

export const SCHEMA_NUMERIC_GUARDS_MIGRATION =
  "20260523223000_schema_numeric_guards_and_indexes";
export const SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256 =
  "faf1ac4063a888e0405981aba57c177c4bbb33b184a8b315ace52152d21dc274";
export const SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256 =
  "0ae1197e6d8fd936e201ac793f810a42c1358bbea70f66cabffb7415f960aad6";
export const SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGES = Object.freeze([
  "before",
  "after",
  "restart",
]);
export const SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS = Object.freeze([
  Object.freeze({
    identity:
      "grainline_seller_payout_event_apply(text,bigint,bigint,text,text,integer,text,text,text)",
    language: "plpgsql",
    parallel: "u",
    volatility: "v",
  }),
  Object.freeze({
    identity: "grainline_seller_payout_export_page(text,integer,bigint,text)",
    language: "plpgsql",
    parallel: "s",
    volatility: "s",
  }),
  Object.freeze({
    identity: "grainline_seller_payout_latest_failure(text)",
    language: "sql",
    parallel: "s",
    volatility: "s",
  }),
]);

const REVIEWED_CONSTRAINTS = Object.freeze([
  "SellerPayoutEvent_amount_nonnegative_chk",
  "SellerPayoutEvent_currency_chk",
  "SellerPayoutEvent_event_created_seconds_chk",
  "SellerPayoutEvent_failed_status_chk",
  "SellerPayoutEvent_source_event_chk",
]);
const REVIEWED_INDEXES = Object.freeze([
  "SellerPayoutEvent_seller_event_time_idx",
  "SellerPayoutEvent_stripeEventId_key",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseSellerPayoutEventAuthorityScopeEnvironment(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "SellerPayoutEvent authority production scope proof",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("payout scope proof requires the manual main workflow");
  }
  const directUrl = required(env, "DIRECT_URL");
  const stage = required(env, "SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGE");
  if (!SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGES.includes(stage)) {
    throw new Error("payout scope stage must be before, after, or restart");
  }
  const identity = parseVercelRuntimeDatabaseIdentity(directUrl, "DIRECT_URL");
  const reviewed = REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
  if (
    identity.isPooler
    || identity.username !== MIGRATION_ROLE
    || identity.endpointId !== reviewed.endpointId
    || identity.region !== reviewed.region
    || identity.databaseName !== reviewed.databaseName
  ) {
    throw new Error("DIRECT_URL is not the reviewed production migration owner");
  }
  return Object.freeze({ directUrl, identity, stage });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeIdentityArguments(declarations) {
  const trimmed = declarations.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split(",").map((declaration) => {
    const tokens = declaration.trim()
      .replace(/\s+DEFAULT\s+[\s\S]*$/iu, "")
      .replace(/^IN\s+/iu, "")
      .split(/\s+/u);
    if (tokens.length < 2) {
      throw new Error("SellerPayoutEvent function argument is not named");
    }
    return tokens.slice(1).join(" ").toLowerCase();
  }).join(",");
}

export function sellerPayoutEventAuthorityFunctionSources(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    MIGRATIONS_DIRECTORY,
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const expected = new Set(
    SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.map((entry) => entry.identity),
  );
  const sources = new Map();
  const pattern = /\bCREATE\s+FUNCTION\s+public\.(grainline_seller_payout_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\3;/gu;
  for (const match of migration.matchAll(pattern)) {
    const identity = `${match[1]}(${normalizeIdentityArguments(match[2])})`;
    if (expected.has(identity)) sources.set(identity, match[4]);
  }
  const missing = [...expected].filter((identity) => !sources.has(identity));
  if (missing.length !== 0 || sources.size !== expected.size) {
    throw new Error("SellerPayoutEvent function-source catalog drifted");
  }
  return Object.freeze(Object.fromEntries([...sources].sort()));
}

export function sellerPayoutEventAuthorityFunctionSourceSha256(
  root = process.cwd(),
) {
  return Object.freeze(Object.fromEntries(
    Object.entries(sellerPayoutEventAuthorityFunctionSources(root))
      .map(([identity, source]) => [identity, sha256(source)]),
  ));
}

function isAppliedRow(row, checksum) {
  return row?.checksum === checksum
    && row.finished_at !== null
    && row.finished_at !== undefined
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1;
}

function isZeroStepRolledBackRow(row, checksum) {
  return row?.checksum === checksum
    && row.finished_at === null
    && row.rolled_back_at !== null
    && row.rolled_back_at !== undefined
    && Number(row.applied_steps_count) === 0;
}

export function readSellerPayoutEventAuthorityMigrationCatalog(
  root = process.cwd(),
) {
  const migrationsDirectory = path.join(root, MIGRATIONS_DIRECTORY);
  const catalog = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name <= SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const migrationPath = path.join(
        migrationsDirectory,
        entry.name,
        "migration.sql",
      );
      const stat = lstatSync(migrationPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`${entry.name} migration must be a regular file`);
      }
      return Object.freeze({
        migration_name: entry.name,
        checksum: sha256(readFileSync(migrationPath)),
      });
    });
  if (
    catalog.length === 0
    || new Set(catalog.map((entry) => entry.migration_name)).size
      !== catalog.length
    || catalog.at(-1)?.migration_name !== SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION
    || catalog.at(-1)?.checksum !== SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256
  ) {
    throw new Error("reviewed migration tree must end at payout authority preparation");
  }
  return Object.freeze(catalog);
}

function assertExactLedger(rows, catalog, stage) {
  if (
    !Array.isArray(rows)
    || !Array.isArray(catalog)
    || catalog.length === 0
    || catalog.at(-1)?.migration_name !== SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION
    || catalog.at(-1)?.checksum !== SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256
  ) {
    throw new Error("production ledger is not the exact payout-compatible scope");
  }
  const expectedByName = new Map(
    catalog.map((entry) => [entry?.migration_name, entry?.checksum]),
  );
  const expectedNames = new Set([
    ...expectedByName.keys(),
    LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  ]);
  const schemaNumericCurrentChecksum = expectedByName.get(
    SCHEMA_NUMERIC_GUARDS_MIGRATION,
  );
  if (
    expectedByName.size !== catalog.length
    || !expectedByName.has(CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION)
    || schemaNumericCurrentChecksum !== SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256
    || catalog.some((entry, index) =>
      index > 0
      && catalog[index - 1]?.migration_name.localeCompare(
        entry?.migration_name ?? "",
      ) >= 0
    )
    || [...expectedByName.entries()].some(([name, checksum]) =>
      typeof name !== "string"
      || !/^[0-9]{8,14}_[a-z0-9_]+$/u.test(name)
      || typeof checksum !== "string"
      || !/^[0-9a-f]{64}$/u.test(checksum)
    )
    || rows.some((row) => !expectedNames.has(row?.migration_name))
  ) {
    throw new Error("production ledger is not the exact payout-compatible scope");
  }

  const rowsFor = (name) => rows.filter((row) => row?.migration_name === name);
  const listingChecksum = expectedByName.get(LISTING_VARIANTS_REVIEWED_MIGRATION);
  const aliasRows = rowsFor(LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS);
  if (
    typeof listingChecksum !== "string"
    || aliasRows.length !== 1
    || !isZeroStepRolledBackRow(aliasRows[0], listingChecksum)
  ) {
    throw new Error("production ledger is not the exact payout-compatible scope");
  }

  for (const [name, checksum] of expectedByName) {
    if (name === SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION) continue;
    const matches = rowsFor(name);
    if (name === SCHEMA_NUMERIC_GUARDS_MIGRATION) {
      if (
        matches.length !== 1
        || !isAppliedRow(
          matches[0],
          SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
        )
      ) {
        throw new Error("production ledger is not the exact payout-compatible scope");
      }
      continue;
    }
    if (name === DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName) {
      if (
        matches.length !== 2
        || matches.filter((row) => isAppliedRow(row, checksum)).length !== 1
        || matches.filter((row) =>
          isZeroStepRolledBackRow(row, FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256)
        ).length !== 1
      ) {
        throw new Error("production ledger is not the exact payout-compatible scope");
      }
      continue;
    }
    if (matches.length !== 1 || !isAppliedRow(matches[0], checksum)) {
      throw new Error("production ledger is not the exact payout-compatible scope");
    }
  }

  const targetChecksum = expectedByName.get(
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  );
  const targetRows = rowsFor(SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION);
  const targetApplied = targetRows.length === 1
    && isAppliedRow(targetRows[0], targetChecksum);
  if (
    (stage === "before" && targetRows.length !== 0)
    || (stage === "after" && !targetApplied)
    || (stage === "restart" && targetRows.length !== 0 && !targetApplied)
  ) {
    throw new Error("production ledger is not the exact payout-compatible scope");
  }
  return targetApplied;
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function assertTablePosture(catalogState, migrationRole = MIGRATION_ROLE) {
  const table = catalogState?.table;
  if (
    !table
    || table.owner_name !== migrationRole
    || table.rls_enabled !== false
    || table.rls_forced !== false
    || Number(table.policy_count) !== 0
    || table.runtime_can_select !== true
    || table.runtime_can_insert !== true
    || table.runtime_can_update !== true
    || table.runtime_can_delete !== true
    || table.public_has_crud !== false
    || Number(table.invalid_table_acl_count) !== 0
    || Number(table.column_acl_count) !== 0
  ) {
    throw new Error("SellerPayoutEvent table posture is not compatible");
  }
}

function assertPreparedCatalog(catalogState, migrationRole = MIGRATION_ROLE) {
  const column = catalogState?.columns?.[0];
  if (
    catalogState.columns?.length !== 1
    || column.column_name !== "stripeEventCreatedSeconds"
    || column.data_type !== "bigint"
    || column.is_nullable !== "YES"
  ) {
    throw new Error("SellerPayoutEvent provider-time column is not exact");
  }

  const constraints = catalogState.constraints ?? [];
  if (
    constraints.length !== REVIEWED_CONSTRAINTS.length
    || !constraints.every((entry, index) =>
      entry.constraint_name === REVIEWED_CONSTRAINTS[index]
      && entry.constraint_type === "c"
      && entry.validated === true
    )
  ) {
    throw new Error("SellerPayoutEvent constraints are not exact and validated");
  }
  const constraintDefinitions = new Map(
    constraints.map((entry) => [entry.constraint_name, entry.definition ?? ""]),
  );
  if (
    !/status[\s\S]*'failed'/u.test(
      constraintDefinitions.get("SellerPayoutEvent_failed_status_chk") ?? "",
    )
    || !/"amountCents"[\s\S]*>= 0/u.test(
      constraintDefinitions.get("SellerPayoutEvent_amount_nonnegative_chk") ?? "",
    )
    || !/currency[\s\S]*\^\[a-z\]\{3\}\$/u.test(
      constraintDefinitions.get("SellerPayoutEvent_currency_chk") ?? "",
    )
    || !/"stripeEventId"[\s\S]*IS NOT NULL[\s\S]*btrim[\s\S]*1[\s\S]*255/u.test(
      constraintDefinitions.get("SellerPayoutEvent_source_event_chk") ?? "",
    )
    || !/"stripeEventCreatedSeconds"[\s\S]*1[\s\S]*253402300799/u.test(
      constraintDefinitions.get(
        "SellerPayoutEvent_event_created_seconds_chk",
      ) ?? "",
    )
  ) {
    throw new Error("SellerPayoutEvent constraint definitions drifted");
  }

  const indexes = catalogState.indexes ?? [];
  if (
    indexes.length !== REVIEWED_INDEXES.length
    || indexes[0]?.index_name !== "SellerPayoutEvent_seller_event_time_idx"
    || indexes[0]?.is_unique !== false
    || indexes[0]?.is_valid !== true
    || indexes[0]?.is_ready !== true
    || !/\("sellerProfileId", "stripeEventCreatedSeconds" DESC, id DESC\)/u
      .test(indexes[0]?.definition ?? "")
    || indexes[1]?.index_name !== "SellerPayoutEvent_stripeEventId_key"
    || indexes[1]?.is_unique !== true
    || indexes[1]?.is_valid !== true
    || indexes[1]?.is_ready !== true
    || !/\("stripeEventId"\)/u.test(indexes[1]?.definition ?? "")
  ) {
    throw new Error("SellerPayoutEvent indexes are not exact and valid");
  }

  const functions = catalogState.functions ?? [];
  const sourceHashes = sellerPayoutEventAuthorityFunctionSourceSha256();
  if (
    functions.length !== SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.length
    || !functions.every((entry, index) => {
      const expected = SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS[index];
      return entry.identity === expected.identity
        && entry.owner_name === migrationRole
        && entry.function_kind === "f"
        && entry.language_name === expected.language
        && entry.security_definer === true
        && entry.leakproof === false
        && exactStringArray(entry.config, ["search_path=pg_catalog"])
        && entry.runtime_can_execute === true
        && entry.public_can_execute === false
        && Number(entry.invalid_acl_count) === 0
        && entry.volatility === expected.volatility
        && entry.parallel === expected.parallel
        && sha256(entry.function_source ?? "") === sourceHashes[entry.identity];
    })
  ) {
    throw new Error("SellerPayoutEvent function catalog is not exact");
  }
}

export function assertSellerPayoutEventPreparedCatalog(
  catalogState,
  migrationRole = MIGRATION_ROLE,
) {
  assertTablePosture(catalogState, migrationRole);
  assertPreparedCatalog(catalogState, migrationRole);
  return Object.freeze({
    migrationRole,
    payoutRlsEnabled: false,
    payoutRlsForced: false,
    predecessorRuntimeCrudRetained: true,
    runtimeFunctionCount: SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.length,
  });
}

function assertPredecessorCatalog(catalogState) {
  if (
    catalogState?.columns?.length !== 0
    || catalogState?.constraints?.length !== 0
    || catalogState?.indexes?.length !== 0
    || catalogState?.functions?.length !== 0
  ) {
    throw new Error("SellerPayoutEvent predecessor catalog is not exact");
  }
}

export function assertSellerPayoutEventAuthorityProductionScope(
  snapshot,
  stage,
  catalog = readSellerPayoutEventAuthorityMigrationCatalog(),
) {
  if (!SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGES.includes(stage)) {
    throw new Error("payout scope stage must be before, after, or restart");
  }
  assertTablePosture(snapshot?.catalogState);
  const migrationApplied = assertExactLedger(snapshot?.ledgerRows, catalog, stage);
  if (migrationApplied) assertPreparedCatalog(snapshot.catalogState);
  else assertPredecessorCatalog(snapshot.catalogState);
  return Object.freeze({
    checkoutStockReservationForceApplied: true,
    historicalLedgerExceptionCount: 3,
    payoutAuthorityApplied: migrationApplied,
    payoutRlsEnabled: false,
    payoutRlsForced: false,
    predecessorRuntimeCrudRetained: true,
    reviewedMigrationCount: catalog.length,
    runtimeFunctionCount: migrationApplied ? 3 : 0,
    state: migrationApplied ? "prepared" : "predecessor",
    productionChangedByProof: false,
  });
}

export async function readSellerPayoutEventProductionSnapshot(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-seller-payout-authority-scope-proof",
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const readOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS read_only",
    )).rows[0]?.read_only;
    if (readOnly !== "on") throw new Error("scope transaction is not read-only");

    const ledgerRows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        ORDER BY migration_name, started_at, id`,
    )).rows;
    const tableRows = (await client.query(
      `SELECT
         pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
         relation.relrowsecurity AS rls_enabled,
         relation.relforcerowsecurity AS rls_forced,
         (SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = relation.oid) AS policy_count,
         pg_catalog.has_table_privilege($1, relation.oid, 'SELECT')
           AS runtime_can_select,
         pg_catalog.has_table_privilege($1, relation.oid, 'INSERT')
           AS runtime_can_insert,
         pg_catalog.has_table_privilege($1, relation.oid, 'UPDATE')
           AS runtime_can_update,
         pg_catalog.has_table_privilege($1, relation.oid, 'DELETE')
           AS runtime_can_delete,
         EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(
                 relation.relacl,
                 pg_catalog.acldefault('r', relation.relowner)
               )
             ) AS acl
            WHERE acl.grantee = 0
              AND acl.privilege_type = ANY(
                ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
              )
         ) AS public_has_crud
         ,(SELECT pg_catalog.count(*)::integer
             FROM pg_catalog.aclexplode(
               COALESCE(
                 relation.relacl,
                 pg_catalog.acldefault('r', relation.relowner)
               )
             ) AS acl
            WHERE acl.grantee NOT IN (
                    relation.relowner,
                    (SELECT role.oid
                       FROM pg_catalog.pg_roles AS role
                      WHERE role.rolname = $1)
                  )
               OR (
                 acl.grantee = (
                   SELECT role.oid
                     FROM pg_catalog.pg_roles AS role
                    WHERE role.rolname = $1
                 )
                 AND (
                   acl.privilege_type <> ALL(
                     ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
                   )
                   OR acl.grantor <> relation.relowner
                   OR acl.is_grantable
                 )
               )) AS invalid_table_acl_count,
         (SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_attribute AS attribute
            CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
           WHERE attribute.attrelid = relation.oid
             AND attribute.attnum > 0
             AND NOT attribute.attisdropped) AS column_acl_count
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'SellerPayoutEvent'
        AND relation.relkind = 'r'`,
      [RUNTIME_ROLE],
    )).rows;
    if (tableRows.length !== 1) {
      throw new Error("SellerPayoutEvent table catalog is not exact");
    }
    const columns = (await client.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'SellerPayoutEvent'
          AND column_name = 'stripeEventCreatedSeconds'
        ORDER BY column_name`,
    )).rows;
    const constraints = (await client.query(
      `SELECT constraint_metadata.conname AS constraint_name,
              constraint_metadata.contype AS constraint_type,
              constraint_metadata.convalidated AS validated,
              pg_catalog.pg_get_constraintdef(
                constraint_metadata.oid,
                true
              ) AS definition
         FROM pg_catalog.pg_constraint AS constraint_metadata
        WHERE constraint_metadata.conrelid =
              'public."SellerPayoutEvent"'::regclass
          AND constraint_metadata.conname = ANY($1::text[])
        ORDER BY constraint_metadata.conname`,
      [REVIEWED_CONSTRAINTS],
    )).rows;
    const indexes = (await client.query(
      `SELECT index_relation.relname AS index_name,
              index_metadata.indisunique AS is_unique,
              index_metadata.indisvalid AS is_valid,
              index_metadata.indisready AS is_ready,
              pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
         FROM pg_catalog.pg_index AS index_metadata
         JOIN pg_catalog.pg_class AS index_relation
           ON index_relation.oid = index_metadata.indexrelid
        WHERE index_metadata.indrelid = 'public."SellerPayoutEvent"'::regclass
          AND index_relation.relname = ANY($1::text[])
        ORDER BY index_relation.relname`,
      [REVIEWED_INDEXES],
    )).rows;
    const functions = (await client.query(
      `SELECT
         procedure.proname || '(' || pg_catalog.replace(
           pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
         ) || ')' AS identity,
         pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
         procedure.prosecdef AS security_definer,
         procedure.prokind AS function_kind,
         language.lanname AS language_name,
         procedure.proleakproof AS leakproof,
         procedure.proconfig AS config,
         procedure.provolatile AS volatility,
         procedure.proparallel AS parallel,
         procedure.prosrc AS function_source,
         pg_catalog.has_function_privilege($1, procedure.oid, 'EXECUTE')
           AS runtime_can_execute,
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
         ) AS public_can_execute
         ,(SELECT pg_catalog.count(*)::integer
             FROM pg_catalog.aclexplode(
               COALESCE(
                 procedure.proacl,
                 pg_catalog.acldefault('f', procedure.proowner)
               )
             ) AS acl
            WHERE acl.privilege_type <> 'EXECUTE'
               OR acl.grantee = 0
               OR acl.grantee NOT IN (
                    procedure.proowner,
                    (SELECT role.oid
                       FROM pg_catalog.pg_roles AS role
                      WHERE role.rolname = $1)
                  )
               OR (
                 acl.grantee = (
                   SELECT role.oid
                     FROM pg_catalog.pg_roles AS role
                    WHERE role.rolname = $1
                 )
                 AND (
                   acl.grantor <> procedure.proowner
                   OR acl.is_grantable
                 )
               )) AS invalid_acl_count
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = procedure.pronamespace
       JOIN pg_catalog.pg_language AS language
         ON language.oid = procedure.prolang
      WHERE namespace.nspname = 'public'
        AND procedure.proname = ANY($2::text[])
      ORDER BY identity`,
      [
        RUNTIME_ROLE,
        SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.map(
          (entry) => entry.identity.slice(0, entry.identity.indexOf("(")),
        ),
      ],
    )).rows;
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      ledgerRows,
      catalogState: Object.freeze({
        table: tableRows[0],
        columns,
        constraints,
        indexes,
        functions,
      }),
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifySellerPayoutEventAuthorityProductionScope(
  config,
  {
    readSnapshot = readSellerPayoutEventProductionSnapshot,
    readCatalog = readSellerPayoutEventAuthorityMigrationCatalog,
  } = {},
) {
  return assertSellerPayoutEventAuthorityProductionScope(
    await readSnapshot(config.directUrl),
    config.stage,
    readCatalog(),
  );
}

async function main() {
  try {
    const config = parseSellerPayoutEventAuthorityScopeEnvironment();
    const result = await verifySellerPayoutEventAuthorityProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("SellerPayoutEvent authority scope proof failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
