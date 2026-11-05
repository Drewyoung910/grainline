import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);

// Runs the real checkout routes with isolated ports. The question is only
// whether stock gets reserved once the buyer has used up their allowance.
function fixture(path, { listingType = "IN_STOCK", capped = false } = {}) {
  const state = { reservations: 0, capChecks: 0 };
  const reservationLimiter = { name: "reservation" };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const seller = {
    id: "seller", userId: "maker", displayName: "Maker", chargesEnabled: true,
    stripeAccountSupported: true, offersGiftWrapping: false, allowLocalPickup: false,
  };
  const listing = {
    id: "listing_1", sellerId: "seller", title: "Bench", status: "ACTIVE", isPrivate: false,
    reservedForUserId: null, listingType, stockQuantity: 1, currency: "usd", priceCents: 5000,
    priceVersion: 1, variantGroups: [], photos: [], seller,
  };
  const reserve = async () => {
    state.reservations += 1;
    return { id: "reservation" };
  };
  const session = { id: "cs_test", client_secret: "cs_test_secret_x" };
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "buyer", email: "b@example.test" }) },
    "@/lib/ratelimit": {
      checkoutRatelimit: { name: "attempts" },
      checkoutReservationRatelimit: reservationLimiter,
      safeRateLimit: async (limiter) => {
        if (limiter !== reservationLimiter) return { success: true, reset: 0 };
        state.capChecks += 1;
        return { success: !capped, reset: Date.now() + 60_000 };
      },
      rateLimitResponse: (_reset, message) => Response.json({ error: message }, { status: 429 }),
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/addressFields": { normalizeCheckoutShippingAddress: (address) => address },
    "@/lib/usStates": { normalizeUsState: (value) => value },
    "@/lib/shipping-token": {
      shippingRateExpiresAtIsTooFarFuture: () => false,
      shippingRateSubjectHash: () => "subject",
      verifyRate: () => ({ ok: true }),
    },
    "@/lib/shippingQuoteState": { isPickupRateObjectId: () => false },
    "@/lib/stripeWebhookState": { SHIPPING_ESTIMATED_DAYS_MAX: 60 },
    "@/types/checkout": { isFallbackRate: () => false },
    "@/lib/sellerTransactionAccess": { sellerSingleCheckoutSource: async () => listing },
    "@/lib/cartOwnerAccess": {
      ownerCartForCheckoutSeller: async () => ({
        id: "cart",
        items: [{
          id: "line", listingId: listing.id, quantity: 1, priceCents: 5000, priceVersion: 1,
          selectedVariantOptionIds: [], listing,
        }],
      }),
    },
    "@/lib/cartPriceReviewState": { cartPriceReviewState: () => null },
    "@/lib/sellerOrderState": { sellerOrderBlockReason: () => null, sellerOrderBlockMessage: () => "" },
    "@/lib/checkoutBlockState": { checkoutPairIsBlocked: async () => false, CHECKOUT_PAIR_UNAVAILABLE_MESSAGE: "" },
    "@/lib/sellerCheckoutPrivateAccess": {
      sellerCheckoutPrivateState: async () => ({ stripeAccountId: "acct" }),
    },
    "@/lib/listingVariants": {
      resolveListingVariantSelection: () => ({
        ok: true, variantAdjustCents: 0, variantKey: "", selectedVariantLabels: [], selectedVariantsSnapshot: [],
      }),
      validateVariantUnitPriceCents: () => null,
    },
    "@/lib/checkoutAmounts": {
      calculateCheckoutAmounts: () => ({ sellerTransferAmountCents: 4000, belowMinimumSellerTransfer: false }),
    },
    "@/lib/checkoutSessionLock": {
      singleCheckoutLockKey: () => "lock",
      cartCheckoutLockKey: () => "lock",
      checkoutPayloadHash: () => "hash",
      checkoutSessionCreateIdempotencyKey: () => "key",
      getCheckoutLock: async () => null,
      acquireCheckoutLock: async () => "owner",
      markCheckoutLockReady: async () => true,
      releaseCheckoutLock: async () => true,
      releasePreparingCheckoutLock: async () => true,
    },
    "@/lib/checkoutReservationSourceState": {
      singleCheckoutReservationSnapshotWitness: () => ({ witness: true }),
      cartCheckoutReservationSnapshotWitness: () => ({ witness: true }),
    },
    "@/lib/checkoutStockReservationAuthority": {
      createSnapshotSingleCheckoutStockReservation: reserve,
      createSnapshotCartCheckoutStockReservation: reserve,
      bindCheckoutStockReservationSession: async () => true,
      abortCheckoutStockReservation: async () => ({ result: "released" }),
      isCheckoutReservationSourceChangedDatabaseError: () => false,
      isCheckoutStockUnavailableDatabaseError: () => false,
    },
    "@/lib/checkoutStockRestore": {
      checkoutStockReservationMetadata: () => ({}),
      restoreBuyerExpiredCheckoutStockOnce: async () => {},
    },
    "@/lib/stripe": { stripe: { checkout: { sessions: { create: async () => session } } } },
    "@/lib/stripeStatementDescriptor": { stripeStatementDescriptorSuffix: () => "MAKER" },
    "@/lib/orderItemSnapshot": {
      buyNowListingProductMetadata: () => ({}),
      checkoutShippingPackageMetadata: () => ({}),
    },
    "@/lib/sanitize": { sanitizeText: (text) => text, truncateText: (text) => text },
    "@/lib/money": { DEFAULT_CURRENCY: "usd" },
    "@/lib/appBaseUrl": { APP_BASE_URL: "https://example.test" },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, Date, Set, Map, JSON, Math, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  const body = {
    listingId: "listing_1",
    sellerId: "seller",
    checkoutGroupId: "6f1d6a5e-6d7b-4c58-9d55-2f1e7f6f0a11",
    quantity: 1,
    shippingAddress: { name: "B", line1: "1 Main", city: "Austin", state: "TX", postalCode: "78701" },
    selectedRate: {
      objectId: "rate", amountCents: 500, currency: "usd", displayName: "Ground", carrier: "USPS",
      estDays: 3, subjectHash: "subject", token: "token", expiresAt: 1,
    },
  };
  return {
    state,
    post: () => exports.POST(new Request("https://example.test/checkout", {
      method: "POST",
      body: JSON.stringify(body),
    })),
  };
}

for (const [label, path] of [
  ["Buy Now", "src/app/api/cart/checkout/single/route.ts"],
  ["cart", "src/app/api/cart/checkout-seller/route.ts"],
]) {
  test(`${label}: a buyer over the allowance reserves no stock`, async () => {
    const subject = fixture(path, { capped: true });
    const response = await subject.post();
    assert.equal(response.status, 429);
    assert.equal(subject.state.reservations, 0);
  });

  test(`${label}: a buyer inside the allowance reserves stock`, async () => {
    const subject = fixture(path);
    const response = await subject.post();
    assert.equal(response.status, 200);
    assert.equal(subject.state.capChecks, 1);
    assert.equal(subject.state.reservations, 1);
  });

  test(`${label}: made-to-order holds no stock, so it spends no allowance`, async () => {
    const subject = fixture(path, { listingType: "MADE_TO_ORDER", capped: true });
    const response = await subject.post();
    assert.equal(response.status, 200);
    assert.equal(subject.state.capChecks, 0);
  });
}
