#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
  STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256,
  buildStripeWebhookEventActivationCandidate,
} from "./stage-stripe-webhook-event-activation-migration.mjs";

export const STRIPE_WEBHOOK_EVENT_ACTIVATION_RELEASE_PHASE =
  "stripe-webhook-event-activation-reviewed";
export const STRIPE_WEBHOOK_EVENT_ACTIVATION_ROLLBACK_SHA256 =
  "a59b087417806305e6fe114c6bddebf7b164e1a2be64d077858403ba7d4cd555";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function verifyStripeWebhookEventActivationRelease(
  rootDirectory = process.cwd(),
) {
  const candidate = buildStripeWebhookEventActivationCandidate(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
    "migration.sql",
  );
  const migration = fs.readFileSync(migrationPath, "utf8");
  if (migration !== candidate.migration) {
    throw new Error(
      "StripeWebhookEvent activation migration differs from byte-pinned draft",
    );
  }

  const migrationNames = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    path.join(rootDirectory, "prisma/migrations"),
    migrationNames,
  );
  if (
    migrationTreeSha256
      !== STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION_TREE_SHA256
  ) {
    throw new Error(
      "StripeWebhookEvent activation migration tree fingerprint drifted",
    );
  }

  const rollbackPath = path.join(
    rootDirectory,
    "docs/rls-drafts/stripe-webhook-event-activation-rollback.sql",
  );
  if (
    sha256(fs.readFileSync(rollbackPath, "utf8"))
      !== STRIPE_WEBHOOK_EVENT_ACTIVATION_ROLLBACK_SHA256
  ) {
    throw new Error(
      "reviewed StripeWebhookEvent activation rollback drifted",
    );
  }

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: STRIPE_WEBHOOK_EVENT_ACTIVATION_RELEASE_PHASE,
    rootDirectory,
  });
  return Object.freeze({
    phase: STRIPE_WEBHOOK_EVENT_ACTIVATION_RELEASE_PHASE,
    migration: STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
    draftSha256: STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    rollbackSha256: STRIPE_WEBHOOK_EVENT_ACTIVATION_ROLLBACK_SHA256,
    protectedTables: 1,
    runtimeFunctions: 6,
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    guard,
  });
}

function main() {
  process.stdout.write(
    `${JSON.stringify(verifyStripeWebhookEventActivationRelease(), null, 2)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent activation release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
