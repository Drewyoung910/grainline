import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";
import { supportRequestPreparationMigrationPath } from "./helpers/support-request-preparation-migration-path.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account-state residue hardening", () => {
  it("redacts inactive reviewer snapshots without joining User", () => {
    const reviews = source("src/components/ReviewsSection.tsx");

    assert.match(reviews, /reviewerAccountActive: boolean/);
    assert.match(reviews, /reviewerName: string \| null/);
    assert.match(reviews, /reviewerImageUrl: string \| null/);
    assert.match(reviews, /function reviewerUnavailable/);
    assert.match(reviews, /return !reviewer\.reviewerAccountActive/);
    assert.match(reviews, /reviewerAccountActive: true/);
    assert.doesNotMatch(reviews, /reviewer:\s*\{\s*select:/);
    assert.match(reviews, /!reviewerUnavailable\(r\).*BlockReportButton/s);
    assert.doesNotMatch(reviews, /r\.reviewer\.(?:banned|deletedAt|imageUrl)/);
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
    const authority = source(
      sellerProfilePrivateMigrationPath("20261014160000_prepare_seller_profile_private_account_deletion_app_authorities"),
    );

    assert.match(deletion, /anonymizeSellerForAccountDeletion\(tx, \{/);
    for (const [field, valuePattern] of [
      ["isVerifiedMaker", "false"],
      ["verifiedAt", "NULL"],
      ["guildLevel", "'NONE'"],
      ["guildMemberApprovedAt", "NULL"],
      ["guildMasterApprovedAt", "NULL"],
      ["guildMasterAppliedAt", "NULL"],
      ["guildMasterReviewNotes", "NULL"],
      ["consecutiveMetricFailures", "0"],
      ["lastMetricCheckAt", "NULL"],
      ["metricWarningSentAt", "NULL"],
      ["listingsBelowThresholdSince", "NULL"],
      ["profileViews", "0"],
      ["featuredUntil", "NULL"],
      ["metroId", "NULL"],
      ["cityMetroId", "NULL"],
    ]) {
      assert.match(
        authority,
        new RegExp(`"${field}" = ${valuePattern}`),
        `account deletion should reset ${field}`,
      );
    }

    assert.match(
      deletion,
      /sellerProfileViewDaily\.deleteMany\(\{\s*where: \{ sellerProfileId: user\.sellerProfile\.id \},\s*\}\)/s,
    );
  });

  it("removes deleted seller FAQs from retained seller profiles", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const faqDelete = deletion.indexOf("await tx.sellerFaq.deleteMany");
    const profileUpdate = deletion.indexOf("await anonymizeSellerForAccountDeletion(tx");

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
    assert.match(reportsPage, /userStaffAdminLabels\(getOrderStaffReadClient\(\), \{\s*actorId: staff\.id,\s*userIds: reports\.flatMap\(\(report\) => \[report\.reporterId, report\.reportedId\]\),/s);
    assert.match(reportsPage, /const reportUserById = new Map\(reportUsers\.map\(\(user\) => \[user\.id, user\]\)\)/);
    assert.match(reportsPage, /userStaffReportLabels\(getOrderStaffReadClient\(\), \{\s*actorId: staff\.id,\s*userIds: topReporters\.map\(\(r\) => r\.reporterId\),/s);
    assert.match(source("src/lib/userStaffAccess.ts"), /UserStaffReportLabel = UserStaffEmailTarget & \{\s*deletedAt: Date \| null;/s);
    assert.match(reportsPage, /reportUserLabel\(reportUserById\.get\(r\.reporterId\)\)/);
    assert.match(reportsPage, /reportUserLabel\(reportUserById\.get\(r\.reportedId\)\)/);
    assert.doesNotMatch(reportsPage, /r\.reported\.email \?\? r\.reported\.name/);
  });

  it("tracks source ids on maker fanout notifications and email outbox rows", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260619212000_add_fanout_source_metadata/migration.sql");
    const notifications = source("src/lib/notifications.ts");
    const notificationSources = source("src/lib/notificationSources.ts");
    const outbox = source("src/lib/emailOutbox.ts");
    const broadcastRoute = source("src/app/api/seller/broadcast/route.ts");
    const listingFanout = source("src/lib/followerListingNotifications.ts");
    const blogFanout = source("src/lib/followerBlogNotifications.ts");

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

    assert.match(notifications, /NotificationSourceFields/);
    assert.match(notificationSources, /\{ sourceType: NotificationSourceType; sourceId: string \}/);
    assert.match(notificationSources, /\{ sourceType\?: never; sourceId\?: never \}/);
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
    assert.match(blogFanout, /sourceType: NOTIFICATION_SOURCE_TYPES\.FOLLOWED_MAKER_NEW_BLOG/);
    assert.match(blogFanout, /sourceId: publicPost\.id/);
  });

  it("removes deleted seller-authored fanout residue through exact notification and outbox authority", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const emailOutboxLifecycle = source("src/lib/emailOutboxContentLifecycle.ts");
    const helperStart = deletion.indexOf("async function cleanupDeletedSellerFanoutRows");
    const helper = deletion.slice(
      helperStart,
      deletion.indexOf(
        "async function redactOrderReviewNotesForDeletedAccount",
        helperStart,
      ),
    );
    const callIndex = deletion.indexOf("await cleanupDeletedSellerFanoutRows(tx, user.sellerProfile.id, now)");
    const broadcastDeleteIndex = deletion.indexOf("await tx.sellerBroadcast.deleteMany");
    const listingAnonymizeIndex = deletion.indexOf("await tx.listing.updateMany");
    const blogArchiveIndex = deletion.indexOf("await archiveBlogPostsForDeletedAccount");

    assert.ok(helperStart >= 0, "account deletion should have a seller fanout cleanup helper");
    assert.ok(callIndex >= 0, "account deletion should call seller fanout cleanup");
    assert.ok(callIndex < broadcastDeleteIndex, "fanout cleanup should run before broadcast rows are deleted");
    assert.ok(callIndex < listingAnonymizeIndex, "fanout cleanup should collect listing ids before listing anonymization");
    assert.ok(callIndex < blogArchiveIndex, "fanout cleanup should collect blog slugs before blog archive slugs are written");
    assert.match(deletion, /await deleteAccountNotificationServiceRows\(tx, user\.id\)/);
    assert.doesNotMatch(helper, /tx\.notification\.|deleteNotification(?:Source|Link)Rows/);
    assert.doesNotMatch(deletion, /notificationTextMatchSql|redactNotificationsAboutDeletedAccount/);
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
    assert.match(emailOutboxLifecycle, /payloadVersion: \{ not: null \}/);
    assert.match(emailOutboxLifecycle, /data: \{ payload: \{} \}/);
  });

  it("clears deleted staff closure links and redacts support closure evidence text", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const access = source("src/lib/supportRequestAccess.ts");
    const migration = source(supportRequestPreparationMigrationPath());

    assert.match(
      deletion,
      /redactSupportRequestsForAccountDeletion\(\s*tx,\s*accountSensitiveValues,\s*accountAuditSensitiveValues,\s*\)/,
    );
    assert.match(access, /grainline_support_request_account_deletion_redact_batch/);
    assert.match(access, /while \(requestCount === 500 \|\| closureCount === 500\)/);
    assert.match(migration, /WHERE request\."closureEvidenceById" = actor_id/);
    assert.match(migration, /SET "closureEvidenceById" = NULL/);
    assert.match(
      migration,
      /grainline_account_deletion_redact_text_core\(request\."closureEvidence", p_audit_sensitive_values\)/,
    );
  });

  it("delegates outbox eligibility to claim and provider-start authorities", () => {
    const outbox = source("src/lib/emailOutbox.ts");
    const access = source("src/lib/emailOutboxAccess.ts");
    const worker = source("src/lib/emailOutboxWorker.ts");

    assert.match(outbox, /claimEmailOutboxBatch\(take\)/);
    assert.match(outbox, /claimEmailOutboxJob\(id\)/);
    assert.match(outbox, /beginProviderAttempt: beginEmailOutboxProviderAttempt/);
    assert.match(access, /grainline_email_outbox_claim_batch/);
    assert.match(access, /grainline_email_outbox_claim_one/);
    assert.match(access, /grainline_email_outbox_begin_provider_attempt/);
    const beginIndex = worker.indexOf("await dependencies.beginProviderAttempt(claim)");
    const sendIndex = worker.indexOf("await dependencies.sendLegacy(claim)");
    assert.ok(beginIndex >= 0, "the provider-boundary eligibility recheck must exist");
    assert.ok(sendIndex >= 0, "provider delivery must exist");
    assert.ok(
      beginIndex < sendIndex,
      "the provider-boundary eligibility recheck must run before provider delivery",
    );
    assert.doesNotMatch(outbox, /prisma\.user\.(?:findUnique|findFirst|findMany)/);
    assert.doesNotMatch(outbox, /inactiveQueuedEmailRecipientReason/);
    assert.doesNotMatch(outbox, /shouldSendEmail\(/);
  });
});
