import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      const filePath = path.join(
        process.cwd(),
        "src",
        relative.endsWith(".ts") ? relative : `${relative}.ts`,
      );
      return nextResolve(pathToFileURL(filePath).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const email = await import("../src/lib/email.ts");

describe("names with an ampersand or apostrophe", () => {
  // Shop names reach email as stored: sanitize-html wrote "&" as "&amp;".
  const stored = "O'Brien &amp; Daughters";

  it("keeps them readable in subjects", () => {
    assert.equal(
      email.sellerBroadcastEmailSubject(stored),
      "Update from O'Brien & Daughters on Grainline",
    );
    assert.equal(
      email.renderNewListingFromFollowedMakerEmail({
        to: "a@example.com",
        makerName: stored,
        listingTitle: "Oak &amp; Iron Rack",
        listingPrice: "$10.00",
        listingUrl: "https://example.test/listing/1",
      }).subject,
      "O'Brien & Daughters just posted a new listing on Grainline",
    );
    assert.equal(
      email.renderWelcomeSellerEmail({ seller: { email: "a@example.com" } }).subject,
      "Welcome to Grainline - let's set up your shop!",
    );
  });

  it("does not show a literal &amp; in the body", () => {
    const { html } = email.renderBackInStockEmail({
      buyer: { email: "a@example.com" },
      listingTitle: "Oak &amp; Iron Rack",
      listingId: "listing-1",
    });
    assert.match(html, /Oak &amp; Iron Rack/);
    assert.doesNotMatch(html, /&amp;amp;/);
  });
});

const orderTotals = {
  itemsSubtotalCents: 48000,
  shippingAmountCents: 1500,
  taxAmountCents: 3934,
  giftWrapping: false,
  giftWrappingPriceCents: 0,
  currency: "usd",
};

describe("order confirmation address and pickup", () => {
  const order = {
    id: "order-abc123",
    ...orderTotals,
    estimatedDeliveryDate: new Date("2026-12-01T12:00:00Z"),
    shipToName: "Bea Buyer",
    shipToLine1: "1 Main St",
    shipToLine2: "Apt 4B",
    shipToCity: "Round Rock",
    shipToState: "TX",
    shipToPostalCode: "78664",
  };
  const items = [{ title: "Bench", quantity: 1, priceCents: 48000 }];

  it("shows the recipient and apartment, with no comma before the ZIP", () => {
    const { html } = email.renderOrderConfirmedBuyerEmail({
      order,
      buyer: { email: "a@example.com" },
      seller: { displayName: "Shop" },
      items,
    });
    assert.match(html, /Bea Buyer, 1 Main St, Apt 4B, Round Rock, TX 78664/);
  });

  it("does not describe a pickup order as shipping, to the buyer or the maker", () => {
    const buyer = email.renderOrderConfirmedBuyerEmail({
      order,
      buyer: { email: "a@example.com" },
      seller: { displayName: "Shop" },
      items,
      isPickup: true,
    }).html;
    assert.doesNotMatch(buyer, /Shipping to/);
    assert.doesNotMatch(buyer, /Estimated delivery/);
    assert.match(buyer, /Local pickup/);

    const maker = email.renderOrderConfirmedSellerEmail({
      order: { ...order, processingDeadline: new Date("2026-12-01T12:00:00Z") },
      buyer: { name: "Bea" },
      seller: { displayName: "Shop", email: "m@example.com" },
      items,
      isPickup: true,
    }).html;
    assert.doesNotMatch(maker, /Ship by/);
    assert.match(maker, /Ready by/);
    assert.match(maker, /Local pickup/);
  });
});
