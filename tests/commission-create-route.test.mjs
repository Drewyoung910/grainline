import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { formatCommissionBudgetRange } from "../src/lib/commissionBudget.ts";
import * as money from "../src/lib/money.ts";
import * as sanitize from "../src/lib/sanitize.ts";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

function loadRoute(sellerProfile = null) {
  const limiterCalls = [];
  const created = [];
  const tx = { commissionRequest: { create: async ({ data }) => { created.push(data); return { id: "new-request" }; } } };
  const route = loadWithStubs("src/app/api/commission/route.ts", {
    zod: { z },
    "@/lib/money": money,
    "@/lib/sanitize": sanitize,
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-1" }) },
    "@/lib/db": { prisma: { $transaction: (fn) => fn(tx) } },
    "@/lib/ratelimit": {
      commissionCreateRatelimit: "daily-quota",
      commissionReferenceImageIpRatelimit: "image-ip",
      searchRatelimit: "search",
      getIP: () => "127.0.0.1",
      rateLimitResponse: () => new Response(null, { status: 429 }),
      safeRateLimit: async (limiter) => { limiterCalls.push(limiter); return { success: true, reset: 0 }; },
    },
    "@/lib/userIdentityAccess": {
      userClerkCommissionContext: async () => ({ id: "user-1", banned: false, deletedAt: null, sellerProfile }),
    },
    "@/lib/requestBody": {
      readBoundedJson: async (request) => request.body,
      isInvalidJsonBodyError: () => false,
      isRequestBodyTooLargeError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => ({ status: init?.status ?? 200, body }),
      privateResponse: (response) => response,
    },
    "@/lib/uploadPersistenceVerification": { filterVerifiedFirstPartyMediaUrlsForUser: async () => [] },
    "@/lib/profanity": { containsProfanity: () => ({ flagged: false, matches: [] }), containsSlur: () => false },
    "@/lib/httpStatus": { HTTP_STATUS: { BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, PAYLOAD_TOO_LARGE: 413 } },
    "@/lib/categories": { CATEGORY_VALUES: [] },
  });
  return { route, limiterCalls, created };
}



const valid = { title: "Walnut desk", description: "A desk" };

test("a rejected commission post does not spend the daily quota", async () => {
  const rejected = [
    { ...valid, budgetMin: 500, budgetMax: 100 },
    { ...valid, budgetMin: "not a number" },
    { ...valid, isNational: false },
    { title: "" },
  ];
  for (const body of rejected) {
    const { route, limiterCalls } = loadRoute();
    const response = await route.POST({ body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(limiterCalls, [], JSON.stringify(body));
  }
});

test("a valid commission post spends one quota token", async () => {
  const { route, limiterCalls, created } = loadRoute();
  const response = await route.POST({ body: valid });
  assert.equal(response.status, 200);
  assert.deepEqual(limiterCalls, ["daily-quota"]);
  assert.equal(created.length, 1);
});

test("sanitizing cannot push commission text past its column", async () => {
  const { route, created } = loadRoute();
  const response = await route.POST({
    body: { title: "&".repeat(100), description: "&".repeat(1000), timeline: "&".repeat(200) },
  });
  assert.equal(response.status, 200);
  assert.ok(Array.from(created[0].timeline).length <= 200);
  assert.ok(Array.from(created[0].title).length <= 150);
  assert.ok(Array.from(created[0].description).length <= 5000);
});

test("a zero budget is stored as no budget", async () => {
  const { route, created } = loadRoute();
  await route.POST({ body: { ...valid, budgetMin: 0, budgetMax: "0.00" } });
  assert.equal(created[0].budgetMinCents, null);
  assert.equal(created[0].budgetMaxCents, null);
});

test("a zero budget already saved shows as no budget", () => {
  assert.equal(formatCommissionBudgetRange(0, 0), null);
  assert.equal(formatCommissionBudgetRange(0, 50_000), "Up to $500.00");
  assert.equal(formatCommissionBudgetRange(10_000, 0), "From $100.00");
  assert.equal(formatCommissionBudgetRange(10_000, 50_000), "$100.00\u2013$500.00");
});
