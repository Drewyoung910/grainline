#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION,
  STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_TREE_SHA256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import { verifyPromotedOrderPaymentShippingCompatibility } from "./stage-order-payment-shipping-compatible-preparation.mjs";

export const STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_PHASE =
  "stripe-webhook-maintenance-authority-reviewed";
export const STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_SHA256 =
  "0c34cc94f6a602e8f686487277b422f3ba4e89a1f2c50b9b3b673cb63d259df5";

const functions = Object.freeze([
  Object.freeze({
    name: "grainline_stripe_webhook_prune_batch",
    signature: "grainline_stripe_webhook_prune_batch(integer)",
  }),
  Object.freeze({
    name: "grainline_stripe_webhook_health_summary",
    signature: "grainline_stripe_webhook_health_summary()",
  }),
  Object.freeze({
    name: "grainline_legacy_stock_restore_claim",
    signature: "grainline_legacy_stock_restore_claim(text)",
  }),
]);

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function verifyStripeWebhookMaintenanceAuthorityMigration(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = fs.readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  if (
    migrationSha256
    !== STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_SHA256
  ) {
    throw new Error("Stripe webhook maintenance migration bytes drifted");
  }

  for (const reviewed of functions) {
    if (!new RegExp(`CREATE FUNCTION public\\.${reviewed.name}\\s*\\(`).test(migration)) {
      throw new Error(`missing reviewed service function ${reviewed.signature}`);
    }
    const escapedSignature = reviewed.signature.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    if (!new RegExp(
      `REVOKE ALL ON FUNCTION public\\.${escapedSignature}\\s+`
      + "FROM PUBLIC, grainline_app_runtime;",
    ).test(migration)) {
      throw new Error(`missing reviewed revoke for ${reviewed.signature}`);
    }
    if (!new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${escapedSignature}\\s+`
      + "TO grainline_app_runtime;",
    ).test(migration)) {
      throw new Error(`missing reviewed grant for ${reviewed.signature}`);
    }
  }
  if ((migration.match(/SECURITY DEFINER/g) ?? []).length !== 3) {
    throw new Error("Stripe webhook maintenance function count drifted");
  }
  if ((migration.match(/SET search_path = pg_catalog/g) ?? []).length !== 3) {
    throw new Error("Stripe webhook maintenance search_path posture drifted");
  }
  if (/\b(?:ENABLE|FORCE) ROW LEVEL SECURITY\b/.test(migration)) {
    throw new Error("Stripe webhook maintenance preparation changed RLS");
  }
  if (/\b(?:GRANT|REVOKE)\b[\s\S]{0,80}\bON TABLE\b/i.test(migration)) {
    throw new Error("Stripe webhook maintenance preparation changed table grants");
  }
  if (/pg_catalog\.(?:coalesce|nullif|greatest|least)\b/i.test(migration)) {
    throw new Error("PostgreSQL special forms must remain unqualified");
  }

  return Object.freeze({
    migrationName: STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION,
    migrationSha256,
    runtimeServiceFunctions: functions.length,
    rlsChanged: false,
    predecessorTableGrantsChanged: false,
    rowDataChanged: false,
  });
}

export function verifyStripeWebhookMaintenanceAuthority(
  rootDirectory = process.cwd(),
) {
  const migration = verifyStripeWebhookMaintenanceAuthorityMigration(
    rootDirectory,
  );
  const predecessor = verifyPromotedOrderPaymentShippingCompatibility(
    rootDirectory,
  );
  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_PHASE,
    rootDirectory,
  });
  return Object.freeze({
    phase: STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_PHASE,
    ...migration,
    migrationTreeSha256:
      STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_TREE_SHA256,
    predecessorMigration: predecessor.migrationName,
    predecessorMigrationSha256: predecessor.migrationSha256,
    guard,
  });
}

function main() {
  process.stdout.write(
    `${JSON.stringify(verifyStripeWebhookMaintenanceAuthority(), null, 2)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Stripe webhook maintenance verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
