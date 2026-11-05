import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/account/delete/route.ts";

function fixture({ role }) {
  const state = { clerkDeletes: 0, anonymized: 0 };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": {
      auth: async () => ({ userId: "clerk", factorVerificationAge: [0, 0] }),
      clerkClient: async () => ({ users: { deleteUser: async () => { state.clerkDeletes += 1; } } }),
      reverificationErrorResponse: () => Response.json({}, { status: 403 }),
    },
    "@/lib/ensureUser": { ensureUser: async () => ({ id: "me", role }) },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/accountDeletion": {
      acquireAccountDeletionLock: async () => ({ key: "lock" }),
      anonymizeUserAccount: async () => { state.anonymized += 1; return { ok: true }; },
      getAccountDeletionBlockers: async () => [],
      releaseAccountDeletionLock: async () => undefined,
    },
    "@/lib/accountDeletionSideEffects": { enqueueAccountDeletionLocalAnonymizeSideEffect: async () => "side-effect" },
    "@/lib/accountDeletionSideEffectDb": { getAccountDeletionSideEffectClient: () => ({}) },
    "@/lib/ratelimit": {
      accountDeletionRatelimit: {},
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => Response.json({}, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/accountExportReverification": {
      ACCOUNT_DELETION_REVERIFICATION: {},
      hasFreshAccountDeletionSession: () => true,
    },
    "@/lib/requestBody": {
      readBoundedJson: (req) => req.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
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
  return {
    state,
    remove: () => exports.POST(new Request("https://example.test/api/account/delete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmText: "DELETE" }),
    })),
  };
}

test("an ADMIN cannot delete their own account from the settings page", async () => {
  const subject = fixture({ role: "ADMIN" });
  const response = await subject.remove();
  assert.equal(response.status, HTTP_STATUS.CONFLICT);
  const body = await response.json();
  assert.equal(body.blockers[0].code, "admin_role");
  assert.equal(subject.state.clerkDeletes, 0);
  assert.equal(subject.state.anonymized, 0);
});

test("an ordinary member can still delete their account", async () => {
  const subject = fixture({ role: "USER" });
  const response = await subject.remove();
  assert.equal(response.status, 200);
  assert.equal(subject.state.clerkDeletes, 1);
});
