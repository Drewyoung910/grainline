#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  parseVercelRuntimeDatabaseIdentity,
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  CASE_CORRECTNESS_MIGRATION,
  CASE_CORRECTNESS_MIGRATION_SHA256,
} from "./build-case-correctness-migration.mjs";
import {
  ORDER_COMPATIBLE_PRODUCTION_FIRST_MIGRATION,
  ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS,
} from "./order-compatible-production-catalog.mjs";
import {
  assertOrderCompatibleProductionLedger,
} from "./verify-order-compatible-production-scope.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";

export const CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGES = Object.freeze([
  "restart",
  "after",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseCaseCorrectnessProductionScopeEnvironment(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "Case correctness production scope proof",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("Case correctness scope proof requires manual main");
  }
  const directUrl = required(env, "DIRECT_URL");
  const stage = required(env, "CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGE");
  if (!CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGES.includes(stage)) {
    throw new Error("Case correctness scope stage is invalid");
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

function caseApplied(row) {
  return row?.migration_name === CASE_CORRECTNESS_MIGRATION
    && row.checksum === CASE_CORRECTNESS_MIGRATION_SHA256
    && row.finished_at !== null
    && row.finished_at !== undefined
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1;
}

export function assertCaseCorrectnessLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGES.includes(stage)
    || rows.length > 1
    || (rows.length === 1 && !caseApplied(rows[0]))
  ) {
    throw new Error("Case correctness migration ledger is invalid");
  }
  if (stage === "after" && rows.length !== 1) {
    throw new Error("Case correctness migration is not applied");
  }
  return rows.length === 1;
}

function assertCaseTablePosture(table, name, migrationRole) {
  if (
    table?.relation_name !== name
    || table.owner_name !== migrationRole
    || table.rls_enabled !== true
    || table.rls_forced !== true
    || Number(table.policy_count) !== 0
    || table.runtime_has_crud !== false
    || table.public_has_crud !== false
  ) {
    throw new Error(`${name} FORCE posture drifted`);
  }
}

export function assertCaseCorrectnessProductionScope(
  snapshot,
  stage,
  { migrationRole = MIGRATION_ROLE } = {},
) {
  if (
    !Array.isArray(snapshot?.unexpectedLedgerRows)
    || snapshot.unexpectedLedgerRows.length !== 0
  ) {
    throw new Error("Case correctness migration ledger has an unknown row");
  }
  const orderPrefix = assertOrderCompatibleProductionLedger(
    snapshot?.orderLedgerRows,
    "after",
  );
  const applied = assertCaseCorrectnessLedger(snapshot?.caseLedgerRows, stage);
  if (
    !Array.isArray(snapshot?.caseTables)
    || snapshot.caseTables.length !== 3
  ) {
    throw new Error("Case table catalog is incomplete");
  }
  for (const name of ["Case", "CaseMessage", "CaseMessageAttachment"]) {
    assertCaseTablePosture(
      snapshot.caseTables.find((table) => table.relation_name === name),
      name,
      migrationRole,
    );
  }
  return Object.freeze({
    state: applied ? "case-corrected" : "order-compatible",
    orderMigrationCount: orderPrefix,
    caseCorrectnessApplied: applied,
    caseTableCount: 3,
    caseRlsEnabled: true,
    caseRlsForced: true,
    directRuntimeCrud: false,
  });
}

export async function readCaseCorrectnessProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE } = {},
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-case-correctness-production-scope",
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    open = true;
    const readOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS value",
    )).rows[0]?.value;
    if (readOnly !== "on") throw new Error("scope transaction is not read-only");
    const orderNames = new Set(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map(
      (entry) => entry.name,
    ));
    const releaseLedgerRows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name >= $1
        ORDER BY migration_name, started_at, id`,
      [ORDER_COMPATIBLE_PRODUCTION_FIRST_MIGRATION],
    )).rows;
    const orderLedgerRows = releaseLedgerRows.filter((row) =>
      orderNames.has(row.migration_name)
    );
    const caseLedgerRows = releaseLedgerRows.filter((row) =>
      row.migration_name === CASE_CORRECTNESS_MIGRATION
    );
    const unexpectedLedgerRows = releaseLedgerRows.filter((row) =>
      !orderNames.has(row.migration_name)
      && row.migration_name !== CASE_CORRECTNESS_MIGRATION
    );
    const caseTables = (await client.query(
      `SELECT
         c.relname AS relation_name,
         pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy p
           WHERE p.polrelid = c.oid) AS policy_count,
         (
           pg_catalog.has_table_privilege($1, c.oid, 'SELECT')
           OR pg_catalog.has_table_privilege($1, c.oid, 'INSERT')
           OR pg_catalog.has_table_privilege($1, c.oid, 'UPDATE')
           OR pg_catalog.has_table_privilege($1, c.oid, 'DELETE')
         ) AS runtime_has_crud,
         (
           pg_catalog.has_table_privilege('PUBLIC', c.oid, 'SELECT')
           OR pg_catalog.has_table_privilege('PUBLIC', c.oid, 'INSERT')
           OR pg_catalog.has_table_privilege('PUBLIC', c.oid, 'UPDATE')
           OR pg_catalog.has_table_privilege('PUBLIC', c.oid, 'DELETE')
         ) AS public_has_crud
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($2::text[])
      ORDER BY c.relname`,
      [runtimeRole, ["Case", "CaseMessage", "CaseMessageAttachment"]],
    )).rows;
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      orderLedgerRows,
      caseLedgerRows,
      unexpectedLedgerRows,
      caseTables,
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyCaseCorrectnessProductionScope(
  config,
  {
    readSnapshot = readCaseCorrectnessProductionSnapshot,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
  } = {},
) {
  return assertCaseCorrectnessProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole }),
    config.stage,
    { migrationRole },
  );
}

async function main() {
  try {
    const config = parseCaseCorrectnessProductionScopeEnvironment();
    const result = await verifyCaseCorrectnessProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("Case correctness production scope proof failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
