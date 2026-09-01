import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("order refund presentation integration", () => {
  it("separates refund presentation from fulfillment on participant detail pages", () => {
    for (const path of [
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
    ]) {
      const page = source(path);
      assert.match(page, /orderPaymentPresentationState/);
      assert.match(page, /suppressActiveFulfillmentForPaymentState/);
      assert.match(page, /Fully refunded — no fulfillment is required\./);
      assert.doesNotMatch(page, /fulfillmentStatus\s*[:=]\s*["']CANCELLED["']/);
    }
  });

  it("does not render seller fulfillment controls after a nonterminal full refund", () => {
    const page = source("src/app/dashboard/sales/[orderId]/page.tsx");
    assert.match(
      page,
      /!suppressActiveFulfillment && status !== "DELIVERED" && status !== "PICKED_UP"/,
    );
    assert.match(page, /!suppressActiveFulfillment && order\.processingDeadline/);
  });

  it("uses the bounded summary's finalized amount without inventing a refund-state field", () => {
    for (const path of [
      "src/app/account/orders/page.tsx",
      "src/app/dashboard/orders/page.tsx",
      "src/app/dashboard/sales/page.tsx",
    ]) {
      const page = source(path);
      assert.match(page, /refundRecorded:\s*(?:order|o)\.sellerRefundAmountCents != null/);
      assert.doesNotMatch(page, /sellerRefundState/);
    }
  });

  it("persists the exact paid Checkout total in both Order creation paths", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    assert.match(webhook, /requireCheckoutChargedTotalCents\(s\.amount_total\)/);
    assert.equal((webhook.match(/\n\s+chargedTotalCents,\n\s+itemsSubtotalCents,/g) ?? []).length, 4);
    assert.doesNotMatch(
      webhook,
      /refundAmountCents\s*=\s*s\.amount_total\s*\?\?/,
    );
  });
});
