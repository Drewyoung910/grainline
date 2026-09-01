import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20260901040000_prepare_order_eligibility_authority/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const authority = readFileSync("src/lib/orderEligibilityAuthority.ts", "utf8");
const state = readFileSync("src/lib/orderEligibilityState.ts", "utf8");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Order eligibility authority contract", () => {
  it("converts the four eligibility families away from direct Order reads", () => {
    const converted = [
      "src/app/api/reviews/route.ts",
      "src/app/api/users/[id]/report/route.ts",
      "src/app/api/verification/apply/route.ts",
      "src/app/dashboard/verification/page.tsx",
      "src/lib/listingSoftDelete.ts",
    ];
    for (const path of converted) {
      const text = source(path);
      assert.doesNotMatch(
        text,
        /(?:prisma|tx|client)\.order\b|(?:FROM|JOIN)\s+(?:public\.)?["`]Order["`]/iu,
        path,
      );
      assert.match(text, /orderEligibilityAuthority|get(?:SellerVerificationOrderSales|ListingOrderArchiveBlocked)|lockReviewEligibleOrderItem|canReportOrderTarget/u, path);
    }
  });

  it("keeps the review source lock and every output narrow and actor bound", () => {
    assert.equal((migration.match(/^SECURITY DEFINER$/gmu) ?? []).length, 4);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gmu) ?? []).length, 4);
    assert.match(migration, /FOR UPDATE OF source_order/u);
    assert.match(migration, /source_order\."buyerId" = p_actor_user_id/u);
    assert.match(migration, /seller\."userId" = p_actor_user_id/u);
    assert.match(migration, /source_order\."buyerId" = p_reported_user_id OR seller\."userId" = p_reported_user_id/u);
    assert.doesNotMatch(migration, /RETURNS SETOF public\."Order"|RETURNS public\."Order"/u);
    assert.match(authority, /reviewEligibilityFromRows\(rows\)/u);
    assert.match(state, /if \(rows\.length === 0\) return null/u);
    assert.match(state, /rows\.length !== 1/u);
  });

  it("preserves paid, refund, case-window and runtime grant rules", () => {
    assert.match(migration, /source_order\."paidAt" IS NOT NULL/u);
    assert.match(migration, /source_order\."stripeSessionId" IS NOT NULL/u);
    assert.match(migration, /source_order\."sellerRefundId" IS NULL/u);
    assert.match(migration, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(migration, /INTERVAL '30 days'/u);
    assert.match(migration, /'UNDER_REVIEW'::public\."CaseStatus"/u);
    assert.equal((migration.match(/FROM PUBLIC;/g) ?? []).length, 4);
    assert.equal((migration.match(/TO grainline_app_runtime;/g) ?? []).length, 4);
  });
});
