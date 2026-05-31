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
    ]) {
      const text = source(path);

      assert.match(text, /parseBoundedPositiveIntParam/);
      assert.match(text, /parseBoundedPositiveIntParam\([^,]+, 1, 1000\)/);
      assert.doesNotMatch(text, /Math\.max\(1,\s*parseInt\(/);
    }
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
