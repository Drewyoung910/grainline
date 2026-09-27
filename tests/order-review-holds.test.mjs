import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE,
  orderHasDeauthorizedSellerReviewHold,
} = await import("../src/lib/orderReviewHolds.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("order review holds", () => {
  it("uses only the durable Stripe deauthorization witness", () => {
    assert.equal(
      orderHasDeauthorizedSellerReviewHold({
        sellerDeauthorizedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
      true,
    );
    assert.equal(
      orderHasDeauthorizedSellerReviewHold({
        sellerDeauthorizedAt: null,
      }),
      false,
    );
  });

  it("keeps the legacy note as database compatibility while the webhook uses fixed authority", () => {
    const platformWebhook = source("src/app/api/stripe/webhook/route.ts");
    const v2Webhook = source("src/app/api/stripe/webhook/v2/route.ts");
    const deauthorizationAuthority = source(
      "docs/rls-drafts/order-seller-deauthorization-authority.sql",
    );

    assert.match(v2Webhook, /applyStripeSellerDeauthorization/);
    assert.doesNotMatch(platformWebhook, /applyStripeSellerDeauthorization/);
    assert.doesNotMatch(v2Webhook, /DEAUTHORIZED_SELLER_REVIEW_NOTE/);
    assert.doesNotMatch(v2Webhook, /reviewNote: "Seller Stripe account was deauthorized after payment/);
    assert.match(
      deauthorizationAuthority,
      /Seller Stripe account was deauthorized after payment\./,
    );
  });

  it("blocks deauthorized orders in fulfillment prechecks and final predicates", () => {
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const authority = source(
      "prisma/migrations/20260926012000_correct_order_seller_deauthorization_fulfillment/migration.sql",
    );

    assert.match(fulfillment, /DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE/);
    assert.match(fulfillment, /finalizeSellerOrderFulfillment\(\{/);
    assert.match(
      authority,
      /locked_order\."sellerDeauthorizedAt" IS NOT NULL/,
    );
    assert.match(authority, /'reason', 'seller_deauthorized'/);
  });

  it("blocks deauthorized orders before label purchase and inside the label lock", () => {
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");
    const labelAuthority = source(
      "prisma/migrations/20260926012100_correct_order_seller_deauthorization_label/migration.sql",
    );

    assert.match(labelRoute, /sellerLabelPreflight/);
    assert.match(labelRoute, /case "seller_deauthorized"/);
    assert.match(labelAuthority, /source_order\."sellerDeauthorizedAt" IS NOT NULL/);
    assert.match(labelAuthority, /locked_order\."sellerDeauthorizedAt" IS NOT NULL/);
    assert.match(labelAuthority, /'reason', 'seller_deauthorized'/);
  });

  it("hides seller fulfillment controls while a deauthorization hold is active", () => {
    const page = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const detailAuthority = source(
      "prisma/migrations/20260926012200_correct_order_seller_deauthorization_projection/migration.sql",
    );
    const detailProjection = source(
      "prisma/migrations/20260901100000_prepare_order_participant_detail_projection/migration.sql",
    );
    const actionStart = page.indexOf("<div className=\"font-medium\">Fulfillment actions</div>");
    const actionEnd = page.indexOf("{/* Seller notes */}", actionStart);
    const actionBlock = page.slice(actionStart, actionEnd);

    assert.match(page, /const deauthorizedReviewHold = order\.deauthorizedReviewHold/);
    assert.match(
      detailAuthority,
      /source_order\."sellerDeauthorizedAt" IS NOT NULL/,
    );
    assert.match(detailProjection, /detail\.deauthorized_review_hold/);
    assert.match(actionBlock, /\{deauthorizedReviewHold \? \(/);
    assert.match(actionBlock, /DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE/);
    assert.ok(
      actionBlock.indexOf("deauthorizedReviewHold") < actionBlock.indexOf("<LabelSection"),
      "deauthorization hold branch must wrap label purchase controls",
    );
    assert.ok(
      actionBlock.indexOf("deauthorizedReviewHold") < actionBlock.indexOf("Mark shipped"),
      "deauthorization hold branch must wrap manual fulfillment controls",
    );
    assert.match(DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE, /Staff must review payout/);
  });
});
