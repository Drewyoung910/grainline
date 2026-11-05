import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

import { privateJson, privateResponse } from "../src/lib/privateResponse.ts";

const routePath = "src/app/api/messages/inbox/route.ts";

function row(index, { unreadCount = 0, latestFromMe = false } = {}) {
  return {
    id: `conversation-${index}`,
    userAId: "me",
    userA: { id: "me", name: "Me", imageUrl: null },
    userB: { id: `user-${index}`, name: `User ${index}`, imageUrl: null },
    latestMessage: { senderId: latestFromMe ? "me" : `user-${index}`, body: "Hello", kind: null, createdAt: new Date(0) },
    unreadCount,
  };
}

async function get(rows, totalUnread, search = "") {
  const javascript = ts.transpileModule(readFileSync(routePath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-me" }) },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/conversationMessageAuthority": {
      listActorConversationInbox: async () => rows,
      countActorUnreadMessages: async () => totalUnread,
    },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "me" }) },
    "@/lib/messageInputState": { messageSearchQuery: (value) => value ?? "" },
    "@/lib/messageSnippet": { formatSnippet: (body) => body },
    "@/lib/privateResponse": { privateJson, privateResponse },
    "@/lib/ratelimit": {
      messageInboxRatelimit: {},
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/sanitize": { truncateText: (value) => value },
    "@/lib/sellerProfileParticipantAccess": { sellerConversationParticipantCards: async () => [] },
  };
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    URL,
    URLSearchParams,
    Request,
    Response,
    Map,
    Set,
    Array,
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: routePath });
  return (await exports.GET(new Request(`https://example.test/api/messages/inbox${search}`))).json();
}

test("the unread badge counts every conversation, not the newest page", async () => {
  const rows = Array.from({ length: 31 }, (_, index) => row(index));
  const body = await get(rows, 7, "?tab=unread");
  assert.equal(body.unreadTotal, 7);
  // None of the newest page is unread, and older pages may still be: the rail
  // needs hasMore to avoid claiming the visitor is all caught up.
  assert.equal(body.conversations.length, 0);
  assert.equal(body.hasMore, true);
});

test("the awaiting-reply count says when it stopped at the newest page", async () => {
  const short = await get([row(1, { latestFromMe: true })], 0);
  assert.equal(short.awaitingReplyTotal, 1);
  assert.equal(short.awaitingReplyMore, false);

  const long = await get(Array.from({ length: 31 }, (_, index) => row(index, { latestFromMe: index === 0 })), 0);
  assert.equal(long.awaitingReplyMore, true);
});
