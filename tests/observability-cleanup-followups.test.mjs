import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { activeSellerProfileWhere, visibleSellerProfileWhere } = await import("../src/lib/sellerVisibility.ts");
const { STRIPE_CONNECT_ACCOUNT_VERSION } = await import("../src/lib/stripeConnectV2State.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("observability cleanup follow-ups", () => {
  it("keeps listing view and click counters scoped to public sellable listings", () => {
    for (const path of [
      "src/app/api/listings/[id]/view/route.ts",
      "src/app/api/listings/[id]/click/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /publicListingWhere\(\{ id \}\)/);
      assert.match(text, /listing\.updateMany/);
      assert.doesNotMatch(text, /listing\.update\(\{\s*where: \{ id \}/);
    }
  });

  it("separates visible seller profiles from currently sellable seller profiles", () => {
    assert.deepEqual(visibleSellerProfileWhere({ id: "seller_1" }), {
      AND: [
        {
          chargesEnabled: true,
          OR: [
            { stripeAccountVersion: null },
            { stripeAccountVersion: STRIPE_CONNECT_ACCOUNT_VERSION },
          ],
          user: { banned: false, deletedAt: null },
        },
        { id: "seller_1" },
      ],
    });
    assert.deepEqual(activeSellerProfileWhere({ id: "seller_1" }), {
      AND: [
        {
          chargesEnabled: true,
          OR: [
            { stripeAccountVersion: null },
            { stripeAccountVersion: STRIPE_CONNECT_ACCOUNT_VERSION },
          ],
          vacationMode: false,
          user: { banned: false, deletedAt: null },
        },
        { id: "seller_1" },
      ],
    });
    assert.match(source("src/app/api/follow/[sellerId]/route.ts"), /visibleSellerProfileWhere\(\{ id: sellerId \}\)/);
    assert.match(source("src/app/account/following/page.tsx"), /sellerProfile: visibleSellerProfileWhere\(\)/);
  });

  it("keeps staff order totals on the gift-wrap-aware helper", () => {
    assert.match(source("src/app/admin/flagged/page.tsx"), /orderTotalCents\(order\)/);
    const casePage = source("src/app/admin/cases/[id]/page.tsx");
    assert.match(casePage, /giftWrappingPriceCents: true/);
    assert.match(casePage, /label="Gift wrapping"/);
    assert.match(casePage, /orderTotalCents\(caseRecord\.order\)/);
  });

  it("moves seller profile views to a deduped client endpoint and uses cached ratings", () => {
    const sellerPage = source("src/app/seller/[id]/page.tsx");
    const viewRoute = source("src/app/api/seller/[id]/view/route.ts");
    assert.match(sellerPage, /SellerProfileViewTracker/);
    assert.doesNotMatch(sellerPage, /profileViews: \{ increment: 1 \}/);
    assert.match(sellerPage, /getSellerRatingMap\(\[seller\.id\]\)/);
    assert.match(viewRoute, /profileViewRatelimit/);
    assert.match(viewRoute, /hasTrackingCookie/);
    assert.match(viewRoute, /viewer\?\.id === seller\.userId/);
    assert.match(viewRoute, /isLikelyBot/);
    assert.match(viewRoute, /visibleSellerProfileWhere\(\{ id \}\)/);
  });

  it("records account export generation durably without exported payload data", () => {
    const text = source("src/app/api/account/export/route.ts");
    assert.match(text, /logUserAuditAction/);
    assert.match(text, /action: "ACCOUNT_EXPORT"/);
    assert.match(text, /metadata: \{ route: "\/api\/account\/export", method \}/);
    assert.match(text, /if \(!auditLogId\)/);
  });
});
