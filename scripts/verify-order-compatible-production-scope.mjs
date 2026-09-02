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
  ORDER_COMPATIBLE_PRODUCTION_CHARGED_TOTAL_PREFIX_LENGTH,
  ORDER_COMPATIBLE_PRODUCTION_FIRST_MIGRATION,
  ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS,
} from "./order-compatible-production-catalog.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";

export const ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGES = Object.freeze([
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

export function parseOrderCompatibleProductionScopeEnvironment(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "Order compatible production scope proof",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("Order compatible scope proof requires manual main");
  }
  const directUrl = required(env, "DIRECT_URL");
  const stage = required(env, "ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGE");
  if (!ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGES.includes(stage)) {
    throw new Error("Order compatible scope stage is invalid");
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

function isAppliedRow(row, checksum) {
  return row?.checksum === checksum
    && row.finished_at !== null
    && row.finished_at !== undefined
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1;
}

export function assertOrderCompatibleProductionLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGES.includes(stage)
  ) {
    throw new Error("Order compatible migration ledger is invalid");
  }
  const expectedNames = new Set(
    ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map((entry) => entry.name),
  );
  if (rows.some((row) => !expectedNames.has(row?.migration_name))) {
    throw new Error("Order compatible migration ledger has an unknown row");
  }
  let prefixLength = 0;
  let absentSeen = false;
  for (const migration of ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS) {
    const matches = rows.filter((row) => row?.migration_name === migration.name);
    if (matches.length === 0) {
      absentSeen = true;
      continue;
    }
    if (
      absentSeen
      || matches.length !== 1
      || !isAppliedRow(matches[0], migration.checksum)
    ) {
      throw new Error("Order compatible migration ledger is not an exact prefix");
    }
    prefixLength += 1;
  }
  if (
    stage === "after"
    && prefixLength !== ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.length
  ) {
    throw new Error("Order compatible migration ledger is not complete");
  }
  return prefixLength;
}

function assertOrderPredecessorPosture(table, migrationRole) {
  if (
    table?.owner_name !== migrationRole
    || table.rls_enabled !== false
    || table.rls_forced !== false
    || Number(table.policy_count) !== 0
    || table.runtime_can_select !== true
    || table.runtime_can_insert !== true
    || table.runtime_can_update !== true
    || table.runtime_can_delete !== true
    || table.public_has_crud !== false
  ) {
    throw new Error("Order predecessor table posture drifted");
  }
}

export function assertOrderCompatibleProductionScope(
  snapshot,
  stage,
  { migrationRole = MIGRATION_ROLE } = {},
) {
  const prefixLength = assertOrderCompatibleProductionLedger(
    snapshot?.ledgerRows,
    stage,
  );
  assertOrderPredecessorPosture(snapshot?.orderTable, migrationRole);
  const chargedTotalExpected =
    prefixLength >= ORDER_COMPATIBLE_PRODUCTION_CHARGED_TOTAL_PREFIX_LENGTH;
  const chargedColumns = snapshot?.chargedTotalColumns;
  if (
    !Array.isArray(chargedColumns)
    || (chargedTotalExpected
      ? chargedColumns.length !== 1
        || chargedColumns[0]?.column_name !== "chargedTotalCents"
        || chargedColumns[0]?.data_type !== "integer"
        || chargedColumns[0]?.is_nullable !== "YES"
        || chargedColumns[0]?.column_default !== null
      : chargedColumns.length !== 0)
  ) {
    throw new Error("Order charged-total column posture drifted");
  }
  return Object.freeze({
    state: prefixLength === 0
      ? "predecessor"
      : prefixLength === ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.length
        ? "order-compatible"
        : `partial-${prefixLength}`,
    migrationPrefixLength: prefixLength,
    migrationCount: ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.length,
    orderRlsEnabled: false,
    orderRlsForced: false,
    predecessorRuntimeCrudRetained: true,
    caseCorrectnessApplied: false,
  });
}

export async function readOrderCompatibleProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE } = {},
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-compatible-production-scope",
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
    const ledgerRows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name >= $1
        ORDER BY migration_name, started_at, id`,
      [ORDER_COMPATIBLE_PRODUCTION_FIRST_MIGRATION],
    )).rows;
    const orderTable = (await client.query(
      `SELECT
         pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy p
           WHERE p.polrelid = c.oid) AS policy_count,
         pg_catalog.has_table_privilege($1, c.oid, 'SELECT') AS runtime_can_select,
         pg_catalog.has_table_privilege($1, c.oid, 'INSERT') AS runtime_can_insert,
         pg_catalog.has_table_privilege($1, c.oid, 'UPDATE') AS runtime_can_update,
         pg_catalog.has_table_privilege($1, c.oid, 'DELETE') AS runtime_can_delete,
         EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
             ) AS acl
            WHERE acl.grantee = 0
              AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
         ) AS public_has_crud
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'Order'`,
      [runtimeRole],
    )).rows[0];
    const chargedTotalColumns = (await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Order'
          AND column_name = 'chargedTotalCents'`,
    )).rows;
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({ ledgerRows, orderTable, chargedTotalColumns });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyOrderCompatibleProductionScope(
  config,
  {
    readSnapshot = readOrderCompatibleProductionSnapshot,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
  } = {},
) {
  return assertOrderCompatibleProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole }),
    config.stage,
    { migrationRole },
  );
}

async function main() {
  try {
    const config = parseOrderCompatibleProductionScopeEnvironment();
    const result = await verifyOrderCompatibleProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("Order compatible production scope proof failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
