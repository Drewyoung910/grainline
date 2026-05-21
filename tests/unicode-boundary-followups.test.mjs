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

  it("defensively sanitizes durable Stripe order snapshot strings", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    assert.match(webhook, /function snapshotText\(value: string \| null \| undefined, maxLength: number\)/);
    assert.match(webhook, /function snapshotSellerName\(value: string \| null \| undefined\)/);
    assert.match(webhook, /title: snapshotText\(listing\.title, 200\)/);
    assert.match(webhook, /description: snapshotText\(listing\.description, 5000\)/);
    assert.match(webhook, /sellerName: snapshotSellerName\(listing\.seller\?\.displayName\)/);
    assert.match(webhook, /title: snapshotText\(listingData\?\.title, 200\)/);
    assert.match(webhook, /sellerName: snapshotSellerName\(listingData\?\.seller\?\.displayName\)/);
  });

  it("uses bounded short-name account deletion redaction instead of ignoring two-character names", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const redaction = source("src/lib/accountDeletionAuditRedaction.ts");
    assert.match(deletion, /Array\.from\(item\)\.length >= 2/);
    assert.match(deletion, /notificationTextMatchSql\(value\)/);
    assert.match(redaction, /Array\.from\(value\)\.length >= 2/);
    assert.match(redaction, /redactionPatternForNeedle\(needle\)/);
  });
});
