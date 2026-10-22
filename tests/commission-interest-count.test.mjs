import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const { resolvedInterestedCount } = await import("../src/lib/commissionInterestCountValue.ts");

describe("commission interest counts", () => {
  it("prefers the live relation count over a denormalized counter", () => {
    assert.equal(
      resolvedInterestedCount({
        interestedCount: 12,
        _count: { interests: 3 },
      }),
      3,
    );
  });

  it("falls back to the stored count for legacy callers without _count", () => {
    assert.equal(resolvedInterestedCount({ interestedCount: 7 }), 7);
    assert.equal(resolvedInterestedCount({}), 0);
  });

  it("routes public counts and cards through the bounded database authorities", () => {
    const access = source("src/lib/commissionInterestCount.ts");
    assert.match(access, /grainline_seller_public_commission_interest_counts/);
    assert.match(access, /grainline_seller_public_commission_interest_cards/);
    assert.match(access, /withDbUserContext/);
    for (const path of [
      "src/app/api/commission/[id]/route.ts",
      "src/app/api/commission/route.ts",
      "src/app/commission/[param]/page.tsx",
      "src/app/commission/page.tsx",
    ]) {
      const routeSource = source(path);
      assert.match(routeSource, /publicCommissionInterestCounts\(/);
      assert.doesNotMatch(routeSource, /publicCommissionInterestWhere\(/);
    }

    for (const path of [
      "src/app/api/commission/[id]/route.ts",
      "src/app/commission/[param]/page.tsx",
    ]) {
      const routeSource = source(path);
      assert.match(routeSource, /publicCommissionInterestCards\(/);
    }
  });

  it("removes the public Near Me SellerProfile join", () => {
    const page = source("src/app/commission/page.tsx");
    assert.doesNotMatch(page, /JOIN public\."SellerProfile"|JOIN "SellerProfile"/);
    assert.match(page, /publicCommissionInterestCounts\(rawResults\.map/);
  });

  it("routes owner summaries and notification targets through fixed authorities", () => {
    const access = source("src/lib/commissionInterestResidualAccess.ts");
    assert.match(access, /grainline_seller_owner_commission_interest_summaries/);
    assert.match(access, /grainline_seller_service_commission_interest_targets/);
    assert.match(access, /withDbUserContext/);

    const account = source("src/app/account/commissions/page.tsx");
    assert.match(account, /ownerCommissionInterestSummaries\(/);
    assert.doesNotMatch(account, /interests:\s*\{/);

    for (const path of [
      "src/app/api/commission/[id]/route.ts",
      "src/app/api/cron/commission-expire/route.ts",
    ]) {
      const routeSource = source(path);
      assert.match(routeSource, /commissionInterestNotificationTargets\(/);
      assert.doesNotMatch(routeSource, /sellerProfile:\s*\{/);
    }
  });
});
