import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("admin query and email guardrails", () => {
  it("bounds admin pagination before Prisma skip math", () => {
    for (const path of [
      "src/app/admin/users/page.tsx",
      "src/app/admin/audit/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/admin/reviews/page.tsx",
      "src/app/admin/support/page.tsx",
    ]) {
      const text = source(path);

      assert.match(text, /parseBoundedPositiveIntParam/);
      assert.match(text, /parseBoundedPositiveIntParam\([^,]+, 1, 1000\)/);
      assert.match(text, /const requestedPage = parseBoundedPositiveIntParam/);
      assert.match(text, /const totalPages = Math\.max\(1, Math\.ceil\(/);
      assert.match(text, /const page = Math\.min\(requestedPage, totalPages\)/);
      assert.doesNotMatch(text, /Math\.max\(1,\s*parseInt\(/);
      assert.doesNotMatch(text, /skip: \(requestedPage - 1\)/);
    }
  });

  it("keeps admin list ordering deterministic on equal timestamps", () => {
    const users = source("src/app/admin/users/page.tsx");
    const audit = source("src/app/admin/audit/page.tsx");
    const broadcasts = source("src/app/admin/broadcasts/page.tsx");
    const reviews = source("src/app/admin/reviews/page.tsx");
    const support = source("src/app/admin/support/page.tsx");

    assert.match(users, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(audit, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(broadcasts, /orderBy: \[\{ sentAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(reviews, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(reviews, /photos: \{ orderBy: \[\{ sortOrder: "asc" \}, \{ id: "asc" \}\] \}/);
    assert.match(support, /orderBy: \[\{ slaDueAt: "asc" \}, \{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
    assert.match(support, /orderBy: \[\{ closedAt: "desc" \}, \{ id: "desc" \}\]/);
  });

  it("does not silently truncate admin review or support queues", () => {
    const reviews = source("src/app/admin/reviews/page.tsx");
    const support = source("src/app/admin/support/page.tsx");

    assert.match(reviews, /const PAGE_SIZE = 50/);
    assert.match(reviews, /const total = await prisma\.review\.count\(\)/);
    assert.match(reviews, /skip: \(page - 1\) \* PAGE_SIZE/);
    assert.match(reviews, /take: PAGE_SIZE/);
    assert.doesNotMatch(reviews, /take: 100/);

    assert.match(support, /const ACTIVE_PAGE_SIZE = 50/);
    assert.match(support, /const activeCount = await prisma\.supportRequest\.count\(\{ where: activeWhere \}\)/);
    assert.match(support, /Support Requests \(\{activeCount\} open\)/);
    assert.match(support, /skip: \(page - 1\) \* ACTIVE_PAGE_SIZE/);
    assert.match(support, /take: ACTIVE_PAGE_SIZE/);
    assert.doesNotMatch(support, /take: 100/);
  });

  it("bounds free-text search params before contains queries", () => {
    const users = source("src/app/admin/users/page.tsx");
    const broadcasts = source("src/app/admin/broadcasts/page.tsx");
    const messages = source("src/app/messages/page.tsx");

    assert.match(users, /const q = truncateText\(\(qParam \?\? ""\)\.trim\(\), 200\)/);
    assert.match(users, /maxLength=\{200\}/);
    assert.match(broadcasts, /const q = truncateText\(\(sp\.q \?\? ""\)\.trim\(\), 200\)/);
    assert.match(broadcasts, /maxLength=\{200\}/);
    assert.match(messages, /const q = truncateText\(qParam\.trim\(\), 200\)/);
    assert.match(messages, /maxLength=\{200\}/);
  });

  it("honors refund email preferences before seller refund emails", () => {
    const route = source("src/app/api/orders/[id]/refund/route.ts");
    const prefIndex = route.indexOf('shouldSendEmail(order.buyerId, "EMAIL_REFUND_ISSUED")');
    const sendIndex = route.indexOf("await sendRefundIssued");

    assert.ok(prefIndex >= 0, "seller refunds must check EMAIL_REFUND_ISSUED");
    assert.ok(sendIndex > prefIndex, "seller refunds must check preferences before emailing");
  });

  it("uses the configured email app URL for dynamic notification links", () => {
    const messageThread = source("src/app/messages/[id]/page.tsx");
    const reviews = source("src/app/api/reviews/route.ts");

    assert.match(messageThread, /import \{ EMAIL_APP_URL \} from "@\/lib\/emailBaseUrl"/);
    assert.match(messageThread, /new URL\(`\/messages\/\$\{id\}`, EMAIL_APP_URL\)\.toString\(\)/);
    assert.doesNotMatch(messageThread, /conversationUrl:\s*`https:\/\/thegrainline\.com/);

    assert.match(reviews, /import \{ EMAIL_APP_URL \} from "@\/lib\/emailBaseUrl"/);
    assert.match(reviews, /new URL\(`\$\{publicListingPath\(listingId, listing\.title\)\}#reviews`, EMAIL_APP_URL\)\.toString\(\)/);
    assert.doesNotMatch(reviews, /reviewUrl:\s*`https:\/\/thegrainline\.com/);
  });

  it("uses explicit staff preview links for pending admin listing review", () => {
    const adminReview = source("src/app/admin/review/page.tsx");
    const listingPage = source("src/app/listing/[id]/page.tsx");

    assert.match(adminReview, /\$\{publicListingPath\(listing\.id, listing\.title\)\}\?preview=admin/);
    assert.match(listingPage, /sp\.preview === "admin"/);
    assert.match(listingPage, /staffPreview/);
    assert.match(listingPage, /me\.role === "ADMIN" \|\| me\.role === "EMPLOYEE"/);
  });
});
