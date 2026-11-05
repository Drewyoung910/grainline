import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/admin/verify-pin/route.ts";

function fixture({ limit = { success: true, reset: 0 }, body = {} } = {}) {
  const state = { messages: [], audits: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "s" }) },
    "@sentry/nextjs": { captureMessage: (message) => state.messages.push(message) },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "admin", role: "ADMIN", banned: false, deletedAt: null }) },
    "@/lib/ratelimit": {
      getIP: () => "203.0.113.1",
      safeRateLimit: async () => limit,
      rateLimitResponse: () => new Response(JSON.stringify({ error: "Too many" }), { status: 429 }),
      pinUserRatelimit: {},
      pinIpRatelimit: {},
    },
    "@/lib/audit": { logAdminAction: async (entry) => state.audits.push(entry) },
    "@/lib/privacyTelemetry": { hashIdentifierForTelemetry: () => "hash" },
    "@/lib/requestBody": {
      readOptionalBoundedJson: async () => body,
      isRequestBodyTooLargeError: () => false,
    },
    "@/lib/privateResponse": { privateJson: (json, init) => Response.json(json, init), privateResponse: (r) => r },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/adminPinChallenge": {
      ADMIN_PIN_SHA256_BY_CLERK_ID_ENV: "X",
      resolveAdminPinDigestForUser: () => ({ ok: true, digest: "d".repeat(64), source: "shared" }),
      adminPinDigestMatches: () => false,
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, Math, process, JSON,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    state,
    post: () => exports.POST(new Request("https://example.test/api/admin/verify-pin", { method: "POST" })),
  };
}

test("a JSON null body is a wrong PIN, not a 500", async () => {
  const subject = fixture({ body: null });
  assert.equal((await subject.post()).status, 401);
});

test("a limiter outage is not reported as a brute-force attack", async () => {
  const subject = fixture({ limit: { success: false, reset: 0, unavailable: true } });
  const response = await subject.post();
  assert.equal(response.status, 503);
  assert.doesNotMatch((await response.json()).error, /Too many/);
  assert.deepEqual(subject.state.messages, []);
  assert.deepEqual(subject.state.audits, []);
});

test("a real limit still is", async () => {
  const subject = fixture({ limit: { success: false, reset: 0 } });
  assert.equal((await subject.post()).status, 429);
  assert.deepEqual(subject.state.messages, ["ADMIN_PIN_BRUTEFORCE"]);
});
