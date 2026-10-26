import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

function loadRoute({
  authenticated = true,
  rateLimitAllowed = true,
  subscribeStatus = "OK",
  subscribed = true,
} = {}) {
  const calls = { subscribe: [], delete: [] };
  const dependencies = {
    "@clerk/nextjs/server": {
      auth: async () => ({ userId: authenticated ? "clerk_stock_owner" : null }),
    },
    "@/lib/ratelimit": {
      notifyRatelimit: {},
      safeRateLimit: async () => ({ success: rateLimitAllowed, reset: Date.now() + 1000 }),
      rateLimitResponse: () => Response.json({ error: "rate limited" }, { status: 429 }),
    },
    "@/lib/ensureUser": {
      ensureUserByClerkId: async () => ({ id: "stock_owner" }),
      isAccountAccessError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/requestOriginGuard": {
      getExplicitCrossOriginPostRejection: (request) => (
        request.headers.get("x-cross-origin") === "1" ? {} : null
      ),
    },
    "@/lib/stockNotificationAccess": {
      subscribeOwnerStockNotification: async (userId, listingId) => {
        calls.subscribe.push({ userId, listingId });
        return { resultStatus: subscribeStatus, subscribed };
      },
      deleteOwnerStockNotification: async (userId, listingId) => {
        calls.delete.push({ userId, listingId });
        return { count: 1 };
      },
    },
  };
  const { outputText } = ts.transpileModule(
    readFileSync("src/app/api/listings/[id]/notify/route.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
    return dependencies[name];
  }, routeModule, routeModule.exports);
  return { route: routeModule.exports, calls };
}

function request(method, crossOrigin = false) {
  return new Request("http://localhost/api/listings/listing_1/notify", {
    method,
    headers: crossOrigin ? { "x-cross-origin": "1" } : undefined,
  });
}

const context = { params: Promise.resolve({ id: "listing_1" }) };

test("stock notification POST fails before authority work for cross-origin and unauthenticated requests", async () => {
  const crossOrigin = loadRoute();
  assert.equal((await crossOrigin.route.POST(request("POST", true), context)).status, 403);
  assert.deepEqual(crossOrigin.calls.subscribe, []);

  const unauthenticated = loadRoute({ authenticated: false });
  assert.equal((await unauthenticated.route.POST(request("POST"), context)).status, 401);
  assert.deepEqual(unauthenticated.calls.subscribe, []);
});

test("stock notification POST maps the database eligibility decision without a second listing read", async () => {
  for (const [subscribeStatus, expectedStatus] of [
    ["SELF", 400],
    ["BLOCKED", 404],
    ["UNAVAILABLE", 400],
    ["OK", 200],
  ]) {
    const loaded = loadRoute({ subscribeStatus, subscribed: subscribeStatus === "OK" });
    const response = await loaded.route.POST(request("POST"), context);
    assert.equal(response.status, expectedStatus, subscribeStatus);
    assert.deepEqual(loaded.calls.subscribe, [{
      userId: "stock_owner",
      listingId: "listing_1",
    }]);
    if (subscribeStatus === "OK") {
      assert.deepEqual(await response.json(), { subscribed: true });
    }
  }
});

test("stock notification DELETE is actor-bound and respects the mutation rate limit", async () => {
  const rateLimited = loadRoute({ rateLimitAllowed: false });
  assert.equal((await rateLimited.route.DELETE(request("DELETE"), context)).status, 429);
  assert.deepEqual(rateLimited.calls.delete, []);

  const loaded = loadRoute();
  const response = await loaded.route.DELETE(request("DELETE"), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { subscribed: false });
  assert.deepEqual(loaded.calls.delete, [{
    userId: "stock_owner",
    listingId: "listing_1",
  }]);
});
