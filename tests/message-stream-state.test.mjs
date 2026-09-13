import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { isTerminalMessageStreamStatus, messageStreamStatusMessage } = await import("../src/lib/messageStreamState.ts");

describe("message stream state", () => {
  it("stops fallback polling on auth/rate-limit statuses", () => {
    assert.equal(isTerminalMessageStreamStatus(401), true);
    assert.equal(isTerminalMessageStreamStatus(403), true);
    assert.equal(isTerminalMessageStreamStatus(429), true);
    assert.equal(isTerminalMessageStreamStatus(500), false);
  });

  it("maps terminal statuses to user-facing copy", () => {
    assert.match(messageStreamStatusMessage(401), /Sign in/);
    assert.match(messageStreamStatusMessage(403), /no longer available/);
    assert.match(messageStreamStatusMessage(429), /rate limited/);
  });
});
