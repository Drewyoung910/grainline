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
const REVIEWED_SUCCESSOR_PHASE = "case-resolution-window-reviewed";
export const STRIPE_WEBHOOK_EVENT_ACTIVATION_ROLLBACK_SHA256 =
  "2174c06aba53726523921ef0938cc92744aed187ea5dfdff3a8ea1e3499b3722";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function verifyStripeWebhookEventActivationRelease(
  rootDirectory = process.cwd(),
  { allowReviewedSuccessor = false } = {},
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
    .map((entry) => entry.name)
    .filter((name) => name <= STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION);
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

  let guard;
  if (allowReviewedSuccessor) {
    const successorGuard = validateCurrentSavedSearchRlsDeployShape({
      phase: REVIEWED_SUCCESSOR_PHASE,
      rootDirectory,
    });
    guard = Object.freeze({
      phase: STRIPE_WEBHOOK_EVENT_ACTIVATION_RELEASE_PHASE,
      sealedPrefix: true,
      successorPhase: successorGuard.phase,
    });
  } else {
    guard = validateCurrentSavedSearchRlsDeployShape({
      phase: STRIPE_WEBHOOK_EVENT_ACTIVATION_RELEASE_PHASE,
      rootDirectory,
    });
  }
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
  const mode = process.argv[2];
  if (mode !== undefined && mode !== "--allow-reviewed-successor") {
    throw new Error(
      "usage: verify-stripe-webhook-event-activation-release.mjs "
      + "[--allow-reviewed-successor]",
    );
  }
  process.stdout.write(
    `${JSON.stringify(verifyStripeWebhookEventActivationRelease(undefined, {
      allowReviewedSuccessor: mode === "--allow-reviewed-successor",
    }), null, 2)}\n`,
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
