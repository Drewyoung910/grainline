import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import * as money from "../src/lib/money.ts";
import * as sanitize from "../src/lib/sanitize.ts";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

const common = (limiterCalls) => ({
  zod: { z },
  "@/lib/money": money,
  "@/lib/sanitize": sanitize,
  "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-1" }) },
  "@/lib/ratelimit": {
    commissionInterestRatelimit: "interest-quota",
    customOrderRequestRatelimit: "custom-order-quota",
    rateLimitResponse: () => ({ status: 429 }),
    safeRateLimit: async (limiter) => { limiterCalls.push(limiter); return { success: true, reset: 0 }; },
  },
  "@/lib/privateResponse": {
    privateJson: (body, init) => ({ status: init?.status ?? 200, body }),
    privateResponse: (response) => response,
  },
  "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
  "@/lib/requestBody": {
    readBoundedJson: async (request) => request.body,
    isInvalidJsonBodyError: () => false,
    isRequestBodyTooLargeError: () => false,
  },
});

function loadInterestRoute({ buyerId = "buyer-1", blocked = false } = {}) {
  const limiterCalls = [];
  const route = loadWithStubs("src/app/api/commission/[id]/interest/route.ts", {
    ...common(limiterCalls),
    "@/lib/db": {
      prisma: {
        commissionRequest: {
          findUnique: async () => ({ id: "request-1", buyerId, status: "OPEN", expiresAt: null, buyerAccountActive: true }),
        },
        block: { findFirst: async () => (blocked ? { id: "block-1" } : null) },
      },
    },
    "@/lib/commissionExpiry": { commissionIsExpired: () => false },
    "@/lib/userIdentityAccess": {
      userClerkCommissionContext: async () => ({
        id: "maker-1",
        banned: false,
        deletedAt: null,
        sellerProfile: { chargesEnabled: true, vacationMode: false },
      }),
    },
    "@/lib/commissionInterestMessageAccess": {
      createCommissionInterestMessage: async () => ({ ok: true, alreadyInterested: true, conversationId: "convo-1" }),
    },
  });
  return { limiterCalls, post: () => route.POST({}, { params: Promise.resolve({ id: "request-1" }) }) };
}

test("a refused commission interest does not spend the daily quota", async () => {
  for (const options of [{ buyerId: "maker-1" }, { blocked: true }]) {
    const { limiterCalls, post } = loadInterestRoute(options);
    const response = await post();
    assert.ok(response.status >= 400, JSON.stringify(options));
    assert.deepEqual(limiterCalls, [], JSON.stringify(options));
  }
});

test("an accepted commission interest spends one quota token", async () => {
  const { limiterCalls, post } = loadInterestRoute();
  assert.equal((await post()).status, 200);
  assert.deepEqual(limiterCalls, ["interest-quota"]);
});

function loadCustomOrderRoute({ acceptsCustomOrders = true } = {}) {
  const limiterCalls = [];
  const route = loadWithStubs("src/app/api/messages/custom-order-request/route.ts", {
    ...common(limiterCalls),
    "@/lib/db": { prisma: { block: { findFirst: async () => null } } },
    "@/lib/userIdentityAccess": {
      userClerkActor: async () => ({ id: "buyer-1", name: "Buyer", banned: false, deletedAt: null }),
    },
    "@/lib/userRelationshipAccess": {
      userCustomOrderSellerState: async () => ({
        sellerProfileId: "seller-1",
        banned: false,
        deletedAt: null,
        acceptsCustomOrders,
        chargesEnabled: true,
        stripeAccountId: "acct_1",
      }),
    },
    "@/lib/sellerOrderState": { sellerOrderBlockReason: () => null, sellerOrderBlockMessage: () => "" },
    "@/lib/customOrderRequestAccess": {
      createCustomOrderRequestMessage: async () => ({ ok: true, conversationId: "convo-1", messageId: "message-1" }),
    },
  });
  return { limiterCalls, route };
}

const validRequest = { sellerUserId: "maker-1", description: "A walnut desk" };

test("a refused custom-order request does not spend the daily quota", async () => {
  const cases = [
    [{}, { description: "" }],
    [{}, { ...validRequest, budget: "not a number" }],
    [{}, { ...validRequest, sellerUserId: "buyer-1" }],
    [{ acceptsCustomOrders: false }, validRequest],
  ];
  for (const [options, body] of cases) {
    const { limiterCalls, route } = loadCustomOrderRoute(options);
    const response = await route.POST({ body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(limiterCalls, [], JSON.stringify(body));
  }
});

test("an accepted custom-order request spends one quota token", async () => {
  const { limiterCalls, route } = loadCustomOrderRoute();
  const response = await route.POST({ body: validRequest });
  assert.equal(response.status, 200);
  assert.deepEqual(limiterCalls, ["custom-order-quota"]);
});
