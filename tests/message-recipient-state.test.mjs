import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { messagingUnavailableReason } = await import("../src/lib/messageRecipientState.ts");

describe("message recipient state", () => {
  it("allows replies to active recipients", () => {
    assert.equal(messagingUnavailableReason({ banned: false, deletedAt: null }), null);
  });

  it("blocks replies to missing, banned, or deleted recipients", () => {
    const copy = "This account is no longer available. Messages are preserved, but new replies are disabled.";

    assert.equal(messagingUnavailableReason(null), copy);
    assert.equal(messagingUnavailableReason({ banned: true, deletedAt: null }), copy);
    assert.equal(messagingUnavailableReason({ banned: false, deletedAt: new Date("2026-04-30") }), copy);
  });
});
