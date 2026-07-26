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

  it("documents every non-participant lifecycle and the current production boundary", () => {
    const plan = fs.readFileSync("docs/rls-conversation-message-plan.md", "utf8");
    assert.match(plan, /unresolved `MESSAGE_THREAD` report/);
    assert.match(plan, /account export/);
    assert.match(plan, /account-deletion redaction/);
    assert.match(plan, /seller response metrics/);
    assert.match(plan, /commission-interest system message/);
    assert.match(plan, /custom-order-ready/);
    assert.match(
      plan,
      /initial Conversation\/Message RLS activation is live and accepted in\s+production/,
    );
    assert.match(plan, /enabled without FORCE/);
    assert.match(plan, /exactly one reviewed SELECT policy each/);
    assert.match(plan, /direct runtime\s+SELECT only/);
    assert.match(plan, /all writes behind the fixed authority functions/);
    assert.match(plan, /FORCE remains a later separate release/);
    assert.match(
      plan,
      /actual pooled `grainline_app_runtime`\s+rollback-only proof/,
    );
  });
});
