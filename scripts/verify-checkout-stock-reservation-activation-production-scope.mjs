#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  readReservationMigrationRows,
} from "./verify-checkout-stock-reservation-authority-production-scope.mjs";
import {
  assertReservationSourceConsistencyProductionScope,
  parseReservationSourceConsistencyScopeEnvironment,
  readReservationSourceConsistencyMigrationCatalog,
} from "./verify-checkout-stock-reservation-source-consistency-production-scope.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256,
} from "./build-checkout-stock-reservation-activation-candidate.mjs";
import {
  verifyCheckoutStockReservationActivationRelease,
} from "./verify-checkout-stock-reservation-activation-release.mjs";

export const RESERVATION_ACTIVATION_SCOPE_STAGES = Object.freeze([
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

export function parseReservationActivationScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "CHECKOUT_STOCK_RESERVATION_ACTIVATION_SCOPE_STAGE",
  );
  if (!RESERVATION_ACTIVATION_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "reservation activation scope stage must be before, after, or restart",
    );
  }
  const sourceConsistency = parseReservationSourceConsistencyScopeEnvironment({
    ...env,
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: sourceConsistency.directUrl,
    identity: sourceConsistency.identity,
    stage,
  });
}

export function readReservationActivationMigrationCatalog(
  root = process.cwd(),
) {
  const predecessorCatalog =
    readReservationSourceConsistencyMigrationCatalog(root);
  const release = verifyCheckoutStockReservationActivationRelease(root, {
    allowReviewedSuccessor: true,
  });
  if (
    release.migration !== CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION
    || release.migrationSha256
      !== CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256
    || predecessorCatalog.some(
      (entry) => entry.migration_name === release.migration,
    )
    || predecessorCatalog.at(-1)?.migration_name >= release.migration
  ) {
    throw new Error(
      "reviewed activation migration does not follow the source-consistency prefix",
    );
  }
  return Object.freeze([
    ...predecessorCatalog,
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

export function assertReservationActivationProductionScope(
  rows,
  stage,
  catalog = readReservationActivationMigrationCatalog(),
) {
  if (!RESERVATION_ACTIVATION_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "reservation activation scope stage must be before, after, or restart",
    );
  }
  const activation = catalog.at(-1);
  const predecessorCatalog = catalog.slice(0, -1);
  if (
    !Array.isArray(rows)
    || !Array.isArray(catalog)
    || catalog.length < 2
    || activation?.migration_name
      !== CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION
    || activation.checksum
      !== CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256
  ) {
    throw new Error(
      "production ledger is not the exact reservation activation scope",
    );
  }

  const activationRows = rows.filter(
    (row) => row?.migration_name === activation.migration_name,
  );
  const predecessorRows = rows.filter(
    (row) => row?.migration_name !== activation.migration_name,
  );
  const predecessor = assertReservationSourceConsistencyProductionScope(
    predecessorRows,
    "after",
    predecessorCatalog,
  );
  const activationApplied = activationRows.length === 1
    && isAppliedRow(activationRows[0], activation.checksum);
  if (
    (stage === "before" && activationRows.length !== 0)
    || (stage === "after" && !activationApplied)
    || (stage === "restart"
      && activationRows.length !== 0
      && !activationApplied)
  ) {
    throw new Error(
      "production ledger is not the exact reservation activation scope",
    );
  }

  return Object.freeze({
    reservationAuthorityApplied: predecessor.reservationAuthorityApplied,
    sourceConsistencyApplied: predecessor.sourceConsistencyApplied,
    reservationActivationApplied: activationApplied,
    reservationForceRows: predecessor.reservationForceRows,
    reviewedMigrationCount: catalog.length,
    historicalLedgerExceptionCount:
      predecessor.historicalLedgerExceptionCount,
    state: activationApplied ? "activated" : "source-consistent",
    productionChangedByProof: false,
  });
}

export async function verifyReservationActivationProductionScope(
  config,
  {
    readRows = readReservationMigrationRows,
    readCatalog = readReservationActivationMigrationCatalog,
  } = {},
) {
  return assertReservationActivationProductionScope(
    await readRows(config.directUrl),
    config.stage,
    readCatalog(),
  );
}

async function main() {
  try {
    const config = parseReservationActivationScopeEnvironment();
    const result = await verifyReservationActivationProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "CheckoutStockReservation activation production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
