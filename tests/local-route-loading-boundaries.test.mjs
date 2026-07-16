import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function exists(path) {
  return existsSync(new URL(path, root));
}

describe("local discovery and niche route loading boundaries", () => {
  it("keeps browse index and city fallbacks local instead of nesting generic loaders", () => {
    assert.equal(exists("src/app/browse/loading.tsx"), false);
    assert.equal(exists("src/app/browse/[metroSlug]/loading.tsx"), false);
    assert.match(
      source("src/app/browse/page.tsx"),
      /<Suspense fallback=\{<BrowseIndexSkeleton \/>\}>/,
    );
    assert.match(
      source("src/app/browse/[metroSlug]/page.tsx"),
      /<Suspense fallback=\{<BrowseCitySkeleton \/>\}>/,
    );
    assert.match(
      source("src/app/browse/[metroSlug]/[category]/loading.tsx"),
      /return <BrowseCitySkeleton \/>/,
    );
    assert.match(
      source("src/app/makers/[metroSlug]/loading.tsx"),
      /return <MakersCitySkeleton \/>/,
    );
  });

  it("gives public data archives route-shaped leaf skeletons", () => {
    const loaders = [
      ["src/app/blog/author/[slug]/loading.tsx", "BlogAuthorSkeleton"],
      ["src/app/tag/[slug]/loading.tsx", "TagLandingSkeleton"],
      ["src/app/seller/[id]/customer-photos/loading.tsx", "CustomerPhotosSkeleton"],
      ["src/app/sellers/map/loading.tsx", "SellersMapSkeleton"],
    ];

    for (const [path, skeleton] of loaders) {
      assert.equal(exists(path), true, `${path} should exist`);
      assert.match(source(path), new RegExp(`return <${skeleton} \\/>`));
    }
  });

  it("selects a commission fallback after distinguishing metro and detail routes", () => {
    assert.equal(exists("src/app/commission/[param]/loading.tsx"), false);
    const commissionRoute = source("src/app/commission/[param]/page.tsx");
    assert.match(
      commissionRoute,
      /<Suspense fallback=\{<CommissionMetroSkeleton \/>\}>/,
    );
    assert.match(
      commissionRoute,
      /<Suspense fallback=\{<CommissionDetailSkeleton \/>\}>/,
    );
  });

  it("keeps list-order fallbacks local and uses leaf detail skeletons", () => {
    assert.equal(exists("src/app/dashboard/orders/loading.tsx"), false);
    assert.equal(exists("src/app/dashboard/sales/loading.tsx"), false);
    assert.match(
      source("src/app/dashboard/orders/page.tsx"),
      /<Suspense fallback=\{<BuyerOrdersSkeleton \/>\}>/,
    );
    assert.match(
      source("src/app/dashboard/sales/page.tsx"),
      /<Suspense fallback=\{<SalesListSkeleton \/>\}>/,
    );
    assert.match(
      source("src/app/dashboard/orders/[id]/loading.tsx"),
      /return <OrderDetailSkeleton \/>/,
    );
    assert.match(
      source("src/app/dashboard/sales/[orderId]/loading.tsx"),
      /return <OrderDetailSkeleton \/>/,
    );
  });

  it("covers server-heavy setup, listing, and checkout leaves", () => {
    const loaders = [
      ["src/app/dashboard/onboarding/loading.tsx", "OnboardingSkeleton"],
      ["src/app/dashboard/listings/[id]/edit/loading.tsx", "EditListingSkeleton"],
      ["src/app/dashboard/listings/custom/loading.tsx", "CreateListingSkeleton"],
      ["src/app/checkout/success/loading.tsx", "CheckoutSuccessSkeleton"],
    ];

    for (const [path, skeleton] of loaders) {
      assert.equal(exists(path), true, `${path} should exist`);
      assert.match(source(path), new RegExp(`return <${skeleton} \\/>`));
    }

    assert.match(
      source("src/app/accept-terms/loading.tsx"),
      /aria-label="Loading terms acceptance"/,
    );
  });

  it("leaves fast static footer destinations loader-free", () => {
    for (const path of [
      "src/app/about/loading.tsx",
      "src/app/accessibility/loading.tsx",
      "src/app/help/shipping-and-returns/loading.tsx",
      "src/app/help/trust-and-safety/loading.tsx",
      "src/app/privacy/loading.tsx",
      "src/app/security/loading.tsx",
      "src/app/seller-handbook/loading.tsx",
      "src/app/terms/loading.tsx",
    ]) {
      assert.equal(exists(path), false, `${path} should not delay static content`);
    }
  });

  it("keeps the private custom-listing form on the shared surface and control system", () => {
    const customListing = source("src/app/dashboard/listings/custom/page.tsx");
    assert.match(customListing, /<main className="mx-auto max-w-2xl p-8">/);
    assert.match(customListing, /className="card-section p-4"/);
    assert.match(customListing, /min-h-\[44px\] rounded-md bg-neutral-900/);
    assert.doesNotMatch(customListing, /rounded-xl/);
    assert.doesNotMatch(customListing, /bg-black/);
  });

  it("keeps onboarding and legal utility surfaces on the shared design system", () => {
    const onboarding = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");
    const onboardingFallback = source("src/components/CommerceRouteSkeletons.tsx");
    assert.match(onboarding, /min-h-\[100svh\] bg-\[#F7F5F0\]/);
    assert.match(onboarding, /card-section p-8/);
    assert.match(onboarding, /w-full rounded-md border border-neutral-200/);
    assert.match(onboardingFallback, /card-section space-y-5 p-8 text-center/);
    assert.doesNotMatch(onboardingFallback, /h-1\.5 w-full rounded-full/);

    for (const path of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"]) {
      const legalPage = source(path);
      assert.match(legalPage, /<nav className="card-section mb-12 px-6 py-5 print:hidden">/);
      assert.doesNotMatch(legalPage, /bg-stone-50/);
    }
  });

  it("keeps buyer and seller fulfillment cards on the white section surface", () => {
    for (const path of [
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
    ]) {
      assert.doesNotMatch(source(path), /card-section bg-neutral-50/);
    }
  });
});
