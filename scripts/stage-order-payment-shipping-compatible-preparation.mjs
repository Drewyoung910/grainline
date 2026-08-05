#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION =
  "20260805012000_prepare_order_payment_shipping_compatibility";
export const ORDER_SELLER_KEY_DRAFT =
  "docs/rls-drafts/order-seller-key-compatibility.sql";
export const STRIPE_WEBHOOK_LEASE_DRAFT =
  "docs/rls-drafts/stripe-webhook-lease-compatibility.sql";
export const ORDER_SELLER_KEY_DRAFT_SHA256 =
  "809f4d2b556146557354a27ace6671399c85933fb19179acb3d85a8aaa0b6a9a";
export const STRIPE_WEBHOOK_LEASE_DRAFT_SHA256 =
  "e84b16163ac56fbad264197846f426eaa917d0e0f9fa141e0f00d4de099ac057";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function readPinnedDraft(rootDirectory, relativePath, expectedSha256) {
  const source = fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
  if (sha256(source) !== expectedSha256) {
    throw new Error(`${relativePath} differs from the reviewed draft bytes`);
  }
  if (!source.includes("DRAFT ONLY") || !source.includes("not a production migration")) {
    throw new Error(`${relativePath} lost its draft-only boundary`);
  }

  const beginMarker = "\nBEGIN;\n";
  const beginIndex = source.indexOf(beginMarker);
  if (beginIndex < 0 || !source.endsWith("\nCOMMIT;\n")) {
    throw new Error(`${relativePath} is not one exact transaction-wrapped draft`);
  }
  const body = source.slice(
    beginIndex + beginMarker.length,
    -"\nCOMMIT;\n".length,
  );
  if (/^\s*(?:BEGIN|COMMIT);/m.test(body)) {
    throw new Error(`${relativePath} contains a nested transaction boundary`);
  }
  return Object.freeze({ body, sha256: expectedSha256 });
}

export function buildOrderPaymentShippingCompatibilityCandidate(
  rootDirectory = process.cwd(),
) {
  const sellerKey = readPinnedDraft(
    rootDirectory,
    ORDER_SELLER_KEY_DRAFT,
    ORDER_SELLER_KEY_DRAFT_SHA256,
  );
  const webhookLease = readPinnedDraft(
    rootDirectory,
    STRIPE_WEBHOOK_LEASE_DRAFT,
    STRIPE_WEBHOOK_LEASE_DRAFT_SHA256,
  );
  const migration = `-- Coexistence-safe Order/payment/shipping preparation.
--
-- This migration adds durable seller keys and generation-bound Stripe webhook
-- lease operations while preserving predecessor table grants and RLS posture.
-- It is additive compatibility work, not an RLS activation.

BEGIN;

${sellerKey.body}

${webhookLease.body}

COMMIT;
`;

  if (/ALTER TABLE public\."(?:Order|OrderItem|StripeWebhookEvent)"\s+(?:ENABLE|FORCE) ROW LEVEL SECURITY/i.test(migration)) {
    throw new Error("compatibility candidate must not activate RLS");
  }
  if (/(?:GRANT|REVOKE)[\s\S]{0,120}ON TABLE public\."(?:Order|OrderItem|StripeWebhookEvent)"/i.test(migration)) {
    throw new Error("compatibility candidate must not change predecessor table grants");
  }

  return Object.freeze({
    migration,
    migrationName: ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION,
    migrationSha256: sha256(migration),
    orderSellerKeyDraftSha256: sellerKey.sha256,
    stripeWebhookLeaseDraftSha256: webhookLease.sha256,
  });
}

export function verifyPromotedOrderPaymentShippingCompatibility(
  rootDirectory = process.cwd(),
) {
  const candidate = buildOrderPaymentShippingCompatibilityCandidate(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    candidate.migrationName,
    "migration.sql",
  );
  if (!fs.existsSync(migrationPath)) {
    throw new Error("promoted Order/payment/shipping compatibility migration is missing");
  }
  const promoted = fs.readFileSync(migrationPath, "utf8");
  if (promoted !== candidate.migration) {
    throw new Error("promoted compatibility migration differs from reviewed drafts");
  }
  return candidate;
}

function main() {
  const candidate = buildOrderPaymentShippingCompatibilityCandidate();
  if (process.argv.includes("--print-migration")) {
    process.stdout.write(candidate.migration);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    orderSellerKeyDraftSha256: candidate.orderSellerKeyDraftSha256,
    stripeWebhookLeaseDraftSha256: candidate.stripeWebhookLeaseDraftSha256,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Order/payment/shipping compatibility staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
