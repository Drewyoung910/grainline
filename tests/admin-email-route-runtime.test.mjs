import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/admin/email/route.ts";

function fixture({ hardSuppressed = false } = {}) {
  const state = { sent: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "s" }) },
    "@/lib/userIdentityAccess": {
      userClerkGate: async () => ({ id: "admin", role: "ADMIN", banned: false, deletedAt: null }),
    },
    "@/lib/ratelimit": {
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      adminEmailRatelimit: {},
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/adminPinApi": { requireStaffAdminPinForApi: async () => null },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (json, init) => Response.json(json, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/emailSuppression": {
      normalizeEmailAddress: (email) => email,
      // A one-click unsubscribe is true for the broad check and false for delivery.
      isEmailSuppressed: async () => true,
      isEmailDeliverySuppressed: async () => hardSuppressed,
    },
    "@/lib/userStaffAccess": {
      userStaffEmailRecipient: async () => ({ id: "user", email: "a@example.com", banned: false, deletedAt: null }),
    },
    "@/lib/adminEmailRecipient": { inactiveAdminEmailRecipientReason: () => null },
    "@/lib/email": {
      UNSUBSCRIBE_HREF_PLACEHOLDER: "https://example.test/u",
      sendRenderedEmail: async (email) => state.sent.push(email),
    },
    "@/lib/sanitize": {
      normalizeUserText: (text) => text,
      stripBidiControls: (text) => text,
      truncateText: (text) => text,
    },
    "@/lib/audit": { logAdminActionOrThrow: async () => "audit" },
    "@/lib/notifications": { createNotification: async () => {} },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, console, process,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    state,
    post: (subject) => exports.POST(new Request("https://example.test/x", {
      method: "POST",
      body: JSON.stringify({ userId: "user", subject, body: "Hello" }),
    })),
  };
}

test("staff can write to someone who once clicked unsubscribe", async () => {
  const subject = fixture();
  assert.equal((await subject.post("About your order")).status, 200);
  assert.equal(subject.state.sent.length, 1);
});

test("a bounce or complaint still stops it, and says why", async () => {
  const subject = fixture({ hardSuppressed: true });
  const response = await subject.post("About your order");
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /bounced/);
  assert.equal(subject.state.sent.length, 0);
});

test("the subject keeps ampersands and apostrophes", async () => {
  const subject = fixture();
  await subject.post("A note about your order & Bea's review");
  assert.equal(subject.state.sent[0].subject, "A note about your order & Bea's review");
});
