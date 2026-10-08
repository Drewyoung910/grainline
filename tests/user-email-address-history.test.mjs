import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  accountEmailFallbackEmailsForUser,
  accountEmailSuppressionKeysForEmails,
  syncUserEmailAddressHistory,
  uniqueAccountEmailAddresses,
} = await import("../src/lib/userEmailAddresses.ts");

const userClerkIdentityMigrationPath =
  process.env.USER_CLERK_IDENTITY_MIGRATION_PATH
  ?? "prisma/migrations/20261007155000_correct_user_clerk_identity_placeholder/migration.sql";

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
    let query;
    const client = {
      $queryRaw: async (strings, ...values) => {
        query = { sql: strings.join("?"), values };
        return [{ email: "current@example.com" }];
      },
    };

    assert.deepEqual(
      await accountEmailFallbackEmailsForUser(client),
      ["current@example.com"],
    );
    assert.match(query.sql, /grainline_user_email_fallback_addresses\(\)/);
    assert.deepEqual(query.values, []);
  });

  it("does not use historical Gmail aliases whose suppression key belongs to another active account", async () => {
    let query;
    const client = {
      $queryRaw: async (strings, ...values) => {
        query = { sql: strings.join("?"), values };
        return [{ email: "woodworker@example.com" }];
      },
    };

    assert.deepEqual(
      await accountEmailFallbackEmailsForUser(client),
      ["woodworker@example.com"],
    );
    assert.match(query.sql, /grainline_user_email_fallback_addresses\(\)/);
    assert.deepEqual(query.values, []);
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

  it("routes sync through the serialized authority and preserves the current claim epoch", async () => {
    let query;
    const client = {
      $queryRaw: async (strings, ...values) => {
        query = { sql: strings.join("?"), values };
        return [{ syncedCount: 1 }];
      },
    };
    assert.deepEqual(await syncUserEmailAddressHistory(client, {
      userId: "user_1",
      previousEmail: " Old@Example.com ",
      currentEmail: " Current@Example.com ",
      source: "x".repeat(90),
    }), ["old@example.com", "current@example.com"]);
    assert.match(query.sql, /grainline_user_email_address_sync/);
    assert.deepEqual(query.values, [
      "user_1",
      "current@example.com",
      "x".repeat(80),
    ]);

    const authority = source(
      "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
    );
    assert.match(authority, /FROM public\."User" AS account_user[\s\S]*FOR UPDATE/);
    assert.match(authority, /WHEN "UserEmailAddress"\."isCurrent"[\s\S]*THEN "UserEmailAddress"\."currentSinceAt"[\s\S]*ELSE EXCLUDED\."currentSinceAt"/);
  });

  it("captures current and previous emails when Clerk refreshes account state", () => {
    const ensureUser = source("src/lib/ensureUser.ts");
    const identityAuthority = source(userClerkIdentityMigrationPath);

    assert.match(
      ensureUser,
      /import \{ ensureUserIdentityByClerkId \} from "@\/lib\/userIdentityAccess"/,
    );
    assert.match(ensureUser, /ensureUserIdentityByClerkId\(tx, identity\)/);
    assert.match(identityAuthority, /grainline_user_email_address_sync/);
    assert.match(identityAuthority, /'ensure_user'/);
    assert.match(identityAuthority, /'ensure_user_create'/);
    assert.match(identityAuthority, /'ensure_user_create_email_conflict'/);
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
