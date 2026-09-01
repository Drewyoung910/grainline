#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256,
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256,
} from "./order-payment-event-activation-identity.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_DRAFT_SHA256,
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256,
  ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_SHA256,
  buildOrderPaymentEventForceCandidate,
} from "./stage-order-payment-event-force-migration.mjs";
import {
  verifyOrderPaymentEventActivationRelease,
} from "./verify-order-payment-event-activation-release.mjs";
import {
  CASE_CORRECTNESS_MIGRATION,
  verifyOptionalCaseCorrectnessSuccessor,
} from "./build-case-correctness-migration.mjs";
import {
  ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
  ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION,
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
  ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
  ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
  ORDER_STAFF_READ_AUTHORITY_MIGRATION,
} from "./order-participant-list-authority-catalog.mjs";
import {
  ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION,
} from "./order-receipt-notification-authority-catalog.mjs";
import {
  ORDER_FULFILLMENT_AUTHORITY_MIGRATION,
} from "./order-fulfillment-authority-catalog.mjs";
import {
  ORDER_LABEL_AUTHORITY_MIGRATION,
} from "./order-label-authority-catalog.mjs";
import {
  ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION,
} from "./order-charged-total-compatibility-catalog.mjs";

export const ORDER_PAYMENT_EVENT_FORCE_PHASE =
  "order-payment-event-force-reviewed";

function migrationPrefix(rootDirectory, finalMigration) {
  const migrationDirectory = path.join(rootDirectory, "prisma/migrations");
  const migrationNames = fs.readdirSync(migrationDirectory, {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    .filter((name) => name <= finalMigration);
  return computeMigrationTreeSha256(migrationDirectory, migrationNames);
}

export function verifyOrderPaymentEventForceRelease(
  rootDirectory = process.cwd(),
  { allowReviewedOrderParticipantListSuccessor = false } = {},
) {
  const activation = verifyOrderPaymentEventActivationRelease(rootDirectory, {
    allowReviewedForceSuccessor: true,
    allowReviewedOrderParticipantListSuccessor,
  });
  if (
    activation.migration !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION
    || activation.migrationSha256 !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256
    || migrationPrefix(rootDirectory, activation.migration)
      !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256
  ) {
    throw new Error("OrderPaymentEvent FORCE predecessor prefix drifted");
  }

  const candidate = buildOrderPaymentEventForceCandidate(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
    "migration.sql",
  );
  if (
    !fs.existsSync(migrationPath)
    || fs.readFileSync(migrationPath, "utf8") !== candidate.migration
    || candidate.migrationSha256 !== ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256
  ) {
    throw new Error(
      "OrderPaymentEvent FORCE migration differs from byte-pinned draft",
    );
  }
  const migrationTreeSha256 = migrationPrefix(
    rootDirectory,
    ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  );
  if (migrationTreeSha256 !== ORDER_PAYMENT_EVENT_FORCE_MIGRATION_TREE_SHA256) {
    throw new Error("OrderPaymentEvent FORCE migration prefix drifted");
  }

  const caseCorrectnessSuccessor =
    verifyOptionalCaseCorrectnessSuccessor(rootDirectory);
  const omittedReviewedMigrationNames = allowReviewedOrderParticipantListSuccessor
    ? [
        ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
        ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
        ORDER_STAFF_READ_AUTHORITY_MIGRATION,
        ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
        ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
        ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
        ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
        ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
        ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
        ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
        ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
        ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION,
        ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION,
        ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION,
        ORDER_FULFILLMENT_AUTHORITY_MIGRATION,
        ORDER_LABEL_AUTHORITY_MIGRATION,
        ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION,
      ]
    : [];
  if (caseCorrectnessSuccessor) {
    omittedReviewedMigrationNames.push(CASE_CORRECTNESS_MIGRATION);
  }
  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: ORDER_PAYMENT_EVENT_FORCE_PHASE,
    rootDirectory,
    omittedReviewedMigrationNames,
  });
  return Object.freeze({
    phase: ORDER_PAYMENT_EVENT_FORCE_PHASE,
    activationMigration: activation.migration,
    activationMigrationSha256: activation.migrationSha256,
    migration: ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
    draftSha256: ORDER_PAYMENT_EVENT_FORCE_DRAFT_SHA256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    rollbackSha256: ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_SHA256,
    protectedTables: 1,
    runtimeFunctions: 16,
    privateFunctions: 13,
    directReferenceFunctions: 25,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    reviewedCaseCorrectnessSuccessor: caseCorrectnessSuccessor,
    guard,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderPaymentEventForceRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent FORCE release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
