import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Conversation and Message pre-RLS audit guardrails", () => {
  it("keeps the new-conversation GET read-only and creation explicit", () => {
    const page = source("src/app/messages/new/page.tsx");
    assert.doesNotMatch(page, /conversation\.(?:create|update|updateMany|upsert)/);
    assert.match(page, /<ActionForm action=\{startConversation\}>/);
    assert.match(page, /startConversationForUser/);
    assert.match(page, /conversationStartRatelimit/);
    assert.match(page, /created only when you continue/);
  });

  it("serializes conversation creation with block and account lifecycle changes", () => {
    const access = source("src/lib/conversationStartAccess.ts");
    assert.match(access, /TransactionIsolationLevel\.ReadCommitted/);
    assert.match(access, /ORDER BY start_user\.id\s+FOR SHARE/);
    assert.match(access, /block\.findFirst/);
    assert.match(access, /pg_advisory_xact_lock/);
    assert.ok(
      access.indexOf("FOR SHARE") < access.indexOf("block.findFirst"),
      "pair locks must precede the reciprocal block absence check",
    );
    assert.ok(
      access.indexOf("block.findFirst") < access.indexOf("conversation.create"),
      "conversation creation must follow the locked block check",
    );
  });

  it("records every open pre-RLS finding and bars authority SQL until fixes land", () => {
    const audit = source("docs/conversation-message-pre-rls-audit.md");
    for (let finding = 1; finding <= 10; finding += 1) {
      assert.match(audit, new RegExp(`CM-A${String(finding).padStart(2, "0")}`));
    }
    assert.match(audit, /no Conversation or Message RLS SQL has been drafted, applied or deployed/);
    assert.match(audit, /Only then may Extra High review accept policy\/function SQL/);
  });
});
