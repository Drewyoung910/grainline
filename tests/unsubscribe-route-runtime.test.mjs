import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const path = "src/app/api/email/unsubscribe/route.ts";

// The real route with its ports stubbed. Nothing here exercises the database.
function fixture({ validToken = true, superseded = false, ipLimited = false } = {}) {
  const state = { ipChecks: 0, unsubscribed: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "next/server": { NextResponse: Response, NextRequest: Request },
    "@/lib/unsubscribe": {
      unsubscribeEmail: async (email) => {
        state.unsubscribed.push(email);
        return { ok: true };
      },
      unsubscribeTokenSuperseded: async () => superseded,
      verifyUnsubscribeToken: () => validToken,
    },
    "@/lib/ratelimit": {
      getIP: () => "203.0.113.1",
      rateLimitResponse: () => new Response(null, { status: 429 }),
      unsubscribeRatelimit: "ip",
      unsubscribeEmailRatelimit: "address",
      safeRateLimit: async (limiter) => {
        if (limiter === "ip") {
          state.ipChecks += 1;
          return { success: !ipLimited, reset: 0 };
        }
        return { success: true, reset: 0 };
      },
    },
    "@/lib/security": { logSecurityEvent: () => {} },
    "@/lib/privacyTelemetry": { hashEmailForTelemetry: () => "hash" },
    "@/lib/requestBody": {
      isRequestBodyTooLargeError: () => false,
      readBoundedText: () => "",
      readOptionalBoundedJson: async () => null,
    },
    "@/lib/serverErrorLogger": { logServerError: () => {} },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": {
      HTTP_STATUS: {
        OK: 200, BAD_REQUEST: 400, FORBIDDEN: 403, PAYLOAD_TOO_LARGE: 413,
        TOO_MANY_REQUESTS: 429, INTERNAL_SERVER_ERROR: 500,
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, URL, URLSearchParams, encodeURIComponent,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return { state, exports };
}

const url = (extra = "") =>
  `https://example.test/api/email/unsubscribe?email=a%40example.com&token=t&issuedAt=1${extra}`;

test("a valid one-click POST from a busy mail provider IP is not stopped by the IP limit", async () => {
  const subject = fixture({ ipLimited: true });
  const response = await subject.exports.POST(new Request(url(), { method: "POST" }));
  assert.equal(response.status, 200);
  assert.deepEqual(subject.state.unsubscribed, ["a@example.com"]);
  assert.equal(subject.state.ipChecks, 0);
});

test("an invalid token still counts against the IP limit", async () => {
  const subject = fixture({ validToken: false, ipLimited: true });
  const response = await subject.exports.POST(new Request(url(), { method: "POST" }));
  assert.equal(response.status, 429);
  assert.deepEqual(subject.state.unsubscribed, []);
});

test("the confirmation page still counts against the IP limit", async () => {
  const subject = fixture({ ipLimited: true });
  const response = await subject.exports.GET(new Request(url()));
  assert.equal(response.status, 429);
});

