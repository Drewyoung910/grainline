import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { stockNotificationSubscribedFromResponse } = await import("../src/lib/stockNotificationState.ts");

describe("stock notification response state", () => {
  it("trusts the server subscription state when present", () => {
    assert.equal(stockNotificationSubscribedFromResponse({ subscribed: true }, false), true);
    assert.equal(stockNotificationSubscribedFromResponse({ subscribed: false }, true), false);
  });

  it("falls back to the optimistic state for malformed legacy responses", () => {
    assert.equal(stockNotificationSubscribedFromResponse({}, true), true);
    assert.equal(stockNotificationSubscribedFromResponse(null, false), false);
  });
});
