import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { shouldRevokeSessionsForClerkEmailChange } = await import("../src/lib/clerkSessionSecurity.ts");

describe("Clerk user lifecycle session security", () => {
  it("revokes sessions for real primary email changes on user.updated", () => {
    assert.equal(
      shouldRevokeSessionsForClerkEmailChange({
        eventType: "user.updated",
        clerkUserId: "user_123",
        previousEmail: "old@example.com",
        nextEmail: "new@example.com",
      }),
      true,
    );
  });

  it("ignores casing-only email changes and non-update events", () => {
    assert.equal(
      shouldRevokeSessionsForClerkEmailChange({
        eventType: "user.updated",
        clerkUserId: "user_123",
        previousEmail: " Person@Example.com ",
        nextEmail: "person@example.com",
      }),
      false,
    );
    assert.equal(
      shouldRevokeSessionsForClerkEmailChange({
        eventType: "user.created",
        clerkUserId: "user_123",
        previousEmail: "old@example.com",
        nextEmail: "new@example.com",
      }),
      false,
    );
  });

  it("does not revoke when replacing a placeholder email during first sync", () => {
    assert.equal(
      shouldRevokeSessionsForClerkEmailChange({
        eventType: "user.updated",
        clerkUserId: "user_123",
        previousEmail: "user_123@placeholder.invalid",
        nextEmail: "person@example.com",
      }),
      false,
    );
  });
});
