import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("onboarding-incomplete dashboard access", () => {
  it("keeps /dashboard accessible with a setup banner instead of redirecting to onboarding", () => {
    const dashboard = source("src/app/dashboard/page.tsx");

    assert.doesNotMatch(dashboard, /if \(sellerProfile && !sellerProfile\.onboardingComplete\) \{\s*redirect\("\/dashboard\/onboarding"\);/s);
    assert.match(dashboard, /searchParams\?: Promise<\{ setup\?: string \}>/);
    assert.match(dashboard, /const sellerPrivate = await sellerOwnerPrivateState\(seller\.userId, seller\.id\)/);
    assert.match(dashboard, /const onboardingComplete = sellerPrivate\?\.onboardingComplete \?\? false/);
    assert.match(dashboard, /forceSetupBanner = params\.setup === "required"/);
    assert.match(dashboard, /Finish setup to start selling/);
    assert.match(dashboard, /Continue setup →/);
    assert.match(dashboard, /Connect Stripe Payouts →/);
    assert.match(dashboard, /!chargesEnabled && onboardingComplete/);
  });

  it("does not add onboarding redirects to read and draft dashboard surfaces", () => {
    for (const path of [
      "src/app/dashboard/inventory/page.tsx",
      "src/app/dashboard/listings/new/page.tsx",
      "src/app/dashboard/listings/[id]/edit/page.tsx",
      "src/app/dashboard/seller/page.tsx",
      "src/app/dashboard/profile/page.tsx",
      "src/app/dashboard/notifications/page.tsx",
    ]) {
      const text = source(path);
      assert.doesNotMatch(text, /onboardingComplete[^;\n]*redirect\("\/dashboard\/onboarding"\)/, path);
      assert.doesNotMatch(text, /redirect\("\/dashboard\/onboarding"\)/, path);
    }
  });

  it("keeps sales and analytics out of the normal metrics flow for incomplete sellers", () => {
    const sales = source("src/app/dashboard/sales/page.tsx");
    assert.match(sales, /select: \{ id: true, displayName: true, chargesEnabled: true \}/);
    assert.match(sales, /const sellerPrivate = await sellerOwnerPrivateState\(me\.id, seller\.id\)/);
    assert.match(sales, /if \(!sellerPrivate\.onboardingComplete\)/);
    assert.match(sales, /Connect Stripe to start accepting orders/);

    const salesDetail = source("src/app/dashboard/sales/[orderId]/page.tsx");
    assert.match(salesDetail, /select: \{ id: true \}/);
    assert.doesNotMatch(salesDetail, /select: \{[^}]*displayName: true/);
    assert.match(salesDetail, /const sellerPrivate = await sellerOwnerPrivateState\(me\.id, seller\.id\)/);
    assert.match(salesDetail, /if \(!sellerPrivate\.onboardingComplete\) redirect\("\/dashboard\?setup=required"\)/);

    const analyticsApi = source("src/app/api/seller/analytics/route.ts");
    assert.match(analyticsApi, /const sellerPrivate = await sellerOwnerPrivateState\(me\.id, sellerProfile\.id\)/);
    assert.match(analyticsApi, /if \(!sellerPrivate\.onboardingComplete\)/);
    assert.match(analyticsApi, /code: "SETUP_REQUIRED"/);

    const analyticsPage = source("src/app/dashboard/analytics/page.tsx");
    assert.match(analyticsPage, /setupRequired/);
    assert.match(analyticsPage, /Connect Stripe to start accepting orders/);
  });

  it("keeps publish-state mutations gated by seller orderability while drafts remain allowed", () => {
    const newListing = source("src/app/dashboard/listings/new/page.tsx");
    assert.match(newListing, /if \(!saveAsDraft && !seller\.chargesEnabled\)/);
    assert.match(newListing, /if \(!saveAsDraft && seller\.vacationMode\)/);
    assert.match(newListing, /select: \{ chargesEnabled: true, vacationMode: true \}/);
    assert.match(newListing, /disabled=\{Boolean\(publishBlockedMessage\)\}/);
    assert.match(newListing, /Save as Draft/);

    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    assert.match(shopActions, /select: \{ chargesEnabled: true, vacationMode: true \}/);
    assert.match(shopActions, /if \(!sellerCheck\?\.chargesEnabled \|\| sellerCheck\.vacationMode\)/);

    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    assert.match(singleCheckout, /sellerOrderBlockReason\(listing\.seller\)/);
    assert.match(sellerCheckout, /sellerOrderBlockReason\(sellerItems\[0\]\.listing\.seller\)/);
  });

  it("documents the access contract in CLAUDE.md", () => {
    const claude = source("CLAUDE.md");
    assert.match(claude, /Onboarding-incomplete dashboard access behavior/);
    assert.match(claude, /Do not re-add the `!onboardingComplete` redirect from `\/dashboard`/);
  });
});
