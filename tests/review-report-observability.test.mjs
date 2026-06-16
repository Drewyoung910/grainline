import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("review/report/favorite observability hardening", () => {
  it("keeps review rating summaries in the review write transaction", () => {
    const createRoute = source("src/app/api/reviews/route.ts");
    const editRoute = source("src/app/api/reviews/[id]/route.ts");
    const ratingSummary = source("src/lib/sellerRatingSummary.ts");

    assert.match(createRoute, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(createRoute, /await refreshSellerRatingSummary\(orderItem\.listing\.sellerId, tx\)/);
    assert.match(editRoute, /await refreshSellerRatingSummary\(r\.listing\.sellerId, tx\)/);
    assert.match(editRoute, /await refreshSellerRatingSummary\(review\.listing\.sellerId, tx\)/);
    assert.match(ratingSummary, /pg_advisory_xact_lock\(913343, hashtext\(\$\{sellerProfileId\}\)\)/);
    assert.match(ratingSummary, /db: RatingDbClient = prisma/);
    assert.match(ratingSummary, /if \(db === prisma\)[\s\S]*prisma\.\$transaction/);
    assert.doesNotMatch(createRoute, /source: "review_rating_summary_refresh"/);
    assert.doesNotMatch(editRoute, /source: "review_rating_summary_refresh"/);
  });

  it("captures review side-effect failures with bounded identifiers", () => {
    const createRoute = source("src/app/api/reviews/route.ts");
    const editRoute = source("src/app/api/reviews/[id]/route.ts");

    assert.match(createRoute, /import \{ sanitizeEmailOutboxError \} from "@\/lib\/emailOutboxSanitize"/);
    assert.match(createRoute, /source: "review_notification_email"/);
    assert.match(createRoute, /console\.error\("Failed to create review notification:", sanitizeEmailOutboxError\(e\)\)/);
    assert.match(createRoute, /console\.error\("Failed to send review notification email:", sanitizeEmailOutboxError\(e\)\)/);
    assert.doesNotMatch(createRoute, /console\.error\("Failed to create review notification:", e\)/);
    assert.doesNotMatch(createRoute, /console\.error\("Failed to send review notification email:", e\)/);
    assert.match(editRoute, /source: "review_photo_cleanup_edit"/);
    assert.match(editRoute, /source: "review_photo_cleanup_delete"/);
    assert.match(editRoute, /Review photo cleanup skipped non-R2 media/);
    assert.doesNotMatch(editRoute, /extra:\s*\{[^}]*url/s);
  });

  it("captures report, favorite, and block cleanup failures instead of swallowing them", () => {
    const reportRoute = source("src/app/api/users/[id]/report/route.ts");
    const favoriteRoute = source("src/app/api/favorites/route.ts");
    const blockRoute = source("src/app/api/users/[id]/block/route.ts");

    assert.match(reportRoute, /source: "user_report_listing_notification"/);
    assert.doesNotMatch(reportRoute, /\.catch\(\(\) => \{\}\)/);
    assert.match(favoriteRoute, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(favoriteRoute, /source: "favorite_upsert"/);
    assert.match(favoriteRoute, /source: "favorite_notification"/);
    assert.doesNotMatch(favoriteRoute, /console\.error\("POST \/api\/favorites/);
    assert.match(blockRoute, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(blockRoute, /source: "block_follow_cleanup"/);
    assert.doesNotMatch(blockRoute, /console\.error\("Failed to remove follow rows after block:/);
  });

  it("captures remaining AI and seller analytics failures with Sentry context", () => {
    const aiReview = source("src/lib/ai-review.ts");
    const altText = source("src/lib/photoAltTextBackfill.ts");
    const analytics = source("src/app/api/seller/analytics/route.ts");
    const recentSales = source("src/app/api/seller/analytics/recent-sales/route.ts");

    assert.match(aiReview, /source: "ai_review_duplicate_check"/);
    assert.match(aiReview, /source: "ai_review"/);
    assert.match(aiReview, /source: "ai_alt_text_generate"/);
    assert.doesNotMatch(aiReview, /catch \{\s*return null;\s*\}/);
    assert.match(altText, /source: "photo_alt_text_backfill"/);
    assert.match(analytics, /source: "seller_analytics"/);
    assert.match(recentSales, /source: "seller_analytics_recent_sales"/);
  });
});
