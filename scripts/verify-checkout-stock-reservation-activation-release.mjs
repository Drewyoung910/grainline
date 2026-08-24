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
import {
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  verifySellerPayoutEventAuthorityRelease,
} from "./verify-seller-payout-event-authority-release.mjs";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
} from "./stage-seller-payout-event-activation-migration.mjs";
import {
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
} from "./stage-seller-payout-event-force-migration.mjs";
import {
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
} from "./order-refund-claim-generation-catalog.mjs";
import {
  verifyOrderRefundClaimGenerationRelease,
} from "./verify-order-refund-claim-generation-release.mjs";
import {
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
  verifyOrderRefundRecordAuthorityMigrationBytes,
} from "./order-refund-record-authority-catalog.mjs";

export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE =
  "checkout-stock-reservation-activation-reviewed";
const CHECKOUT_STOCK_RESERVATION_FORCE_PHASE =
  "checkout-stock-reservation-force-reviewed";

export function verifyCheckoutStockReservationActivationRelease(
  rootDirectory = process.cwd(),
  {
    allowReviewedSuccessor = false,
    allowReviewedRefundRecordSuccessor = false,
  } = {},
) {
  if (allowReviewedRefundRecordSuccessor && !allowReviewedSuccessor) {
    throw new Error(
      "Order refund record successor requires reviewed reservation successors",
    );
  }
  if (allowReviewedRefundRecordSuccessor) {
    verifyOrderRefundRecordAuthorityMigrationBytes(rootDirectory);
  }
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

  const forceMigrationExists = fs.existsSync(path.join(
    migrationDirectory,
    "20260815060001_force_checkout_stock_reservation_rls",
  ));
  let guard;
  if (allowReviewedSuccessor && forceMigrationExists) {
    const payoutSuccessorExists = fs.existsSync(path.join(
      migrationDirectory,
      SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
    ));
    const payoutActivationSuccessorExists = fs.existsSync(path.join(
      migrationDirectory,
      SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
    ));
    const payoutForceSuccessorExists = fs.existsSync(path.join(
      migrationDirectory,
      SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
    ));
    const refundClaimSuccessorExists = fs.existsSync(path.join(
      migrationDirectory,
      ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
    ));
    const refundRecordSuccessorExists = fs.existsSync(path.join(
      migrationDirectory,
      ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
    ));
    if (payoutSuccessorExists) {
      if (refundClaimSuccessorExists) {
        verifyOrderRefundClaimGenerationRelease(rootDirectory, {
          allowReviewedRefundRecordSuccessor,
        });
      } else {
        verifySellerPayoutEventAuthorityRelease(rootDirectory, {
          allowReviewedActivationSuccessor: payoutActivationSuccessorExists,
          allowReviewedForceSuccessor: payoutForceSuccessorExists,
        });
      }
    }
    const successorGuard = validateCurrentSavedSearchRlsDeployShape({
      phase: CHECKOUT_STOCK_RESERVATION_FORCE_PHASE,
      rootDirectory,
      omittedReviewedMigrationNames: [
        ...(payoutSuccessorExists
          ? [SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION]
          : []),
        ...(payoutActivationSuccessorExists
          ? [SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION]
          : []),
        ...(payoutForceSuccessorExists
          ? [SELLER_PAYOUT_EVENT_FORCE_MIGRATION]
          : []),
        ...(refundClaimSuccessorExists
          ? [ORDER_REFUND_CLAIM_GENERATION_MIGRATION]
          : []),
        ...(allowReviewedRefundRecordSuccessor && refundRecordSuccessorExists
          ? [ORDER_REFUND_RECORD_AUTHORITY_MIGRATION]
          : []),
      ],
    });
    guard = Object.freeze({
      phase: CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE,
      sealedPrefix: true,
      successorPhase: successorGuard.phase,
    });
  } else {
    guard = validateCurrentSavedSearchRlsDeployShape({
      phase: CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE,
      rootDirectory,
    });
  }
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
  const mode = process.argv[2];
  if (
    mode !== undefined
    && mode !== "--allow-reviewed-successor"
    && mode !== "--allow-reviewed-refund-record-successor"
  ) {
    throw new Error(
      "usage: verify-checkout-stock-reservation-activation-release.mjs "
      + "[--allow-reviewed-successor|--allow-reviewed-refund-record-successor]",
    );
  }
  process.stdout.write(`${JSON.stringify(
    verifyCheckoutStockReservationActivationRelease(undefined, {
      allowReviewedSuccessor: mode !== undefined,
      allowReviewedRefundRecordSuccessor:
        mode === "--allow-reviewed-refund-record-successor",
    }),
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
