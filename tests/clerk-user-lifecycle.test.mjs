import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { shouldRevokeSessionsForClerkEmailChange } = await import("../src/lib/clerkSessionSecurity.ts");
const { resolveClerkWebhookPrimaryEmail, shouldReserveClerkWelcomeEmail } = await import(
  "../src/lib/clerkWebhookEmail.ts"
);

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

describe("Clerk webhook email resolution", () => {
  it("uses only the Clerk primary email address", () => {
    assert.deepEqual(
      resolveClerkWebhookPrimaryEmail({
        primaryEmailAddressId: "email_primary",
        emailAddresses: [
          { id: "email_old", email_address: "old@example.com" },
          { id: "email_primary", email_address: " primary@example.com " },
        ],
      }),
      { reason: "resolved", email: "primary@example.com" },
    );
  });

  it("does not fall back to another email when the primary id is absent", () => {
    assert.deepEqual(
      resolveClerkWebhookPrimaryEmail({
        primaryEmailAddressId: "email_missing",
        emailAddresses: [{ id: "email_other", email_address: "other@example.com" }],
      }),
      { reason: "primary_email_not_found", email: null },
    );
  });

  it("requires a primary email id and non-empty primary address", () => {
    assert.deepEqual(
      resolveClerkWebhookPrimaryEmail({
        primaryEmailAddressId: null,
        emailAddresses: [{ id: "email_one", email_address: "one@example.com" }],
      }),
      { reason: "missing_primary_email_id", email: null },
    );

    assert.deepEqual(
      resolveClerkWebhookPrimaryEmail({
        primaryEmailAddressId: "email_empty",
        emailAddresses: [{ id: "email_empty", email_address: " " }],
      }),
      { reason: "primary_email_empty", email: null },
    );
  });
});

describe("Clerk webhook welcome email reservation", () => {
  it("reserves only user.created events with a resolved email and no prior welcome timestamp", () => {
    assert.equal(
      shouldReserveClerkWelcomeEmail({
        eventType: "user.created",
        email: "person@example.com",
        welcomeEmailSentAt: null,
      }),
      true,
    );
    assert.equal(
      shouldReserveClerkWelcomeEmail({
        eventType: "user.updated",
        email: "person@example.com",
        welcomeEmailSentAt: null,
      }),
      false,
    );
    assert.equal(
      shouldReserveClerkWelcomeEmail({
        eventType: "user.created",
        email: null,
        welcomeEmailSentAt: null,
      }),
      false,
    );
    assert.equal(
      shouldReserveClerkWelcomeEmail({
        eventType: "user.created",
        email: "person@example.com",
        welcomeEmailSentAt: new Date("2026-04-30T12:00:00Z"),
      }),
      false,
    );
  });
});
