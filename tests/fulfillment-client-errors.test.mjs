import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/orders/[id]/fulfillment/route.ts";

function route() {
  const state = { finalized: [], logged: 0 };
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === "then" ? undefined : stub()),
    apply: () => undefined,
  });
  const dependencies = {
    zod: require("zod"),
    "next/server": { NextResponse: { redirect: () => new Response(null, { status: 303 }) } },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "maker" }), isAccountAccessError: () => false },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true, reset: 0 }) },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/requestBody": {
      readOptionalBoundedJson: (request) => request.json(),
      assertKnownContentLengthUnder() {},
      isRequestBodyTooLargeError: () => false,
      isMissingContentLengthError: () => false,
      isInvalidContentLengthError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/appBaseUrl": { APP_BASE_URL: "https://example.test" },
    "@/lib/sanitize": { sanitizeText: (text) => text, truncateText: (text) => text },
    "@/lib/serverErrorLogger": {
      logServerError: () => {
        state.logged += 1;
      },
    },
    "@/lib/orderFulfillmentAuthority": {
      updateSellerOrderNotes: async () => ({ outcome: "ok" }),
    },
    "@/lib/orderFulfillmentFinalization": {
      finalizeSellerOrderFulfillment: async (input) => {
        state.finalized.push(input);
        return { outcome: "ok" };
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, URL, Object, Set, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  const params = { params: Promise.resolve({ id: "order" }) };
  return {
    state,
    postJson: (body) => exports.POST(new Request("https://example.test/f", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), params),
    postText: () => exports.POST(new Request("https://example.test/f", {
      method: "POST",
      headers: { "content-type": "text/plain", "content-length": "5" },
      body: "hello",
    }), params),
  };
}

test("tracking on a pickup step is the client's mistake, not a server error", async () => {
  const subject = route();
  const response = await subject.postJson({
    action: "ready_for_pickup", trackingCarrier: "UPS", trackingNumber: "1Z999AA10123456784",
  });
  assert.equal(response.status, 400);
  assert.equal(subject.state.finalized.length, 0);
});

test("a body the route cannot read is a 415, not a server error", async () => {
  const subject = route();
  const response = await subject.postText();
  assert.equal(response.status, 415);
  assert.equal(subject.state.logged, 0);
});

test("an ordinary pickup step still goes through", async () => {
  const subject = route();
  const response = await subject.postJson({ action: "ready_for_pickup" });
  assert.equal(response.status, 303);
  assert.equal(subject.state.finalized.length, 1);
});
