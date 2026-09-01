import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function assertOrdered(text, needles) {
  let previous = -1;
  for (const [label, needle] of needles) {
    const index = text.indexOf(needle);
    assert.ok(index >= 0, `${label} is missing`);
    assert.ok(index > previous, `${label} is out of order`);
    previous = index;
  }
}

describe("Order fulfillment durable finalization", () => {
  const finalization = source("src/lib/orderFulfillmentFinalization.ts");
  const fulfillmentRoute = source("src/app/api/orders/[id]/fulfillment/route.ts");
  const receiptRoute = source("src/app/api/orders/[id]/confirm-delivery/route.ts");
  const emailOutbox = source("src/lib/emailOutbox.ts");

  it("co-commits seller transition, Notification and email reservation", () => {
    const seller = finalization.slice(
      finalization.indexOf("export async function finalizeSellerOrderFulfillment"),
      finalization.indexOf("export async function finalizeBuyerOrderReceipt"),
    );
    assertOrdered(seller, [
      ["transaction", "const committed = await prisma.$transaction"],
      ["fixed transition", "transitionSellerOrderFulfillment(input, tx)"],
      ["source notification", "await createNotificationOrThrow({"],
      ["email render", "renderOrderShippedEmail({"],
      ["outbox reservation", "await enqueueEmailOutboxOnce({"],
      ["transaction end", "return { result, emailOutboxId };"],
      ["post-commit delivery", "await processEmailOutboxJobById(committed.emailOutboxId)"],
    ]);
    assert.match(seller, /dedupKey: `order-fulfillment:\$\{result\.auditLogId\}`/);
    assert.match(emailOutbox, /"order_shipped"/);
    assert.match(emailOutbox, /"ready_for_pickup"/);
  });

  it("co-commits buyer receipt and seller Notification", () => {
    const buyer = finalization.slice(
      finalization.indexOf("export async function finalizeBuyerOrderReceipt"),
    );
    assertOrdered(buyer, [
      ["transaction", "return prisma.$transaction"],
      ["fixed receipt", "confirmBuyerOrderReceipt(input, tx)"],
      ["seller notification", "await createNotificationOrThrow({"],
      ["transaction client", "}, tx);"],
    ]);
  });

  it("leaves both HTTP routes without direct Order mutation authority", () => {
    assert.match(fulfillmentRoute, /finalizeSellerOrderFulfillment\(\{/);
    assert.match(fulfillmentRoute, /updateSellerOrderNotes\(\{/);
    assert.match(receiptRoute, /finalizeBuyerOrderReceipt\(\{/);
    for (const route of [fulfillmentRoute, receiptRoute]) {
      assert.doesNotMatch(route, /prisma\.order\.|tx\.order\.|\$executeRaw/);
      assert.doesNotMatch(route, /logSystemActionOrThrow|createNotificationOrThrow/);
    }
  });
});
