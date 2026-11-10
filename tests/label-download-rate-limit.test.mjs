import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/orders/[id]/label/route.ts";

function fixture({ limited }) {
  const state = { shippoCalls: 0, proofs: 0 };
  const downloadLimiter = { name: "download" };
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
    "@/lib/ratelimit": {
      labelDownloadRatelimit: downloadLimiter,
      labelPurchaseRatelimit: {},
      safeRateLimit: async (limiter) => ({
        success: !(limited && limiter === downloadLimiter),
        reset: 0,
      }),
      rateLimitResponse: (_reset, message) => Response.json({ error: message }, { status: 429 }),
    },
    "@/lib/orderLabelAuthority": {
      sellerLabelDownload: async () => {
        state.proofs += 1;
        return {
          outcome: "ready", transactionId: "tx", rateObjectId: "rate", amountCents: 500, currency: "usd",
        };
      },
      isValidProviderLabelUrl: () => true,
    },
    "@/lib/shippo": {
      shippoRequest: async () => {
        state.shippoCalls += 1;
        return {
          status: "SUCCESS", test: true, object_id: "tx", label_url: "https://labels.example/label.pdf",
          rate: { object_id: "rate", amount: "5.00", currency: "USD" },
        };
      },
      normalizeShippoRateCurrency: (value) => value.toLowerCase(),
      shippoCredentialTestMode: () => true,
    },
    "@/lib/shippingQuoteState": { safeProviderShippingCents: () => 500 },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    state,
    download: () => exports.GET(
      new Request("https://example.test/api/orders/order/label"),
      { params: Promise.resolve({ id: "order" }) },
    ),
  };
}

test("a maker over the download limit spends no Shippo calls", async () => {
  const subject = fixture({ limited: true });
  const response = await subject.download();
  assert.equal(response.status, 429);
  assert.equal(subject.state.shippoCalls, 0);
});

test("an ordinary download still redirects to the label", async () => {
  const subject = fixture({ limited: false });
  const response = await subject.download();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://labels.example/label.pdf");
  assert.equal(subject.state.shippoCalls, 1);
});
