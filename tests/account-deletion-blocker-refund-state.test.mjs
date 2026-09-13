import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account deletion blocker refund state", () => {
  it("waives order deletion blockers only for recorded full refunds", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const authority = source(
      "prisma/migrations/20260905020000_prepare_order_account_deletion_authority/migration.sql",
    );

    assert.match(authority, /"sellerRefundId" <> 'pending'/);
    assert.match(authority, /COALESCE\(source_order\."sellerRefundAmountCents", 0\) > 0/);
    assert.match(authority, /COALESCE\(source_order\."sellerRefundAmountCents", 0\) >=/);
    assert.match(authority, /COALESCE\(\s*source_order\."chargedTotalCents"/s);
    for (const field of ["itemsSubtotalCents", "shippingAmountCents", "giftWrappingPriceCents", "taxAmountCents"]) {
      assert.match(authority, new RegExp(`COALESCE\\(source_order\\.\"${field}\", 0\\)`));
    }
    assert.match(deletion, /getOrderAccountDeletionBlockerCounts/);
    assert.doesNotMatch(deletion, /ACCOUNT_DELETION_FULL_REFUND_SQL/);
    assert.doesNotMatch(deletion, /FROM\s+(?:public\.)?"Order"/);
  });

  it("defers provider-deleted anonymization when Grainline blockers remain", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const webhook = source("src/app/api/clerk/webhook/route.ts");
    const deferStart = deletion.indexOf("async function deferProviderDeletedAccountAnonymization");
    const byClerkStart = deletion.indexOf("export async function anonymizeUserAccountByClerkId");
    const byClerk = deletion.slice(byClerkStart);

    assert.notEqual(deferStart, -1);
    assert.match(deletion.slice(deferStart, byClerkStart), /banned: true/);
    assert.match(deletion.slice(deferStart, byClerkStart), /banReason: "Clerk account deleted before Grainline deletion blockers cleared; support review required"/);
    assert.match(deletion.slice(deferStart, byClerkStart), /data: \{ chargesEnabled: false, vacationMode: true \}/);
    assert.match(deletion.slice(deferStart, byClerkStart), /tx\.supportRequest\.findFirst\(\{/);
    assert.match(deletion.slice(deferStart, byClerkStart), /kind: "DATA_REQUEST"/);
    assert.match(deletion.slice(deferStart, byClerkStart), /topic: PROVIDER_DELETED_ACCOUNT_DATA_REQUEST_TOPIC/);
    assert.match(deletion.slice(deferStart, byClerkStart), /status: \{ in: \["OPEN", "IN_PROGRESS"\] \}/);
    assert.match(deletion.slice(deferStart, byClerkStart), /tx\.supportRequest\.create\(\{/);
    assert.match(deletion.slice(deferStart, byClerkStart), /slaDueAt: supportRequestSlaDueAt\(now\)/);
    assert.match(deletion, /Provider-side account deletion arrived before Grainline deletion blockers cleared\./);
    assert.match(deletion, /Record provider, counsel, or completion evidence before closing\./);
    assert.match(deletion.slice(deferStart, byClerkStart), /source: "clerk_deleted_account_blocked_anonymization"/);

    assert.match(byClerk, /const blockers = await getAccountDeletionBlockers\(user\.id\)/);
    assert.match(byClerk, /if \(blockers\.length > 0\) \{\s*await deferProviderDeletedAccountAnonymization\(\{ userId: user\.id, clerkId, blockers \}\);/s);
    assert.match(byClerk, /return \{ ok: false, alreadyDeleted: false, blocked: true, blockers \}/);
    assert.ok(
      byClerk.indexOf("const blockers = await getAccountDeletionBlockers(user.id)") <
        byClerk.indexOf("return anonymizeUserAccount(user.id)"),
      "Clerk provider deletion must check Grainline blockers before anonymization",
    );

    assert.match(webhook, /if \(event\.type === "user\.deleted"\) \{\s*const anonymized = await anonymizeUserAccountByClerkId\(event\.data\.id\);/s);
    assert.match(webhook, /"inProgress" in anonymized && anonymized\.inProgress/);
  });
});
