#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const REVIEWED_NOTIFICATION_INSPECTION_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
});

const INSPECT_CONFIRMATION = "inspect-prelaunch-notification-legacy-state";
const PREREQUISITE_CONFIRMATION = "saved-search-phase-b-and-runtime-separation-postflights-passed";

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

export function parseNotificationLegacyInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Notification legacy inspection");
  if (env.NOTIFICATION_LEGACY_INSPECT_CONFIRM !== INSPECT_CONFIRMATION) {
    throw new Error("NOTIFICATION_LEGACY_INSPECT_CONFIRM must match the reviewed inspect value");
  }
  if (env.NOTIFICATION_RLS_PREREQUISITES_CONFIRMED !== PREREQUISITE_CONFIRMATION) {
    throw new Error("Notification reset prerequisites are not explicitly confirmed");
  }

  const directUrl = required(env, "DIRECT_URL");
  const migrationRole = required(env, "MIGRATION_DB_ROLE");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  const target = REVIEWED_NOTIFICATION_INSPECTION_TARGET;
  if (
    identity.isPooler
    || identity.endpointId !== target.endpointId
    || identity.databaseName !== target.databaseName
    || identity.region !== target.region
    || identity.username !== target.ownerRole
    || migrationRole !== target.ownerRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }

  return Object.freeze({ mode: "inspect", directUrl, identity });
}

export function normalizeNotificationLegacyCounts(row) {
  const counts = {
    total: Number(row?.total_count),
    missingSource: Number(row?.missing_source_count),
    missingRelatedUser: Number(row?.missing_related_user_count),
  };
  if (Object.values(counts).some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new TypeError("Notification legacy inspection returned invalid counts");
  }
  return Object.freeze(counts);
}

async function readPosture(client) {
  const result = await client.query(`
    SELECT
      pg_catalog.current_user AS current_user,
      pg_catalog.current_database() AS database_name,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      table_class.relrowsecurity AS rls_enabled,
      table_class.relforcerowsecurity AS rls_forced,
      table_owner.rolname AS table_owner
    FROM pg_catalog.pg_class AS table_class
    JOIN pg_catalog.pg_namespace AS table_schema
      ON table_schema.oid = table_class.relnamespace
    JOIN pg_catalog.pg_roles AS table_owner
      ON table_owner.oid = table_class.relowner
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.rolname = 'neondb_owner'
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE table_schema.nspname = 'public'
      AND table_class.relname = 'Notification'
      AND table_class.relkind = 'r'
  `);
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || row.current_user !== REVIEWED_NOTIFICATION_INSPECTION_TARGET.ownerRole
    || row.database_name !== REVIEWED_NOTIFICATION_INSPECTION_TARGET.databaseName
    || row.owner_bypass_rls !== true
    || row.runtime_bypass_rls !== false
    || row.runtime_superuser !== false
    || row.table_owner !== REVIEWED_NOTIFICATION_INSPECTION_TARGET.ownerRole
    || row.rls_enabled !== false
    || row.rls_forced !== false
  ) {
    throw new Error("Notification legacy inspection database posture is not the reviewed pre-activation state");
  }
  return Object.freeze({
    currentUser: row.current_user,
    databaseName: row.database_name,
    tableOwner: row.table_owner,
    rlsEnabled: row.rls_enabled,
    rlsForced: row.rls_forced,
  });
}

async function readCounts(client) {
  const result = await client.query(`
    SELECT
      pg_catalog.count(*) AS total_count,
      pg_catalog.count(*) FILTER (
        WHERE "sourceType" IS NULL OR "sourceId" IS NULL
      ) AS missing_source_count,
      pg_catalog.count(*) FILTER (
        WHERE "relatedUserId" IS NULL
      ) AS missing_related_user_count
    FROM public."Notification"
  `);
  return normalizeNotificationLegacyCounts(result.rows[0]);
}

export async function runNotificationLegacyInspection(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  try {
    const posture = await readPosture(client);
    const before = await readCounts(client);
    return Object.freeze({ mode: config.mode, posture, before });
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    const config = parseNotificationLegacyInspectionConfig(process.env);
    const result = await runNotificationLegacyInspection(config);
    process.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: "passed",
      ...result,
    }, null, 2)}\n`);
  } catch {
    process.stderr.write("Notification legacy inspection failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
