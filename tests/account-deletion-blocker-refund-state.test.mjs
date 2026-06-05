import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account deletion blocker refund state", () => {
  it("waives order deletion blockers only for recorded full refunds", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const blockersStart = deletion.indexOf("export async function getAccountDeletionBlockers");
    const blockersEnd = deletion.indexOf("function messageAttachmentUrl", blockersStart);
    const blockerQuery = deletion.slice(blockersStart, blockersEnd);

    assert.match(deletion, /import \{ REFUND_LOCK_SENTINEL \} from "@\/lib\/refundLockState"/);
    assert.match(deletion, /const ACCOUNT_DELETION_FULL_REFUND_SQL = Prisma\.sql`/);
    assert.match(deletion, /o\."sellerRefundId" <> \$\{REFUND_LOCK_SENTINEL\}/);
    assert.match(deletion, /COALESCE\(o\."sellerRefundAmountCents", 0\) > 0/);
    assert.match(deletion, /COALESCE\(o\."sellerRefundAmountCents", 0\) >= \(/);
    for (const field of [
      "itemsSubtotalCents",
      "shippingAmountCents",
      "giftWrappingPriceCents",
      "taxAmountCents",
    ]) {
      assert.match(deletion, new RegExp(`COALESCE\\(o\\."${field}", 0\\)`));
    }
    assert.match(deletion, /AND NOT \(\$\{ACCOUNT_DELETION_FULL_REFUND_SQL\}\)/);
    assert.match(blockerQuery, /prisma\.\$queryRaw/);
    assert.match(blockerQuery, /SELECT COUNT\(\*\) AS count/);
    assert.match(blockerQuery, /SELECT COUNT\(DISTINCT o\.id\) AS count/);
    assert.doesNotMatch(blockerQuery, /sellerRefundId: null/);
    assert.doesNotMatch(blockerQuery, /paymentEvents: \{ none: blockingRefundLedgerWhere\(\) \}/);
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
    assert.match(deletion.slice(deferStart, byClerkStart), /source: "clerk_deleted_account_blocked_anonymization"/);

    assert.match(byClerk, /const blockers = await getAccountDeletionBlockers\(user\.id\)/);
    assert.match(byClerk, /if \(blockers\.length > 0\) \{\s*await deferProviderDeletedAccountAnonymization\(\{ userId: user\.id, clerkId, blockers \}\);/s);
    assert.match(byClerk, /return \{ ok: false, alreadyDeleted: false, blocked: true, blockers \}/);
    assert.ok(
      byClerk.indexOf("const blockers = await getAccountDeletionBlockers(user.id)") <
        byClerk.indexOf("return anonymizeUserAccount(user.id)"),
      "Clerk provider deletion must check Grainline blockers before anonymization",
    );

    assert.match(webhook, /if \(event\.type === "user\.deleted"\) \{\s*await anonymizeUserAccountByClerkId\(event\.data\.id\);/s);
  });
});
