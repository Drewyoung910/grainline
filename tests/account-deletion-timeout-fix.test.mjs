import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account deletion timeout and terminal UX guardrails", () => {
  it("keeps large account deletion transactions on an explicit timeout budget", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");

    assert.match(accountDeletion, /withDbUserContext\(userId, async \(tx\) =>/);
    assert.match(accountDeletion, /\}, \{ timeout: 30000, maxWait: 10000 \}\)\.catch/);
    assert.match(accountDeletion, /source: "account_delete_partial"/);
    assert.match(accountDeletion, /throw error/);
  });

  it("keeps audit-log scans outside the deletion transaction", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const transactionStart = accountDeletion.indexOf("const result = await withDbUserContext");
    const transactionEnd = accountDeletion.indexOf("}, { timeout: 30000, maxWait: 10000 }).catch");
    assert.notEqual(transactionStart, -1);
    assert.notEqual(transactionEnd, -1);

    const transactionBody = accountDeletion.slice(transactionStart, transactionEnd);
    assert.doesNotMatch(transactionBody, /collectAdminAuditLogRedactionUpdates\(\{/);
    assert.match(accountDeletion.slice(transactionEnd), /collectAdminAuditLogRedactionUpdates\(\{\s*db: prisma/s);
    assert.match(accountDeletion.slice(transactionEnd), /enqueueAccountDeletionAuditRedactionSideEffects\(prisma, userId, redactionUpdates\)/);
    assert.match(accountDeletion, /source: "account_delete_audit_redaction"/);
    assert.match(accountDeletion, /source: "account_delete_media_cleanup"/);
  });

  it("keeps Prisma work sequential in account-deletion transaction helpers", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const sellerFanoutStart = accountDeletion.indexOf("async function cleanupDeletedSellerFanoutRows");
    const sellerFanoutEnd = accountDeletion.indexOf("async function collectMessagesBySensitiveText", sellerFanoutStart);
    const mediaCollectionStart = accountDeletion.indexOf("async function collectAccountDeletionMediaUrls");
    const mediaCollectionEnd = accountDeletion.indexOf("function revalidateDeletedAccountSearchCaches", mediaCollectionStart);

    assert.notEqual(sellerFanoutStart, -1);
    assert.notEqual(sellerFanoutEnd, -1);
    assert.notEqual(mediaCollectionStart, -1);
    assert.notEqual(mediaCollectionEnd, -1);

    const sellerFanout = accountDeletion.slice(sellerFanoutStart, sellerFanoutEnd);
    const mediaCollection = accountDeletion.slice(mediaCollectionStart, mediaCollectionEnd);
    assert.doesNotMatch(sellerFanout, /Promise\.all\s*\(/);
    assert.doesNotMatch(mediaCollection, /Promise\.all\s*\(/);
    assert.match(sellerFanout, /await tx\.sellerBroadcast\.findMany[\s\S]*await tx\.listing\.findMany[\s\S]*await tx\.blogPost\.findMany/);
    assert.match(
      mediaCollection,
      /await db\.sellerProfile\.findUnique[\s\S]*await db\.reviewPhoto\.findMany[\s\S]*await db\.commissionRequest\.findMany[\s\S]*await db\.message\.findMany[\s\S]*await db\.blogPost\.findMany[\s\S]*await db\.directUpload\.findMany/,
    );
  });

  it("defensively disables seller orderability inside the deletion transaction", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");

    assert.match(accountDeletion, /if \(stripeRejectSucceeded\) \{\s*await tx\.sellerProfile\.updateMany/s);
    assert.match(accountDeletion, /where: \{ userId: user\.id \}/);
    assert.match(accountDeletion, /data: \{ chargesEnabled: false, vacationMode: true \}/);
    assert.match(accountDeletion, /chargesEnabled: false/);
    assert.match(accountDeletion, /vacationMode: true/);
  });

  it("marks sellers non-orderable after Stripe reject before the large transaction", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const stripeReject = accountDeletion.indexOf("const stripeRejectSucceeded =");
    const preTransactionDisable = accountDeletion.indexOf("await disableSellerOrderabilityAfterStripeReject");
    const transactionStart = accountDeletion.indexOf("const result = await withDbUserContext");

    assert.notEqual(stripeReject, -1);
    assert.notEqual(preTransactionDisable, -1);
    assert.notEqual(transactionStart, -1);
    assert.ok(stripeReject < preTransactionDisable);
    assert.ok(preTransactionDisable < transactionStart);
    assert.match(accountDeletion, /async function disableSellerOrderabilityAfterStripeReject/);
    assert.match(accountDeletion, /where: \{ userId: input\.userId, stripeAccountId: input\.stripeAccountId \}/);
    assert.match(accountDeletion, /data: \{ chargesEnabled: false, vacationMode: true \}/);
    assert.match(accountDeletion, /source: "account_delete_stripe_reject_local_disable"/);
  });

  it("expires, restores, and scrubs account checkout stock reservations during deletion", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const cleanupStart = accountDeletion.indexOf("async function cleanupAccountCheckoutStockReservationsForDeletion");
    const scrubStart = accountDeletion.indexOf("async function scrubCheckoutStockReservationsForDeletedAccount");
    const anonymizeStart = accountDeletion.indexOf("export async function anonymizeUserAccount");
    const transactionStart = accountDeletion.indexOf("const result = await withDbUserContext");

    assert.notEqual(cleanupStart, -1);
    assert.notEqual(scrubStart, -1);
    assert.notEqual(anonymizeStart, -1);
    assert.notEqual(transactionStart, -1);
    assert.ok(cleanupStart < anonymizeStart);
    assert.ok(scrubStart < anonymizeStart);
    assert.ok(
      accountDeletion.indexOf("cleanupAccountCheckoutStockReservationsForDeletion({", anonymizeStart) <
        transactionStart,
      "best-effort Stripe/session cleanup should run before the large anonymization transaction",
    );
    assert.ok(
      accountDeletion.indexOf("scrubCheckoutStockReservationsForDeletedAccount(tx", transactionStart) >
        transactionStart,
      "reservation identifier scrubbing should run inside the local anonymization transaction",
    );
    assert.match(accountDeletion, /ACCOUNT_DELETION_CHECKOUT_RESERVATION_CLEANUP_BATCH_SIZE = 50/);
    assert.match(accountDeletion, /status: \{ in: \["RESERVED", "SESSION_CREATED"\] \}/);
    assert.match(accountDeletion, /restoreCheckoutStockReservationOnce\(\{[\s\S]*reason: "account_deletion_no_session"/);
    assert.match(accountDeletion, /stripe\.checkout\.sessions\.retrieve\(sessionId\)/);
    assert.match(accountDeletion, /checkoutStockReservationRepairAction\(session\)/);
    assert.match(accountDeletion, /action === "skip_paid_or_complete" \|\| action === "skip_unrecognized"/);
    assert.match(accountDeletion, /stripe\.checkout\.sessions\.expire\(sessionId\)/);
    assert.match(accountDeletion, /reason: "account_deletion_stripe_session_unpaid"/);
    assert.match(accountDeletion, /source: "account_delete_checkout_reservation_cleanup"/);
    assert.match(accountDeletion, /checkoutLockKey: `deleted:\$\{reservation\.id\}`/);
    assert.match(accountDeletion, /payloadHash: "deleted"/);
    assert.match(accountDeletion, /reservedItems: parseCheckoutStockReservationItems\(reservation\.reservedItems\) as Prisma\.InputJsonValue/);
    assert.match(accountDeletion, /where: \{ buyerId: userId \},\s*data: \{ buyerId: null \}/);
    assert.match(accountDeletion, /where: \{ sellerId: sellerProfileId \},\s*data: \{ sellerId: null \}/);
  });

  it("writes a user-requested account deletion audit row before anonymization", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    const auditCreate = accountDeletion.indexOf('action: "USER_ACCOUNT_DELETE"');
    const userRedaction = accountDeletion.indexOf("deletedEmail");
    const transactionStart = accountDeletion.indexOf("const result = await withDbUserContext");
    const transactionEnd = accountDeletion.indexOf("}, { timeout: 30000, maxWait: 10000 }).catch");

    assert.notEqual(auditCreate, -1);
    assert.ok(auditCreate > transactionStart && auditCreate < transactionEnd);
    assert.ok(auditCreate > userRedaction, "audit row should be built after deletion metadata is computed");
    assert.match(accountDeletion, /adminId: user\.id/);
    assert.match(accountDeletion, /targetType: "USER"/);
    assert.match(accountDeletion, /targetId: user\.id/);
    assert.match(accountDeletion, /reason: "User requested account deletion"/);
    assert.match(accountDeletion, /actorKind: "user"/);
    assert.match(accountDeletion, /hadStripeAccount: Boolean\(stripeAccountId\)/);
    assert.match(accountDeletion, /stripeRejectSucceeded/);
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
        accountDeletion.indexOf("runAccountDeletionStripeRejectSideEffect", anonymizeStart),
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
    assert.match(route, /enqueueAccountDeletionLocalAnonymizeSideEffect\(prisma, me\.id\)/);
    assert.ok(
      route.indexOf("users.deleteUser(clerkId)") <
        route.indexOf("enqueueAccountDeletionLocalAnonymizeSideEffect(prisma, me.id)"),
      "account deletion route must not enqueue local anonymization until Clerk deletion succeeds",
    );
    assert.match(route, /anonymizeUserAccount\(me\.id, \{ lockAlreadyAcquired: true \}\)/);
    assert.match(route, /"inProgress" in anonymized && anonymized\.inProgress/);
    assert.match(route, /status: HTTP_STATUS\.CONFLICT/);
  });

  it("keeps account deletion behind same-origin, fresh-session, and server confirmation checks", () => {
    const route = source("src/app/api/account/delete/route.ts");
    const button = source("src/components/AccountDeletionButton.tsx");

    assert.match(route, /import \{ auth, clerkClient, reverificationErrorResponse \} from "@clerk\/nextjs\/server"/);
    assert.match(route, /getExplicitCrossOriginPostRejection\(req\)/);
    assert.match(route, /hasFreshAccountDeletionSession\(session\.factorVerificationAge\)/);
    assert.match(route, /reverificationErrorResponse\(ACCOUNT_DELETION_REVERIFICATION\)/);
    assert.match(route, /confirmText: z\.literal\("DELETE"\)/);
    assert.match(route, /readBoundedJson\(req, ACCOUNT_DELETION_BODY_MAX_BYTES\)/);

    const guardIndex = route.indexOf("getExplicitCrossOriginPostRejection(req)");
    const authIndex = route.indexOf("await auth()");
    const freshnessIndex = route.indexOf("hasFreshAccountDeletionSession(session.factorVerificationAge)");
    const bodyIndex = route.indexOf("readBoundedJson(req, ACCOUNT_DELETION_BODY_MAX_BYTES)");
    const rateIndex = route.indexOf("safeRateLimit(accountDeletionRatelimit");
    const blockersIndex = route.indexOf("getAccountDeletionBlockers(me.id)");
    const lockIndex = route.indexOf("acquireAccountDeletionLock(me.id)");
    const clerkIndex = route.indexOf("users.deleteUser(clerkId)");

    assert.ok(guardIndex >= 0);
    assert.ok(authIndex > guardIndex);
    assert.ok(freshnessIndex > authIndex);
    assert.ok(bodyIndex > freshnessIndex);
    assert.ok(rateIndex > bodyIndex);
    assert.ok(blockersIndex > rateIndex);
    assert.ok(lockIndex > blockersIndex);
    assert.ok(clerkIndex > lockIndex);

    assert.match(button, /useReverification\(requestAccountDeletion\)/);
    assert.match(button, /credentials: "same-origin"/);
    assert.match(button, /"Content-Type": "application\/json"/);
    assert.match(button, /body: JSON\.stringify\(\{ confirmText \}\)/);
    assert.match(button, /isReverificationCancelledError\(error\)/);
  });

  it("treats post-Clerk anonymization failures as terminal for the client", () => {
    const route = source("src/app/api/account/delete/route.ts");
    const button = source("src/components/AccountDeletionButton.tsx");
    const deletedPage = source("src/app/account/deleted/page.tsx");
    const middleware = source("src/middleware.ts");

    assert.match(route, /clerkSessionDeleted: true/);
    assert.match(button, /data\.clerkSessionDeleted/);
    assert.match(button, /clearSignedOutLocalAccountState\(\)/);
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
    assert.match(claude, /Do not re-merge audit-log scans or R2 object deletion into the transaction/);

    assert.match(source("docs/runbook.md"), /public support\/legal request handling/);
  });
});
