import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const record = read("docs/order-core-history-compatibility.md");

const historicalRenderers = [
  "src/app/account/orders/page.tsx",
  "src/app/account/page.tsx",
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/admin/orders/page.tsx",
  "src/app/checkout/success/page.tsx",
  "src/app/dashboard/orders/[id]/page.tsx",
  "src/app/dashboard/orders/page.tsx",
  "src/app/dashboard/sales/[orderId]/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/app/api/seller/analytics/recent-sales/route.ts",
];

const durableSellerConsumers = [
  "src/app/account/page.tsx",
  "src/app/api/account/export/route.ts",
  "src/app/api/orders/[id]/fulfillment/route.ts",
  "src/app/api/orders/[id]/label/route.ts",
  "src/app/api/orders/[id]/refund/route.ts",
  "src/app/api/seller/analytics/recent-sales/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/app/dashboard/sales/[orderId]/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/lib/accountDeletion.ts",
  "src/lib/ban.ts",
];

describe("core Order historical compatibility", () => {
  it("renders retained Order items through the bounded checkout snapshot", () => {
    for (const file of historicalRenderers) {
      const source = read(file);
      assert.match(source, /readHistoricalOrderItemSnapshot/, file);
      assert.match(source, /listingSnapshot/, file);
      assert.doesNotMatch(source, /\.listing\.title|\.listing\.photos|\.listing\.seller\.displayName/, file);
    }
  });

  it("uses the durable Order seller key for converted seller authority", () => {
    for (const file of durableSellerConsumers) {
      const source = read(file);
      assert.match(source, /sellerProfileId/, file);
      assert.doesNotMatch(
        source,
        /items:\s*\{\s*(?:some|every):\s*\{\s*listing:\s*\{\s*sellerId/s,
        file,
      );
    }
  });

  it("binds participant detail reads in the database predicate", () => {
    assert.match(
      read("src/app/dashboard/orders/[id]/page.tsx"),
      /findFirst\(\{\s*where: \{ id, buyerId: me\.id \}/s,
    );
    assert.match(
      read("src/app/dashboard/sales/[orderId]/page.tsx"),
      /findFirst\(\{\s*where: \{ id: orderId, sellerProfileId: seller\.id \}/s,
    );
  });

  it("writes the expanded snapshot in both paid webhook families", () => {
    const webhook = read("src/app/api/stripe/webhook/route.ts");
    for (const field of [
      "listingType",
      "processingTimeMinDays",
      "processingTimeMaxDays",
      "shipsWithinDays",
    ]) {
      assert.equal(webhook.match(new RegExp(`${field}:`, "g"))?.length >= 2, true, field);
    }
    assert.match(webhook, /sellerProfileId: cartSellerProfileId/);
    assert.match(webhook, /sellerProfileId: singleSellerProfileId/);
    assert.match(webhook, /const seller = order\.sellerProfile/);
    assert.match(webhook, /where: \{ sellerProfileId: seller\.id \}/);
    assert.doesNotMatch(webhook, /order\.items\[0\]\?\.listing\.seller/);
  });

  it("keeps the development fixture modern and production unreachable", () => {
    const fixture = read("src/app/api/dev/make-order/route.ts");
    assert.match(fixture, /process\.env\.NODE_ENV === "development"/);
    assert.match(fixture, /process\.env\.VERCEL !== "1"/);
    assert.match(fixture, /sellerProfileId: listing\.sellerId/g);
    assert.match(fixture, /listingSnapshot: \{/);
  });

  it("records the remaining boundaries without claiming RLS activation", () => {
    assert.match(record, /contains no\s+database migration, policy, grant, deployment, provider, credential or\s+production-state change/);
    assert.match(record, /never falls back to mutable Listing content/);
    assert.match(record, /Account export continues to include shipping-rate quote rows/);
    assert.match(record, /Order RLS remains off/);
    assert.match(record, /separate `OrderItem` and\s+`OrderShippingRateQuote` releases/);
  });
});
