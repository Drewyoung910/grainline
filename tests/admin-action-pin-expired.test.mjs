import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const { adminPinExpiredActionState } = await (async () => {
  const javascript = ts.transpileModule(readFileSync("src/lib/adminPinApi.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  vm.runInNewContext(javascript, { exports, Error, require: (name) => (name === "@/lib/httpStatus" ? { HTTP_STATUS } : stub()) });
  return exports;
})();

function runAction(path, call) {
  const logged = [];
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "s" }) },
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }), adminActionRatelimit: {} },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "admin", role: "ADMIN", banned: false, deletedAt: null }) },
    "@/lib/adminPin": { ADMIN_PIN_COOKIE_NAME: "pin", verifyAdminPinCookieValue: async () => false },
    "@/lib/adminPinApi": { adminPinExpiredActionState },
    "@/lib/adminPageAccess": { requireAdminPageAccess: async () => null },
    "@/lib/serverErrorLogger": { logServerError: (error) => logged.push(error) },
    "@/lib/supportRequest": { normalizeSupportRequestClosureEvidence: () => null },
    "@/lib/supportRequestState": { isSupportRequestStatus: () => true },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Error, String, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return call(exports).then((state) => ({ state, logged }));
}

test("an expired PIN on an order action asks for the PIN and logs nothing", async () => {
  const { state, logged } = await runAction("src/app/admin/actions.ts", (exports) => exports.markReviewed("order"));
  assert.equal(state.ok, false);
  assert.match(state.error, /PIN has expired/);
  assert.equal(logged.length, 0);
});

test("an expired PIN on a support action does the same", async () => {
  const { state, logged } = await runAction(
    "src/app/admin/support/actions.ts",
    (exports) => exports.setSupportRequestStatus("request", "OPEN"),
  );
  assert.match(state.error, /PIN has expired/);
  assert.equal(logged.length, 0);
});

test("another failure is still logged", () => {
  assert.equal(adminPinExpiredActionState(new Error("database down")), null);
});
