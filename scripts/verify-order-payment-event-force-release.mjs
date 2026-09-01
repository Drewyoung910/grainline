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
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
} from "./order-participant-list-authority-catalog.mjs";

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

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: ORDER_PAYMENT_EVENT_FORCE_PHASE,
    rootDirectory,
    omittedReviewedMigrationNames: allowReviewedOrderParticipantListSuccessor
      ? [
          ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
          ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
        ]
      : [],
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
