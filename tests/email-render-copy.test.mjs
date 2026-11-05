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

describe("first sale amount", () => {
  it("shows what the piece sold for, not the buyer's total with tax and shipping", () => {
    const { html } = email.renderFirstSaleCongratsEmail({
      seller: { displayName: "Shop", email: "m@example.com" },
      order: { id: "order-1", ...orderTotals },
    });
    assert.match(html, /\$480\.00/);
    assert.doesNotMatch(html, /\$534\.34/);
  });
});

describe("what buyers are asked to do next", () => {
  it("asks a buyer to confirm delivery, which starts their Case window", () => {
    const { html } = email.renderOrderShippedEmail({
      order: { id: "order-1" },
      buyer: { email: "a@example.com" },
    });
    assert.match(html, /confirm delivery on your order page/);
  });

  it("does not point a pickup buyer at details the order page does not have", () => {
    const { html } = email.renderReadyForPickupEmail({
      order: { id: "order-1" },
      buyer: { email: "a@example.com" },
      seller: { displayName: "Shop" },
    });
    assert.match(html, /Message Shop to arrange a time/);
    assert.doesNotMatch(html, /pickup location/);
  });
});

describe("custom piece ready", () => {
  it("links to the signed-in thread, because the private listing is a 404 when signed out", () => {
    const { html, subject } = email.renderCustomOrderReadyEmail({
      buyer: { email: "a@example.com" },
      sellerName: "Shop",
      listingTitle: "Walnut Desk",
      priceCents: 90000,
      currency: "usd",
      conversationId: "conversation-1",
    });
    assert.match(html, /href="[^"]*\/messages\/conversation-1"/);
    assert.doesNotMatch(html, /\/listing\//);
    assert.match(subject, /Walnut Desk/);
  });
});

describe("plain text and narrow screens", () => {
  it("keeps each table row on one line in the plain-text version", async () => {
    const { htmlToText } = await import("../src/lib/emailText.ts");
    const { html } = email.renderOrderConfirmedBuyerEmail({
      order: { id: "order-1", ...orderTotals },
      buyer: { email: "a@example.com" },
      seller: { displayName: "Shop" },
      items: [{ title: "Bench", quantity: 2, priceCents: 24000 }],
    });
    const text = htmlToText(html);
    assert.match(text, /Bench \| ×2 \| \$480\.00/);
    assert.match(text, /Total \| \$534\.34/);
  });

  it("lets a long unbroken link wrap instead of widening the page", () => {
    const { html } = email.renderSellerBroadcastEmail({
      to: "a@example.com",
      makerName: "Shop",
      message: `https://example.com/${"x".repeat(200)}`,
    });
    assert.match(html, /overflow-wrap:anywhere/);
  });
});

describe("Guild emails", () => {
  it("names the right badge when a Guild Master is approved", () => {
    const { subject, html } = email.renderVerificationApprovedEmail({
      seller: { displayName: "Shop", email: "m@example.com" },
      profileId: "seller-1",
      level: "GUILD_MASTER",
    });
    assert.equal(subject, "You are now a Guild Master!");
    assert.match(html, /Guild Master/);
    assert.doesNotMatch(html, /Guild Member/);
  });

  it("does not blame metrics when staff removed a Guild Master badge", () => {
    const { html } = email.renderGuildMasterRevokedEmail({
      seller: { displayName: "Shop", email: "m@example.com" },
      byStaff: true,
    });
    assert.doesNotMatch(html, /two consecutive monthly reviews/);
    assert.match(html, /Grainline staff/);
  });

  it("still explains metrics when the monthly review removed it", () => {
    const { html } = email.renderGuildMasterRevokedEmail({
      seller: { displayName: "Shop", email: "m@example.com" },
    });
    assert.match(html, /two consecutive monthly reviews/);
  });

  it("names the application that was declined", () => {
    const { subject, html } = email.renderVerificationRejectedEmail({
      seller: { displayName: "Shop", email: "m@example.com" },
      level: "GUILD_MASTER",
    });
    assert.match(subject, /Guild Master/);
    assert.match(html, /Guild Master application/);
  });

  it("tells a reinstated member their badge is back", () => {
    const { subject, html } = email.renderVerificationApprovedEmail({
      seller: { displayName: "Shop", email: "m@example.com" },
      profileId: "seller-1",
      level: "GUILD_MEMBER",
      reinstated: true,
    });
    assert.match(subject, /reinstated/);
    assert.match(html, /reinstated/);
  });
});
