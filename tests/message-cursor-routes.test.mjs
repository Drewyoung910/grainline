import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const state = { listCalls: 0 };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "s" }) },
    "@/lib/conversationMessageAuthority": {
      getActorConversation: async () => ({ userAId: "me", userBId: "other" }),
      listActorMessages: async () => {
        state.listCalls += 1;
        throw new TypeError("message recipient RPC input is invalid");
      },
    },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "me" }), isAccountAccessError: () => false },
    "@/lib/ratelimit": {
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (json, init) => Response.json(json, init),
      privateResponse: (response) => response,
    },
    "@/lib/messagePolling": { MESSAGE_POLL_LIMIT: 200 },
    "@/lib/messageCursor": {
      parseMessageCursor: (timestamp, id, options = {}) => {
        if (!timestamp) return null;
        if (options.requireId && !id) return null;
        return { createdAt: new Date(Number(timestamp)), id: id || null };
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, URL, Date, Number,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return { state, exports };
}

const url = "https://example.test/api/messages/c/x?since=1710000000000";
const context = { params: Promise.resolve({ id: "conversation" }) };

test("the list route answers 400 for a since cursor with no id, not a 500", async () => {
  const { state, exports } = load("src/app/api/messages/[id]/list/route.ts");
  const response = await exports.GET(new Request(url), context);
  assert.equal(response.status, 400);
  assert.equal(state.listCalls, 0);
});

test("the stream refuses it too, instead of staying open and delivering nothing", async () => {
  const { exports } = load("src/app/api/messages/[id]/stream/route.ts");
  const response = await exports.GET(new Request(url), context);
  assert.equal(response.status, 400);
});
