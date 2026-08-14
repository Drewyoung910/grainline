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
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "./verify-direct-upload-activation-release.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const MIGRATIONS_DIRECTORY = path.join("prisma", "migrations");
export const RESERVATION_ACTIVATION_MIGRATION =
  "20260810220000_enable_checkout_stock_reservation_rls";
export const RESERVATION_FORCE_MIGRATION =
  "20260811020000_force_checkout_stock_reservation_rls";
export const SCHEMA_NUMERIC_GUARDS_MIGRATION =
  "20260523223000_schema_numeric_guards_and_indexes";
export const SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256 =
  "faf1ac4063a888e0405981aba57c177c4bbb33b184a8b315ace52152d21dc274";
export const SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256 =
  "0ae1197e6d8fd936e201ac793f810a42c1358bbea70f66cabffb7415f960aad6";
export const RESERVATION_AUTHORITY_SCOPE_STAGES = Object.freeze([
  "before",
  "after",
  "restart",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseReservationAuthorityScopeEnvironment(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "CheckoutStockReservation authority production scope proof",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("reservation scope proof requires the manual main workflow");
  }
  const directUrl = required(env, "DIRECT_URL");
  const stage = required(
    env,
    "CHECKOUT_STOCK_RESERVATION_AUTHORITY_SCOPE_STAGE",
  );
  if (!RESERVATION_AUTHORITY_SCOPE_STAGES.includes(stage)) {
    throw new Error("reservation scope stage must be before, after, or restart");
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
  const hash = createHash("sha256");
  hash.write(value);
  return hash.digest("hex");
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

export function readReservationAuthorityMigrationCatalog(
  root = process.cwd(),
) {
  const migrationsDirectory = path.join(root, MIGRATIONS_DIRECTORY);
  const entries = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter(
      (entry) => entry.name <= CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const catalog = entries.map((entry) => {
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
    || catalog.at(-1)?.migration_name
      !== CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION
  ) {
    throw new Error(
      "reviewed migration tree must end at reservation authority preparation",
    );
  }
  return Object.freeze(catalog);
}

export function assertReservationAuthorityProductionScope(
  rows,
  stage,
  catalog = readReservationAuthorityMigrationCatalog(),
) {
  if (!RESERVATION_AUTHORITY_SCOPE_STAGES.includes(stage)) {
    throw new Error("reservation scope stage must be before, after, or restart");
  }
  if (
    !Array.isArray(rows)
    || !Array.isArray(catalog)
    || catalog.length === 0
    || catalog.at(-1)?.migration_name
      !== CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION
  ) {
    throw new Error(
      "production ledger is not the exact reservation-compatible scope",
    );
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
    || !expectedByName.has(STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION)
    || typeof schemaNumericCurrentChecksum !== "string"
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
    throw new Error(
      "production ledger is not the exact reservation-compatible scope",
    );
  }

  const rowsFor = (name) =>
    rows.filter((row) => row?.migration_name === name);
  const listingChecksum = expectedByName.get(
    LISTING_VARIANTS_REVIEWED_MIGRATION,
  );
  const aliasRows = rowsFor(LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS);
  if (
    typeof listingChecksum !== "string"
    || aliasRows.length !== 1
    || !isZeroStepRolledBackRow(aliasRows[0], listingChecksum)
  ) {
    throw new Error(
      "production ledger is not the exact reservation-compatible scope",
    );
  }

  for (const [name, checksum] of expectedByName) {
    const matches = rowsFor(name);
    if (name === CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION) continue;
    if (name === SCHEMA_NUMERIC_GUARDS_MIGRATION) {
      if (
        matches.length !== 1
        || !isAppliedRow(
          matches[0],
          SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
        )
      ) {
        throw new Error(
          "production ledger is not the exact reservation-compatible scope",
        );
      }
      continue;
    }
    if (name === DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName) {
      if (
        matches.length !== 2
        || matches.filter((row) => isAppliedRow(row, checksum)).length !== 1
        || matches.filter((row) =>
          isZeroStepRolledBackRow(
            row,
            FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
          )
        ).length !== 1
      ) {
        throw new Error(
          "production ledger is not the exact reservation-compatible scope",
        );
      }
      continue;
    }
    if (matches.length !== 1 || !isAppliedRow(matches[0], checksum)) {
      throw new Error(
        "production ledger is not the exact reservation-compatible scope",
      );
    }
  }

  const authorityChecksum = expectedByName.get(
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  );
  const authorityMatches = rowsFor(
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  );
  const authorityApplied = authorityMatches.length === 1
    && isAppliedRow(authorityMatches[0], authorityChecksum);
  if (
    (stage === "before" && authorityMatches.length !== 0)
    || (stage === "after" && !authorityApplied)
    || (stage === "restart"
      && authorityMatches.length !== 0
      && !authorityApplied)
  ) {
    throw new Error(
      "production ledger is not the exact reservation-compatible scope",
    );
  }
  return Object.freeze({
    stripeForceApplied: true,
    reservationAuthorityApplied: authorityApplied,
    reservationActivationRows: 0,
    reservationForceRows: 0,
    reviewedMigrationCount: catalog.length,
    historicalLedgerExceptionCount: 3,
    state: authorityApplied ? "prepared" : "predecessor",
    productionChangedByProof: false,
  });
}

export async function readReservationMigrationRows(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-reservation-authority-scope-proof",
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    open = true;
    const readOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS read_only",
    )).rows[0]?.read_only;
    if (readOnly !== "on") throw new Error("scope transaction is not read-only");
    const rows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        ORDER BY migration_name, started_at, id`,
    )).rows;
    await client.query("ROLLBACK");
    open = false;
    return rows;
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyReservationAuthorityProductionScope(
  config,
  {
    readRows = readReservationMigrationRows,
    readCatalog = readReservationAuthorityMigrationCatalog,
  } = {},
) {
  return assertReservationAuthorityProductionScope(
    await readRows(config.directUrl),
    config.stage,
    readCatalog(),
  );
}

async function main() {
  try {
    const config = parseReservationAuthorityScopeEnvironment();
    const result = await verifyReservationAuthorityProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("reservation authority scope proof failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
