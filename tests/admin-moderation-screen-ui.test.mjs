import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DELETED_ACCOUNT_EMAIL_DOMAIN,
  PROVIDER_DELETED_PENDING_BAN_REASON,
  isDeletedStaffDirectoryAccount,
  userStaffDirectoryAccountState,
} from "../src/lib/userStaffDirectoryState.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("admin Users list recognises deleted accounts from the database's deletion markers", () => {
  const id = "cmabc123def456ghi789jkl0";
  assert.equal(
    userStaffDirectoryAccountState({
      id,
      email: `deleted+${id}@deleted.thegrainline.local`,
      banned: true,
      banReason: "Account deleted at user's request",
    }),
    "deleted",
  );
  assert.equal(
    userStaffDirectoryAccountState({
      id,
      email: "maker@example.com",
      banned: true,
      banReason: PROVIDER_DELETED_PENDING_BAN_REASON,
    }),
    "deletion_pending",
  );
  assert.equal(
    userStaffDirectoryAccountState({
      id,
      email: "maker@example.com",
      banned: true,
      banReason: "Counterfeit listings",
    }),
    "banned",
  );
  // Another user's placeholder email does not mark this row deleted.
  assert.equal(
    userStaffDirectoryAccountState({
      id,
      email: "deleted+someoneelse@deleted.thegrainline.local",
      banned: true,
      banReason: null,
    }),
    "banned",
  );
  assert.equal(
    userStaffDirectoryAccountState({ id, email: "buyer@example.com", banned: false, banReason: null }),
    "active",
  );
  assert.equal(isDeletedStaffDirectoryAccount("deleted"), true);
  assert.equal(isDeletedStaffDirectoryAccount("deletion_pending"), true);
  assert.equal(isDeletedStaffDirectoryAccount("banned"), false);
});

test("deleted-account markers stay aligned with the database functions that write them", () => {
  const deletion = source(
    "prisma/migrations/20261006020000_prepare_user_account_deletion_authorities/migration.sql",
  );
  assert.ok(
    deletion.includes(`email = 'deleted+' || account_user.id || '${DELETED_ACCOUNT_EMAIL_DOMAIN}'`),
  );
  assert.ok(deletion.includes(`"banReason" = '${PROVIDER_DELETED_PENDING_BAN_REASON}'`));
});

test("admin Users list hides Unban and Email for deleted accounts", () => {
  const page = source("src/app/admin/users/page.tsx");
  assert.match(page, /const accountState = userStaffDirectoryAccountState\(u\)/);
  assert.match(page, /const deleted = isDeletedStaffDirectoryAccount\(accountState\)/);
  assert.match(
    page,
    /\{deleted \? \(\s*<span className="text-xs text-neutral-500">No actions<\/span>\s*\) : \(\s*<>[\s\S]*<BanUserButton[\s\S]*Email\s*<\/Link>\s*<\/>\s*\)\}/,
  );
  assert.match(page, /\{deleted \? \(\s*<div>\s*<span className="text-xs text-neutral-700 font-medium">Deleted<\/span>/);
});

test("review queue explains an approve or reject that the server skipped", () => {
  const buttons = source("src/components/ReviewListingButtons.tsx");
  assert.match(buttons, /if \(data\?\.skipped\) \{/);
  assert.match(buttons, /"Listing is no longer pending review\."/);
});

test("admin blog queue states when it shows fewer pending comments than the badge", () => {
  const page = source("src/app/admin/blog/page.tsx");
  assert.match(page, /const PENDING_COMMENT_LIMIT = 30;/);
  assert.match(page, /take: PENDING_COMMENT_LIMIT/);
  assert.match(page, /pendingCommentQueueFull \? `\$\{PENDING_COMMENT_LIMIT\}\+` : pendingComments\.length/);
  assert.doesNotMatch(page, /\{pendingComments\.length\}\s*<\/span>/);
  // The View link renders only through the public-visibility check.
  assert.equal((page.match(/href=\{`\/blog\/\$\{post\.slug\}`\}/g) ?? []).length, 1);
  assert.match(page, /"Not public: scheduled"/);
  assert.match(page, /\{postViewControl\(p\)\}/);
});

test("admin moderation links avoid known 404 targets", () => {
  const reports = source("src/app/admin/reports/page.tsx");
  assert.match(reports, /\$\{listingPathMap\.get\(r\.targetId\)\}\?preview=admin/);
  assert.match(reports, /\?preview=admin#reviews/);
  assert.doesNotMatch(reports, /\?\? `\/listing\/\$\{r\.targetId\}`/);
  assert.doesNotMatch(reports, /\?\? `\/seller\/\$\{r\.targetId\}`/);
  assert.match(reports, /reportUserById\.get\(r\.reportedId\)\?\.deletedAt \? \(/);

  const reviews = source("src/app/admin/reviews/page.tsx");
  assert.match(reviews, /publicListingPath\(r\.listing\.id, r\.listing\.title\)\}\?preview=admin/);

  const broadcasts = source("src/app/admin/broadcasts/page.tsx");
  assert.doesNotMatch(broadcasts, /:\s*"#"/);
  assert.match(broadcasts, /sellerTarget && sellerShopLinkable \? \(/);
});

test("admin reviews page lets staff expand the full review text", () => {
  const reviews = source("src/app/admin/reviews/page.tsx");
  assert.doesNotMatch(reviews, /line-clamp-3">\{r\.comment\}/);
  assert.match(reviews, /<ExpandableText\s+text=\{r\.comment\}/);
  assert.doesNotMatch(reviews, /toggleClassName="[^"]*amber/);

  const expandable = source("src/components/ExpandableText.tsx");
  // Optional prop; callers that omit it keep the component's default toggle styling.
  assert.match(expandable, /toggleClassName\?: string;/);
  assert.match(expandable, /className=\{toggleClassName \?\? "/);
});
