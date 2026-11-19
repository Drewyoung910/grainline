import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  "utf8",
);
const staffAccess = readFileSync("src/lib/sellerProfileStaffAccess.ts", "utf8");
const reviewPage = readFileSync("src/app/admin/review/page.tsx", "utf8");
const adminLayout = readFileSync("src/app/admin/layout.tsx", "utf8");

test("listing review queue is bounded and isolated to the staff database role", () => {
  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_seller_staff_listing_review_queue\(\s*p_actor_id text,\s*p_limit integer\s*\)/u,
  );
  assert.match(
    migration,
    /grainline_seller_staff_listing_review_queue[\s\S]*SESSION_USER <> 'grainline_staff_read_runtime'/u,
  );
  assert.match(
    migration,
    /p_limit < 1[\s\S]*p_limit > 100/u,
  );
  assert.match(
    migration,
    /ORDER BY listing\."createdAt" ASC, listing\.id ASC[\s\S]*LIMIT p_limit/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_staff_listing_review_queue\(\s*text,integer\s*\)[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;[\s\S]*GRANT EXECUTE ON FUNCTION public\.grainline_seller_staff_listing_review_queue\(\s*text,integer\s*\)[\s\S]*TO grainline_staff_read_runtime;/u,
  );
});

test("admin listing queue and count use the protected authority", () => {
  assert.match(staffAccess, /export async function sellerProfileStaffListingReviewQueue/u);
  assert.match(reviewPage, /sellerProfileStaffListingReviewQueue\(/u);
  assert.match(adminLayout, /sellerProfileStaffListingReviewQueue\(/u);
  assert.doesNotMatch(reviewPage, /prisma\.listing\.(?:count|findMany|groupBy)/u);
  assert.doesNotMatch(adminLayout, /prisma\.listing\.count/u);
});
