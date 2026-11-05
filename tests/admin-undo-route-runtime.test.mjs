import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/admin/audit/[id]/undo/route.ts";

function undoFailingWith(message) {
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const logged = [];
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "s" }) },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "admin", role: "ADMIN", banned: false, deletedAt: null }) },
    "@/lib/audit": {
      undoAdminAction: async () => {
        throw new Error(message);
      },
    },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }), adminActionRatelimit: {} },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/serverErrorLogger": { logServerError: (error) => logged.push(error) },
    "@/lib/privateResponse": { privateJson: (body, init) => Response.json(body, init), privateResponse: (r) => r },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/adminPinApi": { requireStaffAdminPinForApi: async () => null },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, Error, Set,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    logged,
    run: () => exports.POST(
      new Request("https://example.test/x", { method: "POST", body: JSON.stringify({ reason: "r" }) }),
      { params: Promise.resolve({ id: "log" }) },
    ),
  };
}

test("staff see why an undo failed when they can act on it", async () => {
  for (const message of [
    "Cannot automatically undo this ban because its audit metadata is incomplete. Use the manual unban workflow.",
    "User ban state changed before undo could be applied",
    "Seller profile changed before undo could be applied",
    "Listing changed before undo could be applied",
    "This person deleted their account and it is waiting for cleanup, so it cannot be unbanned.",
  ]) {
    const response = await undoFailingWith(message).run();
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, message);
  }
});

test("an unexpected failure stays generic and is logged", async () => {
  const subject = undoFailingWith("connect ECONNREFUSED 10.0.0.1");
  const response = await subject.run();
  assert.equal((await response.json()).error, "This action cannot be undone.");
  assert.equal(subject.logged.length, 1);
});
