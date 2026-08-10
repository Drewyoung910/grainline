#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
  STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
  STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256,
  buildStripeWebhookEventActivationCandidate,
} from "./stage-stripe-webhook-event-activation-migration.mjs";
import {
  STRIPE_WEBHOOK_EVENT_FORCE_DRAFT_SHA256,
  buildStripeWebhookEventForceCandidate,
} from "./stage-stripe-webhook-event-force-migration.mjs";

export const STRIPE_WEBHOOK_EVENT_FORCE_RELEASE_PHASE =
  "stripe-webhook-event-force-reviewed";
export const STRIPE_WEBHOOK_EVENT_FORCE_ROLLBACK_SHA256 =
  "16766a26bcab922f522c29c5e98eebfb09eead213ad9228c9b0b75d05228fd6a";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function verifyStripeWebhookEventForceRelease(
  rootDirectory = process.cwd(),
) {
  const activation = buildStripeWebhookEventActivationCandidate(rootDirectory);
  const activationMigration = fs.readFileSync(
    path.join(
      rootDirectory,
      "prisma",
      "migrations",
      STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
      "migration.sql",
    ),
    "utf8",
  );
  if (activationMigration !== activation.migration) {
    throw new Error(
      "StripeWebhookEvent FORCE predecessor differs from reviewed Phase A",
    );
  }

  const candidate = buildStripeWebhookEventForceCandidate(rootDirectory);
  const migration = fs.readFileSync(
    path.join(
      rootDirectory,
      "prisma",
      "migrations",
      STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
      "migration.sql",
    ),
    "utf8",
  );
  if (migration !== candidate.migration) {
    throw new Error(
      "StripeWebhookEvent FORCE migration differs from byte-pinned draft",
    );
  }

  const migrationNames = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    path.join(rootDirectory, "prisma/migrations"),
    migrationNames,
  );
  if (
    migrationTreeSha256
      !== STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION_TREE_SHA256
  ) {
    throw new Error("StripeWebhookEvent FORCE migration tree drifted");
  }

  const rollbackPath = path.join(
    rootDirectory,
    "docs/rls-drafts/stripe-webhook-event-force-rollback.sql",
  );
  if (
    sha256(fs.readFileSync(rollbackPath, "utf8"))
      !== STRIPE_WEBHOOK_EVENT_FORCE_ROLLBACK_SHA256
  ) {
    throw new Error("reviewed StripeWebhookEvent FORCE rollback drifted");
  }

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: STRIPE_WEBHOOK_EVENT_FORCE_RELEASE_PHASE,
    rootDirectory,
  });
  return Object.freeze({
    phase: STRIPE_WEBHOOK_EVENT_FORCE_RELEASE_PHASE,
    activationMigration: STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
    activationDraftSha256: STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256,
    activationMigrationSha256: activation.migrationSha256,
    forceMigration: STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
    forceDraftSha256: STRIPE_WEBHOOK_EVENT_FORCE_DRAFT_SHA256,
    forceMigrationSha256: candidate.migrationSha256,
    forceRollbackSha256: STRIPE_WEBHOOK_EVENT_FORCE_ROLLBACK_SHA256,
    migrationTreeSha256,
    protectedTables: 1,
    runtimeFunctions: 6,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    guard,
  });
}

function main() {
  process.stdout.write(
    `${JSON.stringify(verifyStripeWebhookEventForceRelease(), null, 2)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent FORCE release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
