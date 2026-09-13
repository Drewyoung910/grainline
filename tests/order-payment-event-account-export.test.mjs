import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("OrderPaymentEvent account-export projection", () => {
  it("uses distinct actor-bound database exports instead of nested base rows", () => {
    const route = fs.readFileSync("src/app/api/account/export/route.ts", "utf8");
    if (!/exportBuyerOrderPaymentHistory\(user\.id\)/.test(route)) {
      throw new Error("buyer payment export authority is missing");
    }
    if (!/exportSellerOrderPaymentHistory\(user\.id\)/.test(route)) {
      throw new Error("seller payment export authority is missing");
    }
    if (/paymentEvents:\s*\{/.test(route)) {
      throw new Error("account export still embeds OrderPaymentEvent base rows");
    }
    if (!/paymentEvents: buyerPaymentHistory\.get\(order\.id\) \?\? \[\]/.test(route)) {
      throw new Error("buyer payment history is not attached from the fixed projection");
    }
    if (!/paymentEvents: sellerPaymentHistory\.get\(order\.id\) \?\? \[\]/.test(route)) {
      throw new Error("seller payment history is not attached from the fixed projection");
    }
  });

  it("keeps buyer and seller SQL projections refund-only and distinct", () => {
    const migration = fs.readFileSync(
      "prisma/migrations/20260829020000_prepare_order_payment_event_read_authority/migration.sql",
      "utf8",
    );
    const buyerStart = migration.indexOf("grainline_order_payment_buyer_export_page");
    const sellerStart = migration.indexOf("grainline_order_payment_seller_export_page");
    const staffStart = migration.indexOf("grainline_order_payment_staff_timeline");
    const buyer = migration.slice(buyerStart, sellerStart);
    const seller = migration.slice(sellerStart, staffStart);
    for (const block of [buyer, seller]) {
      if (!/payment\."eventType" = 'REFUND'/.test(block)) {
        throw new Error("participant payment export is not refund-only");
      }
      if (/stripe_event_id|stripe_object_id|metadata|description/.test(block)) {
        throw new Error("participant payment export exposes private provider fields");
      }
      if (!/ORDER BY payment\."createdAt" DESC, payment\.id DESC/.test(block)) {
        throw new Error("participant payment export is not keyset ordered");
      }
    }
    if (/reason text/.test(buyer)) {
      throw new Error("buyer payment export exposes seller accounting reason");
    }
    if (!/reason text/.test(seller)) {
      throw new Error("seller payment export lost its bounded accounting reason");
    }
  });

  it("records the later keyset-paged fixed-authority boundary", () => {
    const plan = fs.readFileSync("docs/order-payment-event-account-export.md", "utf8");
    assert.match(plan, /distinct actor-bound, keyset-paged database export/);
    assert.match(plan, /does not authorize silent truncation/);
    assert.match(plan, /382e47a4526af0d7e4a36d4e3e41acd842e3361a/);
    assert.match(plan, /ancestor of deployed source/);
    assert.match(plan, /asynchronous export upgrade remain separate gates/);
  });
});
