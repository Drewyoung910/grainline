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
  assertGuardBeforeInText(path, text, snippets);
}

function assertHandlerGuardBefore(path, handlerSignature, snippets) {
  const text = routeSource(path);
  const handlerIndex = text.indexOf(handlerSignature);

  assert.ok(handlerIndex > -1, `${path} must contain ${handlerSignature}`);
  assertGuardBeforeInText(path, text.slice(handlerIndex), snippets);
}

function assertGuardBeforeInText(path, text, snippets) {
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

  it("checks social, saved-state, and read-state mutation origins before interaction work", () => {
    assertGuardBefore("src/app/api/favorites/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "prisma.listing.findFirst",
      "prisma.favorite.upsert",
    ]);
    assertGuardBefore("src/app/api/favorites/[listingId]/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "await ctx.params",
      "prisma.favorite.deleteMany",
    ]);
    assertHandlerGuardBefore("src/app/api/blog/[slug]/save/route.ts", "export async function POST(", [
      "await params",
      "await auth()",
      "safeRateLimit(",
      "upsertOwnerSavedBlogPost",
    ]);
    assertHandlerGuardBefore("src/app/api/blog/[slug]/save/route.ts", "export async function DELETE(", [
      "await params",
      "await auth()",
      "safeRateLimit(",
      "deleteOwnerSavedBlogPost",
    ]);
    assertHandlerGuardBefore("src/app/api/follow/[sellerId]/route.ts", "export async function POST(", [
      "await params",
      "await auth()",
      "safeRateLimit(",
      "prisma.follow.upsert",
    ]);
    assertHandlerGuardBefore("src/app/api/follow/[sellerId]/route.ts", "export async function DELETE(", [
      "await params",
      "await auth()",
      "safeRateLimit(",
      "prisma.follow.deleteMany",
    ]);
    assertHandlerGuardBefore("src/app/api/search/saved/route.ts", "export async function POST(", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "createOwnerSavedSearch",
    ]);
    assertHandlerGuardBefore("src/app/api/search/saved/route.ts", "export async function DELETE(", [
      "await auth()",
      "safeRateLimit(",
      "deleteOwnerSavedSearch",
    ]);
    assertGuardBefore("src/app/api/notifications/[id]/read/route.ts", [
      "await params",
      "await auth()",
      "safeRateLimit(",
      "await markOwnerNotificationRead",
    ]);
    assertGuardBefore("src/app/api/notifications/read-all/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readOptionalBoundedJson(req",
      "await markOwnerNotificationsRead",
    ]);
    assertGuardBefore("src/app/api/messages/[id]/read/route.ts", [
      "await params",
      "await auth()",
      "safeRateLimit(",
      "prisma.conversation.findFirst",
      "prisma.message.updateMany",
    ]);
    assertGuardBefore("src/app/api/messages/custom-order-request/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "createCustomOrderRequestMessage({",
    ]);
    assertGuardBefore("src/app/api/commission/[id]/interest/route.ts", [
      "await params",
      "await auth()",
      "safeRateLimit(",
      "prisma.commissionInterest.findUnique",
      "prisma.$transaction",
    ]);
    assertGuardBefore("src/app/api/reviews/[id]/vote/route.ts", [
      "await ctx.params",
      "await auth()",
      "safeRateLimit(",
      "prisma.review.findUnique",
      "prisma.$transaction",
    ]);
    assertHandlerGuardBefore("src/app/api/listings/[id]/notify/route.ts", "export async function POST(", [
      "await auth()",
      "await params",
      "safeRateLimit(",
      "prisma.stockNotification.upsert",
    ]);
    assertHandlerGuardBefore("src/app/api/listings/[id]/notify/route.ts", "export async function DELETE(", [
      "await auth()",
      "await params",
      "safeRateLimit(",
      "prisma.stockNotification.deleteMany",
    ]);
    assertHandlerGuardBefore("src/app/api/users/[id]/block/route.ts", "export async function POST(", [
      "await auth()",
      "safeRateLimit(",
      "createUserBlock(me.id, blockedId)",
    ]);
    assertHandlerGuardBefore("src/app/api/users/[id]/block/route.ts", "export async function DELETE(", [
      "await auth()",
      "safeRateLimit(",
      "deleteUserBlock(me.id, blockedId)",
    ]);
    assertGuardBefore("src/app/api/users/[id]/report/route.ts", [
      "await auth()",
      "safeRateLimit(",
      "readBoundedJson(req",
      "prisma.userReport.create",
    ]);
  });
});
