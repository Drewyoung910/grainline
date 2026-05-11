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
    assert.match(source("src/components/AddressAutocomplete.tsx"), /dedupe/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /limit: "8"/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /trimmed\.length < 2/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /}, 350\);/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /setQuery\(""\)/);
    assert.match(source("src/components/AddressAutocomplete.tsx"), /No address matches yet/);
    assert.match(source("src/components/ShippingAddressForm.tsx"), /setCity\(address\.city\)/);
    assert.doesNotMatch(source("src/components/ShippingAddressForm.tsx"), /if \(address\.city\)/);
    assert.match(source("src/components/SellerShipFromAddressFields.tsx"), /setCity\(address\.city\)/);
    assert.doesNotMatch(source("src/components/SellerShipFromAddressFields.tsx"), /if \(address\.city\)/);
    const state = source("src/lib/addressAutocompleteState.ts");
    assert.match(state, /address\.hamlet/);
    assert.match(state, /cityFromDisplayName/);
    assert.doesNotMatch(state, /address\.city \?\?.*address\.county/s);
    assert.doesNotMatch(state, /address\.city \?\?.*address\.suburb/s);
    assert.doesNotMatch(state, /address\.city \?\?.*address\.neighbourhood/s);
    assert.doesNotMatch(state, /address\.city \?\?.*address\.city_district/s);
    assert.match(state, /cityFromDisplayName\(place\.display_name, \[address\.suburb, address\.neighbourhood, address\.city_district\]\)/);
    assert.match(state, /formatAddressLabel/);
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

  it("displays listing product imagery at 4:5 portrait via CSS without forcing an upload-time crop", () => {
    assert.match(source("src/components/ListingCard.tsx"), /aspect-\[4\/5\]/);
    assert.match(source("src/components/ListingGallery.tsx"), /aspect-\[4\/5\]/);
    assert.doesNotMatch(source("src/components/ListingGallery.tsx"), /h-\[350px\]|h-\[400px\]|h-\[500px\]/);
    // Upload-time crop is intentionally NOT forced on listing photos so the
    // lightbox can show the original aspect. Cards crop via CSS object-cover.
    // Match the actual UploadButton element — endpoint immediately followed by
    // `appearance` (or other non-cropAspect prop) means cropAspect is NOT set.
    const photoManager = source("src/components/PhotoManager.tsx");
    assert.match(photoManager, /<UploadButton\s+endpoint="listingImage"\s+appearance/);
    assert.doesNotMatch(source("src/components/AddPhotosButton.tsx"), /cropAspect=\{4 \/ 5\}/);
    // Re-crop affordances still pass cropAspect={4/5} so sellers can opt in to
    // 4:5 thumbnail framing on existing photos.
    assert.match(photoManager, /<ImageRecropButton[\s\S]*?cropAspect=\{4 \/ 5\}/);
    assert.match(source("src/components/EditPhotoGrid.tsx"), /<ImageRecropButton[\s\S]*?cropAspect=\{4 \/ 5\}/);
  });

  it("keeps made-to-order variants from exposing stock checkboxes", () => {
    const variant = source("src/components/VariantEditor.tsx");
    const wrapper = source("src/components/ListingTypeVariantSection.tsx");
    assert.match(wrapper, /onListingTypeChange=\{setType\}/);
    assert.match(variant, /listingType = "MADE_TO_ORDER"/);
    assert.match(variant, /!isMadeToOrder &&/);
    assert.match(variant, /inStock: isMadeToOrder \? true : o\.inStock/);
  });

  it("keeps variant price typing raw until blur", () => {
    const variant = source("src/components/VariantEditor.tsx");
    assert.match(variant, /priceDrafts/);
    assert.match(variant, /focusedPriceKey/);
    assert.match(variant, /onBlur=/);
    assert.doesNotMatch(variant, /value=\{opt\.priceAdjustCents === 0 \? "" : \(opt\.priceAdjustCents \/ 100\)\.toFixed\(2\)\}/);
  });

  it("prevents accidental listing form submit and restores values after server errors", () => {
    const actionForm = source("src/components/ActionForm.tsx");
    assert.match(actionForm, /preventEnterSubmit/);
    assert.match(actionForm, /preserveOnError/);
    assert.match(actionForm, /restoreFormValues/);
    assert.match(actionForm, /field\.type === "file"/);
    assert.match(actionForm, /field\.checked = values\?\.some/);
    assert.match(source("src/app/dashboard/listings/new/page.tsx"), /preventEnterSubmit preserveOnError/);
    assert.match(source("src/app/dashboard/listings/[id]/edit/page.tsx"), /preventEnterSubmit preserveOnError/);
  });

  it("uses one left disclosure marker in listing shop policies", () => {
    assert.doesNotMatch(source("src/app/listing/[id]/page.tsx"), /▾/);
  });

  it("keeps light avatars visible on light surfaces", () => {
    assert.doesNotMatch(source("src/app/seller/[id]/page.tsx"), /ring-white/);
    assert.match(source("src/app/seller/[id]/page.tsx"), /ring-4 ring-neutral-200 shadow-sm/);
    assert.match(source("src/components/UserAvatarMenu.tsx"), /ring-1 ring-neutral-200 shadow-sm/);
    assert.match(source("src/components/UserAvatarMenu.tsx"), /borderRadius: "9999px"/);
    assert.match(source("src/components/ThreadMessages.tsx"), /ring-1 ring-neutral-200 shadow-sm/);
  });

  it("uses direct order message links and touch-friendly listing gallery controls", () => {
    const buyerOrder = source("src/app/dashboard/orders/[id]/page.tsx");
    const gallery = source("src/components/ListingGallery.tsx");

    assert.match(buyerOrder, /href=\{messageHref\}/);
    assert.doesNotMatch(buyerOrder, /href="\/messages"[\s\S]*Message maker/);
    assert.match(gallery, /touch-pan-y/);
    assert.match(gallery, /addEventListener\("touchmove"/);
    assert.match(gallery, /passive: false/);
    assert.match(gallery, /horizontalLocked/);
    assert.match(gallery, /event\.preventDefault\(\)/);
    assert.match(gallery, /aria-label="Previous photo"/);
    assert.match(gallery, /aria-label="Next photo"/);
  });

  it("keeps listing detail constrained on narrow mobile viewports", () => {
    const listingPage = source("src/app/listing/[id]/page.tsx");
    const purchasePanel = source("src/components/ListingPurchasePanel.tsx");
    const variantSelector = source("src/components/VariantSelector.tsx");

    assert.match(listingPage, /overflow-x-hidden/);
    assert.match(listingPage, /grid min-w-0/);
    assert.match(listingPage, /card-section min-w-0 overflow-x-hidden/);
    assert.match(purchasePanel, /min-w-0 space-y-4 overflow-x-hidden/);
    assert.match(variantSelector, /flex min-w-0 flex-wrap gap-2/);
    assert.match(variantSelector, /max-w-full whitespace-normal break-words/);
  });

  it("sends order confirmations directly from the Stripe webhook", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(webhook, /sendOrderConfirmedBuyer/);
    assert.match(webhook, /sendOrderConfirmedSeller/);
    assert.match(webhook, /sendFirstSaleCongrats/);
    assert.match(webhook, /shouldSendEmail\(sellerUserId, "EMAIL_NEW_ORDER"\)/);
    assert.doesNotMatch(webhook, /enqueueEmailOutbox\(\{[\s\S]*order-confirmed-buyer/);
    assert.doesNotMatch(webhook, /enqueueEmailOutbox\(\{[\s\S]*order-confirmed-seller/);
  });

  it("supports workshop gallery alt text, reordering, and buyer-facing alt attributes", () => {
    const galleryUploader = source("src/components/GalleryUploader.tsx");
    const profilePage = source("src/app/dashboard/profile/page.tsx");
    const sellerGallery = source("src/components/SellerGallery.tsx");
    const schema = source("prisma/schema.prisma");

    assert.match(schema, /galleryAltTexts\s+String\[\]\s+@default\(\[\]\)/);
    assert.match(galleryUploader, /name="galleryAltTexts"/);
    assert.match(galleryUploader, /draggable/);
    assert.match(galleryUploader, /Move photo left/);
    assert.match(galleryUploader, /Save alt text/);
    assert.match(profilePage, /galleryAltTexts/);
    assert.match(sellerGallery, /imageAltTexts/);
    assert.match(sellerGallery, /alt=\{url\.alt \|\| `Gallery image \$\{i \+ 1\}`\}/);
  });

  it("uses solid warm-cream page backgrounds instead of page-wide amber gradients", () => {
    assert.match(source("src/components/Header.tsx"), /bg-\[#F7F5F0\]/);
    assert.match(source("src/app/page.tsx"), /bg-\[#F7F5F0\]/);
    assert.match(source("src/app/browse/page.tsx"), /bg-\[#F7F5F0\]/);
    assert.match(source("src/app/listing/[id]/page.tsx"), /bg-\[#F7F5F0\]/);
    assert.doesNotMatch(source("src/components/Header.tsx"), /bg-gradient-to-b/);
  });

  it("adds order timeline context without a redundant payment-confirmed step", () => {
    const timeline = source("src/components/OrderTimeline.tsx");
    const buyerOrder = source("src/app/dashboard/orders/[id]/page.tsx");
    const sellerOrder = source("src/app/dashboard/sales/[orderId]/page.tsx");

    assert.match(timeline, /Estimated delivery:/);
    assert.match(timeline, /processingWindowDetail/);
    assert.match(buyerOrder, /estimatedDeliveryDate=\{order\.estimatedDeliveryDate\}/);
    assert.match(sellerOrder, /processingTimeMinDays=\{processingMins\.length/);
    assert.doesNotMatch(timeline, /Payment confirmed/);
  });

  it("renames the staff reconciliation queue away from old flagged-order wording", () => {
    assert.match(source("src/app/admin/flagged/page.tsx"), /Orders Needing Review/);
    assert.match(source("src/app/admin/layout.tsx"), /Orders Needing Review/);
    assert.match(source("src/components/AdminMobileNav.tsx"), /Needs Review/);
    assert.doesNotMatch(source("src/app/admin/flagged/page.tsx"), /No flagged orders/);
    assert.doesNotMatch(source("src/app/dashboard/orders/[id]/page.tsx"), /shipping detail change/);
    assert.doesNotMatch(source("src/app/dashboard/sales/[orderId]/page.tsx"), /Shipping address or rate changed/);
  });

  it("dashboard listing card click goes to public path for active and to preview URL for non-public statuses", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    // The card link branches on isPublicStatus and appends ?preview=1 for the
    // owner-preview case so DRAFT/HIDDEN/REJECTED/PENDING_REVIEW don't 404.
    assert.match(dashboard, /isPublicStatus = l\.status === "ACTIVE" \|\| l\.status === "SOLD" \|\| l\.status === "SOLD_OUT"/);
    assert.match(dashboard, /\?preview=1`/);
    assert.match(dashboard, /isArchived\s*\?\s*null/);
  });

  it("AI alt-text backfill helper exists and is wired into every reviewListingWithAI path", () => {
    const helper = source("src/lib/photoAltTextBackfill.ts");
    const publishActions = source("src/app/seller/[id]/shop/actions.ts");
    const editPage = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const newPage = source("src/app/dashboard/listings/new/page.tsx");

    assert.match(helper, /export async function backfillEmptyAltTexts/);
    assert.match(helper, /altText: cleaned/);
    assert.match(helper, /\.findMany\(/);
    assert.match(publishActions, /import \{ backfillEmptyAltTexts \}/);
    assert.match(publishActions, /backfillEmptyAltTexts\(listing\.id, aiResult\.altTexts\)/);
    // Edit page has 3 reviewListingWithAI call sites — updateListing,
    // deletePhotoAction, replacePhotoAction. All three must call the backfill.
    assert.match(editPage, /import \{ backfillEmptyAltTexts \}/);
    const backfillCalls = editPage.match(/backfillEmptyAltTexts\(listingId, aiResult\.altTexts\)/g) ?? [];
    assert.equal(backfillCalls.length, 3, "expected 3 backfill calls in edit page");
    // Catch returns now include altTexts so TypeScript can union the success
    // type without a property-missing error.
    const editAltTextsInCatch = editPage.match(/altTexts: \[\] as string\[\]/g) ?? [];
    assert.equal(editAltTextsInCatch.length, 3, "expected altTexts in all 3 catch returns");
    // New listing path was already there — sanity check it still backfills.
    assert.match(newPage, /aiResult\.altTexts/);
  });

  it("publish from edit redirects PENDING_REVIEW to preview URL with status-aware banner", () => {
    const editPage = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const listingPage = source("src/app/listing/[id]/page.tsx");

    // updateListing redirect: ACTIVE/SOLD/SOLD_OUT → public, PENDING_REVIEW →
    // preview URL, everything else → edit page with saved=1.
    assert.match(editPage, /finalStatus === ListingStatus\.PENDING_REVIEW/);
    assert.match(editPage, /\$\{publicListingPath\(listingId, finalTitle\)\}\?preview=1/);
    assert.match(editPage, /\?saved=1/);
    // saved=pending was the old buggy banner — should be gone now.
    assert.doesNotMatch(editPage, /saved=pending/);
    // Preview banner now branches on status so PENDING_REVIEW shows the right
    // "under review" message instead of the generic preview message.
    assert.match(listingPage, /listing\.status === "PENDING_REVIEW"/);
    assert.match(listingPage, /Under review/);
  });

  it("header uses a wider container and grows the search bar for desktop presence", () => {
    const header = source("src/components/Header.tsx");
    assert.match(header, /max-w-\[1600px\]/);
    assert.match(header, /max-w-\[640px\]/);
    assert.doesNotMatch(header, /max-w-6xl/);
    // Search bar still wraps SearchBar inside flex-1 so it grows in available
    // space within the new max width.
    assert.match(header, /flex-1 max-w-\[640px\]/);
  });
});
