import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  collectConversationMessageAccess,
  summarizeConversationMessageAccess,
} from "../scripts/conversation-message-rls-inventory.mjs";

const EXPECTED_BASELINE = {};

describe("Conversation and Message RLS inventory", () => {
  const inventory = collectConversationMessageAccess();

  it("pins every current direct ORM and raw SQL access path", () => {
    assert.equal(inventory.ormCalls.length, 0);
    assert.equal(inventory.rawSqlReferences.length, 0);
    assert.deepEqual(summarizeConversationMessageAccess(inventory), EXPECTED_BASELINE);
  });

  it("documents every non-participant lifecycle and the production preparation boundary", () => {
    const plan = fs.readFileSync("docs/rls-conversation-message-plan.md", "utf8");
    assert.match(plan, /unresolved `MESSAGE_THREAD` report/);
    assert.match(plan, /account export/);
    assert.match(plan, /account-deletion redaction/);
    assert.match(plan, /seller response metrics/);
    assert.match(plan, /commission-interest system message/);
    assert.match(plan, /custom-order-ready/);
    assert.match(plan, /Conversation\/Message RLS remains disabled/);
    assert.match(plan, /invariant-preparation releases are live/);
    assert.match(plan, /zero policies/);
    assert.match(plan, /actual pooled production-runtime rollback-only postflight/);
  });
});
