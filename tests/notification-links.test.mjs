import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { safeNotificationPath } = await import("../src/lib/notificationLinks.ts");

describe("notification links", () => {
  it("allows internal paths with query strings and hashes", () => {
    assert.equal(safeNotificationPath("/account?tab=notifications#latest"), "/account?tab=notifications#latest");
  });

  it("rejects external, scheme, protocol-relative, and backslash links", () => {
    assert.equal(safeNotificationPath("https://example.com/account"), null);
    assert.equal(safeNotificationPath("javascript:alert(1)"), null);
    assert.equal(safeNotificationPath("//example.com/account"), null);
    assert.equal(safeNotificationPath("/\\example.com"), null);
  });
});
