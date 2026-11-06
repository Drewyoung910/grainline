import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/orders/[id]/label/route.ts";

const address = {
  name: "A", street1: "1 Main", street2: null, city: "Austin", state: "TX", zip: "78701", country: "US",
};

function fixture({ blocked = [], preflight = "ready" } = {}) {
  const spent = [];
  const state = { quotes: 0, claims: 0, preflights: 0 };
  const purchaseLimiter = { name: "purchase" };
  const requestLimiter = { name: "request" };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "maker" }), isAccountAccessError: () => false },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/requestBody": {
      readOptionalBoundedJson: (req) => req.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/ratelimit": {
      labelDownloadRatelimit: {},
      labelPurchaseRatelimit: purchaseLimiter,
      labelRequestRatelimit: requestLimiter,
      safeRateLimit: async (limiter) => {
        spent.push(limiter.name);
        return { success: !blocked.includes(limiter.name), reset: 0 };
      },
      rateLimitResponse: (_reset, message) => Response.json({ error: message }, { status: 429 }),
    },
    "@/lib/orderLabelAuthority": {
      sellerLabelPreflight: async () => (state.preflights += 1, preflight === "conflict"
        ? { outcome: "conflict", reason: "active_case" }
        : {
        outcome: "ready", currency: "usd", storedRateUsable: false,
        packageWeightGrams: 500, packageLengthCm: 10, packageWidthCm: 10, packageHeightCm: 10,
        shipFrom: { ...address, phone: "5125550100" }, shipTo: address,
      }),
      replaceSellerLabelQuote: async () => ({ outcome: "stored" }),
      claimSellerLabelPurchase: async () => {
        state.claims += 1;
        return { outcome: "conflict", reason: "rate_expired" };
      },
      isValidProviderLabelUrl: () => true,
    },
    "@/lib/shippo": {
      shippoRatesMultiPiece: async () => {
        state.quotes += 1;
        return {
          shipmentId: "shipment",
          rates: [{ objectId: "rate", amount: 900, currency: "USD", provider: "USPS", servicelevel_name: "Ground" }],
        };
      },
      normalizeShippoRateCurrency: (value) => value.toLowerCase(),
    },
    "@/lib/shippingQuoteState": {
      isPickupRateObjectId: () => false,
      isQuoteOnlyRateObjectId: () => false,
      MAX_PROVIDER_SHIPPING_CENTS: 500_000,
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  const post = (body) => exports.POST(
    new Request("https://example.test/api/orders/order/label", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "order" }) },
  );
  return { spent, state, post };
}

test("getting label rates does not use up the label purchase limit", async () => {
  const subject = fixture();
  const response = await subject.post({});
  assert.equal(response.status, 202);
  assert.equal(subject.state.quotes, 1);
  assert.deepEqual(subject.spent, ["request"]);
});

test("buying a chosen rate spends one purchase token", async () => {
  const subject = fixture();
  await subject.post({ rateObjectId: "rate" });
  assert.equal(subject.state.claims, 1);
  assert.deepEqual(subject.spent, ["request", "purchase"]);
});

test("a request the first check refuses is still rate limited", async () => {
  const subject = fixture({ preflight: "conflict" });
  const response = await subject.post({ rateObjectId: "rate" });
  assert.equal(response.status, 409);
  assert.deepEqual(subject.spent, ["request"]);
  const limited = fixture({ blocked: ["request"] });
  assert.equal((await limited.post({ rateObjectId: "rate" })).status, 429);
  assert.equal(limited.state.preflights, 0);
});

test("a maker over the purchase limit cannot start a purchase", async () => {
  const subject = fixture({ blocked: ["purchase"] });
  const response = await subject.post({ rateObjectId: "rate" });
  assert.equal(response.status, 429);
  assert.equal(subject.state.claims, 0);
});

test("a maker over the request limit makes no Shippo rate call", async () => {
  const subject = fixture({ blocked: ["request"] });
  const response = await subject.post({});
  assert.equal(response.status, 429);
  assert.equal(subject.state.quotes, 0);
});
