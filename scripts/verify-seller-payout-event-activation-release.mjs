#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT_SHA256,
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
  buildSellerPayoutEventActivationCandidate,
} from "./stage-seller-payout-event-activation-migration.mjs";
import {
  verifySellerPayoutEventAuthorityRelease,
} from "./verify-seller-payout-event-authority-release.mjs";

export const SELLER_PAYOUT_EVENT_ACTIVATION_RELEASE_PHASE =
  "seller-payout-event-activation-reviewed";
export const SELLER_PAYOUT_EVENT_ACTIVATION_ROLLBACK_SHA256 =
  "b311f9ae78a8d093d2b200f68acf17d1b4d6b2dd4d1eda342f701b0b4553a94a";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifySellerPayoutEventActivationRelease(
  rootDirectory = process.cwd(),
) {
  verifySellerPayoutEventAuthorityRelease(rootDirectory, {
    allowReviewedActivationSuccessor: true,
  });
  const candidate = buildSellerPayoutEventActivationCandidate(rootDirectory);
  const migrationDirectory = path.join(rootDirectory, "prisma/migrations");
  const migrationPath = path.join(
    migrationDirectory,
    SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
    "migration.sql",
  );
  const migration = fs.readFileSync(migrationPath, "utf8");
  if (migration !== candidate.migration) {
    throw new Error(
      "SellerPayoutEvent activation migration differs from byte-pinned draft",
    );
  }

  const migrationNames = fs.readdirSync(migrationDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  if (
    migrationTreeSha256
      !== SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION_TREE_SHA256
  ) {
    throw new Error("SellerPayoutEvent activation migration tree drifted");
  }

  const rollbackPath = path.join(
    rootDirectory,
    "docs/rls-drafts/seller-payout-event-activation-rollback.sql",
  );
  if (
    sha256(fs.readFileSync(rollbackPath, "utf8"))
      !== SELLER_PAYOUT_EVENT_ACTIVATION_ROLLBACK_SHA256
  ) {
    throw new Error("reviewed SellerPayoutEvent activation rollback drifted");
  }

  const schema = fs.readFileSync(
    path.join(rootDirectory, "prisma/schema.prisma"),
    "utf8",
  );
  const model = schema.match(
    /model SellerPayoutEvent \{([\s\S]*?)\n\}/u,
  )?.[1] ?? "";
  if (
    !/^\s*stripeEventCreatedSeconds\s+BigInt\s*$/mu.test(model)
    || /stripeEventCreatedSeconds\s+BigInt\?/u.test(model)
  ) {
    throw new Error(
      "SellerPayoutEvent Prisma provider-event time must be required",
    );
  }

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: SELLER_PAYOUT_EVENT_ACTIVATION_RELEASE_PHASE,
    rootDirectory,
  });
  return Object.freeze({
    phase: SELLER_PAYOUT_EVENT_ACTIVATION_RELEASE_PHASE,
    migration: SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
    draftSha256: SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT_SHA256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    rollbackSha256: SELLER_PAYOUT_EVENT_ACTIVATION_ROLLBACK_SHA256,
    protectedTables: 1,
    runtimeFunctions: 3,
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    providerEventTimeNotNull: true,
    rowDataChanged: false,
    guard,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifySellerPayoutEventActivationRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent activation release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
