import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("conversation participant pair guardrails", () => {
  it("keeps a raw unordered unique index for conversation participant pairs", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260524023000_conversation_unordered_pair_index/migration.sql");

    assert.match(schema, /raw migration also[\s\S]{0,160}LEAST\/GREATEST/);
    assert.match(schema, /@@unique\(\[userAId, userBId\]\)/);

    assert.match(migration, /Duplicate unordered Conversation participant pairs exist/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_unordered_user_pair_key"/);
    assert.match(migration, /LEAST\("userAId", "userBId"\)/);
    assert.match(migration, /GREATEST\("userAId", "userBId"\)/);
  });

  it("keeps normal conversation creation paths on canonical participant order", () => {
    const messagesNew = source("src/app/messages/new/page.tsx");
    const customOrder = source("src/app/api/messages/custom-order-request/route.ts");
    const commissionInterest = source("src/app/api/commission/[id]/interest/route.ts");

    assert.match(messagesNew, /const \[a, b\] = \[me\.id, other\.id\]\.sort/);
    assert.match(messagesNew, /data: \{ userAId: a, userBId: b/);
    assert.match(messagesNew, /where: \{ userAId_userBId: \{ userAId: a, userBId: b \} \}/);

    assert.match(customOrder, /const \[a, b\] = \[me\.id, sellerUserId\]\.sort/);
    assert.match(customOrder, /userAId: a,\s+userBId: b/s);
    assert.match(customOrder, /where: \{ userAId_userBId: \{ userAId: a, userBId: b \} \}/);

    assert.match(commissionInterest, /const \[a, b\] = \[me\.id, buyerUserId\]\.sort/);
    assert.match(commissionInterest, /where: \{ userAId_userBId: \{ userAId: a, userBId: b \} \}/);
    assert.match(commissionInterest, /create: \{ userAId: a, userBId: b \}/);
  });
});
