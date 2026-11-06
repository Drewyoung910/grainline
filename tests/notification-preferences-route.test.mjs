import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";
import { VALID_PREFERENCE_KEYS, isAlwaysOnInAppPreferenceKey, isValidEmailPreferenceKey } from "../src/lib/notificationPreferenceKeys.ts";
import { isAlwaysOnEmailPreferenceKey } from "../src/lib/emailPreferencePolicy.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/account/notifications/preferences/route.ts";

function fixture() {
  const state = { updates: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/db": { prisma: { $transaction: async (run) => run({}) } },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "me", email: "a@example.com" }) },
    "@/lib/notificationPreferenceKeys": { VALID_PREFERENCE_KEYS, isAlwaysOnInAppPreferenceKey, isValidEmailPreferenceKey },
    "@/lib/emailPreferencePolicy": { isAlwaysOnEmailPreferenceKey },
    "@/lib/ratelimit": {
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (json, init) => Response.json(json, init),
      privateResponse: (response) => response,
    },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/userOwnerPrivateAccess": {
      updateUserOwnerNotificationPreference: async (_tx, input) => {
        state.updates.push(input);
        return true;
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, Error,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    state,
    post: (type, enabled) => exports.POST(new Request("https://example.test/x", {
      method: "POST",
      body: JSON.stringify({ type, enabled }),
    })),
  };
}

test("money, case and account notices cannot be switched off", async () => {
  for (const type of ["PAYOUT_FAILED", "PAYMENT_DISPUTE", "ACCOUNT_WARNING", "REFUND_ISSUED", "NEW_ORDER", "ORDER_SHIPPED", "CASE_OPENED", "CASE_MESSAGE", "CASE_RESOLVED"]) {
    const subject = fixture();
    assert.equal((await subject.post(type, false)).status, 400, type);
    assert.equal(subject.state.updates.length, 0, type);
  }
});

test("someone who switched one off earlier can switch it back on", async () => {
  const subject = fixture();
  assert.equal((await subject.post("PAYOUT_FAILED", true)).status, 200);
  assert.equal(subject.state.updates[0].enabled, true);
});

test("ordinary notices still toggle both ways", async () => {
  const subject = fixture();
  assert.equal((await subject.post("NEW_FAVORITE", false)).status, 200);
  assert.equal(subject.state.updates[0].enabled, false);
});
