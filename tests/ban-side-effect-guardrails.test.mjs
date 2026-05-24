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

    assert.match(ban, /const BANNED_BUYER_COMMISSION_STATUSES = \['OPEN', 'IN_PROGRESS'\] as const/);
    assert.match(ban, /status: \{ in: \[\.\.\.BANNED_BUYER_COMMISSION_STATUSES\] \}/);
    assert.match(ban, /addedReviewNote: reviewNoteState\.addedReviewNote/);
    assert.match(ban, /flagBannedSellerOpenOrders\(tx, flaggedOpenOrders\)/);
    assert.match(ban, /Prisma\.join\(rows\)/);
    assert.match(ban, /o\."reviewNote" IS NOT DISTINCT FROM data\."previousReviewNote"/);
    assert.doesNotMatch(ban, /for \(const order of flaggedOpenOrders\) \{\s*await tx\.order\.update/s);
    assert.match(ban, /restoreBannedSellerOrderReviewState\(\s*tx,\s*banMetadata\.flaggedOpenOrders/s);
    assert.match(audit, /restoreBannedSellerOrderReviewState\(tx, banMetadata\.flaggedOpenOrders\)/);
  });

  it("lets an already-undone ban retry only the failed Clerk unban sync", () => {
    const audit = source("src/lib/audit.ts");

    assert.match(audit, /retryUndoBanClerkSyncIfPending/);
    assert.match(audit, /UNDO_BAN_USER_CLERK_SYNC_FAILED/);
    assert.match(audit, /if \(log\.undone\) \{\s*if \(await retryUndoBanClerkSyncIfPending\(log, adminId\)\) return/s);
    assert.match(audit, /Cannot retry Clerk unban because the account is currently banned/);
    assert.match(audit, /banned: true,\s+deletedAt: null,\s+\.\.\.\(appliedBannedAt \? \{ bannedAt: appliedBannedAt \} : \{\}\)/s);
    assert.match(audit, /source: 'undo_ban_user_clerk_sync_retry'/);
    assert.match(audit, /retry: true/);
  });
});
