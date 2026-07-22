import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Notification moderation and account-warning authority", () => {
  const listingReview = source("src/app/api/admin/listings/[id]/review/route.ts");
  const userReport = source("src/app/api/users/[id]/report/route.ts");
  const adminEmail = source("src/app/api/admin/email/route.ts");
  const ban = source("src/lib/ban.ts");
  const serviceAccess = source("src/lib/notificationServiceAccess.ts");
  const sql = source("docs/rls-drafts/notification-service-authority.sql");

  it("binds listing decisions and reports to durable exact source rows", () => {
    assert.equal(
      (listingReview.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.LISTING_ADMIN_REVIEW/g) ?? []).length,
      2,
    );
    assert.match(listingReview, /metadata: \{ finalStatus \}/);
    assert.match(listingReview, /if \(!approved\.auditLogId \|\| !approved\.finalStatus\)/);
    assert.match(listingReview, /sourceId: approved\.auditLogId/);
    assert.match(listingReview, /if \(!rejected\.auditLogId\)/);
    assert.match(listingReview, /sourceId: rejected\.auditLogId/);
    assert.match(userReport, /const report = await prisma\.userReport\.create/);
    assert.match(userReport, /sourceType: NOTIFICATION_SOURCE_TYPES\.LISTING_USER_REPORT/);
    assert.match(userReport, /sourceId: report\.id/);
    assert.match(userReport, /relatedUserId: me\.id/);
  });

  it("never falls back to an unaudited free-form account warning", () => {
    assert.match(adminEmail, /await sendRenderedEmail\([\s\S]{0,1600}logAdminActionOrThrow\(\{/);
    assert.match(adminEmail, /metadata: \{ notificationBody \}/);
    assert.match(adminEmail, /if \(recipientUserId && notificationAuditId\)/);
    assert.match(adminEmail, /sourceType: NOTIFICATION_SOURCE_TYPES\.ADMIN_ACCOUNT_MESSAGE/);
    assert.doesNotMatch(adminEmail, /import \{ logAdminAction \}/);
  });

  it("uses a compound ban-audit and order event for each affected buyer order", () => {
    assert.match(ban, /sourceType: NOTIFICATION_SOURCE_TYPES\.BANNED_SELLER_ORDER/);
    assert.match(ban, /sourceId: `\$\{banAuditLogId\}:\$\{order\.id\}`/);
    assert.match(ban, /relatedUserId: bannedSellerUserId/);
    assert.match(ban, /clerkSync\.banAuditLogId,[\s\S]{0,80}userId/);
    assert.match(sql, /p_source_id = source_audit\.id \|\| ':' \|\| source_order\.id/);
    assert.match(sql, /source_audit\.metadata -> 'flaggedOpenOrders'/);
    assert.match(sql, /flagged_order ->> 'id' = source_order\.id/);
    assert.match(sql, /source_order\."buyerId" = p_user_id/);
    assert.match(sql, /p_related_user_id = source_banned_seller\.id/);
    assert.match(sql, /source_banned_seller\.banned = true/);
  });

  it("derives payloads and exposes only the two narrow family wrappers", () => {
    assert.match(sql, /p_source_type = 'listing_admin_review'/);
    assert.match(sql, /p_source_type = 'listing_user_report'/);
    assert.match(sql, /p_source_type = 'admin_account_message'/);
    assert.match(sql, /p_source_type = 'banned_seller_order'/);
    assert.match(sql, /source_audit\.undone = false/);
    assert.match(sql, /source_report\."reportedId" = source_seller\."userId"/);
    assert.match(sql, /source_report\."reporterId" = p_related_user_id/);
    assert.match(sql, /pg_catalog\.left\(source_audit\.metadata ->> 'notificationBody', 1000\)/);
    assert.match(serviceAccess, /public\.grainline_notification_create_moderation_event\(/);
    assert.match(serviceAccess, /public\.grainline_notification_create_account_warning\(/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_moderation_event/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_account_warning/);
  });
});
