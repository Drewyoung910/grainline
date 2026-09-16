import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { checkoutPostpaymentResultFromRows } from "../src/lib/orderCheckoutPostpaymentState.ts";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-checkout-postpayment-authority.sql",
  "utf8",
);
const wrapper = fs.readFileSync(
  "src/lib/orderCheckoutPostpaymentAuthority.ts",
  "utf8",
);
const route = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

function projection(overrides = {}) {
  return {
    orderId: "order-1",
    buyerId: "buyer-1",
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    sellerProfileId: "seller-1",
    sellerUserId: "seller-user",
    sellerDisplayName: "Proof Shop",
    sellerEmail: "seller@example.com",
    itemsSubtotalCents: 500,
    shippingAmountCents: 100,
    taxAmountCents: 50,
    giftWrapping: false,
    giftWrappingPriceCents: null,
    currency: "usd",
    estimatedDeliveryDate: "2026-09-10T12:00:00.000Z",
    processingDeadline: "2026-09-07T12:00:00.000Z",
    shipToLine1: "1 Main St",
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    isFirstLegitimateSale: true,
    items: [{
      id: "item-1",
      listingId: "listing-1",
      quantity: 1,
      priceCents: 500,
      currentStockQuantity: 2,
      listingSnapshot: {
        title: "Proof item",
        description: null,
        priceCents: 500,
        imageUrls: [],
        category: null,
        tags: [],
        sellerName: "Proof Shop",
        capturedAt: "2026-09-05T12:00:00.000Z",
        listingType: "IN_STOCK",
        processingTimeMinDays: null,
        processingTimeMaxDays: null,
        shipsWithinDays: 2,
        shippingWeightGrams: 100,
        shippingLengthCm: 10,
        shippingWidthCm: 10,
        shippingHeightCm: 10,
      },
    }],
    ...overrides,
  };
}

describe("Order checkout post-payment authority", () => {
  it("binds the projection to the active signed event and exact session", () => {
    assert.match(sql, /source_event\."sourceObjectId" IS DISTINCT FROM p_session_id/);
    assert.match(sql, /source_event\."claimGeneration" IS DISTINCT FROM p_claim_generation/);
    assert.match(sql, /source_event\."processingStartedAt" IS NULL/);
    assert.match(sql, /source_event\."processedAt" IS NOT NULL/);
    assert.match(sql, /WHERE source\."stripeSessionId" = p_session_id/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog/);
    assert.doesNotMatch(sql, /\bEXECUTE\s+FORMAT\b|\bEXECUTE\s+IMMEDIATE\b/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
    assert.match(wrapper, /grainline_stripe_checkout_postpayment/);
  });

  it("derives blocking, low-stock, and first-sale state inside PostgreSQL", () => {
    assert.match(sql, /source_order\."sellerRefundId" IS NOT NULL/);
    assert.match(sql, /source_order\."paymentRefundBlocked"/);
    assert.match(sql, /Order was held for staff review\./);
    assert.match(sql, /'currentStockQuantity', listing\."stockQuantity"/);
    assert.match(sql, /candidate\."paidAt" IS NOT NULL/);
    assert.match(sql, /candidate\."sellerRefundId" IS NULL/);
    assert.match(sql, /\(candidate\."paidAt", candidate\.id\) < \(source_order\."paidAt", source_order\.id\)/);
    assert.match(sql, /'isFirstLegitimateSale', is_first_legitimate_sale/);
  });

  it("uses the closed result instead of direct Order, OrderItem, or Listing reads", () => {
    const block = route.slice(
      route.indexOf("async function enqueueOrderPostPaymentSideEffects"),
      route.indexOf("async function sendOrderTransactionalEmailWithFallback"),
    );
    assert.match(block, /readCheckoutPostpaymentProjection\(\{/);
    assert.match(block, /eventId: event\.id/);
    assert.match(block, /claimGeneration/);
    assert.match(block, /sessionId/);
    assert.match(block, /if \(result\.outcome === "blocked"\) return/);
    assert.doesNotMatch(block, /prisma\.(order|orderItem|listing)\./);
    assert.match(block, /order\.isFirstLegitimateSale/);
    assert.match(block, /item\.currentStockQuantity/);
  });

  it("strictly parses ready and blocked results", () => {
    const ready = checkoutPostpaymentResultFromRows([{
      outcome: "ready",
      order_id: "order-1",
      projection: projection(),
    }]);
    assert.equal(ready.outcome, "ready");
    assert.equal(ready.projection.items[0].snapshot.title, "Proof item");
    assert.equal(ready.projection.estimatedDeliveryDate.toISOString(), "2026-09-10T12:00:00.000Z");
    assert.deepEqual(checkoutPostpaymentResultFromRows([{
      outcome: "blocked",
      order_id: "order-1",
      projection: null,
    }]), { outcome: "blocked", orderId: "order-1", projection: null });
    assert.throws(() => checkoutPostpaymentResultFromRows([]), /cardinality/);
    assert.throws(() => checkoutPostpaymentResultFromRows([{
      outcome: "blocked", order_id: "order-1", projection: projection(),
    }]), /inconsistent/);
    assert.throws(() => checkoutPostpaymentResultFromRows([{
      outcome: "ready", order_id: "order-2", projection: projection(),
    }]), /mismatched/);
    assert.throws(() => checkoutPostpaymentResultFromRows([{
      outcome: "ready", order_id: "order-1", projection: projection({ extra: true }),
    }]), /projection keys/);
    assert.throws(() => checkoutPostpaymentResultFromRows([{
      outcome: "ready",
      order_id: "order-1",
      projection: projection({ items: [{ ...projection().items[0], listingSnapshot: {} }] }),
    }]), /incomplete item snapshot/);
  });
});
