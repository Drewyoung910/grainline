import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const { shouldRevokeSessionsForClerkEmailChange } = await import("../src/lib/clerkSessionSecurity.ts");
const {
  clerkCurrentUserIdentityFromSnapshot,
  clerkPlaceholderEmail,
  isClerkUserNotFoundError,
} = await import("../src/lib/clerkCurrentUserIdentity.ts");
const { revokeActiveClerkSessions } = await import("../src/lib/clerkSessionRevocation.ts");
const { normalizeClerkWebhookEmail, resolveClerkWebhookPrimaryEmail, shouldReserveClerkWelcomeEmail } = await import(
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
    assert.equal(
      shouldRevokeSessionsForClerkEmailChange({
        eventType: "user.updated",
        clerkUserId: "user_2NNEqMixed",
        previousEmail: clerkPlaceholderEmail("user_2NNEqMixed"),
        nextEmail: "person@example.com",
      }),
      false,
    );
  });
});

describe("Clerk current user state", () => {
  it("derives normalized identity from current provider state", () => {
    assert.deepEqual(
      clerkCurrentUserIdentityFromSnapshot({
        id: "user_123",
        firstName: "Drew",
        lastName: "Young",
        imageUrl: "https://img.example/user.png",
        primaryEmailAddressId: "email_primary",
        emailAddresses: [
          { id: "email_old", emailAddress: "old@example.com" },
          { id: "email_primary", emailAddress: " Person@Example.COM " },
        ],
      }, "user_123"),
      {
        clerkId: "user_123",
        firstName: "Drew",
        lastName: "Young",
        imageUrl: "https://img.example/user.png",
        primaryEmail: "person@example.com",
        emailResolution: "resolved",
      },
    );
  });

  it("reports a missing current primary email without turning it into an update value", () => {
    const clerkId = "user_2NNEqMixedNoEmail";
    const identity = clerkCurrentUserIdentityFromSnapshot({
      id: clerkId,
      firstName: null,
      lastName: null,
      imageUrl: "",
      primaryEmailAddressId: null,
      emailAddresses: [],
    }, clerkId);
    assert.equal(identity.primaryEmail, null);
    assert.equal(identity.emailResolution, "missing_primary_email_id");
    assert.equal(Object.hasOwn(identity, "emailForPersistence"), false);
    assert.match(
      clerkPlaceholderEmail(clerkId),
      /^user_2nneqmixednoemail-[a-f0-9]{32}@placeholder\.invalid$/,
    );
    assert.throws(
      () => clerkCurrentUserIdentityFromSnapshot({ ...identity, id: "wrong" }, clerkId),
      /wrong account/,
    );
  });

  it("classifies only Clerk API 404 responses as terminal absent users", () => {
    assert.equal(
      isClerkUserNotFoundError({ clerkError: true, status: 404 }),
      true,
    );
    assert.equal(
      isClerkUserNotFoundError({ clerkError: true, status: 503 }),
      false,
    );
    assert.equal(isClerkUserNotFoundError(Object.assign(new Error("not found"), { status: 404 })), false);
  });
});

describe("Clerk session revocation bounds", () => {
  function fakeClerk(sessionCount) {
    const active = new Set(Array.from({ length: sessionCount }, (_, index) => `sess_${index}`));
    const calls = [];
    let inFlight = 0;
    let maxInFlight = 0;
    return {
      active,
      calls,
      get maxInFlight() { return maxInFlight; },
      client: {
        sessions: {
          async getSessionList(input) {
            calls.push(input);
            return {
              data: [...active].slice(input.offset, input.offset + input.limit).map((id) => ({ id })),
              totalCount: active.size,
            };
          },
          async revokeSession(id) {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setImmediate(resolve));
            active.delete(id);
            inFlight -= 1;
          },
        },
      },
    };
  }

  it("drains active sessions from offset zero with bounded concurrency", async () => {
    const clerk = fakeClerk(235);
    assert.deepEqual(
      await revokeActiveClerkSessions(clerk.client, "user_123"),
      { revokedSessionCount: 235 },
    );
    assert.equal(clerk.active.size, 0);
    assert.ok(clerk.calls.every((call) => call.offset === 0));
    assert.ok(clerk.maxInFlight <= 10);
  });

  it("fails retryably instead of scanning an unbounded account", async () => {
    const clerk = fakeClerk(501);
    await assert.rejects(
      () => revokeActiveClerkSessions(clerk.client, "user_123"),
      /per-attempt limit/,
    );
    assert.equal(clerk.active.size, 1);
  });
});

describe("Clerk webhook email resolution", () => {
  it("normalizes Clerk primary emails before persistence", () => {
    assert.equal(normalizeClerkWebhookEmail("  Dre\u0301w@Example.COM "), "dr\u00e9w@example.com");
    assert.equal(normalizeClerkWebhookEmail("not-an-email"), null);
  });

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

  it("falls back to the durable email outbox if direct welcome sends fail", () => {
    const route = source("src/app/api/clerk/webhook/route.ts");
    const email = source("src/lib/email.ts");

    assert.match(email, /export function renderWelcomeBuyerEmail/);
    assert.match(email, /export function renderWelcomeSellerEmail/);
    assert.match(route, /sendRenderedEmail\(buyerWelcomeEmail, \{ throwOnFailure: true \}\)/);
    assert.match(route, /sendRenderedEmail\(sellerWelcomeEmail, \{ throwOnFailure: true \}\)/);
    assert.match(route, /reserveUserClerkWelcomeEmail\(prisma, \{\s*clerkId: id,\s*userId: user\.id/);
    assert.match(route, /enqueueWelcomeFallbackEmail\(buyerWelcomeEmail, `welcome-buyer:\$\{user\.id\}`, user\.id\)/);
    assert.match(route, /enqueueWelcomeFallbackEmail\(sellerWelcomeEmail, `welcome-seller:\$\{user\.id\}`, user\.id\)/);
    assert.match(route, /source: "clerk_webhook_welcome_email_outbox"/);
  });
});
