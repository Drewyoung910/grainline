#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
  buildSellerPayoutEventActivationCandidate,
} from "./stage-seller-payout-event-activation-migration.mjs";
import {
  SELLER_PAYOUT_EVENT_FORCE_DRAFT_SHA256,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
  SELLER_PAYOUT_EVENT_FORCE_ROLLBACK_SHA256,
  buildSellerPayoutEventForceCandidate,
} from "./stage-seller-payout-event-force-migration.mjs";
import {
  verifySellerPayoutEventActivationRelease,
} from "./verify-seller-payout-event-activation-release.mjs";

export const SELLER_PAYOUT_EVENT_FORCE_PHASE =
  "seller-payout-event-force-reviewed";

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

export function verifySellerPayoutEventForceRelease(
  rootDirectory = process.cwd(),
) {
  const activation = verifySellerPayoutEventActivationRelease(rootDirectory, {
    allowReviewedForceSuccessor: true,
  });
  const activationCandidate = buildSellerPayoutEventActivationCandidate(
    rootDirectory,
  );
  if (
    activation.migration !== SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION
    || activation.migrationSha256 !== activationCandidate.migrationSha256
    || migrationPrefix(rootDirectory, activation.migration)
      !== SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256
  ) {
    throw new Error("SellerPayoutEvent FORCE predecessor prefix drifted");
  }

  const candidate = buildSellerPayoutEventForceCandidate(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
    "migration.sql",
  );
  if (
    !fs.existsSync(migrationPath)
    || fs.readFileSync(migrationPath, "utf8") !== candidate.migration
    || candidate.migrationSha256 !== SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256
  ) {
    throw new Error(
      "SellerPayoutEvent FORCE migration differs from byte-pinned draft",
    );
  }
  const migrationTreeSha256 = migrationPrefix(
    rootDirectory,
    SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  );
  if (migrationTreeSha256 !== SELLER_PAYOUT_EVENT_FORCE_MIGRATION_TREE_SHA256) {
    throw new Error("SellerPayoutEvent FORCE migration prefix drifted");
  }

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: SELLER_PAYOUT_EVENT_FORCE_PHASE,
    rootDirectory,
  });
  return Object.freeze({
    phase: SELLER_PAYOUT_EVENT_FORCE_PHASE,
    activationMigration: activation.migration,
    activationMigrationSha256: activation.migrationSha256,
    migration: SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
    draftSha256: SELLER_PAYOUT_EVENT_FORCE_DRAFT_SHA256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    rollbackSha256: SELLER_PAYOUT_EVENT_FORCE_ROLLBACK_SHA256,
    protectedTables: 1,
    runtimeFunctions: 3,
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
      verifySellerPayoutEventForceRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent FORCE release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
