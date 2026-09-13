import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Order fulfillment product-audit contract", () => {
  it("keeps pickup completion buyer-controlled across route and UI", () => {
    const sellerRoute = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const buyerRoute = source("src/app/api/orders/[id]/confirm-delivery/route.ts");
    const sellerPage = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const buyerPage = source("src/app/dashboard/orders/[id]/page.tsx");

    assert.match(sellerRoute, /z\.enum\(\["ready_for_pickup", "shipped", "update_notes"\]\)/);
    assert.doesNotMatch(sellerRoute, /case "picked_up"|case "delivered"/);
    assert.match(sellerRoute, /finalizeSellerOrderFulfillment\(\{/);
    assert.match(sellerRoute, /updateSellerOrderNotes\(\{/);
    assert.match(buyerRoute, /finalizeBuyerOrderReceipt\(\{/);
    assert.doesNotMatch(sellerPage, /name="action" value="picked_up"/);
    assert.match(sellerPage, /case window buyer-controlled/);
    assert.match(buyerPage, /Confirm pickup/);
  });

  it("records product conclusions and the remaining reliability boundary", () => {
    const audit = source("docs/order-fulfillment-receipt-product-audit.md");

    assert.match(audit, /PENDING -> READY_FOR_PICKUP/);
    assert.match(audit, /READY_FOR_PICKUP -> PICKED_UP/);
    assert.match(audit, /buyer-authored\s+`ORDER_FULFILLMENT_TRANSITION`/);
    assert.match(
      audit,
      /Direct best-effort email is no longer the fulfillment reliability boundary/,
    );
    assert.match(audit, /No migration, RLS posture, grant, deployment or provider state changed/);
  });
});
