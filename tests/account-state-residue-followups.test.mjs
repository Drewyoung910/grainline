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

  it("clears deleted seller trust, feature, and geo residue during anonymization", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const updateStart = deletion.indexOf("await tx.sellerProfile.update({\n        where: { id: user.sellerProfile.id }");
    const updateBlock = deletion.slice(updateStart, deletion.indexOf("      });", updateStart));

    assert.ok(updateStart >= 0, "account deletion should update the deleted seller profile");
    for (const [field, valuePattern] of [
      ["isVerifiedMaker", "false"],
      ["verifiedAt", "null"],
      ["guildLevel", '"NONE"'],
      ["guildMemberApprovedAt", "null"],
      ["guildMasterApprovedAt", "null"],
      ["guildMasterAppliedAt", "null"],
      ["guildMasterReviewNotes", "null"],
      ["consecutiveMetricFailures", "0"],
      ["lastMetricCheckAt", "null"],
      ["metricWarningSentAt", "null"],
      ["listingsBelowThresholdSince", "null"],
      ["profileViews", "0"],
      ["featuredUntil", "null"],
      ["metroId", "null"],
      ["cityMetroId", "null"],
    ]) {
      assert.match(
        updateBlock,
        new RegExp(`${field}: ${valuePattern}`),
        `account deletion should reset ${field}`,
      );
    }
  });

  it("removes deleted seller FAQs from retained seller profiles", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const faqDelete = deletion.indexOf("await tx.sellerFaq.deleteMany");
    const profileUpdate = deletion.indexOf("await tx.sellerProfile.update({\n        where: { id: user.sellerProfile.id }");

    assert.ok(faqDelete >= 0, "account deletion should remove seller FAQs");
    assert.match(deletion.slice(faqDelete, profileUpdate), /where: \{ sellerProfileId: user\.sellerProfile\.id \}/);
    assert.ok(faqDelete < profileUpdate, "FAQ deletion should happen before the retained seller profile is anonymized");
  });

  it("hides generated deleted-account emails in the admin reports page", () => {
    const reportsPage = source("src/app/admin/reports/page.tsx");

    assert.match(reportsPage, /function reportUserLabel/);
    assert.match(reportsPage, /if \(user\.deletedAt\) return "Deleted user"/);
    assert.match(reportsPage, /function reportUserSearchValue/);
    assert.match(reportsPage, /if \(!user \|\| user\.deletedAt\) return ""/);
    assert.match(reportsPage, /reporter: \{ select: \{ name: true, email: true, deletedAt: true \} \}/);
    assert.match(reportsPage, /reported: \{ select: \{ name: true, email: true, deletedAt: true \} \}/);
    assert.match(reportsPage, /select: \{ id: true, name: true, email: true, deletedAt: true \}/);
    assert.match(reportsPage, /reportUserLabel\(r\.reporter\)/);
    assert.match(reportsPage, /reportUserLabel\(r\.reported\)/);
    assert.doesNotMatch(reportsPage, /r\.reported\.email \?\? r\.reported\.name/);
  });

  it("tracks source ids on maker fanout notifications and email outbox rows", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260619212000_add_fanout_source_metadata/migration.sql");
    const notifications = source("src/lib/notifications.ts");
    const outbox = source("src/lib/emailOutbox.ts");
    const broadcastRoute = source("src/app/api/seller/broadcast/route.ts");
    const listingFanout = source("src/lib/followerListingNotifications.ts");
    const blogNew = source("src/app/dashboard/blog/new/page.tsx");
    const blogEdit = source("src/app/dashboard/blog/[id]/edit/page.tsx");

    for (const model of ["EmailOutbox", "Notification"]) {
      const modelBlock = schema.slice(schema.indexOf(`model ${model} {`), schema.indexOf("}", schema.indexOf(`model ${model} {`)));
      assert.match(modelBlock, /sourceType\s+String\?\s+@db\.VarChar\(80\)/, `${model} should store source type`);
      assert.match(modelBlock, /sourceId\s+String\?\s+@db\.VarChar\(191\)/, `${model} should store source id`);
      assert.match(modelBlock, /@@index\(\[sourceType, sourceId\]\)/, `${model} should index source metadata`);
    }
    assert.match(migration, /ADD COLUMN "sourceType" VARCHAR\(80\)/);
    assert.match(migration, /ADD COLUMN "sourceId" VARCHAR\(191\)/);
    assert.match(migration, /CREATE INDEX "EmailOutbox_sourceType_sourceId_idx"/);
    assert.match(migration, /CREATE INDEX "Notification_sourceType_sourceId_idx"/);

    assert.match(notifications, /sourceType\?: string/);
    assert.match(notifications, /sourceId\?: string/);
    assert.match(notifications, /sourceType: notificationSourceType/);
    assert.match(notifications, /sourceId: notificationSourceId/);
    assert.match(outbox, /sourceType\?: string/);
    assert.match(outbox, /sourceId\?: string/);
    assert.match(outbox, /sourceType: email\.sourceType \? truncateText\(email\.sourceType, 80\) : undefined/);
    assert.match(outbox, /sourceId: email\.sourceId \? truncateText\(email\.sourceId, 191\) : undefined/);

    assert.match(broadcastRoute, /sourceType: "seller_broadcast"/);
    assert.match(broadcastRoute, /sourceId: broadcast\.id/);
    assert.match(listingFanout, /sourceType: "followed_maker_new_listing"/);
    assert.match(listingFanout, /sourceId: publicListing\.id/);
    assert.match(blogNew, /sourceType: "followed_maker_new_blog"/);
    assert.match(blogNew, /sourceId: publicPost\.id/);
    assert.match(blogEdit, /sourceType: "followed_maker_new_blog"/);
    assert.match(blogEdit, /sourceId: publicPost\.id/);
  });

  it("removes deleted seller-authored fanout residue from follower notifications and outbox rows", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const helperStart = deletion.indexOf("async function cleanupDeletedSellerFanoutRows");
    const helper = deletion.slice(helperStart, deletion.indexOf("async function collectMessagesBySensitiveText", helperStart));
    const callIndex = deletion.indexOf("await cleanupDeletedSellerFanoutRows(tx, user.sellerProfile.id, now)");
    const broadcastDeleteIndex = deletion.indexOf("await tx.sellerBroadcast.deleteMany");
    const listingAnonymizeIndex = deletion.indexOf("await tx.listing.updateMany");
    const blogArchiveIndex = deletion.indexOf("await archiveBlogPostsForDeletedAccount");

    assert.ok(helperStart >= 0, "account deletion should have a seller fanout cleanup helper");
    assert.ok(callIndex >= 0, "account deletion should call seller fanout cleanup");
    assert.ok(callIndex < broadcastDeleteIndex, "fanout cleanup should run before broadcast rows are deleted");
    assert.ok(callIndex < listingAnonymizeIndex, "fanout cleanup should collect listing ids before listing anonymization");
    assert.ok(callIndex < blogArchiveIndex, "fanout cleanup should collect blog slugs before blog archive slugs are written");

    for (const sourceType of [
      "seller_broadcast",
      "followed_maker_new_listing",
      "followed_maker_new_blog",
    ]) {
      assert.match(helper, new RegExp(`deleteNotificationSourceRows\\(tx, "${sourceType}"`));
    }
    assert.match(helper, /link: `\/account\/feed\?broadcast=\$\{id\}`/);
    assert.match(helper, /link: \{ startsWith: `\/listing\/\$\{id\}--` \}/);
    assert.match(helper, /link: `\/listing\/\$\{id\}`/);
    assert.match(helper, /link,\s*\}\)\)/);
    assert.match(helper, /sourceType: "seller_broadcast"/);
    assert.match(helper, /sourceType: "followed_maker_new_listing"/);
    assert.match(helper, /dedupKey: \{ startsWith: `seller-broadcast:\$\{id\}:` \}/);
    assert.match(helper, /dedupKey: \{ startsWith: `followed-listing:\$\{id\}:` \}/);
    assert.match(helper, /dedupKey: \{ startsWith: `admin-approved-listing:\$\{id\}:` \}/);
    assert.match(helper, /dedupKey: \{ startsWith: `followed-listing-active:\$\{id\}:` \}/);
    assert.match(deletion, /async function redactEmailOutboxRowsForDeletedMaker/);
    assert.match(deletion, /status: "SKIPPED"/);
    assert.match(deletion, /subject: "Email removed after maker deletion"/);
    assert.match(deletion, /html: "\[Email removed after maker deletion\]"/);
  });

  it("clears deleted staff closure links and redacts support closure evidence text", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const helperStart = deletion.indexOf("async function redactSupportClosureEvidenceByDeletedAccount");
    const helper = deletion.slice(helperStart, deletion.indexOf("async function archiveBlogPostsForDeletedAccount", helperStart));

    assert.ok(helperStart >= 0, "account deletion should redact staff closure evidence references");
    assert.match(deletion, /function supportClosureEvidenceTextMatchSql/);
    assert.match(helper, /where: \{ closureEvidenceById: deletedUserId \}/);
    assert.match(helper, /data: \{ closureEvidenceById: null \}/);
    assert.match(helper, /FROM "SupportRequest"/);
    assert.match(helper, /"closureEvidence" IS NOT NULL/);
    assert.match(helper, /redactAccountDeletionText\(request\.closureEvidence, sensitiveValues\)/);
    assert.match(helper, /data: \{ closureEvidence: closureEvidence\.text \}/);
    assert.match(deletion, /redactSupportClosureEvidenceByDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
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
