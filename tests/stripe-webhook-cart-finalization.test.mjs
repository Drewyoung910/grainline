import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const webhookSource = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

describe("Stripe cart checkout webhook finalization", () => {
  it("creates cart order items from Stripe paid line items, not mutable live cart rows", () => {
    assert.match(
      webhookSource,
      /const paidItems: PaidItem\[\] = \[\];/,
      "cart finalization must build an immutable paid-items list from Stripe line_items",
    );
    assert.match(
      webhookSource,
      /for \(const checkoutItem of checkoutItems\)/,
      "order item creation must iterate normalized Stripe-paid checkout items",
    );
    assert.doesNotMatch(
      webhookSource,
      /for \(const it of cart\.items\)/,
      "order item creation must not loop over live cart rows after payment",
    );
    assert.doesNotMatch(
      webhookSource,
      /if \(!cart \|\| cart\.items\.length === 0\)/,
      "a missing or emptied cart must not cause a paid checkout to be silently acknowledged without an order",
    );
  });

  it("stores paid unit prices in order snapshots instead of mutable listing prices", () => {
    assert.match(
      webhookSource,
      /priceCents: orderPriceCents,\s+listingSnapshot: \{[\s\S]*?priceCents: orderPriceCents,/,
      "cart item snapshots must preserve the Stripe-paid unit price",
    );
    assert.match(
      webhookSource,
      /const singleOrderPriceCents = singlePaidLine\?\.price\?\.unit_amount \?\? price;/,
      "single-listing checkout must prefer the Stripe-paid unit price",
    );
    assert.match(
      webhookSource,
      /priceCents: singleOrderPriceCents,\s+listingSnapshot: \{[\s\S]*?priceCents: singleOrderPriceCents,/,
      "single-listing snapshots must preserve the charged unit price",
    );
  });

  it("revalidates seller and listing eligibility inside the checkout transaction", () => {
    assert.match(
      webhookSource,
      /vacationMode: true,\s+acceptingNewOrders: true,/,
      "transaction seller revalidation must include vacationMode and acceptingNewOrders",
    );
    assert.match(
      webhookSource,
      /select: \{ id: true, status: true, isPrivate: true, reservedForUserId: true \}/,
      "transaction listing revalidation must include public/active/reservation state",
    );
    assert.match(
      webhookSource,
      /listings: cartListingIds\.map\(\(listingId\) => transactionListingById\.get\(listingId\)\)/,
      "cart finalization must pass transaction-fresh listings into checkoutInvalidReasonState",
    );
    assert.match(
      webhookSource,
      /listings: \[transactionListing\]/,
      "single-listing finalization must pass transaction-fresh listing state into checkoutInvalidReasonState",
    );
  });
});
