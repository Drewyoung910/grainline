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
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
  ORDER_STAFF_READ_AUTHORITY_MIGRATION,
} from "./order-participant-list-authority-catalog.mjs";

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

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: ORDER_PAYMENT_EVENT_ACTIVATION_PHASE,
    rootDirectory,
    omittedReviewedMigrationNames: [
      ...(allowReviewedForceSuccessor ? [ORDER_PAYMENT_EVENT_FORCE_MIGRATION] : []),
      ...(allowReviewedOrderParticipantListSuccessor
        ? [
            ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
            ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
            ORDER_STAFF_READ_AUTHORITY_MIGRATION,
          ]
        : []),
    ],
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
