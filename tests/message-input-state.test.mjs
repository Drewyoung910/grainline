import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  messageRouteId,
  messageSearchQuery,
  messageSearchQueryIsWithinBounds,
} from "../src/lib/messageInputState.ts";
import { userRelationshipTargetState } from "../src/lib/userRelationshipAccess.ts";

test("message route ids reject malformed values before an authority call", () => {
  assert.equal(messageRouteId("listing-ok_1"), "listing-ok_1");
  assert.equal(messageRouteId("a b"), null);
  assert.equal(messageRouteId(""), null);
  assert.equal(messageRouteId("x".repeat(192)), null);
});

test("message inbox search is bounded by Unicode code points", () => {
  assert.equal(Array.from(messageSearchQuery(`  ${"😀".repeat(250)}  `)).length, 200);
  assert.equal(messageSearchQueryIsWithinBounds("😀".repeat(200)), true);
  assert.equal(messageSearchQueryIsWithinBounds("😀".repeat(201)), false);
});

test("relationship lookup rejects malformed and self targets without querying", async () => {
  let queries = 0;
  const client = {
    async $queryRaw() {
      queries += 1;
      return [];
    },
  };

  assert.equal(await userRelationshipTargetState(client, {
    actorId: "user-a",
    targetId: "a b",
  }), null);
  assert.equal(await userRelationshipTargetState(client, {
    actorId: "user-a",
    targetId: "user-a",
  }), null);
  assert.equal(queries, 0);
});

test("the inbox and its database wrapper share the code-point boundary", () => {
  const page = readFileSync("src/app/messages/page.tsx", "utf8");
  const authority = readFileSync("src/lib/conversationMessageAuthority.ts", "utf8");
  assert.match(page, /messageSearchQuery\(qParam\)/);
  assert.match(authority, /messageSearchQueryIsWithinBounds\(query\)/);
});
