import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account deletion timeout and terminal UX guardrails", () => {
  it("keeps large account deletion transactions on an explicit timeout budget", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");

    assert.match(accountDeletion, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(accountDeletion, /\}, \{ timeout: 30000, maxWait: 10000 \}\)\.catch/);
    assert.match(accountDeletion, /source: "account_delete_partial"/);
    assert.match(accountDeletion, /throw error/);
  });

  it("keeps audit-log scans outside the deletion transaction", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const transactionStart = accountDeletion.indexOf("const result = await prisma.$transaction");
    const transactionEnd = accountDeletion.indexOf("}, { timeout: 30000, maxWait: 10000 }).catch");
    assert.notEqual(transactionStart, -1);
    assert.notEqual(transactionEnd, -1);

    const transactionBody = accountDeletion.slice(transactionStart, transactionEnd);
    assert.doesNotMatch(transactionBody, /redactAdminAuditLogsForAccountDeletion\(\{/);
    assert.match(accountDeletion.slice(transactionEnd), /redactAdminAuditLogsForAccountDeletion\(\{\s*db: prisma/s);
    assert.match(accountDeletion, /source: "account_delete_audit_redaction"/);
    assert.match(accountDeletion, /source: "account_delete_media_cleanup"/);
  });

  it("defensively disables seller orderability inside the deletion transaction", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");

    assert.match(accountDeletion, /if \(stripeRejectSucceeded\) \{\s*await tx\.sellerProfile\.updateMany/s);
    assert.match(accountDeletion, /where: \{ userId: user\.id \}/);
    assert.match(accountDeletion, /data: \{ chargesEnabled: false, vacationMode: true \}/);
    assert.match(accountDeletion, /chargesEnabled: false/);
    assert.match(accountDeletion, /vacationMode: true/);
  });

  it("serializes account deletion anonymization before Stripe side effects", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const route = source("src/app/api/account/delete/route.ts");

    assert.match(accountDeletion, /function accountDeletionLockKey\(userId: string\)/);
    assert.match(accountDeletion, /return `account-delete:\$\{userId\}`/);
    assert.match(accountDeletion, /export async function acquireAccountDeletionLock/);
    assert.match(accountDeletion, /redis\.set\(key, "1", \{\s*nx: true,\s*ex: ACCOUNT_DELETION_LOCK_TTL_SECONDS/s);
    const anonymizeStart = accountDeletion.indexOf("export async function anonymizeUserAccount");
    assert.ok(
      accountDeletion.indexOf("await acquireAccountDeletionLock(userId)", anonymizeStart) <
        accountDeletion.indexOf("rejectConnectedStripeAccount(", anonymizeStart),
      "account deletion lock must be acquired before Stripe account rejection",
    );
    assert.match(accountDeletion, /source: "account_delete_lock_release"/);
    assert.match(route, /const deletionLock = await acquireAccountDeletionLock\(me\.id\)/);
    assert.ok(
      route.indexOf("const deletionLock = await acquireAccountDeletionLock(me.id)") <
        route.indexOf("users.deleteUser(clerkId)"),
      "account deletion route must acquire the lock before deleting the Clerk user",
    );
    assert.match(route, /releaseAccountDeletionLock\(deletionLock\)/);
    assert.match(route, /anonymizeUserAccount\(me\.id, \{ lockAlreadyAcquired: true \}\)/);
    assert.match(route, /"inProgress" in anonymized && anonymized\.inProgress/);
    assert.match(route, /status: 409/);
  });

  it("treats post-Clerk anonymization failures as terminal for the client", () => {
    const route = source("src/app/api/account/delete/route.ts");
    const button = source("src/components/AccountDeletionButton.tsx");
    const deletedPage = source("src/app/account/deleted/page.tsx");
    const middleware = source("src/middleware.ts");

    assert.match(route, /clerkSessionDeleted: true/);
    assert.match(button, /data\.clerkSessionDeleted/);
    assert.match(button, /clearRecentlyViewed\(\)/);
    assert.match(button, /signOut\(\{ redirectUrl: "\/account\/deleted\?status=support" \}\)/);
    assert.match(button, /signOut\(\{ redirectUrl: "\/account\/deleted" \}\)/);
    assert.match(deletedPage, /robots: \{ index: false, follow: false \}/);
    assert.match(deletedPage, /Your account has been deleted/);
    assert.match(middleware, /"\/account\/deleted"/);
  });

  it("documents the deletion contract and fixes the account settings link label", () => {
    assert.match(source("src/app/account/page.tsx"), /Account settings →/);
    assert.doesNotMatch(source("src/app/account/page.tsx"), /Notification preferences →/);

    const claude = source("CLAUDE.md");
    assert.match(claude, /Account deletion transaction behavior/);
    assert.match(claude, /timeout: 30000/);
    assert.match(claude, /Do not re-merge audit-log scans or R2 cleanup into the transaction/);

    const audit = source("audit_open_findings.md");
    assert.match(audit, /account deletion timeout\/terminal UX pass/);
    assert.match(audit, /tests\/account-deletion-timeout-fix\.test\.mjs/);
  });
});
