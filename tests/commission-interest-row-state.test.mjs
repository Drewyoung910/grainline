import assert from "node:assert/strict";
import { test } from "node:test";

const { commissionInterestCreatedIdsMatch } = await import("../src/lib/commissionInterestRowState.ts");

const proposed = { messageId: "m-new", commissionInterestId: "i-new" };

test("a new interest in an existing conversation is valid (LAB-03)", () => {
  assert.equal(commissionInterestCreatedIdsMatch(
    { created: true, conversationId: "existing-thread", messageId: "m-new", commissionInterestId: "i-new" },
    proposed,
  ), true);
});

test("a created row must carry the proposed message and interest ids", () => {
  assert.equal(commissionInterestCreatedIdsMatch({ created: true, messageId: "other", commissionInterestId: "i-new" }, proposed), false);
  assert.equal(commissionInterestCreatedIdsMatch({ created: true, messageId: "m-new", commissionInterestId: "other" }, proposed), false);
});

test("a replay of an existing interest returns old ids", () => {
  assert.equal(commissionInterestCreatedIdsMatch({ created: false, messageId: "old", commissionInterestId: "old" }, proposed), true);
});
