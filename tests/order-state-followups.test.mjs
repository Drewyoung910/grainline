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
    assert.match(cartUpdate, /deleteOwnerCartItem\(me\.id, lockedItem\.cartId, lockedItem\.id, tx\)/);
    assert.match(cartUpdate, /updateOwnerCartItemQuantity\(\s*me\.id,\s*lockedItem\.cartId,\s*lockedItem\.id,/s);
    assert.match(cartUpdate, /status: HTTP_STATUS\.CONFLICT/);

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
    const ownerAccess = source("src/lib/cartOwnerAccess.ts");
    assert.match(text, /upsertOwnerCart\(me\.id\)/);
    assert.doesNotMatch(text, /let cart = await prisma\.cart\.findUnique/);
    assert.match(text, /isUniqueConstraintError/);
    assert.match(text, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(text, /lockOwnerCart\(me\.id, cart\.id, tx\)/);
    assert.match(text, /createOwnerCartItem\(/);
    assert.match(text, /markOwnerCartItemMadeToOrder\(/);
    assert.match(text, /incrementOwnerCartItemQuantity\(/);
    assert.doesNotMatch(text, /prisma\.cartItem\.upsert/);
    assert.match(ownerAccess, /quantity: \{ lte: 99 - quantity \}/);
    assert.match(ownerAccess, /quantity: \{ increment: quantity \}/);
    assert.match(text, /MAX_CART_DISTINCT_ITEMS = 50/);
    assert.match(text, /MAX_CART_TOTAL_QUANTITY = 200/);
    assert.match(text, /ownerCartItemStats\(me\.id, cart\.id, tx\)/);
    assert.match(ownerAccess, /_count: \{ id: true \}/);
    assert.match(ownerAccess, /_sum: \{ quantity: true \}/);
    assert.match(text, /projectedDistinctItems > MAX_CART_DISTINCT_ITEMS/);
    assert.match(text, /projectedTotalQuantity > MAX_CART_TOTAL_QUANTITY/);
    assert.match(text, /projectedItemQuantity > \(listingForCart\.stockQuantity \?\? 0\)/);
    assert.match(text, /Only \$\{listingForCart\.stockQuantity \?\? 0\} available/);
  });

  it("keeps cart quantity updates under the cart-wide total item cap", () => {
    const text = source("src/app/api/cart/update/route.ts");
    assert.match(text, /MAX_CART_TOTAL_QUANTITY = 200/);
    assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/);
    assert.match(text, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(text, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(text, /lockOwnerCart\(me\.id, cart\.id, tx\)/);
    assert.match(text, /const lockedItem = await lockOwnerCartItem\(me\.id, item\.cartId, item\.id, tx\)/);
    assert.match(text, /ownerCartItemQuantityStats\(me\.id, cart\.id, tx\)/);
    assert.match(text, /\(cartStats\._sum\.quantity \?\? 0\) - lockedItem\.quantity \+ quantity/);
    assert.match(text, /projectedTotalQuantity > MAX_CART_TOTAL_QUANTITY/);
    assert.match(text, /updateOwnerCartItemQuantity\(\s*me\.id,\s*lockedItem\.cartId,\s*lockedItem\.id,/s);
    assert.match(text, /deleteOwnerCartItem\(me\.id, lockedItem\.cartId, lockedItem\.id, tx\)/);
    assert.match(text, /quantity > \(listing\.stockQuantity \?\? 0\)/);
    assert.match(text, /Only \$\{listing\.stockQuantity \?\? 0\} available/);
    assert.match(text, /logServerError\(err, \{[\s\S]*source: "cart_update_route"/);
    assert.doesNotMatch(text, /console\.error\("POST \/api\/cart\/update error:", err\)/);
  });

  it("rejects ambiguous listing-only cart updates once variants create multiple rows", () => {
    const text = source("src/app/api/cart/update/route.ts");
    const ownerAccess = source("src/lib/cartOwnerAccess.ts");

    assert.match(text, /const matchingItems = await ownerCartItemsByListing\(me\.id, cart\.id, listingId\)/);
    assert.match(ownerAccess, /where: ownerCartItemWhere\(userId, \{ cartId, listingId \}\)/);
    assert.match(ownerAccess, /take: 2/);
    assert.match(text, /matchingItems\.length > 1/);
    assert.match(text, /Use cartItemId to update variant cart lines\./);
    assert.doesNotMatch(text, /findFirst\(\{ where: \{ cartId: cart\.id, listingId: listingId!/);
  });

  it("keeps checkout stock reservation tied to live active listing ownership", () => {
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    const authority = source("docs/rls-drafts/checkout-stock-reservation-authority.sql")
      .replace(/\s+/g, " ");
    const consistency = source("docs/rls-drafts/checkout-stock-reservation-source-consistency.sql")
      .replace(/\s+/g, " ");

    assert.match(singleCheckout, /createSnapshotSingleCheckoutStockReservation\(\{/);
    assert.match(singleCheckout, /listingId: listing\.id,[\s\S]*quantity: body\.quantity,[\s\S]*selectedVariantOptionIds: body\.selectedVariantOptionIds,[\s\S]*sourceWitness: pricedSourceWitness/);
    assert.doesNotMatch(singleCheckout, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(singleCheckout, /checkoutStockReservationMetadata\(checkoutReservationId/);

    assert.match(sellerCheckout, /createSnapshotCartCheckoutStockReservation\(\{/);
    assert.match(sellerCheckout, /cartId: cart\.id,[\s\S]*sellerProfileId: sellerId,[\s\S]*checkoutGroupId: body\.checkoutGroupId,[\s\S]*sourceWitness: pricedSourceWitness/);
    assert.doesNotMatch(sellerCheckout, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(sellerCheckout, /checkoutStockReservationMetadata\(checkoutReservationId/);

    assert.match(authority, /CREATE FUNCTION public\.grainline_checkout_reservation_create_single/);
    assert.match(authority, /source_listing\."sellerId"/);
    assert.match(authority, /source_listing\.status <> 'ACTIVE'/);
    assert.match(authority, /source_listing\."isPrivate" AND source_listing\."reservedForUserId" IS DISTINCT FROM p_buyer_id/);
    assert.match(authority, /listing\."sellerId" = p_seller_profile_id AND listing\.status = 'ACTIVE' AND listing\."listingType" = 'IN_STOCK' AND listing\."stockQuantity" >= source_item\.quantity/);
    assert.match(consistency, /grainline_checkout_reservation_create_single_consistent/);
    assert.match(consistency, /grainline_checkout_reservation_create_single\( p_buyer_id, p_listing_id, p_quantity, p_payload_hash \)/);
    assert.match(consistency, /source_witness IS DISTINCT FROM p_expected_source/);
  });

  it("keeps staff case resolution atomic and persists computed full-refund amounts", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");
    const authority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    ).replace(/\s+/g, " ");

    assert.match(
      authority,
      /p_resolution = 'REFUND_FULL'::public\."CaseResolution" THEN[\s\S]*refund_amount_cents := order_total_cents::integer/,
    );
    assert.match(
      authority,
      /locked_case\.status IN \(\s*'RESOLVED'::public\."CaseStatus",\s*'CLOSED'::public\."CaseStatus"\s*\)/,
    );
    assert.match(
      authority,
      /UPDATE public\."Case" AS case_row SET status = 'RESOLVED'/,
    );
    assert.match(
      authority,
      /"refundAmountCents" = locked_claim\."refundAmountCents"/,
    );
    assert.match(
      route,
      /amountCents: prepared\.refundAmountCents!/,
    );
    assert.match(
      route,
      /finalized = await finalizeCaseStaffResolutionWithSideEffects\(\s*me\.id,\s*prepared,?\s*\)/,
    );
    assert.doesNotMatch(route, /refundAmountCents: refundAmountCents \?\? null/);
    assert.doesNotMatch(route, /(?:prisma|tx)\.case\.update/);
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
