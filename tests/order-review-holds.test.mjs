import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE,
  DEAUTHORIZED_SELLER_REVIEW_NOTE,
  orderHasDeauthorizedSellerReviewHold,
} = await import("../src/lib/orderReviewHolds.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("order review holds", () => {
  it("detects only Stripe deauthorization holds, not every reviewNeeded order", () => {
    assert.equal(
      orderHasDeauthorizedSellerReviewHold({
        reviewNeeded: true,
        reviewNote: DEAUTHORIZED_SELLER_REVIEW_NOTE,
      }),
      true,
    );
    assert.equal(
      orderHasDeauthorizedSellerReviewHold({
        reviewNeeded: true,
        reviewNote: "Shipping quote mismatch requires staff review.",
      }),
      false,
    );
    assert.equal(
      orderHasDeauthorizedSellerReviewHold({
        reviewNeeded: false,
        reviewNote: DEAUTHORIZED_SELLER_REVIEW_NOTE,
      }),
      false,
    );
  });

  it("uses the shared deauthorization note in the Stripe webhook", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(webhook, /DEAUTHORIZED_SELLER_REVIEW_NOTE/);
    assert.doesNotMatch(webhook, /reviewNote: "Seller Stripe account was deauthorized after payment/);
  });

  it("blocks deauthorized orders in fulfillment prechecks and final predicates", () => {
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");

    assert.match(fulfillment, /orderHasDeauthorizedSellerReviewHold\(authz\.order\)/);
    assert.match(fulfillment, /DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE/);
    assert.match(fulfillment, /action !== "update_notes" && orderHasDeauthorizedSellerReviewHold\(authz\.order\)/);
    assert.match(fulfillment, /NOT: deauthorizedSellerReviewHoldWhere\(\)/);
  });

  it("blocks deauthorized orders before label purchase and inside the label lock", () => {
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");

    assert.match(labelRoute, /orderHasDeauthorizedSellerReviewHold\(order\)/);
    assert.match(labelRoute, /DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE/);
    assert.match(labelRoute, /DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN/);
    assert.match(labelRoute, /COALESCE\("reviewNote", ''\) LIKE \$\{DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN\}/);
  });

  it("hides seller fulfillment controls while a deauthorization hold is active", () => {
    const page = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const actionStart = page.indexOf("<div className=\"font-medium\">Fulfillment actions</div>");
    const actionEnd = page.indexOf("{/* Seller notes */}", actionStart);
    const actionBlock = page.slice(actionStart, actionEnd);

    assert.match(page, /const deauthorizedReviewHold = orderHasDeauthorizedSellerReviewHold\(order\)/);
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
