import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../../src/lib/httpStatus.ts";

import { stripeRefusedCheckoutSessionCreate } from "../../src/lib/checkoutLockState.ts";

const require = createRequire(import.meta.url);

// Runs the real checkout routes with the database, Redis and Stripe replaced.
export function checkoutRouteFixture(path, { listingType = "IN_STOCK", createSession, existingLock = null, reserveError = null } = {}) {
  const state = { reservations: 0, aborts: 0, lockReleases: 0, createOptions: null };
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
    if (reserveError) throw reserveError;
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
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: (_reset, message) => Response.json({ error: message }, { status: 429 }),
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/prismaRawSqlError": { getPrismaRawSqlState: (error) => error?.sqlState ?? null },
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
      getCheckoutLock: async () => existingLock,
      acquireCheckoutLock: async () => "owner",
      markCheckoutLockReady: async () => true,
      releaseCheckoutLock: async () => true,
      releasePreparingCheckoutLock: async () => {
        state.lockReleases += 1;
        return true;
      },
      stripeRefusedCheckoutSessionCreate,
    },
    "@/lib/checkoutReservationSourceState": {
      singleCheckoutReservationSnapshotWitness: () => ({ witness: true }),
      cartCheckoutReservationSnapshotWitness: () => ({ witness: true }),
    },
    "@/lib/checkoutStockReservationAuthority": {
      createSnapshotSingleCheckoutStockReservation: reserve,
      createSnapshotCartCheckoutStockReservation: reserve,
      bindCheckoutStockReservationSession: async () => true,
      abortCheckoutStockReservation: async () => {
        state.aborts += 1;
        return { result: "restored" };
      },
      isCheckoutReservationSourceChangedDatabaseError: () => false,
      isCheckoutStockUnavailableDatabaseError: () => false,
    },
    "@/lib/checkoutStockRestore": {
      checkoutStockReservationMetadata: () => ({}),
      restoreBuyerExpiredCheckoutStockOnce: async () => {},
    },
    "@/lib/stripe": {
      stripe: {
        checkout: {
          sessions: {
            create: async (_params, options) => {
              state.createOptions = options;
              return createSession ? createSession() : session;
            },
          },
        },
      },
    },
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
