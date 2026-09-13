#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  verifyPromotedCheckoutStockReservationSourceConsistency,
} from "./stage-checkout-stock-reservation-source-consistency.mjs";

export const CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_PHASE =
  "checkout-stock-reservation-source-consistency-reviewed";

export function verifyCheckoutStockReservationSourceConsistency(
  rootDirectory = process.cwd(),
) {
  const candidate = verifyPromotedCheckoutStockReservationSourceConsistency(rootDirectory);
  const migrationDirectory = path.join(rootDirectory, "prisma/migrations");
  const migrationNames = fs.readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= candidate.migrationName);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  if (
    migrationTreeSha256
    !== CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_TREE_SHA256
  ) {
    throw new Error("CheckoutStockReservation source-consistency migration prefix drifted");
  }

  return Object.freeze({
    draftSha256: candidate.draftSha256,
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    phase: CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_PHASE,
    predecessorCreateAuthorityRetained: true,
    privateHelpers: CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS
      .filter((entry) => !entry.runtimeExecute).length,
    rlsChanged: false,
    runtimeOperations: CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS
      .filter((entry) => entry.runtimeExecute).length,
    tableGrantsChanged: false,
  });
}

function main() {
  process.stdout.write(`${JSON.stringify(
    verifyCheckoutStockReservationSourceConsistency(),
    null,
    2,
  )}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`CheckoutStockReservation source-consistency release verification failed closed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`);
    process.exitCode = 1;
  }
}
