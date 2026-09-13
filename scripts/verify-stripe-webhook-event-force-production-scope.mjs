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
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
} from "./guard-saved-search-rls-deploy.mjs";

const { Client } = pg;
const REVIEWED_MIGRATION_ROLE = "neondb_owner";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseStripeWebhookEventForceProductionScopeEnvironment(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "StripeWebhookEvent FORCE production scope proof",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error(
      "StripeWebhookEvent FORCE production scope proof requires the manual main workflow",
    );
  }
  const directUrl = required(env, "DIRECT_URL");
  const identity = parseVercelRuntimeDatabaseIdentity(directUrl, "DIRECT_URL");
  const reviewed = REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
  if (
    identity.isPooler
    || identity.username !== REVIEWED_MIGRATION_ROLE
    || identity.endpointId !== reviewed.endpointId
    || identity.region !== reviewed.region
    || identity.databaseName !== reviewed.databaseName
  ) {
    throw new Error(
      "DIRECT_URL does not match the reviewed production migration-owner identity",
    );
  }
  return Object.freeze({ directUrl, identity });
}

export function assertStripeWebhookEventForceProductionScope(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("production migration scope rows are invalid");
  }
  const forceRows = rows.filter(
    (row) => row?.migration_name === STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
  );
  const successorRows = rows.filter(
    (row) => row?.migration_name === CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  );
  if (
    forceRows.length !== 1
    || forceRows[0].finished_at === null
    || forceRows[0].finished_at === undefined
    || forceRows[0].rolled_back_at !== null
    || Number(forceRows[0].applied_steps_count) !== 1
    || successorRows.length !== 0
  ) {
    throw new Error(
      "production migration ledger does not match the reviewed FORCE-only scope",
    );
  }
  return Object.freeze({
    forceMigration: STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
    forceApplied: true,
    successorMigration: CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
    successorRows: 0,
    productionChangedByProof: false,
  });
}

export async function verifyStripeWebhookEventForceProductionScope(
  config,
  { readRows = readProductionMigrationRows } = {},
) {
  return assertStripeWebhookEventForceProductionScope(
    await readRows(config.directUrl),
  );
}

export async function readProductionMigrationRows(connectionString) {
  const parsed = new URL(connectionString);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-stripe-force-production-scope-proof",
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;
    const readOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS read_only",
    )).rows[0]?.read_only;
    if (readOnly !== "on") {
      throw new Error("production migration scope proof transaction is not read-only");
    }
    const rows = (await client.query(
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name = ANY($1::text[])
        ORDER BY migration_name, started_at`,
      [
        [
          STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
          CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
        ],
      ],
    )).rows;
    await client.query("ROLLBACK");
    transactionStarted = false;
    return rows;
  } finally {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }
    await client.end();
  }
}

async function main() {
  try {
    const config = parseStripeWebhookEventForceProductionScopeEnvironment();
    const result = await verifyStripeWebhookEventForceProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "StripeWebhookEvent FORCE production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
