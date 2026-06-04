import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  accountEmailFallbackEmailsForUser,
  accountEmailSuppressionKeysForEmails,
  uniqueAccountEmailAddresses,
} = await import("../src/lib/userEmailAddresses.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("user email address history", () => {
  it("keeps durable account email identity exact-normalized", () => {
    assert.deepEqual(
      uniqueAccountEmailAddresses([
        " Buyer@Example.com ",
        "old@example.com",
        "buyer@example.com",
        null,
      ]),
      ["buyer@example.com", "old@example.com"],
    );

    assert.deepEqual(
      uniqueAccountEmailAddresses(["First.Last+tag@gmail.com"]),
      ["first.last+tag@gmail.com"],
    );
  });

  it("expands Gmail aliases only for suppression-key lookups", () => {
    assert.deepEqual(
      accountEmailSuppressionKeysForEmails([
        "First.Last+tag@gmail.com",
        "old@example.com",
      ]),
      ["first.last+tag@gmail.com", "firstlast@gmail.com", "old@example.com"],
    );
  });

  it("does not use historical emails currently claimed by another active account for email-keyed fallbacks", async () => {
    const client = {
      user: {
        findMany: async (query) => {
          assert.deepEqual(query.where, {
            id: { not: "user_1" },
            deletedAt: null,
            OR: [{ email: { in: ["old@example.com", "current@example.com"] } }],
          });
          assert.deepEqual(query.select, { email: true });
          return [{ email: "old@example.com" }];
        },
      },
    };

    assert.deepEqual(
      await accountEmailFallbackEmailsForUser(client, {
        userId: "user_1",
        emails: ["old@example.com", "current@example.com", "old@example.com"],
      }),
      ["current@example.com"],
    );
  });

  it("does not use historical Gmail aliases whose suppression key belongs to another active account", async () => {
    const client = {
      user: {
        findMany: async (query) => {
          assert.equal(query.where.id.not, "user_1");
          assert.equal(query.where.deletedAt, null);
          assert.deepEqual(query.select, { email: true });
          assert.deepEqual(query.where.OR, [
            {
              email: {
                in: [
                  "first.last+tag@gmail.com",
                  "woodworker@example.com",
                  "firstlast@gmail.com",
                ],
              },
            },
            { email: { endsWith: "@gmail.com" } },
            { email: { endsWith: "@googlemail.com" } },
          ]);
          return [{ email: "firstlast@gmail.com" }];
        },
      },
    };

    assert.deepEqual(
      await accountEmailFallbackEmailsForUser(client, {
        userId: "user_1",
        emails: ["First.Last+tag@gmail.com", "woodworker@example.com"],
      }),
      ["woodworker@example.com"],
    );
  });

  it("stores conservative user-owned history without inferring from email-only tables", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260604173000_user_email_address_history/migration.sql",
    );

    assert.match(schema, /emailAddresses UserEmailAddress\[\]/);
    assert.match(schema, /model UserEmailAddress \{/);
    assert.match(schema, /@@unique\(\[userId, email\]\)/);
    assert.match(schema, /@@index\(\[email\]\)/);
    assert.match(schema, /@@index\(\[userId, isCurrent\]\)/);

    assert.match(migration, /CREATE TABLE "UserEmailAddress"/);
    assert.match(migration, /FROM "User" u/);
    assert.match(migration, /FROM "EmailOutbox" e/);
    assert.match(migration, /WHERE e\."userId" IS NOT NULL/);
    assert.doesNotMatch(migration, /FROM "EmailSuppression"/);
    assert.doesNotMatch(migration, /FROM "NewsletterSubscriber"/);
  });

  it("captures current and previous emails when Clerk refreshes account state", () => {
    const ensureUser = source("src/lib/ensureUser.ts");

    assert.match(
      ensureUser,
      /import \{ syncUserEmailAddressHistory \} from "@\/lib\/userEmailAddresses"/,
    );
    assert.match(ensureUser, /previousEmail: existing\.email/);
    assert.match(ensureUser, /currentEmail: updateData\.email/);
    assert.match(ensureUser, /source: "ensure_user"/);
    assert.match(ensureUser, /source: "ensure_user_create"/);
    assert.match(ensureUser, /source: "ensure_user_create_email_conflict"/);
    assert.match(ensureUser, /droppedField: "email"/);
  });

  it("uses only Clerk primary email when request-time helpers create or refresh users", () => {
    const ensureUser = source("src/lib/ensureUser.ts");
    const ensureSeller = source("src/lib/ensureSeller.ts");
    const ensureUserWrapperStart = ensureUser.indexOf(
      "export async function ensureUser()",
    );
    assert.notEqual(ensureUserWrapperStart, -1);
    const ensureUserWrapper = ensureUser.slice(ensureUserWrapperStart);

    assert.match(ensureUserWrapper, /primaryEmailAddressId/);
    assert.match(
      ensureUserWrapper,
      /\.\.\.\(primaryEmail \? \{ email: primaryEmail \} : \{\}\)/,
    );
    assert.doesNotMatch(ensureUserWrapper, /emailAddresses\?\.\[0\]/);
    assert.doesNotMatch(ensureUserWrapper, /placeholder\.invalid/);

    assert.match(
      ensureSeller,
      /import \{ AccountAccessError, ensureUserByClerkId \} from "@\/lib\/ensureUser"/,
    );
    assert.match(ensureSeller, /ensureUserByClerkId\(userId/);
    assert.match(ensureSeller, /primaryEmailAddressId/);
    assert.doesNotMatch(ensureSeller, /prisma\.user\.create/);
    assert.doesNotMatch(ensureSeller, /emailAddresses\?\.\[0\]/);
  });
});
