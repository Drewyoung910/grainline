import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("post-launch UI follow-ups", () => {
  it("keeps Clerk OAuth callbacks on path routing in App Router catch-all pages", () => {
    assert.match(source("src/app/sign-in/[[...sign-in]]/page.tsx"), /routing="path"/);
    assert.match(source("src/app/sign-in/[[...sign-in]]/page.tsx"), /path="\/sign-in"/);
    assert.match(source("src/app/sign-up/[[...sign-up]]/page.tsx"), /routing="path"/);
    assert.match(source("src/app/sign-up/[[...sign-up]]/page.tsx"), /path="\/sign-up"/);
  });

  it("refreshes Stripe Connect status after hosted onboarding returns", () => {
    const wizard = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");
    const statusRoute = source("src/app/api/stripe/connect/status/route.ts");
    const sellerButton = source("src/app/dashboard/seller/StripeConnectButton.tsx");

    assert.match(wizard, /\/api\/stripe\/connect\/status/);
    assert.match(wizard, /stripe_return=1/);
    assert.match(sellerButton, /\/dashboard\/seller\?stripe_return=1/);
    assert.match(statusRoute, /stripe\.accounts\.retrieve/);
    assert.match(statusRoute, /data: \{ chargesEnabled \}/);
  });

  it("keeps shop identity and workshop gallery canonical on the shop profile page", () => {
    const settings = source("src/app/dashboard/seller/page.tsx");
    const profile = source("src/app/dashboard/profile/page.tsx");

    assert.doesNotMatch(settings, /name="displayName"/);
    assert.doesNotMatch(settings, /name="bio"/);
    assert.doesNotMatch(settings, /GalleryUploader/);
    assert.match(profile, /GalleryUploader/);
    assert.match(profile, /galleryImageUrlsTouched/);
    assert.match(profile, /Workshop gallery/);
  });

  it("reuses the shared address autocomplete on shipping, pickup, and ship-from surfaces", () => {
    assert.match(source("src/components/ShippingAddressForm.tsx"), /AddressAutocomplete/);
    assert.match(source("src/components/LocationPicker.tsx"), /AddressAutocomplete/);
    assert.match(source("src/components/SellerShipFromAddressFields.tsx"), /AddressAutocomplete/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /countrycodes/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /trimmed\.length < 2/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /}, 350\);/);
    assert.doesNotMatch(source("src/components/AddressAutocomplete.tsx"), /address\.city \?\?.*address\.suburb/s);
    assert.doesNotMatch(source("src/components/AddressAutocomplete.tsx"), /address\.city \?\?.*address\.neighbourhood/s);
  });

  it("allows seller blog publishing before Stripe but requires an actual seller profile", () => {
    const page = source("src/app/dashboard/blog/new/page.tsx");
    assert.match(page, /if \(!isStaff && !seller\) redirect\("\/dashboard"\)/);
    assert.match(page, /Create a maker profile before publishing blog posts/);
    assert.doesNotMatch(page, /chargesEnabled/);
  });

  it("shows the Guild Master path before Guild Member approval and avoids sparkle icons", () => {
    const verification = source("src/app/dashboard/verification/page.tsx");
    const dashboard = source("src/app/dashboard/page.tsx");

    assert.match(verification, /GUILD_MASTER_PREVIEW_REQUIREMENTS/);
    assert.match(verification, /Available after Guild Member approval/);
    assert.doesNotMatch(dashboard, /Sparkles/);
    assert.match(dashboard, /Shield/);
  });

  it("keeps profile media uploaders aligned with the design system", () => {
    for (const path of [
      "src/components/ProfileBannerUploader.tsx",
      "src/components/ProfileAvatarUploader.tsx",
      "src/components/ProfileWorkshopUploader.tsx",
    ]) {
      const text = source(path);
      assert.match(text, /border-neutral-200/);
      assert.match(text, /bg-neutral-900/);
      assert.match(text, /rounded-md/);
      assert.doesNotMatch(text, /bg-black/);
    }
  });

  it("keeps search dropdowns useful even when data-backed popular tags are empty", () => {
    const searchBar = source("src/components/SearchBar.tsx");
    const blogSearchBar = source("src/components/BlogSearchBar.tsx");

    assert.match(searchBar, /FALLBACK_POPULAR_SEARCHES/);
    assert.match(searchBar, /popularTags\.length > 0 \? popularTags : FALLBACK_POPULAR_SEARCHES/);
    assert.match(blogSearchBar, /FALLBACK_BLOG_TOPICS/);
    assert.match(blogSearchBar, /popularTags\.length > 0 \? popularTags : FALLBACK_BLOG_TOPICS/);
    assert.match(blogSearchBar, /absolute right-2 top-1\/2/);
  });

  it("invalidates popular search caches when public listing or blog visibility changes", () => {
    assert.match(source("src/lib/searchCache.ts"), /popular-listing-tags/);
    assert.match(source("src/lib/searchCache.ts"), /popular-blog-tags/);
    assert.match(source("src/lib/popularBlogTags.ts"), /unstable_cache/);
    assert.match(source("src/app/dashboard/listings/new/page.tsx"), /revalidateListingSearchCaches/);
    assert.match(source("src/app/dashboard/listings/[id]/edit/page.tsx"), /revalidateListingSearchCaches/);
    assert.match(source("src/app/dashboard/page.tsx"), /revalidateListingSearchCaches/);
    assert.match(source("src/app/api/admin/listings/[id]/review/route.ts"), /revalidateListingSearchCaches/);
    assert.match(source("src/app/api/listings/[id]/stock/route.ts"), /revalidateListingSearchCaches/);
    assert.match(source("src/app/dashboard/blog/new/page.tsx"), /revalidateBlogSearchCaches/);
    assert.match(source("src/app/dashboard/blog/[id]/edit/page.tsx"), /revalidateBlogSearchCaches/);
  });

  it("uses neutral primary CTAs in the onboarding wizard while keeping amber as an accent", () => {
    const wizard = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");
    assert.match(wizard, /bg-neutral-900/);
    assert.match(wizard, /h-full bg-amber-500/);
    assert.doesNotMatch(wizard, /bg-amber-500 hover:bg-amber-600/);
  });
});
