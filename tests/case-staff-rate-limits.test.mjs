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
async function limiterUsed(path, role) {
  const used = [];
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === "then" ? undefined : stub()),
    apply: () => undefined,
  });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "session" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "user", role }) },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/ratelimit": {
      adminActionRatelimit: { name: "staff" },
      caseMessageRatelimit: { name: "participant" },
      refundRatelimit: { name: "refund" },
      safeRateLimit: async (limiter) => {
        used.push(limiter.name);
        return { success: false, reset: 0 };
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
  assert.equal(response.status, 429);
  return used;
}

test("resolving Cases counts as staff work, not against the maker refund limit", async () => {
  assert.deepEqual(await limiterUsed("src/app/api/cases/[id]/resolve/route.ts", "EMPLOYEE"), ["staff"]);
});

test("staff replies use the staff limit, and participants keep theirs", async () => {
  const route = "src/app/api/cases/[id]/messages/route.ts";
  assert.deepEqual(await limiterUsed(route, "ADMIN"), ["staff"]);
  assert.deepEqual(await limiterUsed(route, "USER"), ["participant"]);
});
