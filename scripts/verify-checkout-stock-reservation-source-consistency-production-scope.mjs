#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  assertReservationAuthorityProductionScope,
  parseReservationAuthorityScopeEnvironment,
  readReservationAuthorityMigrationCatalog,
  readReservationMigrationRows,
} from "./verify-checkout-stock-reservation-authority-production-scope.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION,
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_SHA256,
} from "./stage-checkout-stock-reservation-source-consistency.mjs";
import {
  verifyCheckoutStockReservationSourceConsistency,
} from "./verify-checkout-stock-reservation-source-consistency.mjs";

export const RESERVATION_SOURCE_CONSISTENCY_SCOPE_STAGES = Object.freeze([
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

export function parseReservationSourceConsistencyScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_SCOPE_STAGE",
  );
  if (!RESERVATION_SOURCE_CONSISTENCY_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "reservation source-consistency scope stage must be before, after, or restart",
    );
  }
  const authority = parseReservationAuthorityScopeEnvironment({
    ...env,
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: authority.directUrl,
    identity: authority.identity,
    stage,
  });
}

export function readReservationSourceConsistencyMigrationCatalog(
  root = process.cwd(),
) {
  const authorityCatalog = readReservationAuthorityMigrationCatalog(root);
  const candidate = verifyCheckoutStockReservationSourceConsistency(root);
  if (
    authorityCatalog.some(
      (entry) => entry.migration_name === candidate.migrationName,
    )
    || authorityCatalog.at(-1)?.migration_name >= candidate.migrationName
  ) {
    throw new Error(
      "reviewed source-consistency migration does not follow the authority prefix",
    );
  }
  return Object.freeze([
    ...authorityCatalog,
    Object.freeze({
      migration_name: candidate.migrationName,
      checksum: candidate.migrationSha256,
    }),
  ]);
}

function isAppliedRow(row, checksum) {
  return row?.checksum === checksum
    && row.finished_at !== null
    && row.finished_at !== undefined
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1;
}

export function assertReservationSourceConsistencyProductionScope(
  rows,
  stage,
  catalog = readReservationSourceConsistencyMigrationCatalog(),
) {
  if (!RESERVATION_SOURCE_CONSISTENCY_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "reservation source-consistency scope stage must be before, after, or restart",
    );
  }
  const sourceConsistency = catalog.at(-1);
  const authorityCatalog = catalog.slice(0, -1);
  if (
    !Array.isArray(rows)
    || !Array.isArray(catalog)
    || catalog.length < 2
    || sourceConsistency?.migration_name
      !== CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION
    || sourceConsistency.checksum
      !== CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_SHA256
  ) {
    throw new Error(
      "production ledger is not the exact reservation source-consistency scope",
    );
  }

  const sourceRows = rows.filter(
    (row) => row?.migration_name === sourceConsistency.migration_name,
  );
  const predecessorRows = rows.filter(
    (row) => row?.migration_name !== sourceConsistency.migration_name,
  );
  const predecessor = assertReservationAuthorityProductionScope(
    predecessorRows,
    "after",
    authorityCatalog,
  );
  const sourceConsistencyApplied = sourceRows.length === 1
    && isAppliedRow(sourceRows[0], sourceConsistency.checksum);
  if (
    (stage === "before" && sourceRows.length !== 0)
    || (stage === "after" && !sourceConsistencyApplied)
    || (stage === "restart"
      && sourceRows.length !== 0
      && !sourceConsistencyApplied)
  ) {
    throw new Error(
      "production ledger is not the exact reservation source-consistency scope",
    );
  }
  return Object.freeze({
    reservationAuthorityApplied: predecessor.reservationAuthorityApplied,
    sourceConsistencyApplied,
    reservationActivationRows: predecessor.reservationActivationRows,
    reservationForceRows: predecessor.reservationForceRows,
    reviewedMigrationCount: catalog.length,
    historicalLedgerExceptionCount:
      predecessor.historicalLedgerExceptionCount,
    state: sourceConsistencyApplied ? "source-consistent" : "authority-prepared",
    productionChangedByProof: false,
  });
}

export async function verifyReservationSourceConsistencyProductionScope(
  config,
  {
    readRows = readReservationMigrationRows,
    readCatalog = readReservationSourceConsistencyMigrationCatalog,
  } = {},
) {
  return assertReservationSourceConsistencyProductionScope(
    await readRows(config.directUrl),
    config.stage,
    readCatalog(),
  );
}

async function main() {
  try {
    const config = parseReservationSourceConsistencyScopeEnvironment();
    const result = await verifyReservationSourceConsistencyProductionScope(
      config,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "CheckoutStockReservation source-consistency production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
