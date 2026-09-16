#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  ORDER_PAYMENT_EVENT_ACTIVATION_PHASE,
  buildOrderPaymentEventActivationCandidate,
} from "./build-order-payment-event-activation-candidate.mjs";
import {
  verifyOrderPaymentEventActivationMigrationBytes,
} from "./order-payment-event-activation-identity.mjs";
import {
  verifyOrderPaymentEventTransitionAuthorityMigrationBytes,
} from "./order-payment-event-transition-authority-catalog.mjs";
import {
  verifyOrderPaymentEventZeroDirectAccess,
} from "./verify-order-payment-event-zero-direct-access.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
} from "./stage-order-payment-event-force-migration.mjs";
import {
  CASE_CORRECTNESS_MIGRATION,
  verifyOptionalCaseCorrectnessSuccessor,
} from "./build-case-correctness-migration.mjs";
import {
  ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
  verifyOrderStaffReadChargedTotalCorrection,
} from "./verify-order-staff-read-charged-total-correction.mjs";
import {
  ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
  verifyOrderAccountDeletionAuthority,
} from "./verify-order-account-deletion-authority.mjs";
import {
  appendReviewedOrderZeroDirectCompatibleSuccessors,
} from "./stage-order-zero-direct-compatible-prefix.mjs";
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
import {
  ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
} from "./order-participant-list-projection-correction-catalog.mjs";

export function verifyOrderPaymentEventActivationRelease(
  rootDirectory = process.cwd(),
  {
    allowReviewedForceSuccessor = false,
    allowReviewedOrderParticipantListSuccessor = false,
  } = {},
) {
  verifyOrderPaymentEventTransitionAuthorityMigrationBytes(rootDirectory);
  const zeroDirect = verifyOrderPaymentEventZeroDirectAccess(rootDirectory);
  const candidate = buildOrderPaymentEventActivationCandidate(rootDirectory);
  const migrationDirectory = path.join(rootDirectory, "prisma/migrations");
  const migrationPath = path.join(
    migrationDirectory,
    ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
    "migration.sql",
  );
  if (!fs.existsSync(migrationPath)) {
    throw new Error("OrderPaymentEvent activation migration is missing");
  }
  if (fs.readFileSync(migrationPath, "utf8") !== candidate.migration) {
    throw new Error("OrderPaymentEvent activation migration bytes drifted");
  }
  verifyOrderPaymentEventActivationMigrationBytes(rootDirectory);
  if (
    fs.readFileSync(
      path.join(
        rootDirectory,
        "docs/rls-drafts/order-payment-event-activation.sql",
      ),
      "utf8",
    ) !== candidate.draft
    || fs.readFileSync(
      path.join(
        rootDirectory,
        "docs/rls-drafts/order-payment-event-activation-rollback.sql",
      ),
      "utf8",
    ) !== candidate.rollback
  ) {
    throw new Error("OrderPaymentEvent activation draft or rollback drifted");
  }

  const migrationNames = fs.readdirSync(migrationDirectory, {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    .filter((name) => name <= ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  if (
    migrationTreeSha256 !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256
  ) {
    throw new Error("OrderPaymentEvent activation migration tree drifted");
  }

  const provisioning = fs.readFileSync(
    path.join(rootDirectory, "scripts/provision-runtime-db-role.sql"),
    "utf8",
  );
  if (
    !provisioning.includes(
      "OrderPaymentEvent becomes a policyless service ledger at Phase A",
    )
    || !provisioning.includes(
      `'public."grainline_blocked_checkout_refund_claim"(text, bigint, text, text, integer)'`,
    )
    || !provisioning.includes(
      `'public."grainline_case_seller_refund_apply"(text, text)'`,
    )
  ) {
    throw new Error("OrderPaymentEvent activation-aware provisioning drifted");
  }

  const caseCorrectnessSuccessor =
    verifyOptionalCaseCorrectnessSuccessor(rootDirectory);
  const omittedReviewedMigrationNames = [
    ...(allowReviewedForceSuccessor ? [ORDER_PAYMENT_EVENT_FORCE_MIGRATION] : []),
    ...(allowReviewedOrderParticipantListSuccessor
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
          ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
        ]
      : []),
  ];
  if (caseCorrectnessSuccessor) {
    omittedReviewedMigrationNames.push(CASE_CORRECTNESS_MIGRATION);
  }
  const staffReadCorrectionPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
  );
  if (fs.existsSync(staffReadCorrectionPath)) {
    if (!caseCorrectnessSuccessor) {
      throw new Error(
        "Order staff charged-total correction requires the Case correctness predecessor",
      );
    }
    verifyOrderStaffReadChargedTotalCorrection(rootDirectory);
    omittedReviewedMigrationNames.push(
      ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
    );
  }
  const accountDeletionAuthorityPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
  );
  if (fs.existsSync(accountDeletionAuthorityPath)) {
    if (!omittedReviewedMigrationNames.includes(
      ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
    )) {
      throw new Error(
        "Order account-deletion authority requires the staff charged-total correction",
      );
    }
    verifyOrderAccountDeletionAuthority(rootDirectory);
    omittedReviewedMigrationNames.push(ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION);
  }
  appendReviewedOrderZeroDirectCompatibleSuccessors({
    root: rootDirectory,
    laterMigrations: fs.readdirSync(migrationDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name > ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION),
    reviewedSuccessors: omittedReviewedMigrationNames,
    expectedPredecessor: ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
  });
  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: ORDER_PAYMENT_EVENT_ACTIVATION_PHASE,
    rootDirectory,
    omittedReviewedMigrationNames,
  });
  return Object.freeze({
    phase: ORDER_PAYMENT_EVENT_ACTIVATION_PHASE,
    migration: ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
    draftSha256: candidate.draftSha256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    rollbackSha256: candidate.rollbackSha256,
    protectedTables: 1,
    runtimeFunctionsBefore: 18,
    runtimeFunctionsAfter: 16,
    privateFunctionsAfter: 13,
    policyCount: 0,
    rlsEnabled: true,
    rlsForced: false,
    zeroDirectAccess: zeroDirect.directAccessMatches === 0,
    rowDataChanged: false,
    productionChanged: false,
    reviewedCaseCorrectnessSuccessor: caseCorrectnessSuccessor,
    guard,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderPaymentEventActivationRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(`OrderPaymentEvent activation release failed closed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`);
    process.exitCode = 1;
  }
}
