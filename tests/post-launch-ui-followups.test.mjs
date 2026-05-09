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
    assert.match(source("src/components/AddressAutocomplete.tsx"), /1100/);
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
});
