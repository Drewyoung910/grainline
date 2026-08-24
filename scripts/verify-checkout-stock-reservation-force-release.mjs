#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION_TREE_SHA256,
  CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION_TREE_SHA256,
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
  verifyPromotedCheckoutStockReservationForce,
} from "./stage-checkout-stock-reservation-force-migration.mjs";
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
  verifySellerPayoutEventActivationRelease,
} from "./verify-seller-payout-event-activation-release.mjs";
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

export const CHECKOUT_STOCK_RESERVATION_FORCE_PHASE =
  "checkout-stock-reservation-force-reviewed";

function migrationPrefix(rootDirectory, finalMigration) {
  const migrationDirectory = path.join(rootDirectory, "prisma/migrations");
  const migrationNames = fs.readdirSync(migrationDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= finalMigration);
  return computeMigrationTreeSha256(migrationDirectory, migrationNames);
}

export function verifyCheckoutStockReservationForceRelease(
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
  const activation = verifyPromotedCheckoutStockReservationActivation(
    rootDirectory,
  );
  if (
    migrationPrefix(rootDirectory, activation.migrationName)
    !== CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION_TREE_SHA256
  ) {
    throw new Error(
      "CheckoutStockReservation FORCE predecessor migration prefix drifted",
    );
  }

  const candidate = verifyPromotedCheckoutStockReservationForce(rootDirectory);
  const migrationTreeSha256 = migrationPrefix(
    rootDirectory,
    candidate.migrationName,
  );
  if (
    migrationTreeSha256
    !== CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION_TREE_SHA256
  ) {
    throw new Error("CheckoutStockReservation FORCE migration prefix drifted");
  }

  const payoutSuccessorExists = fs.existsSync(path.join(
    rootDirectory,
    "prisma/migrations",
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  ));
  const payoutActivationSuccessorExists = fs.existsSync(path.join(
    rootDirectory,
    "prisma/migrations",
    SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
  ));
  const payoutForceSuccessorExists = fs.existsSync(path.join(
    rootDirectory,
    "prisma/migrations",
    SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  ));
  const refundClaimSuccessorExists = fs.existsSync(path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
  ));
  const refundRecordSuccessorExists = fs.existsSync(path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
  ));
  if (allowReviewedSuccessor && payoutSuccessorExists) {
    if (refundClaimSuccessorExists) {
      verifyOrderRefundClaimGenerationRelease(rootDirectory, {
        allowReviewedRefundRecordSuccessor,
      });
    } else if (payoutActivationSuccessorExists) {
      verifySellerPayoutEventActivationRelease(rootDirectory, {
        allowReviewedForceSuccessor: payoutForceSuccessorExists,
      });
    } else {
      verifySellerPayoutEventAuthorityRelease(rootDirectory);
    }
  }
  const strictGuard = validateCurrentSavedSearchRlsDeployShape({
    phase: CHECKOUT_STOCK_RESERVATION_FORCE_PHASE,
    rootDirectory,
    omittedReviewedMigrationNames:
      allowReviewedSuccessor
        ? [
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
          ]
        : [],
  });
  const guard = allowReviewedSuccessor && payoutSuccessorExists
    ? Object.freeze({
        phase: strictGuard.phase,
        sealedPrefix: true,
        reviewedSuccessorMigration: payoutForceSuccessorExists
          ? refundClaimSuccessorExists
            ? allowReviewedRefundRecordSuccessor
              ? ORDER_REFUND_RECORD_AUTHORITY_MIGRATION
              : ORDER_REFUND_CLAIM_GENERATION_MIGRATION
            : SELLER_PAYOUT_EVENT_FORCE_MIGRATION
          : payoutActivationSuccessorExists
          ? SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION
          : SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
      })
    : strictGuard;
  const runtimeFunctions = CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS
    .filter((entry) => entry.runtimeExecute).length;
  const privateFunctions = CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS
    .filter((entry) => !entry.runtimeExecute).length;

  return Object.freeze({
    phase: CHECKOUT_STOCK_RESERVATION_FORCE_PHASE,
    activationMigration: activation.migrationName,
    activationMigrationSha256: activation.migrationSha256,
    migration: candidate.migrationName,
    draftSha256: candidate.draftSha256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    rollbackSha256: candidate.rollbackDraftSha256,
    protectedTables: 1,
    runtimeFunctions,
    privateFunctions,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    guard,
  });
}

function main() {
  const modes = process.argv.slice(2);
  const mode = modes[0];
  if (
    modes.length > 1
    || (
      mode !== undefined
      && mode !== "--allow-reviewed-successor"
      && mode !== "--allow-reviewed-refund-record-successor"
    )
  ) {
    throw new Error(
      "usage: verify-checkout-stock-reservation-force-release.mjs "
      + "[--allow-reviewed-successor|--allow-reviewed-refund-record-successor]",
    );
  }
  process.stdout.write(`${JSON.stringify(
    verifyCheckoutStockReservationForceRelease(undefined, {
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
      `CheckoutStockReservation FORCE release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
