import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  collectConversationMessageAccess,
  summarizeConversationMessageAccess,
} from "../scripts/conversation-message-rls-inventory.mjs";

const EXPECTED_BASELINE = {
  "src/app/api/account/export/route.ts": { "Message.findMany": 2 },
  "src/app/api/commission/[id]/interest/route.ts": {
    "Conversation.upsert": 1,
    "Message.create": 1,
  },
  "src/app/api/messages/[id]/list/route.ts": {
    "Conversation.findFirst": 1,
    "Message.findMany": 1,
  },
  "src/app/api/messages/[id]/read/route.ts": {
    "Conversation.findFirst": 1,
    "Message.updateMany": 1,
  },
  "src/app/api/messages/[id]/stream/route.ts": {
    "Conversation.findFirst": 1,
    "Message.findMany": 1,
  },
  "src/app/api/messages/custom-order-request/route.ts": {
    "Conversation.findUnique": 2,
    "Conversation.create": 1,
    "Conversation.update": 2,
    "Message.create": 1,
  },
  "src/app/api/messages/unread-count/route.ts": { "Message.count": 1 },
  "src/app/api/users/[id]/report/route.ts": {
    "Message.count": 1,
    "Conversation.count": 1,
  },
  "src/app/dashboard/listings/custom/page.tsx": {
    "Conversation.findFirst": 2,
    "Message.findFirst": 1,
  },
  "src/app/dashboard/orders/[id]/page.tsx": { "Conversation.findFirst": 1 },
  "src/app/messages/[id]/page.tsx": {
    "Conversation.findFirst": 5,
    "Message.findMany": 1,
    "Message.create": 2,
    "Message.findFirst": 1,
    "Conversation.updateMany": 2,
    "Conversation.update": 3,
  },
  "src/app/messages/new/page.tsx": {
    "Conversation.findUnique": 2,
    "Conversation.create": 1,
    "Conversation.update": 1,
  },
  "src/app/messages/page.tsx": {
    "Conversation.findMany": 1,
    "Message.groupBy": 1,
  },
  "src/lib/accountDeletion.ts": {
    "Message.update": 1,
    "Message.findMany": 1,
    "Message.updateMany": 1,
    "Message.raw-sql-reference": 2,
  },
  "src/lib/customOrderReadyLink.ts": {
    "Conversation.findUnique": 1,
    "Message.findFirst": 1,
    "Message.create": 1,
    "Conversation.update": 1,
  },
  "src/lib/metrics.ts": {
    "Conversation.raw-sql-reference": 1,
    "Message.raw-sql-reference": 2,
  },
};

describe("Conversation and Message RLS inventory", () => {
  const inventory = collectConversationMessageAccess();

  it("pins every current direct ORM and raw SQL access path", () => {
    assert.equal(inventory.ormCalls.length, 50);
    assert.equal(inventory.rawSqlReferences.length, 5);
    assert.deepEqual(summarizeConversationMessageAccess(inventory), EXPECTED_BASELINE);
  });

  it("documents every non-participant lifecycle before authority code is drafted", () => {
    const plan = fs.readFileSync("docs/rls-conversation-message-plan.md", "utf8");
    assert.match(plan, /unresolved `MESSAGE_THREAD` report/);
    assert.match(plan, /account export/);
    assert.match(plan, /account-deletion redaction/);
    assert.match(plan, /seller response metrics/);
    assert.match(plan, /commission-interest system message/);
    assert.match(plan, /custom-order-ready/);
    assert.match(plan, /No production SQL or RLS change has been made/);
  });
});
