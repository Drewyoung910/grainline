import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("ban side-effect guardrails", () => {
  it("keeps buyer notifications and checkout expiry from blocking Clerk session revocation", () => {
    const ban = source("src/lib/ban.ts");

    assert.match(ban, /Promise\.allSettled\(/);
    assert.match(ban, /source: 'ban_user_buyer_notification'/);
    assert.match(ban, /try \{\s*const expiryResult = await expireOpenCheckoutSessionsForSeller/s);
    assert.match(ban, /source: 'ban_user_checkout_session_expiry'/);
    assert.match(ban, /await banClerkUserAndRevokeSessions\(clerkSync\.clerkId\)/);
  });

  it("closes active buyer commissions and restores ban-added order review markers on unban", () => {
    const ban = source("src/lib/ban.ts");
    const audit = source("src/lib/audit.ts");
    const authority = source("src/lib/orderBanReviewAuthority.ts");

    assert.match(ban, /const BANNED_BUYER_COMMISSION_STATUSES = \['OPEN', 'IN_PROGRESS'\] as const/);
    assert.match(ban, /status: \{ in: \[\.\.\.BANNED_BUYER_COMMISSION_STATUSES\] \}/);
    assert.match(ban, /flagBannedSellerOpenOrders\(\s*banReviewCapability,\s*userId,\s*tx/s);
    assert.match(ban, /openOrderSnapshots: flaggedOpenOrders/);
    assert.match(ban, /restoreBannedSellerOrderReviews\(\s*banReviewCapability,\s*userId,\s*capabilityBanMetadata\.flaggedOpenOrders,\s*tx/s);
    assert.match(audit, /restoreBannedSellerOrderReviews\(\s*banReviewCapability,\s*log\.targetId,\s*banMetadata\?\.flaggedOpenOrders \?\? \[\],\s*tx/s);
    assert.match(authority, /grainline_order_flag_banned_seller_open_orders/);
    assert.match(authority, /grainline_order_restore_banned_seller_reviews/);
    assert.doesNotMatch(ban, /(?:prisma|tx)\.order\./);
    assert.doesNotMatch(audit, /(?:prisma|tx)\.order\./);
  });

  it("lets an already-undone ban retry only the failed Clerk unban sync", () => {
    const audit = source("src/lib/audit.ts");
    const staffAuthority = source("src/lib/userStaffAccess.ts");

    assert.match(audit, /retryUndoBanClerkSyncIfPending/);
    assert.match(audit, /UNDO_BAN_USER_CLERK_SYNC_FAILED/);
    assert.match(audit, /if \(log\.undone\) \{\s*if \(await retryUndoBanClerkSyncIfPending\(log, adminId\)\) return/s);
    assert.match(audit, /Cannot retry Clerk unban because the account is currently banned/);
    assert.match(audit, /userStaffUnbanApply\(tx, \{[\s\S]*expectedBannedAt: appliedBannedAt/s);
    assert.match(staffAuthority, /grainline_user_staff_unban_apply/);
    assert.match(audit, /source: 'undo_ban_user_clerk_sync_retry'/);
    assert.match(audit, /retry: true/);
  });

  it("lets an already-unbanned user converge Clerk without replaying database restoration", () => {
    const ban = source("src/lib/ban.ts");

    assert.match(ban, /async function convergeAlreadyUnbannedClerkTarget/);
    assert.match(ban, /await unbanClerkUser\(clerkId\)/);
    assert.match(ban, /idempotentConvergence: true/);
    assert.match(
      ban,
      /if \(!target\.banned\) \{[\s\S]*await convergeAlreadyUnbannedClerkTarget\([\s\S]*return \{ sellerRestoreWarning: null \}[\s\S]*const seller = await prisma\.sellerProfile\.findUnique/u,
    );
    assert.match(ban, /originalActionId: clerkSync\.unbanAuditLogId/u);
  });

  it("does not create a second ban event when staff retry failed Clerk convergence", () => {
    const ban = source("src/lib/ban.ts");
    const banFunction = ban.slice(
      ban.indexOf("export async function banUser"),
      ban.indexOf("export async function unbanUser"),
    );

    const convergence = banFunction.indexOf("convergeAlreadyBannedExternalSideEffects");
    const capability = banFunction.indexOf("mintBanReviewCapability");
    assert.ok(convergence >= 0 && convergence < capability);
    assert.match(ban, /repairBanUserExternalSideEffects\(\{/);
    assert.match(ban, /unmatchedHistoricalBan: true/);
    assert.match(banFunction, /userStaffBanApply\(tx, \{/);
  });

  it("rejects stale manual unban work rather than clearing a newer ban", () => {
    const ban = source("src/lib/ban.ts");
    const unbanFunction = ban.slice(ban.indexOf("export async function unbanUser"));

    assert.match(unbanFunction, /userStaffUnbanApply\(tx, \{/);
    assert.match(unbanFunction, /capabilityId: userUnbanCapability/);
    assert.match(unbanFunction, /expectedBannedAt: target\.bannedAt/);
    assert.doesNotMatch(unbanFunction, /(?:prisma|tx)\.user\./);
    assert.match(ban, /User ban state changed\. Refresh and try again\./);
  });
});
