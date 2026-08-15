#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  readReservationMigrationRows,
} from "./verify-checkout-stock-reservation-authority-production-scope.mjs";
import {
  assertReservationActivationProductionScope,
  parseReservationActivationScopeEnvironment,
  readReservationActivationMigrationCatalog,
} from "./verify-checkout-stock-reservation-activation-production-scope.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256,
} from "./build-checkout-stock-reservation-force-candidate.mjs";
import {
  verifyCheckoutStockReservationForceRelease,
} from "./verify-checkout-stock-reservation-force-release.mjs";

export const RESERVATION_FORCE_SCOPE_STAGES = Object.freeze([
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

export function parseReservationForceScopeEnvironment(env = process.env) {
  const stage = required(env, "CHECKOUT_STOCK_RESERVATION_FORCE_SCOPE_STAGE");
  if (!RESERVATION_FORCE_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "reservation FORCE scope stage must be before, after, or restart",
    );
  }
  const activation = parseReservationActivationScopeEnvironment({
    ...env,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: activation.directUrl,
    identity: activation.identity,
    stage,
  });
}

export function readReservationForceMigrationCatalog(root = process.cwd()) {
  const activationCatalog = readReservationActivationMigrationCatalog(root);
  const release = verifyCheckoutStockReservationForceRelease(root);
  if (
    release.migration !== CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION
    || release.migrationSha256
      !== CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256
    || activationCatalog.some(
      (entry) => entry.migration_name === release.migration,
    )
    || activationCatalog.at(-1)?.migration_name >= release.migration
  ) {
    throw new Error(
      "reviewed FORCE migration does not follow the activation prefix",
    );
  }
  return Object.freeze([
    ...activationCatalog,
    Object.freeze({
      migration_name: release.migration,
      checksum: release.migrationSha256,
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

export function assertReservationForceProductionScope(
  rows,
  stage,
  catalog = readReservationForceMigrationCatalog(),
) {
  if (!RESERVATION_FORCE_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "reservation FORCE scope stage must be before, after, or restart",
    );
  }
  const force = catalog.at(-1);
  const activationCatalog = catalog.slice(0, -1);
  if (
    !Array.isArray(rows)
    || !Array.isArray(catalog)
    || catalog.length < 2
    || force?.migration_name !== CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION
    || force.checksum !== CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256
  ) {
    throw new Error(
      "production ledger is not the exact reservation FORCE scope",
    );
  }

  const forceRows = rows.filter(
    (row) => row?.migration_name === force.migration_name,
  );
  const predecessorRows = rows.filter(
    (row) => row?.migration_name !== force.migration_name,
  );
  const predecessor = assertReservationActivationProductionScope(
    predecessorRows,
    "after",
    activationCatalog,
  );
  const forceApplied = forceRows.length === 1
    && isAppliedRow(forceRows[0], force.checksum);
  if (
    (stage === "before" && forceRows.length !== 0)
    || (stage === "after" && !forceApplied)
    || (stage === "restart" && forceRows.length !== 0 && !forceApplied)
  ) {
    throw new Error(
      "production ledger is not the exact reservation FORCE scope",
    );
  }

  return Object.freeze({
    reservationAuthorityApplied: predecessor.reservationAuthorityApplied,
    sourceConsistencyApplied: predecessor.sourceConsistencyApplied,
    reservationActivationApplied: predecessor.reservationActivationApplied,
    reservationForceApplied: forceApplied,
    reviewedMigrationCount: catalog.length,
    historicalLedgerExceptionCount:
      predecessor.historicalLedgerExceptionCount,
    state: forceApplied ? "force-hardened" : "activated",
    productionChangedByProof: false,
  });
}

export async function verifyReservationForceProductionScope(
  config,
  {
    readRows = readReservationMigrationRows,
    readCatalog = readReservationForceMigrationCatalog,
  } = {},
) {
  return assertReservationForceProductionScope(
    await readRows(config.directUrl),
    config.stage,
    readCatalog(),
  );
}

async function main() {
  try {
    const config = parseReservationForceScopeEnvironment();
    const result = await verifyReservationForceProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "CheckoutStockReservation FORCE production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
