import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

const makerVerificationPreparationMigrationPath =
  process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH?.trim()
  || "prisma/migrations/20261028040000_prepare_maker_verification_authorities/migration.sql";

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
    const guildMetricsCron = source("src/app/api/cron/guild-metrics/route.ts");
    const guildMetricsAuthority = source(
      sellerProfilePrivateMigrationPath("20261014190000_prepare_seller_profile_private_guild_metrics_authority"),
    );
    const guildMemberAuthority = source(
      sellerProfilePrivateMigrationPath("20261014200000_prepare_seller_profile_private_guild_member_revocation_authority"),
    );
    const staffTransitionAuthority = source(
      sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"),
    );

    assert.match(applyRoute, /guildMemberApplicationBlockReason/);
    assert.match(dashboard, /guildMemberApplicationBlockReason/);
    assert.match(dashboard, /guildMasterApplicationBlockReason/);
    assert.match(staffTransitionAuthority, /'GUILD_MASTER_REJECTED'::public\."VerificationStatus"/);
    assert.match(guildMemberAuthority, /status = 'REJECTED'[\s\S]*"reviewedAt" = source_now/);
    assert.match(guildMetricsAuthority, /status = 'GUILD_MASTER_REJECTED'/);
    assert.match(guildMetricsCron, /applySellerGuildMetrics/);
  });

  it("guards paired Guild profile and verification transitions with current verification state", () => {
    assert.deepEqual(GUILD_MASTER_APPLICATION_VERIFICATION_STATUSES, ["APPROVED", "GUILD_MASTER_REJECTED"]);
    assert.deepEqual(GUILD_MEMBER_REVOKABLE_VERIFICATION_STATUSES, ["APPROVED", "GUILD_MASTER_REJECTED"]);
    assert.deepEqual(GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES, ["GUILD_MASTER_APPROVED"]);
    assert.deepEqual(GUILD_MEMBER_REINSTATABLE_VERIFICATION_STATUSES, ["REJECTED"]);

    const dashboard = source("src/app/dashboard/verification/page.tsx");
    const adminVerification = source("src/app/admin/verification/page.tsx");
    const staffGuildAccess = source("src/lib/sellerGuildStaffPrivateAccess.ts");
    const guildMemberCron = source("src/app/api/cron/guild-member-check/route.ts");
    const guildMetricsCron = source("src/app/api/cron/guild-metrics/route.ts");
    const guildMetricsAuthority = source(
      sellerProfilePrivateMigrationPath("20261014190000_prepare_seller_profile_private_guild_metrics_authority"),
    );
    const guildMemberAuthority = source(
      sellerProfilePrivateMigrationPath("20261014200000_prepare_seller_profile_private_guild_member_revocation_authority"),
    );
    const staffTransitionAuthority = source(
      sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"),
    );

    assert.match(dashboard, /applyOwnerGuildMasterVerification\(s\.userId/);
    assert.doesNotMatch(dashboard, /makerVerification\.(?:update|updateMany|upsert)/);
    assert.doesNotMatch(guildMemberCron, /makerVerification\.updateMany/);
    assert.match(guildMemberAuthority, /status IN \([\s\S]*'APPROVED'[\s\S]*'GUILD_MASTER_REJECTED'/);
    assert.doesNotMatch(guildMetricsCron, /makerVerification\.updateMany/);
    assert.match(guildMetricsAuthority, /status = 'GUILD_MASTER_APPROVED'/);
    const makerVerificationAuthority = source(
      makerVerificationPreparationMigrationPath,
    );
    assert.match(makerVerificationAuthority, /source_verification\.status NOT IN \([\s\S]*'APPROVED'[\s\S]*'GUILD_MASTER_REJECTED'/);
    assert.match(makerVerificationAuthority, /UPDATE public\."SellerProfilePrivate"[\s\S]*"guildMasterAppliedAt" = source_now/);
    for (const operation of ["REVOKE_GUILD_MEMBER", "REVOKE_GUILD_MASTER", "REINSTATE_GUILD_MEMBER"]) {
      assert.match(adminVerification, new RegExp(`operation: "${operation}"`));
    }
    assert.match(staffGuildAccess, /grainline_seller_guild_staff_transition/);
    assert.match(staffTransitionAuthority, /source_seller\."guildLevel" <> 'GUILD_MEMBER'/);
    assert.match(staffTransitionAuthority, /source_seller\."guildLevel" <> 'GUILD_MASTER'/);
    assert.match(staffTransitionAuthority, /source_verification\.status <> 'REJECTED'/);
    assert.match(staffTransitionAuthority, /source_private\."guildMemberApprovedAt" IS NULL/);
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
    const transitionAuthority = source(
      "prisma/migrations/20260729060000_prepare_case_escalation_cron_authority/migration.sql",
    );
    const refund = source("src/app/api/orders/[id]/refund/route.ts");
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const disputeAuthority = source(
      "prisma/migrations/20260729043000_prepare_case_stripe_dispute_authority/migration.sql",
    );
    const signedDisputeAuthority = source(
      "prisma/migrations/20260824030000_prepare_order_payment_signed_authority/migration.sql",
    );
    const refundAuthority = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    );

    assert.match(autoClose, /family: "OPEN_RESPONSE_DUE"/);
    assert.match(autoClose, /family: "STALE_DISCUSSION"/);
    assert.match(transitionAuthority, /transition_at - INTERVAL '30 days'/);
    assert.match(
      transitionAuthority,
      /case_row\."sellerRespondBy" < transition_cutoff/,
    );
    assert.doesNotMatch(transitionAuthority, /14 days|14\+ days/);
    assert.match(
      transitionAuthority,
      /case_row\.status = 'IN_DISCUSSION'::public\."CaseStatus"[\s\S]*case_row\."updatedAt" < transition_cutoff/,
    );
    assert.match(autoClose, /staleDiscussionEscalated \+= rows\.length/);
    assert.match(
      transitionAuthority,
      /locked_case\."escalateUnlocksAt" > transition_at/,
    );
    assert.doesNotMatch(escalate, /verifyCronRequest|id === "all"/);
    assert.match(refund, /finalizeSellerOrderRefund/);
    assert.match(refundAuthority, /grainline_case_seller_refund_apply/);
    assert.doesNotMatch(refund, /(?:prisma|tx)\.case\.(?:findUnique|updateMany)\(/);
    assert.match(webhook, /applySignedDisputeWebhook\(tx,/);
    assert.doesNotMatch(webhook, /tx\.case\.(?:create|update|updateMany)\(/);
    assert.match(signedDisputeAuthority, /grainline_case_stripe_dispute_apply\(payment_event_id\)/);
    assert.match(disputeAuthority, /status = 'UNDER_REVIEW'::public\."CaseStatus"/);
    assert.match(disputeAuthority, /resolution = NULL/);
    assert.match(disputeAuthority, /"resolvedAt" = NULL/);
    assert.match(disputeAuthority, /"resolvedById" = NULL/);
    assert.match(disputeAuthority, /"buyerMarkedResolved" = false/);
    assert.match(disputeAuthority, /"sellerMarkedResolved" = false/);
  });

  it("surfaces stored case descriptions when dispute-created cases have no messages", () => {
    const fallback = source("src/components/CaseInitialSummary.tsx");
    const adminCase = source("src/app/admin/cases/[id]/page.tsx");
    const sellerCase = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const buyerCase = source("src/app/dashboard/orders/[id]/page.tsx");
    const disputeAuthority = source(
      "prisma/migrations/20260729043000_prepare_case_stripe_dispute_authority/migration.sql",
    );

    assert.match(fallback, /description\.trim\(\)/);
    assert.match(fallback, /Case summary/);
    assert.match(
      disputeAuthority,
      /opening_description := pg_catalog\.left\([\s\S]*'Stripe payment dispute '/,
    );
    assert.match(
      disputeAuthority,
      /INSERT INTO public\."Case"[\s\S]*description,[\s\S]*opening_description/,
    );
    for (const page of [adminCase, sellerCase, buyerCase]) {
      assert.match(page, /caseMessageHistory(?:!)?\.messages\.length === 0/);
    }
    assert.match(adminCase, /<CaseInitialSummary description=\{caseRecord\.description\} \/>/);
    assert.match(sellerCase, /<CaseInitialSummary description=\{activeCase\.description\} \/>/);
    assert.match(buyerCase, /<CaseInitialSummary description=\{activeCase\.description\} \/>/);
  });

  it("coordinates label/manual shipping, admin approval fanout, and mark-resolved notifications", () => {
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const fulfillmentAuthority = source(
      "prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql",
    );
    const adminReview = source("src/app/api/admin/listings/[id]/review/route.ts");
    const markResolved = source("src/app/api/cases/[id]/mark-resolved/route.ts");

    assert.match(fulfillment, /finalizeSellerOrderFulfillment\(\{/);
    assert.match(fulfillmentAuthority, /locked_order\."labelStatus"::text = 'PURCHASED'/);
    assert.match(fulfillmentAuthority, /'reason', 'label_purchased'/);
    assert.match(adminReview, /fanOutListingToFollowers/);
    assert.match(adminReview, /admin-approved-listing:\$\{listing\.id\}:\$\{followerId\}/);
    assert.match(adminReview, /source: 'admin_listing_review_follower_fanout'/);
    assert.match(markResolved, /notifyCounterpartyOfResolutionMark/);
    assert.match(markResolved, /type: resolved \? "CASE_RESOLVED" : "CASE_MESSAGE"/);
    assert.match(markResolved, /dedupScope: `\$\{caseId\}:\$\{status\}:\$\{actorId\}`/);
  });
});
