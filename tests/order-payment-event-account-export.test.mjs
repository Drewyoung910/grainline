import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  ACCOUNT_PAYMENT_HISTORY_WHERE,
  BUYER_ACCOUNT_PAYMENT_HISTORY_SELECT,
  SELLER_ACCOUNT_PAYMENT_HISTORY_SELECT,
} = await import("../src/lib/accountPaymentHistory.ts");

describe("OrderPaymentEvent account-export projection", () => {
  it("keeps both participant projections refund-only", () => {
    assert.deepEqual(ACCOUNT_PAYMENT_HISTORY_WHERE, { eventType: "REFUND" });
  });

  it("pins the exact buyer-safe fields", () => {
    assert.deepEqual(BUYER_ACCOUNT_PAYMENT_HISTORY_SELECT, {
      eventType: true,
      amountCents: true,
      currency: true,
      status: true,
      createdAt: true,
    });
  });

  it("pins the exact seller-safe fields separately", () => {
    assert.deepEqual(SELLER_ACCOUNT_PAYMENT_HISTORY_SELECT, {
      eventType: true,
      amountCents: true,
      currency: true,
      status: true,
      reason: true,
      createdAt: true,
    });
  });

  it("keeps private service-ledger fields out of both route projections", () => {
    const route = fs.readFileSync("src/app/api/account/export/route.ts", "utf8");
    const buyerStart = route.indexOf("prisma.order.findMany({\n      where: { buyerId: user.id }");
    const sellerStart = route.indexOf("sellerProfile\n      ? prisma.order.findMany({", buyerStart);
    const exportEnd = route.indexOf("exportActorMessages(user.id)", sellerStart);
    assert.ok(buyerStart >= 0 && sellerStart > buyerStart && exportEnd > sellerStart);

    for (const block of [
      route.slice(buyerStart, sellerStart),
      route.slice(sellerStart, exportEnd),
    ]) {
      const paymentStart = block.indexOf("paymentEvents: {");
      const paymentEnd = block.indexOf("shippingRateQuotes: {", paymentStart);
      const paymentBlock = block.slice(paymentStart, paymentEnd);
      assert.ok(paymentStart >= 0 && paymentEnd > paymentStart);
      assert.doesNotMatch(
        paymentBlock,
        /(?:id|orderId|stripeEventId|stripeObjectId|stripeObjectType|description|metadata|updatedAt): true/,
      );
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
