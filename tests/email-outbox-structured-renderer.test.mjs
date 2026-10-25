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

const { renderStructuredEmailOutboxClaim } = await import(
  "../src/lib/emailOutboxStructuredRenderer.ts"
);

const optionalTemplates = new Set([
  "welcome",
  "first_listing_congrats",
  "first_sale_congrats",
  "back_in_stock",
  "followed_maker_new_listing",
  "seller_broadcast",
]);

function claim(templateName, payload, overrides = {}) {
  return {
    jobId: `job-${templateName}`,
    claimGeneration: 1n,
    claimToken: "11111111-1111-4111-8111-111111111111",
    recipientEmail: "recipient@example.com",
    recipientUserId: "user-1",
    preferenceKey: null,
    templateName,
    templateVersion: 1,
    payloadVersion: 1,
    payload,
    dedupKey: `dedup-${templateName}`,
    createdAt: new Date("2026-10-25T12:00:00.000Z"),
    legacySubject: null,
    legacyHtml: null,
    lane: optionalTemplates.has(templateName) ? "OPTIONAL" : "TRANSACTIONAL",
    ...overrides,
  };
}

const totals = {
  itemsSubtotalCents: 2500,
  shippingAmountCents: 500,
  taxAmountCents: 250,
  giftWrapping: false,
  giftWrappingPriceCents: 0,
  currency: "usd",
};

const payloads = {
  welcome: { kind: "BUYER", recipientName: "Buyer" },
  first_listing_congrats: {
    sellerDisplayName: "Maker",
    listingId: "listing-1",
    listingTitle: "Oak table",
    priceCents: 2500,
    currency: "usd",
  },
  order_confirmed_buyer: {
    buyerName: "Buyer",
    sellerDisplayName: "Maker",
    orderId: "order-1",
    items: [{ title: "Oak table", quantity: 1, priceCents: 2500 }],
    ...totals,
    estimatedDeliveryDate: "2026-11-02T12:00:00.000Z",
    shipToLine1: "123 Main St",
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    multiSellerCheckout: false,
  },
  order_confirmed_seller: {
    sellerDisplayName: "Maker",
    buyerName: "Buyer",
    orderId: "order-1",
    items: [{ title: "Oak table", quantity: 1, priceCents: 2500 }],
    ...totals,
    processingDeadline: "2026-11-02T12:00:00.000Z",
  },
  first_sale_congrats: {
    sellerDisplayName: "Maker",
    orderId: "order-1",
    ...totals,
  },
  back_in_stock: {
    buyerName: "Buyer",
    listingId: "listing-1",
    listingTitle: "Oak table",
  },
  followed_maker_new_listing: {
    makerDisplayName: "Maker",
    listingId: "listing-1",
    listingTitle: "Oak table",
    priceCents: 2500,
    currency: "usd",
    imageUrl: "https://cdn.thegrainline.com/listings/user-1/photo.jpg",
  },
  seller_broadcast: {
    makerDisplayName: "Maker",
    message: "A new collection is available.",
    imageUrl: null,
  },
  refund_issued: {
    buyerName: "Buyer",
    orderId: "order-1",
    refundAmountCents: 1000,
    currency: "usd",
  },
  case_opened: {
    sellerDisplayName: "Maker",
    buyerDisplayName: "Buyer",
    orderId: "order-1",
    caseId: "case-1",
  },
  case_message: {
    recipientName: "Buyer",
    senderDisplayName: "Maker",
    caseId: "case-1",
    orderId: "order-1",
    recipientSide: "BUYER",
  },
  case_resolved: {
    buyerName: "Buyer",
    orderId: "order-1",
    resolution: "REFUND_PARTIAL",
    refundAmountCents: 1000,
    currency: "usd",
  },
  order_shipped: {
    buyerName: "Buyer",
    orderId: "order-1",
    estimatedDeliveryDate: "2026-11-02T12:00:00.000Z",
    carrier: "UPS",
    trackingNumber: "1Z123",
  },
  ready_for_pickup: {
    buyerName: "Buyer",
    sellerDisplayName: "Maker",
    orderId: "order-1",
  },
};

