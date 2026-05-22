import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("admin moderation hardening follow-ups", () => {
  it("expires open checkout sessions when staff remove a listing", () => {
    const route = source("src/app/api/admin/listings/[id]/route.ts");

    assert.match(route, /expireOpenCheckoutSessionsForListing/);
    assert.match(route, /source: "admin_listing_remove"/);
    assert.match(route, /sellerId: listing\.sellerId/);
  });

  it("captures admin listing-review and custom-order side effects", () => {
    const reviewRoute = source("src/app/api/admin/listings/[id]/review/route.ts");
    const customOrderReadyLink = source("src/lib/customOrderReadyLink.ts");

    assert.match(reviewRoute, /source: 'admin_listing_review_founding_maker'/);
    assert.match(reviewRoute, /source: 'admin_listing_review_notification'/);
    assert.doesNotMatch(reviewRoute, /\.catch\(\(\) => \{\}\)/);
    assert.match(customOrderReadyLink, /source: "custom_order_ready_email"/);
    assert.match(customOrderReadyLink, /listingId: listing\.id/);
    assert.doesNotMatch(customOrderReadyLink, /extra:\s*\{[^}]*email/s);
  });

  it("rechecks seller orderability before admin listing approval", () => {
    const reviewRoute = source("src/app/api/admin/listings/[id]/review/route.ts");

    assert.match(reviewRoute, /function sellerUnavailableReason/);
    assert.match(reviewRoute, /chargesEnabled: true/);
    assert.match(reviewRoute, /vacationMode: false/);
    assert.match(reviewRoute, /user: \{ banned: false, deletedAt: null \}/);
    assert.match(reviewRoute, /status: 'PENDING_REVIEW'/);
    assert.match(reviewRoute, /return NextResponse\.json\(\{ error: unavailableReason \}, \{ status: 409 \}\)/);
    assert.match(reviewRoute, /return NextResponse\.json\(\{ error: currentUnavailableReason \}, \{ status: 409 \}\)/);
    assert.match(reviewRoute, /currentListing\.status === 'ACTIVE' &&\s*!\s*currentUnavailableReason/s);
    assert.ok(
      reviewRoute.indexOf("const unavailableReason = sellerUnavailableReason(listing.seller)") <
        reviewRoute.indexOf("await prisma.listing.updateMany"),
      "seller orderability should be checked before ACTIVE approval mutation",
    );
    assert.ok(
      reviewRoute.indexOf("await prisma.listing.updateMany") <
        reviewRoute.indexOf("await maybeGrantFoundingMaker(listing.sellerId)"),
      "Founding Maker grant should only run after guarded ACTIVE mutation succeeds",
    );
  });

  it("keeps report resolution rate-limited and stale-safe", () => {
    const route = source("src/app/api/admin/reports/[id]/resolve/route.ts");

    assert.match(route, /adminActionRatelimit/);
    assert.match(route, /safeRateLimit\(adminActionRatelimit, admin\.id\)/);
    assert.match(route, /userReport\.updateMany/);
    assert.match(route, /where: \{ id, resolved: false \}/);
  });

  it("keeps admin review rating summaries transactional and cleanup telemetry bounded", () => {
    const route = source("src/app/api/admin/reviews/[id]/route.ts");

    assert.match(route, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(route, /await refreshSellerRatingSummary\(review\.listing\.sellerId, tx\)/);
    assert.doesNotMatch(route, /source: "admin_review_rating_summary_refresh"/);
    assert.match(route, /source: "admin_review_photo_cleanup"/);
    assert.match(route, /captureAdminReviewPhotoCleanupFailures/);
    assert.match(route, /const host = mediaUrlHost/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*url/s);
  });

  it("captures admin email and verification email failures with safe telemetry", () => {
    const emailRoute = source("src/app/api/admin/email/route.ts");
    const verificationPage = source("src/app/admin/verification/page.tsx");

    assert.match(emailRoute, /hashEmailForTelemetry/);
    assert.match(emailRoute, /source: "admin_email_send"/);
    assert.match(emailRoute, /source: "admin_email_notification"/);
    assert.match(emailRoute, /source: "admin_email_audit_log"/);
    assert.match(emailRoute, /const auditTargetId = body\.userId \?\? `email:\$\{hashEmailForTelemetry\(normalizedRecipientEmail\) \?\? "unknown"\}`/);
    assert.match(emailRoute, /targetType: body\.userId \? "USER" : "EMAIL"/);
    assert.match(emailRoute, /targetId: auditTargetId/);
    assert.doesNotMatch(emailRoute, /targetId: normalizedRecipientEmail/);
    assert.doesNotMatch(emailRoute, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    assert.match(verificationPage, /"admin_verification_email"/);
    assert.doesNotMatch(verificationPage, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("captures admin blog comment approval notification failures", () => {
    const page = source("src/app/admin/blog/page.tsx");

    assert.match(page, /Sentry\.captureException/);
    assert.match(page, /source: "admin_blog_comment_approval_notification"/);
    assert.doesNotMatch(page, /catch \{\s*\/\* non-fatal/);
  });
});
