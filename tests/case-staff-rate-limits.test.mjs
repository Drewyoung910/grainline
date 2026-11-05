import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);

// Which limiter a request is counted against. Everything past it is stubbed away:
// a closed limiter ends the request there.
async function limiterUsed(path, role, failOn = null) {
  const used = [];
  let lookups = 0;
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === "then" ? undefined : stub()),
    apply: () => undefined,
  });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "session" }) },
    "@/lib/ensureUser": {
      ensureUserByClerkId: async () => {
        lookups += 1;
        return { id: "user", role };
      },
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/ratelimit": {
      adminActionRatelimit: { name: "staff" },
      caseMessageRatelimit: { name: "participant" },
      refundRatelimit: { name: "refund" },
      safeRateLimit: async (limiter) => {
        used.push(limiter.name);
        return { success: failOn !== null && limiter.name !== failOn, reset: 0 };
      },
      rateLimitResponse: () => Response.json({}, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/adminPin": { requireStaffAdminPinForApi: async () => null },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  const response = await exports.POST(
    new Request("https://example.test/case", { method: "POST", body: "{}" }),
    { params: Promise.resolve({ id: "case_1" }) },
  );
  return { used, status: response.status, lookups };
}

test("resolving Cases counts as staff work, not against the maker refund limit", async () => {
  const result = await limiterUsed("src/app/api/cases/[id]/resolve/route.ts", "EMPLOYEE");
  assert.deepEqual(result.used, ["staff"]);
  assert.equal(result.status, 429);
});

test("Case replies hit the staff-sized limit before any lookup", async () => {
  const result = await limiterUsed("src/app/api/cases/[id]/messages/route.ts", "USER");
  assert.deepEqual(result.used, ["staff"]);
  assert.equal(result.lookups, 0);
  assert.equal(result.status, 429);
});

test("participants then get their own limit; staff do not", async () => {
  const route = "src/app/api/cases/[id]/messages/route.ts";
  const participant = await limiterUsed(route, "USER", "participant");
  assert.deepEqual(participant.used, ["staff", "participant"]);
  assert.equal(participant.status, 429);
  const staff = await limiterUsed(route, "ADMIN", "participant");
  assert.deepEqual(staff.used, ["staff"]);
  assert.notEqual(staff.status, 429);
});
