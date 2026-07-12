import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  getExplicitCrossOriginPostRejection,
} = await import("../src/lib/requestOriginGuard.ts");

function routeSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertGuardBefore(path, snippets) {
  const text = routeSource(path);
  const guardIndex = text.indexOf("getExplicitCrossOriginPostRejection(req)");

  assert.ok(guardIndex > -1, `${path} must call getExplicitCrossOriginPostRejection(req)`);
  for (const snippet of snippets) {
    const snippetIndex = text.indexOf(snippet);
    assert.ok(snippetIndex > -1, `${path} must contain ${snippet}`);
    assert.ok(guardIndex < snippetIndex, `${path} must check origin before ${snippet}`);
  }
}

describe("request origin guard", () => {
  it("rejects explicit cross-origin browser POST headers", () => {
    assert.deepEqual(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      })),
      { header: "origin", value: "https://evil.test", expectedOrigin: "https://thegrainline.com" },
    );

    assert.deepEqual(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { referer: "https://evil.test/post" },
      })),
      { header: "referer", value: "https://evil.test/post", expectedOrigin: "https://thegrainline.com" },
    );

    assert.deepEqual(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      })),
      { header: "sec-fetch-site", value: "cross-site", expectedOrigin: "https://thegrainline.com" },
    );
  });

  it("allows same-origin and absent origin headers", () => {
    assert.equal(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { origin: "https://thegrainline.com", referer: "https://thegrainline.com/dashboard" },
      })),
      null,
    );
    assert.equal(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
      })),
      null,
    );
  });

  it("checks order mutation POST origins before parsing or mutation work", () => {
    assertGuardBefore("src/app/api/orders/[id]/fulfillment/route.ts", [
      "await auth()",
      "await req.formData()",
      "prisma.order.updateMany",
    ]);
    assertGuardBefore("src/app/api/orders/[id]/confirm-delivery/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "prisma.order.findUnique",
      "prisma.order.updateMany",
    ]);
    assertGuardBefore("src/app/api/orders/[id]/refund/route.ts", [
      "await auth()",
      "readBoundedJson(req",
      "prisma.order.findUnique",
      "UPDATE \"Order\"",
      "createMarketplaceRefund({",
    ]);
    assertGuardBefore("src/app/api/orders/[id]/label/route.ts", [
      "await auth()",
      "readOptionalBoundedJson(req",
      "ensureSellerOwnsOrder(userId, id)",
      "UPDATE \"Order\" SET \"labelStatus\"",
      "shippoRequest<ShippoTransaction>",
    ]);
    assertGuardBefore("src/app/api/cases/[id]/resolve/route.ts", [
      "await auth()",
      "requireStaffAdminPinForApi(req",
      "readBoundedJson(req",
      "prisma.case.findUnique",
    ]);
  });

  it("checks case mutation POST origins before parsing or case-state work", () => {
    assertGuardBefore("src/app/api/cases/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "prisma.order.findUnique",
    ]);
    assertGuardBefore("src/app/api/cases/[id]/messages/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "prisma.case.findUnique",
    ]);
    assertGuardBefore("src/app/api/cases/[id]/escalate/route.ts", [
      "verifyCronRequest(req)",
      "await auth()",
      "prisma.case.findUnique",
      "tx.case.updateMany",
    ]);
    assertGuardBefore("src/app/api/cases/[id]/mark-resolved/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "prisma.case.findUnique",
      "UPDATE \"Case\"",
    ]);
  });

  it("checks cart, checkout, rollback, and quote POST origins before buyer-cost work", () => {
    assertGuardBefore("src/app/api/cart/add/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "prisma.listing.findUnique",
      "upsertOwnerCart(me.id)",
      "await lockOwnerCart(me.id, cart.id, tx)",
    ]);
    assertGuardBefore("src/app/api/cart/update/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "ownerCartByUserId(me.id)",
      "prisma.listing.findUnique",
      "await lockOwnerCart(me.id, cart.id, tx)",
    ]);
    assertGuardBefore("src/app/api/cart/checkout/single/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "prisma.listing.findUnique",
      "createCheckoutStockReservation({",
      "stripe.checkout.sessions.create",
    ]);
    assertGuardBefore("src/app/api/cart/checkout-seller/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "ownerCartForCheckoutSeller(me.id)",
      "createCheckoutStockReservation({",
      "stripe.checkout.sessions.create",
    ]);
    assertGuardBefore("src/app/api/cart/checkout/rollback/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "stripe.checkout.sessions.retrieve",
      "stripe.checkout.sessions.expire",
      "restoreUnorderedCheckoutStockOnce({",
    ]);
    assertGuardBefore("src/app/api/shipping/quote/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "cart = await ownerCartForShippingQuote",
      "const shipment = await shippoRequest<ShippoShipment>",
      "const siteConfig = await prisma.siteConfig.findUnique",
    ]);
  });
});
