import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account-state residue hardening", () => {
  it("redacts banned reviewers the same way as deleted reviewers", () => {
    const reviews = source("src/components/ReviewsSection.tsx");

    assert.match(reviews, /banned\?: boolean \| null/);
    assert.match(reviews, /function reviewerUnavailable/);
    assert.match(reviews, /reviewer\.deletedAt \|\| reviewer\.banned/);
    assert.match(reviews, /reviewer: \{ select: \{ id: true, name: true, imageUrl: true, banned: true, deletedAt: true \} \}/);
    assert.doesNotMatch(reviews, /reviewer:\s*\{\s*select:\s*\{[^}]*email:\s*true/s);
    assert.match(reviews, /!reviewerUnavailable\(r\.reviewer\).*BlockReportButton/s);
    assert.doesNotMatch(reviews, /!r\.reviewer\.deletedAt && r\.reviewer\.imageUrl/);
  });

  it("removes banned or deleted sellers from commission interest counts", () => {
    const helper = source("src/lib/commissionInterestCleanup.ts");
    const ban = source("src/lib/ban.ts");
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(helper, /commissionInterest\.findMany/);
    assert.match(helper, /commissionInterest\.deleteMany\(\{ where: \{ sellerProfileId \} \}\)/);
    assert.match(helper, /commissionInterest\.count\(\{\s*where: \{ commissionRequestId \}/s);
    assert.match(helper, /commissionRequest\.update\(\{\s*where: \{ id: commissionRequestId \}/s);
    assert.match(helper, /data: \{ interestedCount \}/);
    assert.match(ban, /removeSellerCommissionInterests\(tx, sellerProfile\.id\)/);
    assert.match(deletion, /removeSellerCommissionInterests\(tx, user\.sellerProfile\.id\)/);
  });

  it("invalidates public seller visibility caches when account state removes public content", () => {
    const ban = source("src/lib/ban.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const blogIndex = source("src/app/dashboard/blog/page.tsx");

    assert.match(ban, /revalidatePublicSellerVisibilityCaches/);
    assert.match(ban, /revalidateAccountStateSearchCaches\('ban_user_search_cache_revalidate', userId\)/);
    assert.match(ban, /revalidateAccountStateSearchCaches\('unban_user_search_cache_revalidate', userId\)/);
    assert.match(deletion, /revalidatePublicSellerVisibilityCaches/);
    assert.match(deletion, /revalidateDeletedAccountSearchCaches\(userId\)/);
    assert.match(blogIndex, /revalidateBlogSearchCaches\(\)/);
  });

  it("rechecks outbox recipient account state even without a preference key", () => {
    const outbox = source("src/lib/emailOutbox.ts");

    assert.match(outbox, /async function inactiveQueuedEmailRecipientReason/);
    assert.match(outbox, /if \(job\.userId\) \{[\s\S]*where: \{ id: job\.userId \}/);
    assert.match(outbox, /where: \{ email: job\.recipientEmail \}/);
    assert.match(outbox, /const inactiveReason = await inactiveQueuedEmailRecipientReason\(job\)/);
    assert.match(outbox, /skipEmailOutboxJob\(job\.id, inactiveReason\)/);
    assert.ok(
      outbox.indexOf("inactiveQueuedEmailRecipientReason(job)") <
        outbox.indexOf("shouldSendEmail(job.userId, job.preferenceKey)"),
      "account-state check must run before preference-only checks",
    );
  });
});
