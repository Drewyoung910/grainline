import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);

const routes = [
  ["src/app/api/admin/listings/[id]/route.ts", "DELETE"],
  ["src/app/api/admin/listings/[id]/review/route.ts", "PATCH"],
  ["src/app/api/admin/reports/[id]/resolve/route.ts", "POST"],
  ["src/app/api/admin/reviews/[id]/route.ts", "DELETE"],
  ["src/app/api/admin/email/route.ts", "POST"],
];

function loadRoute(path) {
  const state = { touched: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "session" }) },
    "@/lib/db": {
      prisma: new Proxy({}, {
        get: (_target, model) => {
          state.touched.push(String(model));
          return stub();
        },
      }),
    },
    "@/lib/userIdentityAccess": {
      userClerkGate: async () => ({ id: "admin", role: "ADMIN", banned: false, deletedAt: null }),
    },
    "@/lib/ratelimit": {
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      adminActionRatelimit: {},
      adminEmailRatelimit: {},
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/adminPinApi": {
      requireStaffAdminPinForApi: async () => Response.json({ error: "Admin PIN required" }, { status: 403 }),
    },
    "next/server": { NextRequest: Request },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, process, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return { state, exports };
}

for (const [path, method] of routes) {
  test(`${method} ${path} refuses an expired admin PIN in the route`, async () => {
    const { state, exports } = loadRoute(path);
    const response = await exports[method](
      new Request("https://example.test/x", { method, body: "{}" }),
      { params: Promise.resolve({ id: "target" }) },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(state.touched, []);
  });
}
