import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  accountEmailFallbackEmailsForUser,
  accountEmailSuppressionKeysForEmails,
  syncUserEmailAddressHistory,
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
    assert.match(schema, /currentSinceAt\s+DateTime\s+@default\(now\(\)\)/);
    assert.match(schema, /@@unique\(\[userId, email\]\)/);
    assert.match(schema, /@@index\(\[email\]\)/);
    assert.match(schema, /@@index\(\[userId, isCurrent\]\)/);

    assert.match(migration, /CREATE TABLE "UserEmailAddress"/);
    assert.match(migration, /FROM "User" u/);
    assert.match(migration, /FROM "EmailOutbox" e/);
    assert.match(migration, /WHERE e\."userId" IS NOT NULL/);
    assert.doesNotMatch(migration, /FROM "EmailSuppression"/);
    assert.doesNotMatch(migration, /FROM "NewsletterSubscriber"/);

    const claimEpochMigration = source(
      "prisma/migrations/20260621051000_email_claim_epoch_and_suppression_keys/migration.sql",
    );
    assert.match(claimEpochMigration, /ADD COLUMN "currentSinceAt" TIMESTAMP\(3\)/);
    assert.match(claimEpochMigration, /WHEN "isCurrent" THEN "firstSeenAt"/);
    assert.match(claimEpochMigration, /ALTER COLUMN "currentSinceAt" SET NOT NULL/);
  });

  it("stamps currentSinceAt only when an email becomes current again", async () => {
    const rows = new Map();
    const keyFor = (where) => `${where.userId_email.userId}:${where.userId_email.email}`;
    const client = {
      userEmailAddress: {
        updateMany: async ({ where, data }) => {
          let count = 0;
          for (const row of rows.values()) {
            const emailMatches =
              where.email?.not !== undefined
                ? row.email !== where.email.not
                : where.email === undefined || row.email === where.email;
            const currentMatches =
              where.isCurrent === undefined || row.isCurrent === where.isCurrent;
            if (row.userId === where.userId && emailMatches && currentMatches) {
              Object.assign(row, data);
              count += 1;
            }
          }
          return { count };
        },
        upsert: async ({ where, create, update }) => {
          const key = keyFor(where);
          const existing = rows.get(key);
          if (existing) Object.assign(existing, update);
          else rows.set(key, { ...create });
          return rows.get(key);
        },
        findUnique: async ({ where, select }) => {
          const row = rows.get(keyFor(where));
          if (!row) return null;
          return Object.fromEntries(Object.keys(select).map((field) => [field, row[field]]));
        },
        update: async ({ where, data }) => {
          const row = rows.get(keyFor(where));
          assert.ok(row);
          Object.assign(row, data);
          return row;
        },
        create: async ({ data }) => {
          rows.set(`${data.userId}:${data.email}`, { ...data });
          return data;
        },
      },
    };

    const first = new Date("2026-06-01T00:00:00.000Z");
    const second = new Date("2026-06-02T00:00:00.000Z");
    const third = new Date("2026-06-03T00:00:00.000Z");

    await syncUserEmailAddressHistory(client, {
      userId: "user_1",
      currentEmail: "a@example.com",
      source: "test",
      now: first,
    });
    await syncUserEmailAddressHistory(client, {
      userId: "user_1",
      previousEmail: "a@example.com",
      currentEmail: "b@example.com",
      source: "test",
      now: second,
    });
    await syncUserEmailAddressHistory(client, {
      userId: "user_1",
      previousEmail: "b@example.com",
      currentEmail: "a@example.com",
      source: "test",
      now: third,
    });

    assert.equal(rows.get("user_1:a@example.com").isCurrent, true);
    assert.equal(rows.get("user_1:a@example.com").firstSeenAt.toISOString(), first.toISOString());
    assert.equal(rows.get("user_1:a@example.com").lastSeenAt.toISOString(), third.toISOString());
    assert.equal(rows.get("user_1:a@example.com").currentSinceAt.toISOString(), third.toISOString());
    assert.equal(rows.get("user_1:b@example.com").isCurrent, false);
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
