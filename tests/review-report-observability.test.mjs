import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("review/report/favorite observability hardening", () => {
  it("captures review side-effect failures with bounded identifiers", () => {
    const createRoute = source("src/app/api/reviews/route.ts");
    const editRoute = source("src/app/api/reviews/[id]/route.ts");

    assert.match(createRoute, /source: "review_rating_summary_refresh"/);
    assert.match(createRoute, /source: "review_notification_email"/);
    assert.match(editRoute, /source: "review_rating_summary_refresh"/);
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
    assert.match(favoriteRoute, /source: "favorite_upsert"/);
    assert.match(favoriteRoute, /source: "favorite_notification"/);
    assert.match(blockRoute, /source: "block_follow_cleanup"/);
  });
});
