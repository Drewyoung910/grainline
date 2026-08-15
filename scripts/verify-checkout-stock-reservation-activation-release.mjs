#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  verifyPromotedCheckoutStockReservationActivation,
} from "./stage-checkout-stock-reservation-activation-migration.mjs";

export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE =
  "checkout-stock-reservation-activation-reviewed";

export function verifyCheckoutStockReservationActivationRelease(
  rootDirectory = process.cwd(),
) {
  const candidate = verifyPromotedCheckoutStockReservationActivation(
    rootDirectory,
  );
  const migrationDirectory = path.join(rootDirectory, "prisma/migrations");
  const migrationNames = fs.readdirSync(migrationDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= candidate.migrationName);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  if (
    migrationTreeSha256
    !== CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION_TREE_SHA256
  ) {
    throw new Error(
      "CheckoutStockReservation activation migration prefix drifted",
    );
  }

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE,
    rootDirectory,
  });
  const runtimeFunctions = CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS
    .filter((entry) => entry.runtimeExecute).length;
  const privateFunctions = CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS
    .filter((entry) => !entry.runtimeExecute).length;

  return Object.freeze({
    phase: CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE,
    migration: candidate.migrationName,
    draftSha256: candidate.draftSha256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    rollbackSha256: candidate.rollbackDraftSha256,
    protectedTables: 1,
    runtimeFunctions,
    privateFunctions,
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    guard,
  });
}

function main() {
  process.stdout.write(`${JSON.stringify(
    verifyCheckoutStockReservationActivationRelease(),
    null,
    2,
  )}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation activation release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
