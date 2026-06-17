import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const {
  GUILD_REAPPLY_COOLDOWN_DAYS,
  guildMasterApplicationBlockReason,
  guildMemberApplicationBlockReason,
} = await import("../src/lib/guildApplicationState.ts");

const {
  LISTING_UNDO_FALLBACK_STATUS,
  listingUndoCurrentStatusWhere,
  listingUndoDataFromMetadata,
} = await import("../src/lib/adminListingUndoState.ts");

const {
  GUILD_MASTER_APPLICATION_VERIFICATION_STATUSES,
  GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES,
  GUILD_MEMBER_REINSTATABLE_VERIFICATION_STATUSES,
  GUILD_MEMBER_REVOKABLE_VERIFICATION_STATUSES,
} = await import("../src/lib/guildVerificationState.ts");

describe("Round 10 state-machine guardrails", () => {
  it("blocks immediate Guild reapplication after rejection or revocation using current verification state", () => {
    const now = new Date("2026-05-23T12:00:00.000Z");
    const recentReview = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    const olderReview = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

    assert.equal(GUILD_REAPPLY_COOLDOWN_DAYS, 30);
    assert.match(
      guildMemberApplicationBlockReason({
        guildLevel: "NONE",
        verificationStatus: "REJECTED",
        reviewedAt: recentReview,
        now,
      }) ?? "",
      /Guild Member applications are paused until/,
    );
    assert.equal(
      guildMemberApplicationBlockReason({
        guildLevel: "NONE",
        verificationStatus: "REJECTED",
        reviewedAt: olderReview,
        now,
      }),
      null,
    );
    assert.match(
      guildMasterApplicationBlockReason({
        guildLevel: "GUILD_MEMBER",
        verificationStatus: "GUILD_MASTER_REJECTED",
        reviewedAt: recentReview,
        now,
      }) ?? "",
      /Guild Master applications are paused until/,
    );
    assert.equal(
      guildMasterApplicationBlockReason({
        guildLevel: "GUILD_MEMBER",
        verificationStatus: "APPROVED",
        reviewedAt: recentReview,
        now,
      }),
      null,
    );

    const applyRoute = source("src/app/api/verification/apply/route.ts");
    const dashboard = source("src/app/dashboard/verification/page.tsx");
    const adminVerification = source("src/app/admin/verification/page.tsx");
    const guildMemberCron = source("src/app/api/cron/guild-member-check/route.ts");
    const guildMetricsCron = source("src/app/api/cron/guild-metrics/route.ts");

    assert.match(applyRoute, /guildMemberApplicationBlockReason/);
    assert.match(dashboard, /guildMemberApplicationBlockReason/);
    assert.match(dashboard, /guildMasterApplicationBlockReason/);
    assert.match(adminVerification, /status: "GUILD_MASTER_REJECTED"/);
    assert.match(guildMemberCron, /status: "REJECTED", reviewedAt: now/);
    assert.match(guildMetricsCron, /status: "GUILD_MASTER_REJECTED",\s+reviewedAt: now/s);
  });

  it("guards paired Guild profile and verification transitions with current verification state", () => {
    assert.deepEqual(GUILD_MASTER_APPLICATION_VERIFICATION_STATUSES, ["APPROVED", "GUILD_MASTER_REJECTED"]);
    assert.deepEqual(GUILD_MEMBER_REVOKABLE_VERIFICATION_STATUSES, ["APPROVED", "GUILD_MASTER_REJECTED"]);
    assert.deepEqual(GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES, ["GUILD_MASTER_APPROVED"]);
    assert.deepEqual(GUILD_MEMBER_REINSTATABLE_VERIFICATION_STATUSES, ["REJECTED"]);

    const dashboard = source("src/app/dashboard/verification/page.tsx");
    const adminVerification = source("src/app/admin/verification/page.tsx");
    const guildMemberCron = source("src/app/api/cron/guild-member-check/route.ts");
    const guildMetricsCron = source("src/app/api/cron/guild-metrics/route.ts");

    assert.match(dashboard, /makerVerification\.updateMany\(\{\s*where: \{\s*sellerProfileId: s\.id,\s*status: \{ in: \[\.\.\.GUILD_MASTER_APPLICATION_VERIFICATION_STATUSES\] \}/s);
    assert.match(guildMemberCron, /makerVerification\.updateMany\(\{\s*where: \{\s*sellerProfileId: seller\.id,\s*status: \{ in: \[\.\.\.GUILD_MEMBER_REVOKABLE_VERIFICATION_STATUSES\] \}/s);
    assert.match(guildMetricsCron, /makerVerification\.updateMany\(\{\s*where: \{\s*sellerProfileId: seller\.id,\s*status: \{ in: \[\.\.\.GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES\] \}/s);
    assert.match(adminVerification, /status: \{ in: \[\.\.\.GUILD_MEMBER_REVOKABLE_VERIFICATION_STATUSES\] \}/);
    assert.match(adminVerification, /status: \{ in: \[\.\.\.GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES\] \}/);
    assert.match(adminVerification, /status: \{ in: \[\.\.\.GUILD_MEMBER_REINSTATABLE_VERIFICATION_STATUSES\] \}/);
    assert.match(dashboard, /assertGuildVerificationTransition\(sellerUpdated\.count, "apply for Guild Master"\)/);
    assert.match(adminVerification, /assertGuildVerificationTransition\(updated\.count, "revoke Guild Member"\)/);
    assert.match(adminVerification, /assertGuildVerificationTransition\(updated\.count, "revoke Guild Master"\)/);
    assert.match(adminVerification, /assertGuildVerificationTransition\(updated\.count, "reinstate Guild Member"\)/);
  });

  it("fails listing undo closed and uses current-state guards before restoring metadata", () => {
    assert.equal(LISTING_UNDO_FALLBACK_STATUS, "HIDDEN");
    assert.deepEqual(
      listingUndoDataFromMetadata({ previousStatus: "NOT_A_STATUS" }),
      { status: "HIDDEN", isPrivate: true },
    );
    assert.deepEqual(
      listingUndoDataFromMetadata({
        previousStatus: "ACTIVE",
        previousIsPrivate: false,
        previousRejectionReason: null,
      }),
      { status: "ACTIVE", isPrivate: false, rejectionReason: null },
    );
    assert.deepEqual(
      listingUndoCurrentStatusWhere("REMOVE_LISTING", "listing_1"),
      { id: "listing_1", status: "REJECTED", isPrivate: true },
    );
    assert.deepEqual(
      listingUndoCurrentStatusWhere("HOLD_LISTING", "listing_1"),
      { id: "listing_1", status: "HIDDEN" },
    );

    const audit = source("src/lib/audit.ts");
    assert.match(audit, /tx\.listing\.updateMany/);
    assert.match(audit, /listingUndoCurrentStatusWhere\(log\.action, log\.targetId\)/);
    assert.match(audit, /listingUndoDataFromMetadata\(metadata\)/);
    assert.doesNotMatch(audit, /ListingStatus\.ACTIVE/);
  });

  it("keeps stalled cases, refunds, and Stripe disputes on guarded transitions", () => {
    const autoClose = source("src/app/api/cron/case-auto-close/route.ts");
    const escalate = source("src/app/api/cases/[id]/escalate/route.ts");
    const refund = source("src/app/api/orders/[id]/refund/route.ts");
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(autoClose, /const STALE_DISCUSSION_DAYS = 30/);
    assert.match(autoClose, /status: "IN_DISCUSSION", updatedAt: \{ lt: discussionCutoff \}/);
    assert.match(autoClose, /staleDiscussionEscalated\+\+/);
    assert.match(escalate, /status: "IN_DISCUSSION", escalateUnlocksAt: \{ lt: now \}/);
    assert.match(refund, /tx\.case\.updateMany\(\{\s*where: \{\s*id: existingCase\.id,\s*status: \{ notIn: \["RESOLVED", "CLOSED"\] \},\s*\}/s);
    assert.match(webhook, /tx\.case\.updateMany\(\{\s*where: \{ id: caseAction\.caseId, status: caseAction\.expectedStatus \}/s);
    assert.match(webhook, /resolvedAt: null/);
    assert.match(webhook, /resolvedById: null/);
    assert.match(webhook, /buyerMarkedResolved: false/);
    assert.match(webhook, /sellerMarkedResolved: false/);
  });

  it("surfaces stored case descriptions when dispute-created cases have no messages", () => {
    const fallback = source("src/components/CaseInitialSummary.tsx");
    const adminCase = source("src/app/admin/cases/[id]/page.tsx");
    const sellerCase = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const buyerCase = source("src/app/dashboard/orders/[id]/page.tsx");
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(fallback, /description\.trim\(\)/);
    assert.match(fallback, /Case summary/);
    assert.match(webhook, /description: caseAction\.description/);
    assert.match(adminCase, /caseRecord\.messages\.length === 0 \? \(\s*<CaseInitialSummary description=\{caseRecord\.description\} \/>/s);
    assert.match(sellerCase, /activeCase\.messages\.length === 0 \? \(\s*<div className="bg-white px-4 py-3">\s*<CaseInitialSummary description=\{activeCase\.description\} \/>/s);
    assert.match(buyerCase, /activeCase\.messages\.length === 0 \? \(\s*<div className="bg-white px-4 py-3">\s*<CaseInitialSummary description=\{activeCase\.description\} \/>/s);
  });

  it("coordinates label/manual shipping, admin approval fanout, and mark-resolved notifications", () => {
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const adminReview = source("src/app/api/admin/listings/[id]/review/route.ts");
    const markResolved = source("src/app/api/cases/[id]/mark-resolved/route.ts");

    assert.match(fulfillment, /authz\.order\.labelStatus === "PURCHASED"/);
    assert.match(fulfillment, /labelStatus: \{ not: LabelStatus\.PURCHASED \}/);
    assert.match(adminReview, /fanOutListingToFollowers/);
    assert.match(adminReview, /admin-approved-listing:\$\{listing\.id\}:\$\{followerId\}/);
    assert.match(adminReview, /source: 'admin_listing_review_follower_fanout'/);
    assert.match(markResolved, /notifyCounterpartyOfResolutionMark/);
    assert.match(markResolved, /type: resolved \? "CASE_RESOLVED" : "CASE_MESSAGE"/);
    assert.match(markResolved, /dedupScope: `\$\{caseId\}:\$\{status\}:\$\{actorId\}`/);
  });
});
