import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const path = "src/app/api/notifications/read-all/route.ts";

function fixture(body) {
  const state = { marked: [] };
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ratelimit": {
      markReadRatelimit: {},
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "me" }), isAccountAccessError: () => false },
    "@/lib/notificationOwnerAccess": {
      markOwnerNotificationsRead: async (userId, ids) => {
        state.marked.push({ userId, ids });
        return { count: ids.length };
      },
    },
    "@/lib/requestBody": {
      readOptionalBoundedJson: async () => body,
      isRequestBodyTooLargeError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (json, init) => Response.json(json, init),
      privateResponse: (response) => response,
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, Array, Set,
    require: (name) => dependencies[name],
  }, { filename: path });
  return { state, post: () => exports.POST(new Request("https://example.test/x", { method: "POST" })) };
}

test("a JSON null body is a 400, not a 500", async () => {
  const subject = fixture(null);
  assert.equal((await subject.post()).status, 400);
  assert.equal(subject.state.marked.length, 0);
});

test("an invalid id list is a 400 and does not mark everything read", async () => {
  for (const ids of [[1, 2], [""], ["x".repeat(192)], "all"]) {
    const subject = fixture({ ids });
    assert.equal((await subject.post()).status, 400, JSON.stringify(ids));
    assert.equal(subject.state.marked.length, 0);
  }
});

test("no list still means all, and a real list means those", async () => {
  const all = fixture({});
  assert.equal((await all.post()).status, 200);
  assert.equal(all.state.marked[0].ids.length, 0);

  const some = fixture({ ids: ["a", "a", "b"] });
  assert.equal((await some.post()).status, 200);
  assert.deepEqual([...some.state.marked[0].ids], ["a", "b"]);
});
