import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  sellerOrderBlockMessage,
  sellerOrderBlockReason,
} from "../src/lib/sellerOrderState.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("order-state audit follow-up guardrails", () => {
  it("keeps acceptingNewOrders as a server-side purchase blocker", () => {
    assert.equal(sellerOrderBlockReason({ acceptingNewOrders: false }), "not_accepting_orders");
    assert.equal(sellerOrderBlockReason({ stripeAccountVersion: null, acceptingNewOrders: true, vacationMode: false }), null);
    assert.equal(sellerOrderBlockReason({ stripeAccountVersion: "v1" }), "unsupported_stripe_account");
    assert.equal(sellerOrderBlockReason({ stripeAccountVersion: "v2", acceptingNewOrders: true, vacationMode: false }), null);
    assert.equal(
      sellerOrderBlockMessage("not_accepting_orders"),
      "This maker is not currently accepting new orders.",
    );
    assert.equal(
      sellerOrderBlockMessage("unsupported_stripe_account"),
      "This seller needs to reconnect Stripe before accepting orders.",
    );
    assert.equal(sellerOrderBlockReason({ acceptingNewOrders: true, vacationMode: false }), null);

    const cartAdd = source("src/app/api/cart/add/route.ts");
    assert.match(cartAdd, /sellerOrderBlockReason\(listing\.seller\)/);
    assert.match(cartAdd, /sellerOrderBlockMessage\(sellerBlockReason\)/);

    const cartUpdate = source("src/app/api/cart/update/route.ts");
    assert.match(cartUpdate, /acceptingNewOrders: true/);
    assert.match(cartUpdate, /stripeAccountVersion: true/);
    assert.match(cartUpdate, /sellerOrderBlockReason\(listing\.seller\)/);
    assert.match(cartUpdate, /sellerOrderBlockMessage\(sellerBlockReason\)/);
    assert.match(cartUpdate, /cartItem\.deleteMany\(\{ where: \{ id: item\.id, cartId: item\.cartId \} \}\)/);
    assert.match(cartUpdate, /cartItem\.updateMany\(\{\s*where: \{ id: item\.id, cartId: item\.cartId \}/s);
    assert.match(cartUpdate, /status: 409/);

    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    assert.match(singleCheckout, /acceptingNewOrders: true/);
    assert.match(singleCheckout, /stripeAccountVersion: true/);
    assert.match(singleCheckout, /sellerOrderBlockReason\(listing\.seller\)/);

    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    assert.match(sellerCheckout, /sellerOrderBlockReason\(sellerItems\[0\]\.listing\.seller\)/);
    assert.match(sellerCheckout, /blockedSellers/);

    const shippingQuote = source("src/app/api/shipping/quote/route.ts");
    assert.match(shippingQuote, /sellerOrderBlockReason\(it\.listing\.seller\)/);
    assert.match(shippingQuote, /sellerOrderBlockReason\(listing\.seller\)/);
    assert.match(shippingQuote, /quoteBlockedResponse\(sellerOrderBlockMessage\(sellerBlockReason\)\)/);

    const customOrder = source("src/app/api/messages/custom-order-request/route.ts");
    assert.match(customOrder, /acceptingNewOrders: true/);
    assert.match(customOrder, /stripeAccountVersion: true/);
    assert.match(customOrder, /!seller\.sellerProfile\.chargesEnabled \|\| !seller\.sellerProfile\.stripeAccountId/);
    assert.match(customOrder, /sellerOrderBlockReason\(\{ \.\.\.seller\.sellerProfile, user: seller \}\)/);

    const listingPage = source("src/app/listing/[id]/page.tsx");
    assert.match(listingPage, /listing\.seller\.acceptingNewOrders !== false/);
    assert.match(listingPage, /sellerAcceptingNewOrders=\{listing\.seller\.acceptingNewOrders !== false\}/);
  });

  it("keeps cart add creation and quantity caps race-safe", () => {
    const text = source("src/app/api/cart/add/route.ts");
    assert.match(text, /prisma\.cart\.upsert/);
    assert.doesNotMatch(text, /let cart = await prisma\.cart\.findUnique/);
    assert.match(text, /isUniqueConstraintError/);
    assert.match(text, /prisma\.cartItem\.create/);
    assert.match(text, /prisma\.cartItem\.updateMany/);
    assert.doesNotMatch(text, /prisma\.cartItem\.upsert/);
    assert.match(text, /quantity: \{ lte: 99 - quantity \}/);
    assert.match(text, /quantity: \{ increment: quantity \}/);
    assert.match(text, /MAX_CART_DISTINCT_ITEMS = 50/);
    assert.match(text, /MAX_CART_TOTAL_QUANTITY = 200/);
    assert.match(text, /prisma\.cartItem\.aggregate\(\{\s*where: \{ cartId: cart\.id \}/s);
    assert.match(text, /projectedDistinctItems > MAX_CART_DISTINCT_ITEMS/);
    assert.match(text, /projectedTotalQuantity > MAX_CART_TOTAL_QUANTITY/);
    assert.match(text, /projectedItemQuantity > \(listing\.stockQuantity \?\? 0\)/);
    assert.match(text, /Only \$\{listing\.stockQuantity \?\? 0\} available/);
  });

  it("keeps cart quantity updates under the cart-wide total item cap", () => {
    const text = source("src/app/api/cart/update/route.ts");
    assert.match(text, /MAX_CART_TOTAL_QUANTITY = 200/);
    assert.match(text, /prisma\.cartItem\.aggregate\(\{\s*where: \{ cartId: cart\.id \},\s*_sum: \{ quantity: true \},\s*\}\)/s);
    assert.match(text, /\(cartStats\._sum\.quantity \?\? 0\) - item\.quantity \+ quantity/);
    assert.match(text, /projectedTotalQuantity > MAX_CART_TOTAL_QUANTITY/);
    assert.match(text, /quantity > \(listing\.stockQuantity \?\? 0\)/);
    assert.match(text, /Only \$\{listing\.stockQuantity \?\? 0\} available/);
  });

  it("keeps checkout stock reservation tied to live active listing ownership", () => {
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");

    assert.match(singleCheckout, /WHERE id = \$\{listing\.id\}\s+AND "sellerId" = \$\{listing\.sellerId\}\s+AND status = 'ACTIVE'\s+AND "listingType" = 'IN_STOCK'\s+AND "stockQuantity" >= \$\{body\.quantity\}/);
    assert.match(singleCheckout, /AND "sellerId" = \$\{reservedSellerId\}/);

    assert.match(sellerCheckout, /WHERE id = \$\{it\.listing\.id\}\s+AND "sellerId" = \$\{it\.listing\.sellerId\}\s+AND status = 'ACTIVE'\s+AND "listingType" = 'IN_STOCK'\s+AND "stockQuantity" >= \$\{it\.quantity\}/);
    assert.match(sellerCheckout, /reservedItems\.push\(\{ listingId: it\.listing\.id, sellerId: it\.listing\.sellerId, quantity: it\.quantity \}\)/);
    assert.match(sellerCheckout, /AND "sellerId" = \$\{r\.sellerId\}/);
  });

  it("keeps staff case resolution atomic and persists computed full-refund amounts", () => {
    const text = source("src/app/api/cases/[id]/resolve/route.ts");
    assert.match(text, /persistedRefundAmountCents = refunding \? refundAmountForOrder : null/);
    assert.match(text, /tx\.case\.updateMany/);
    assert.match(text, /status: \{ notIn: \["RESOLVED", "CLOSED"\] \}/);
    assert.match(text, /resolvedAt: null/);
    assert.match(text, /CASE_RESOLUTION_CONFLICT/);
    assert.match(text, /refundAmountCents: persistedRefundAmountCents/);
    assert.doesNotMatch(text, /refundAmountCents: refundAmountCents \?\? null/);
  });

  it("keeps quote, token-rejection, and case-resolution UI hardening in place", () => {
    const shippingQuote = source("src/app/api/shipping/quote/route.ts");
    assert.match(shippingQuote, /listing\.status !== "ACTIVE"/);
    assert.match(shippingQuote, /listing\.isPrivate && listing\.reservedForUserId !== me\.id/);
    assert.match(shippingQuote, /!listing\.seller\.chargesEnabled \|\| !listing\.seller\.stripeAccountId/);

    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    assert.match(sellerCheckout, /logSecurityEvent\("token_rejected"/);
    assert.match(sellerCheckout, /route: "\/api\/cart\/checkout-seller"/);
    assert.match(sellerCheckout, /tokenLength: body\.selectedRate\.token\.length/);

    const panel = source("src/components/CaseResolutionPanel.tsx");
    assert.match(panel, /try \{/);
    assert.match(panel, /await res\.text\(\)/);
    assert.match(panel, /Network error\. Check your connection and try again\./);
    assert.match(panel, /finally \{/);
  });
});
