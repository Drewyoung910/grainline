import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("ban side-effect repair cron guardrails", () => {
  it("records modern BAN_USER audit rows with enough data for repair and guarded undo", () => {
    const ban = source("src/lib/ban.ts");
    const metadata = source("src/lib/banAuditMetadata.ts");
    const audit = source("src/lib/audit.ts");

    assert.match(ban, /const bannedAt = new Date\(\)/);
    assert.match(ban, /appliedBannedAt: bannedAt/);
    assert.match(ban, /banAuditLogId: banAuditLog\.id/);
    assert.match(ban, /originalActionId: clerkSync\.banAuditLogId/);
    assert.match(metadata, /appliedBannedAt: appliedBannedAt\?\.toISOString\(\) \?\? null/);
    assert.match(metadata, /externalSyncVersion = 1/);
    assert.match(audit, /dateFromMetadata\(banMetadata\?\.appliedBannedAt \?\? null\)/);
    assert.match(audit, /bannedAt: appliedBannedAt/);
    assert.match(audit, /User ban state changed before undo could be applied/);
  });

  it("adds a cron that retries missing or failed Clerk ban sync for modern ban logs", () => {
    const repair = source("src/lib/banSideEffectRepair.ts");
    const route = source("src/app/api/cron/ban-side-effects/route.ts");
    const vercel = source("vercel.json");

    assert.match(repair, /readBanAuditMetadata\(candidate\.metadata\)/);
    assert.match(repair, /metadata\.externalSyncVersion !== 1/);
    assert.match(repair, /latestClerkSyncActionForBan/);
    assert.match(repair, /hasCheckoutExpiryLogForBan/);
    assert.match(repair, /const checkoutAlreadyExpired = await hasCheckoutExpiryLogForBan/);
    assert.match(repair, /latestSyncAction === "BAN_USER_CLERK_SYNC"/);
    assert.match(repair, /expireOpenCheckoutSessionsForSeller\(\{/);
    assert.match(repair, /checkoutRepaired = true/);
    assert.match(repair, /banClerkUserAndRevokeSessions\(target\.clerkId\)/);
    assert.match(repair, /action: "BAN_USER_CLERK_SYNC_FAILED"/);
    assert.match(route, /verifyCronRequest\(request\)/);
    assert.match(route, /beginCronRun\("ban-side-effects", halfHourBucket\(\)\)/);
    assert.match(route, /processBanUserExternalSideEffectRepairBatch\(\{ take: 20 \}\)/);
    assert.match(vercel, /"path": "\/api\/cron\/ban-side-effects"/);
    assert.match(vercel, /"schedule": "20,50 \* \* \* \*"/);
  });
});
