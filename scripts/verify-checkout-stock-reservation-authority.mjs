#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  verifyPromotedCheckoutStockReservationAuthority,
} from "./stage-checkout-stock-reservation-authority.mjs";

export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_PHASE =
  "checkout-stock-reservation-authority-reviewed";

export function verifyCheckoutStockReservationAuthority(
  rootDirectory = process.cwd(),
) {
  const candidate = verifyPromotedCheckoutStockReservationAuthority(rootDirectory);
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
    !== CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION_TREE_SHA256
  ) {
    throw new Error("CheckoutStockReservation authority migration prefix drifted");
  }

  return Object.freeze({
    phase: CHECKOUT_STOCK_RESERVATION_AUTHORITY_PHASE,
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    draftSha256: candidate.draftSha256,
    migrationTreeSha256,
    runtimeOperations: CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS
      .filter((entry) => entry.runtimeExecute).length,
    privateHelpers: CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS
      .filter((entry) => !entry.runtimeExecute).length,
    rlsChanged: false,
    predecessorTableGrantsChanged: false,
    sealedPrefix: Object.freeze({
      migrationCutoff: candidate.migrationName,
      reviewed: true,
    }),
  });
}

function main() {
  process.stdout.write(`${JSON.stringify(
    verifyCheckoutStockReservationAuthority(),
    null,
    2,
  )}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