describe("structured email outbox renderer", () => {
  it("renders every reviewed version-one template with no stored recipient in the payload", () => {
    assert.equal(Object.keys(payloads).length, 14);
    for (const [templateName, payload] of Object.entries(payloads)) {
      const rendered = renderStructuredEmailOutboxClaim(claim(templateName, payload));
      assert.ok(rendered.subject.length > 0, `${templateName} subject`);
      assert.match(rendered.html, /<!DOCTYPE html>/, `${templateName} html`);
      assert.doesNotMatch(JSON.stringify(payload), /recipient@example\.com/);
    }
  });

  it("derives the case-message destination from a closed recipient-side enum", () => {
    const buyer = renderStructuredEmailOutboxClaim(claim("case_message", payloads.case_message));
    assert.match(buyer.html, /http:\/\/localhost:3000\/dashboard\/orders\/order-1/);

    const seller = renderStructuredEmailOutboxClaim(claim("case_message", {
      ...payloads.case_message,
      recipientSide: "SELLER",
    }));
    assert.match(seller.html, /http:\/\/localhost:3000\/dashboard\/sales\/order-1/);

    assert.throws(
      () => renderStructuredEmailOutboxClaim(claim("case_message", {
        ...payloads.case_message,
        recipientSide: "https://attacker.example/collect",
      })),
    );
  });

  it("renders the seller welcome variant from the closed kind discriminator", () => {
    const rendered = renderStructuredEmailOutboxClaim(claim("welcome", {
      kind: "SELLER",
      recipientName: "Account owner",
      sellerDisplayName: "Maker Shop",
    }));
    assert.match(rendered.html, /Hi Maker Shop, welcome to Grainline/);
  });

  it("rejects unknown fields, versions, templates, lane drift and non-first-party images", () => {
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("refund_issued", {
      ...payloads.refund_issued,
      arbitraryUrl: "https://attacker.example/collect",
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("refund_issued", payloads.refund_issued, {
      templateVersion: 2,
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("refund_issued", payloads.refund_issued, {
      payloadVersion: 2,
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("future_template", {})));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("refund_issued", payloads.refund_issued, {
      lane: "OPTIONAL",
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("followed_maker_new_listing", {
      ...payloads.followed_maker_new_listing,
      imageUrl: "https://attacker.example/photo.jpg",
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("order_shipped", {
      ...payloads.order_shipped,
      estimatedDeliveryDate: "tomorrow",
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("case_resolved", {
      ...payloads.case_resolved,
      resolution: "DISMISSED",
      refundAmountCents: 1000,
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("refund_issued", {
      ...payloads.refund_issued,
      orderId: 'order-1\" onclick=\"alert(1)',
    })));
  });

  it("HTML-escapes admitted first-party image URLs at the attribute boundary", () => {
    const rendered = renderStructuredEmailOutboxClaim(claim("followed_maker_new_listing", {
      ...payloads.followed_maker_new_listing,
      imageUrl: "https://cdn.thegrainline.com/listings/user-1/photo.jpg?x=&quot; onerror=alert(1)",
    }));
    assert.match(rendered.html, /x=&amp;quot; onerror=alert\(1\)/);
    assert.doesNotMatch(rendered.html, /src="[^"]*&quot; onerror=/);
  });

  it("counts Unicode code points at the renderer boundary", () => {
    const exactlyOneHundred = "🪵".repeat(100);
    assert.doesNotThrow(() => renderStructuredEmailOutboxClaim(claim("first_listing_congrats", {
      ...payloads.first_listing_congrats,
      sellerDisplayName: exactlyOneHundred,
    })));
    assert.throws(() => renderStructuredEmailOutboxClaim(claim("first_listing_congrats", {
      ...payloads.first_listing_congrats,
      sellerDisplayName: `${exactlyOneHundred}🪵`,
    })));
  });
});
