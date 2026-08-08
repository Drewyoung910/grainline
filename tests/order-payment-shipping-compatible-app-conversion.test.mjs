import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  requireSingleOrderSellerProfileId,
} = await import("../src/lib/orderSellerKey.ts");

function source(path) {
  return fs.readFileSync(path, "utf8");
}

describe("Order, payment, and shipping compatible application conversion", () => {
  it("records the accepted preparation and undeployed application boundary", () => {
    const record = source("docs/order-payment-shipping-compatible-app-conversion.md");

    assert.match(record, /isolated application candidate/);
    assert.match(record, /not merged or deployed/);
    assert.match(record, /6f1f4c1e99fb21726744ecd1652a37b6be35c294/);
    assert.match(record, /31276366947/);
    assert.match(record, /31277540714/);
    assert.match(record, /20260805012000_prepare_order_payment_shipping_compatibility/);
    assert.match(record, /29f56fa82b68c743e0d081324c5caa9795f0dd0d43e8d0ed42acd28311ef03d3/);
    assert.match(record, /does not itself authorize an\s+application deployment/);
    assert.match(record, /not the complete Order\/OrderItem\/payment\/\s*shipping authority conversion/);
    assert.match(record, /grainline_legacy_stock_restore_claim/);
    assert.match(record, /explicit later\s+activation prerequisite/);
    assert.match(record, /duplicate-`stripeSessionId` recovery branch/);
    assert.match(record, /negative claim generations/);
    assert.match(record, /No test, commit or CI result on this branch changes production state/);
  });

  it("requires one complete durable seller key", () => {
    assert.equal(requireSingleOrderSellerProfileId(["seller-a"]), "seller-a");
    assert.equal(
      requireSingleOrderSellerProfileId(["seller-a", "seller-a"]),
      "seller-a",
    );
    assert.throws(() => requireSingleOrderSellerProfileId([]), /one complete seller id/);
    assert.throws(
      () => requireSingleOrderSellerProfileId(["seller-a", null]),
      /one complete seller id/,
    );
    assert.throws(
      () => requireSingleOrderSellerProfileId(["seller-a", "seller-b"]),
      /exactly one seller/,
    );
    assert.throws(
      () => requireSingleOrderSellerProfileId(["   "]),
      /one complete seller id/,
    );
  });

  it("binds Stripe webhook finalizers to the database-issued claim generation", () => {
    const events = source("src/lib/stripeWebhookEvents.ts");
    const legacy = source("src/app/api/stripe/webhook/route.ts");
    const v2 = source("src/app/api/stripe/webhook/v2/route.ts");

    assert.match(events, /grainline_stripe_webhook_begin\(\$\{id\}, \$\{type\}\)/);
    assert.match(events, /grainline_stripe_webhook_complete\([\s\S]*\$\{claimGeneration\}/);
    assert.match(events, /grainline_stripe_webhook_fail\([\s\S]*\$\{claimGeneration\}/);
    assert.match(events, /stripeWebhookEventReservationFromRows\(rows\)/);
    assert.match(events, /stripeWebhookCompletionFromRows\(rows\)/);
    assert.match(events, /stripeWebhookFailureFromRows\(rows\)/);
    assert.doesNotMatch(events, /prisma\.stripeWebhookEvent\.(?:create|findUnique|updateMany)/);

    for (const route of [legacy, v2]) {
      assert.match(route, /const claimGeneration = reservation\.claimGeneration/);
      assert.match(route, /markStripeWebhookEventProcessed\([^)]*claimGeneration/);
      assert.match(route, /markStripeWebhookEventFailed\([^)]*claimGeneration/);
    }
  });

  it("keeps the legacy stock-restore dedup claim on the fixed lifecycle functions", () => {
    const restore = source("src/lib/checkoutStockRestore.ts");

    assert.match(restore, /const id = `checkout-stock-restore:\$\{sessionId\}`/);
    assert.match(
      restore,
      /beginStripeWebhookEvent\([\s\S]*"checkout\.session\.stock_restored",[\s\S]*tx,[\s\S]*\)/,
    );
    assert.match(restore, /reservation\.action !== "process"/);
    assert.match(
      restore,
      /markStripeWebhookEventProcessed\(id, reservation\.claimGeneration, tx\)/,
    );
    assert.doesNotMatch(restore, /tx\.stripeWebhookEvent\.create/);
  });

  it("writes the locked seller key on both checkout Order shapes and every OrderItem", () => {
    const legacy = source("src/app/api/stripe/webhook/route.ts");

    assert.match(
      legacy,
      /const cartSellerProfileId = requireSingleOrderSellerProfileId\(cartSellerIds\)/,
    );
    assert.match(
      legacy,
      /buyerId: cartInvalidState\.buyerUserId,\s+sellerProfileId: cartSellerProfileId/,
    );
    assert.match(
      legacy,
      /orderId: order\.id,\s+sellerProfileId: cartSellerProfileId,\s+listingId: paid\.listingId/,
    );
    assert.match(
      legacy,
      /const singleSellerProfileId = requireSingleOrderSellerProfileId\(\[\s*transactionListing\?\.seller\?\.id,\s*\]\)/,
    );
    assert.match(
      legacy,
      /buyerId: singleInvalidState\.buyerUserId,\s+sellerProfileId: singleSellerProfileId/,
    );
    assert.match(
      legacy,
      /create: \[\{\s+listingId,\s+sellerProfileId: singleSellerProfileId/,
    );
  });
});
