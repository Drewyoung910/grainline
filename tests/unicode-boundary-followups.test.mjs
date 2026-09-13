import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("unicode boundary follow-ups", () => {
  it("derives avatar initials by code point instead of UTF-16 code unit", () => {
    const helper = source("src/lib/avatarInitials.ts");
    const userAvatar = source("src/components/UserAvatarMenu.tsx");
    const header = source("src/components/Header.tsx");

    assert.match(helper, /sanitizeUserName/);
    assert.match(helper, /Array\.from\(cleaned\)\[0\]/);
    assert.match(helper, /Array\.from\(part\)\[0\]/);
    assert.doesNotMatch(userAvatar, /charAt\(0\)/);
    assert.doesNotMatch(header, /charAt\(0\)/);
    assert.match(userAvatar, /avatarInitial\(displayName\)/);
    assert.match(header, /avatarInitial\(name, "A"\)/);
  });

  it("normalizes saved-search query text through sanitizeText", () => {
    const savedSearch = source("src/app/api/search/saved/route.ts");
    assert.match(savedSearch, /import \{ sanitizeText, truncateText \} from "@\/lib\/sanitize"/);
    assert.match(savedSearch, /truncateText\(sanitizeText\(q\)\.replace\(\/\\s\+\/g, " "\), 200\)/);
  });

  it("binds durable order snapshot strings to the database-verified checkout source", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const authority = source("docs/rls-drafts/order-paid-checkout-authority.sql");
    assert.doesNotMatch(webhook, /(?:prisma|tx)\.orderItem\.create/);
    assert.match(authority, /'title', source_item#>>'\{listing,title\}'/);
    assert.match(authority, /'description', source_item#>>'\{listing,description\}'/);
    assert.match(authority, /'sellerName', source_snapshot#>>'\{seller,displayName\}'/);
    assert.match(authority, /source_listing_snapshot := pg_catalog\.jsonb_build_object/);
  });

  it("uses bounded short-name redaction without broad Notification text authority", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const redaction = source("src/lib/accountDeletionAuditRedaction.ts");
    const caseRedaction = source(
      "prisma/migrations/20260729061000_prepare_case_account_deletion_authority/migration.sql",
    );
    assert.match(deletion, /Array\.from\(item\)\.length >= 2/);
    assert.match(
      caseRedaction,
      /pg_catalog\.char_length\(\s*pg_catalog\.lower\(pg_catalog\.btrim\(value\)\)\s*\)\s*>= 2/,
    );
    assert.match(
      caseRedaction,
      /public\.grainline_account_deletion_redact_text_core\(\s*message\.body,\s*sensitive_values\s*\)/,
    );
    assert.doesNotMatch(deletion, /notificationTextMatchSql|redactNotificationsAboutDeletedAccount/);
    assert.match(deletion, /deleteAccountNotificationServiceRows\(tx, user\.id\)/);
    assert.match(redaction, /Array\.from\(value\)\.length >= 2/);
    assert.match(redaction, /redactionPatternForNeedle\(needle\)/);
  });
});
