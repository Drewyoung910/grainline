#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { validateCurrentSavedSearchRlsDeployShape } from "./guard-saved-search-rls-deploy.mjs";
import { verifyPromotedOrderPaymentShippingCompatibility } from "./stage-order-payment-shipping-compatible-preparation.mjs";

export const ORDER_PAYMENT_SHIPPING_COMPATIBILITY_PHASE =
  "order-payment-shipping-compatibility-reviewed";

export function verifyOrderPaymentShippingCompatiblePreparation(
  rootDirectory = process.cwd(),
) {
  const candidate = verifyPromotedOrderPaymentShippingCompatibility(
    rootDirectory,
  );
  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: ORDER_PAYMENT_SHIPPING_COMPATIBILITY_PHASE,
    rootDirectory,
  });
  return Object.freeze({
    phase: ORDER_PAYMENT_SHIPPING_COMPATIBILITY_PHASE,
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    orderSellerKeyDraftSha256: candidate.orderSellerKeyDraftSha256,
    stripeWebhookLeaseDraftSha256: candidate.stripeWebhookLeaseDraftSha256,
    compatibleColumns: 3,
    privateTriggerFunctions: 4,
    runtimeServiceFunctions: 3,
    rlsChanged: false,
    predecessorTableGrantsChanged: false,
    guard,
  });
}

function main() {
  const result = verifyOrderPaymentShippingCompatiblePreparation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Order/payment/shipping compatibility verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
