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
      /Conversation\/Message RLS and its separate FORCE-only hardening are live\s+and accepted in production/,
    );
    assert.match(plan, /FORCE-only hardening are live\s+and accepted in production/);
    assert.match(plan, /enabled\s+and forced/);
    assert.match(plan, /exactly\s+one reviewed SELECT policy each/);
    assert.match(plan, /direct runtime\s+SELECT only/);
    assert.match(plan, /all writes\s+behind the fixed authority functions/);
    assert.match(plan, /Protected run\s+`30207825683`/);
    assert.match(plan, /actual pooled-runtime\s+`--post-force` run proved/);
    assert.match(
      plan,
      /72aa2e27cb121e1cb5e30736f4a6fecca4b80db3e7f30ba6a8f20c9b889a6a5e/,
    );
    assert.match(
      plan,
      /actual pooled `grainline_app_runtime`\s+rollback-only proof/,
    );
  });
});
