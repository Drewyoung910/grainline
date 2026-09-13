import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("accessibility follow-ups", () => {
  it("exposes listing variant choices as accessible radio groups", () => {
    const selector = source("src/components/VariantSelector.tsx");
    assert.match(selector, /role="radiogroup"/);
    assert.match(selector, /aria-labelledby=\{`\$\{baseId\}-\$\{group\.id\}-label`\}/);
    assert.match(selector, /role="radio"/);
    assert.match(selector, /aria-checked=\{isSelected\}/);
    assert.match(selector, /aria-disabled=\{!opt\.inStock\}/);
    assert.match(selector, /ArrowRight/);
    assert.match(selector, /ArrowLeft/);
    assert.match(selector, /Home/);
    assert.match(selector, /End/);
  });

  it("associates open-case fields and errors with form controls", () => {
    const form = source("src/components/OpenCaseForm.tsx");
    assert.match(form, /htmlFor=\{reasonId\}/);
    assert.match(form, /id=\{reasonId\}/);
    assert.match(form, /htmlFor=\{descriptionId\}/);
    assert.match(form, /id=\{descriptionId\}/);
    assert.match(form, /aria-describedby=\{`\$\{descriptionHelpId\}/);
    assert.match(form, /aria-invalid=\{Boolean\(error\)\}/);
    assert.match(form, /role="alert"/);
  });

  it("connects checkout address validation errors to their inputs", () => {
    const form = source("src/components/ShippingAddressForm.tsx");
    for (const id of ["sa-name", "sa-line1", "sa-city", "sa-state", "sa-zip"]) {
      assert.match(form, new RegExp(`aria-describedby=\\{errors\\.[a-zA-Z0-9]+ \\? "${id}-error"`));
      assert.match(form, new RegExp(`id="${id}-error"`));
    }
    assert.match(form, /aria-invalid=\{Boolean\(errors\.name\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.line1\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.city\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.state\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.postalCode\)\}/);
    assert.match(form, /role="alert"/);
  });

  it("labels newsletter signup and links validation errors to the email field", () => {
    const form = source("src/components/NewsletterSignup.tsx");

    assert.match(form, /const emailId = React\.useId\(\)/);
    assert.match(form, /const errorId = React\.useId\(\)/);
    assert.match(form, /<label htmlFor=\{emailId\} className="sr-only">Email address<\/label>/);
    assert.match(form, /id=\{emailId\}/);
    assert.match(form, /aria-invalid=\{Boolean\(error\)\}/);
    assert.match(form, /aria-describedby=\{error \? errorId : undefined\}/);
    assert.match(form, /id=\{errorId\}/);
    assert.match(form, /role="alert"/);
    assert.match(form, /role="status"/);
    assert.match(form, /aria-live="polite"/);
  });

  it("keeps the image crop modal a real dialog with focus and scroll management", () => {
    const modal = source("src/components/ImageCropModal.tsx");
    assert.match(modal, /useDialogFocus\(mounted, dialogRef, onCancel\)/);
    assert.match(modal, /useBodyScrollLock\(mounted\)/);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal="true"/);
    assert.match(modal, /aria-labelledby=\{titleId\}/);
    assert.match(modal, /tabIndex=\{-1\}/);
  });

  it("labels interactive map canvases and exposes text alternatives", () => {
    assert.match(source("src/components/MakersMapSection.tsx"), /role="alert"/);
    assert.match(source("src/components/MobileFilterBar.tsx"), /role="alert"/);
    assert.match(source("src/components/FilterSidebar.tsx"), /role="alert"/);
    assert.match(source("src/components/AllSellersMap.tsx"), /role="application"/);
    assert.match(source("src/components/AllSellersMap.tsx"), /aria-label="Map of Grainline makers"/);
    assert.match(source("src/components/AllSellersMap.tsx"), /className="sr-only"/);
    assert.match(source("src/components/MaplibreMap.tsx"), /aria-label="Map showing this location"/);
    assert.match(source("src/components/LocationPicker.tsx"), /aria-label="Map picker for pickup location"/);
    assert.match(source("src/components/MapCard.tsx"), /aria-label=\{label \? `Map showing \$\{label\}` : "Map preview"\}/);
    assert.match(source("src/components/SellersMap.tsx"), /aria-label="Map of Grainline sellers"/);
  });

  it("labels admin email fields and announces send status", () => {
    const form = source("src/components/admin/AdminEmailForm.tsx");

    assert.match(form, /useId/);
    assert.match(form, /htmlFor=\{toEmailId\}/);
    assert.match(form, /id=\{toEmailId\}/);
    assert.match(form, /htmlFor=\{subjectId\}/);
    assert.match(form, /id=\{subjectId\}/);
    assert.match(form, /htmlFor=\{bodyId\}/);
    assert.match(form, /id=\{bodyId\}/);
    assert.match(form, /aria-label="Close email form"/);
    assert.match(form, /role="status"/);
    assert.match(form, /aria-live="polite"/);
  });

  it("announces toggle and badge state for compact header controls", () => {
    const follow = source("src/components/FollowButton.tsx");
    const unread = source("src/components/UnreadBadge.tsx");
    const guild = source("src/components/GuildBadge.tsx");

    assert.match(follow, /aria-pressed=\{following\}/);
    assert.match(follow, /aria-hidden="true"/);
    assert.match(unread, /aria-label=\{`\$\{count\} unread message/);
    assert.match(unread, /aria-hidden="true"/);
    assert.match(guild, /aria-label=\{label\}/);
  });

  it("labels comment and review authoring controls", () => {
    const blogComment = source("src/components/BlogCommentForm.tsx");
    const reviewComposer = source("src/components/ReviewComposer.tsx");

    assert.match(blogComment, /htmlFor=\{bodyId\}/);
    assert.match(blogComment, /id=\{bodyId\}/);
    assert.match(blogComment, /aria-invalid=\{status === "error"\}/);
    assert.match(blogComment, /role="alert"/);
    assert.match(reviewComposer, /htmlFor=\{ratingId\}/);
    assert.match(reviewComposer, /id=\{ratingId\}/);
    assert.match(reviewComposer, /htmlFor=\{commentId\}/);
    assert.match(reviewComposer, /id=\{commentId\}/);
    assert.match(reviewComposer, /role="img"/);
    assert.match(reviewComposer, /aria-label=\{`\$\{stars\.toFixed\(1\)\} out of 5 stars`\}/);
  });

  it("groups checkout and browse filters with accessible legends and labels", () => {
    const shippingRates = source("src/components/ShippingRateSelector.tsx");
    const filters = source("src/components/FilterSidebar.tsx");
    const mobileFilters = source("src/components/MobileFilterBar.tsx");

    assert.match(shippingRates, /<fieldset className="space-y-2">/);
    assert.match(shippingRates, /<legend className="text-sm font-medium text-neutral-500">Shipping from/);
    assert.match(filters, /<fieldset>/);
    assert.match(filters, /<legend className="font-medium mb-1.5">Listing type<\/legend>/);
    assert.match(filters, /<legend className="font-medium mb-1.5">Price \(USD\)<\/legend>/);
    assert.match(filters, /<legend className="font-medium mb-1.5">Near location<\/legend>/);
    assert.match(filters, /htmlFor=\{`\$\{baseId\}-min`\}/);
    assert.match(filters, /htmlFor=\{`\$\{baseId\}-max`\}/);
    assert.match(filters, /htmlFor=\{`\$\{baseId\}-radius`\}/);

    assert.match(mobileFilters, /htmlFor=\{`\$\{baseId\}-mobile-category`\}/);
    assert.match(mobileFilters, /id=\{`\$\{baseId\}-mobile-category`\}/);
    assert.match(mobileFilters, /<legend className="font-medium mb-1.5">Listing type<\/legend>/);
    assert.match(mobileFilters, /htmlFor=\{`\$\{baseId\}-mobile-ships`\}/);
    assert.match(mobileFilters, /id=\{`\$\{baseId\}-mobile-ships`\}/);
    assert.match(mobileFilters, /htmlFor=\{`\$\{baseId\}-mobile-rating`\}/);
    assert.match(mobileFilters, /id=\{`\$\{baseId\}-mobile-rating`\}/);
    assert.match(mobileFilters, /<legend className="font-medium mb-1.5">Price \(USD\)<\/legend>/);
    assert.match(mobileFilters, /htmlFor=\{`\$\{baseId\}-mobile-min`\}/);
    assert.match(mobileFilters, /htmlFor=\{`\$\{baseId\}-mobile-max`\}/);
    assert.match(mobileFilters, /htmlFor=\{`\$\{baseId\}-mobile-sort`\}/);
    assert.match(mobileFilters, /id=\{`\$\{baseId\}-mobile-sort`\}/);
    assert.match(mobileFilters, /<legend className="font-medium mb-1.5">Near location<\/legend>/);
    assert.match(mobileFilters, /htmlFor=\{`\$\{baseId\}-mobile-radius`\}/);
    assert.match(mobileFilters, /id=\{`\$\{baseId\}-mobile-radius`\}/);
  });

  it("gives listing type and variant editor controls machine-readable labels", () => {
    const listingTypeFields = source("src/components/ListingTypeFields.tsx");
    const variantEditor = source("src/components/VariantEditor.tsx");

    assert.match(listingTypeFields, /role="radiogroup"/);
    assert.match(listingTypeFields, /aria-labelledby=\{listingTypeLabelId\}/);
    assert.match(listingTypeFields, /role="radio"/);
    assert.match(listingTypeFields, /aria-checked=\{type === "MADE_TO_ORDER"\}/);
    assert.match(listingTypeFields, /aria-checked=\{type === "IN_STOCK"\}/);
    assert.match(listingTypeFields, /tabIndex=\{type === "MADE_TO_ORDER" \? 0 : -1\}/);
    assert.match(listingTypeFields, /tabIndex=\{type === "IN_STOCK" \? 0 : -1\}/);
    assert.match(listingTypeFields, /ArrowRight/);
    assert.match(listingTypeFields, /ArrowLeft/);
    assert.match(listingTypeFields, /Home/);
    assert.match(listingTypeFields, /End/);
    assert.match(variantEditor, /useId/);
    assert.match(variantEditor, /htmlFor=\{`\$\{baseId\}-group-\$\{gi\}-option-\$\{oi\}-label`\}/);
    assert.match(variantEditor, /id=\{`\$\{baseId\}-group-\$\{gi\}-option-\$\{oi\}-label`\}/);
    assert.match(variantEditor, /htmlFor=\{`\$\{baseId\}-group-\$\{gi\}-option-\$\{oi\}-price`\}/);
    assert.match(variantEditor, /id=\{`\$\{baseId\}-group-\$\{gi\}-option-\$\{oi\}-price`\}/);
  });

  it("announces character counters and listing photo alt-text editors", () => {
    const charCounter = source("src/components/CharCounter.tsx");
    const giftNote = source("src/components/GiftNoteSection.tsx");
    const vacationMode = source("src/app/dashboard/seller/VacationModeForm.tsx");
    const photoManager = source("src/components/PhotoManager.tsx");
    const editPhotoGrid = source("src/components/EditPhotoGrid.tsx");

    assert.match(charCounter, /useId/);
    assert.match(charCounter, /id\?: string/);
    assert.match(charCounter, /const fieldId = id \?\? generatedId/);
    assert.match(charCounter, /id=\{fieldId\}/);
    assert.match(charCounter, /aria-describedby=\{counterId\}/);
    assert.match(charCounter, /id=\{counterId\} aria-live="polite"/);
    assert.match(source("src/app/dashboard/listings/new/page.tsx"), /htmlFor="listing-title"[\s\S]*?<InputCharCounter id="listing-title"/);
    assert.match(source("src/app/dashboard/listings/[id]/edit/page.tsx"), /htmlFor="listing-title"[\s\S]*?<InputCharCounter id="listing-title"/);
    assert.match(source("src/app/dashboard/profile/page.tsx"), /htmlFor="seller-bio"[\s\S]*?<CharCounter[\s\S]*?id="seller-bio"/);
    assert.match(giftNote, /const giftNoteId = useId\(\)/);
    assert.match(giftNote, /htmlFor=\{giftNoteId\}/);
    assert.match(giftNote, /id=\{giftNoteId\}/);
    assert.match(giftNote, /maxLength=\{200\}/);
    assert.match(giftNote, /aria-describedby=\{giftNoteCounterId\}/);
    assert.match(giftNote, /id=\{giftNoteCounterId\} aria-live="polite"/);
    assert.match(vacationMode, /import \{ useId, useState, useTransition \} from "react"/);
    assert.match(vacationMode, /<span className="sr-only">Vacation mode<\/span>/);
    assert.match(vacationMode, /htmlFor=\{returnDateId\}/);
    assert.match(vacationMode, /id=\{returnDateId\}/);
    assert.match(vacationMode, /htmlFor=\{vacationMessageId\}/);
    assert.match(vacationMode, /id=\{vacationMessageId\}/);
    assert.match(vacationMode, /aria-describedby=\{vacationMessageCounterId\}/);
    assert.match(vacationMode, /id=\{vacationMessageCounterId\} aria-live="polite"/);
    assert.match(photoManager, /aria-label=\{`Alt text for photo \$\{altModalIdx \+ 1\}`\}/);
    assert.match(editPhotoGrid, /aria-label=\{`Alt text for photo \$\{altModalIdx \+ 1\}`\}/);
  });

  it("labels read-only star ratings for assistive technology", () => {
    for (const path of [
      "src/components/ReviewsSection.tsx",
      "src/app/listing/[id]/page.tsx",
      "src/app/page.tsx",
      "src/app/browse/page.tsx",
    ]) {
      const text = source(path);
      assert.match(text, /role="img"/);
      assert.match(text, /aria-label=\{`\$\{value\.toFixed\(1\)\} out of 5 stars`\}/);
      assert.match(text, /aria-hidden="true">★★★★★/);
    }
  });

  it("keeps the decorative homepage hero photograph non-interactive", () => {
    const home = source("src/app/page.tsx");

    assert.match(home, /import Image from "next\/image"/);
    assert.match(home, /src="\/hero-maple-cabinets\.jpg"/);
    assert.match(home, /alt=""/);
    assert.match(home, /aria-hidden="true"/);
    assert.match(home, /\sfill\s/);
    assert.match(home, /\spreload\s/);
    assert.doesNotMatch(home, /HeroMosaic|heroCollagePhotos|mosaicListings/);
  });

  it("uses stored listing photo alt text in browse list cards", () => {
    const browse = source("src/app/browse/page.tsx");

    assert.match(browse, /photoAltText: l\.photos\[0\]\?\.altText \?\? null/);
    assert.match(browse, /<img alt=\{l\.photos\[0\]\?\.altText \?\? l\.title\}/);
    assert.doesNotMatch(browse, /<img alt=\{l\.title\} src=\{img\}/);
  });

  it("labels report forms and address autocomplete listboxes", () => {
    const report = source("src/components/BlockReportButton.tsx");
    const address = source("src/components/AddressAutocomplete.tsx");

    assert.match(report, /htmlFor="report-reason"/);
    assert.match(report, /id="report-reason"/);
    assert.match(report, /htmlFor="report-details"/);
    assert.match(report, /id="report-details"/);
    assert.match(report, /aria-haspopup="dialog"/);
    assert.match(report, /role="dialog"/);
    assert.match(report, /aria-label="Report and block options"/);
    assert.doesNotMatch(report, /role="menu"/);
    assert.match(address, /role="combobox"/);
    assert.match(address, /aria-autocomplete="list"/);
    assert.match(address, /aria-expanded=\{open\}/);
    assert.match(address, /aria-controls=\{listboxId\}/);
    assert.match(address, /role="listbox"/);
    assert.match(address, /role="option"/);
    assert.match(address, /aria-selected=\{activeIndex === index\}/);
    assert.match(address, /ArrowDown/);
    assert.match(address, /ArrowUp/);
  });

  it("keeps compact visual controls accessible without noisy glyphs", () => {
    const thread = source("src/components/ThreadMessages.tsx");
    const favorite = source("src/components/FavoriteButton.tsx");
    const saveBlog = source("src/components/SaveBlogButton.tsx");
    const imageLightbox = source("src/components/ImageLightbox.tsx");
    const listingGallery = source("src/components/ListingGallery.tsx");
    const home = source("src/app/page.tsx");

    assert.match(thread, /Open<span className="sr-only"> in a new tab<\/span>/);
    assert.match(thread, /aria-label=\{`Open \$\{file\.name \?\? "file attachment"\} in a new tab`\}/);
    assert.doesNotMatch(thread, /⬇️/);
    assert.match(favorite, /h-11 w-11/);
    assert.match(favorite, /h-9 w-9 rounded-full/);
    assert.match(saveBlog, /p-3/);
    assert.match(imageLightbox, /<span aria-hidden="true">✕<\/span>/);
    assert.match(listingGallery, /<span aria-hidden="true">✕<\/span>/);
    assert.doesNotMatch(home, /<span aria-hidden="true">★<\/span>/);
    assert.doesNotMatch(home, /animate-bounce/);
  });

  it("keeps account popover and rating slider semantics honest", () => {
    const avatarMenu = source("src/components/UserAvatarMenu.tsx");
    const foundingBadge = source("src/components/FoundingMakerBadge.tsx");
    const starInput = source("src/components/StarInput.tsx");
    const layout = source("src/app/layout.tsx");

    assert.match(avatarMenu, /if \(!open\) return/);
    assert.match(avatarMenu, /aria-haspopup="dialog"/);
    assert.match(avatarMenu, /role="dialog"/);
    assert.match(avatarMenu, /id=\{popoverId\}/);
    assert.match(avatarMenu, /aria-controls=\{open \? popoverId : undefined\}/);
    assert.doesNotMatch(avatarMenu, /aria-haspopup="menu"/);
    assert.doesNotMatch(avatarMenu, /role="menu"/);
    assert.doesNotMatch(avatarMenu, /role="menuitem"/);
    assert.match(foundingBadge, /aria-expanded=\{open\}/);
    assert.match(foundingBadge, /aria-haspopup="dialog"/);
    assert.match(foundingBadge, /aria-controls=\{open \? popoverId : undefined\}/);
    assert.match(foundingBadge, /id=\{popoverId\}/);
    assert.match(foundingBadge, /role="dialog"/);
    assert.match(starInput, /role="slider"/);
    assert.match(starInput, /tabIndex=\{0\}/);
    assert.match(starInput, /aria-valuetext=\{`\$\{\(valueX2 \/ 2\)\.toFixed\(1\)\} out of 5 stars`\}/);
    assert.match(starInput, /ArrowRight/);
    assert.match(starInput, /ArrowLeft/);
    assert.match(starInput, /Home/);
    assert.match(starInput, /End/);
    assert.match(starInput, /htmlFor=\{selectId\}/);
    // Footer is cream (#EFEAE0) as of 2026-07-10 — links must use readable
    // neutral text, and no light-on-dark stone text may remain.
    assert.match(layout, /text-neutral-600 hover:text-neutral-900/);
    assert.doesNotMatch(layout, /text-stone-100/);
    assert.doesNotMatch(layout, /text-stone-300/);
    assert.doesNotMatch(source("src/app/page.tsx"), /text-amber-600">Blog post/);
    assert.doesNotMatch(source("src/components/VariantSelector.tsx"), /text-amber-600">Please select/);
  });

  it("keeps the mobile menu a repaint-safe popover (no modal inert, no painted backdrop)", () => {
    const header = source("src/components/Header.tsx");

    // The menu is a popover like NotificationBell, NOT a modal. Toggling
    // inert/aria-hidden on #main-content and compositing a painted
    // full-screen backdrop both caused visible flashes on mobile
    // open/close/navigation. Popover contract: transparent click-catcher,
    // focus moves to the card on open, blur outside closes, Escape closes.
    assert.match(header, /const drawerId = React\.useId\(\)/);
    assert.match(header, /aria-expanded=\{drawerOpen\}/);
    assert.match(header, /aria-haspopup="dialog"/);
    assert.match(header, /aria-controls=\{drawerOpen \? drawerId : undefined\}/);
    assert.match(header, /id=\{drawerId\}/);
    assert.match(header, /if \(!drawerOpen\) return/);
    assert.match(header, /clearDrawerCloseTimer\(\);[\s\S]*setDrawerClosing\(false\);[\s\S]*setDrawerOpen\(true\);/);
    assert.doesNotMatch(header, /setAttribute\("inert"/);
    assert.doesNotMatch(header, /aria-modal="true"/);
    assert.doesNotMatch(header, /bg-black\/30/);
    assert.match(header, /className="fixed inset-0 z-\[1000\] touch-none"/);
    assert.match(header, /data-drawer-scroll-region/);
    assert.match(header, /scrollRegion\.scrollHeight > scrollRegion\.clientHeight \+ 1/);
    assert.match(header, /drawerNavFade &&/);
    assert.match(header, /bg-gradient-to-t to-transparent/);
    assert.match(header, /from-\[#F7F5F0\] via-\[#F7F5F0\]\/75/);
    assert.match(header, /drawerRef\.current\?\.focus\(\)/);
    assert.match(header, /onBlur=\{/);
    assert.match(header, /!drawerRef\.current\.contains\(e\.relatedTarget\)/);
  });

  it("contains mobile drawer scrolling without pinning the document body", () => {
    const header = source("src/components/Header.tsx");

    assert.doesNotMatch(header, /useBodyScrollLock\(drawerOpen\)/);
    assert.match(header, /document\.addEventListener\("wheel", preventBackgroundScroll, \{ passive: false \}\)/);
    assert.match(header, /document\.addEventListener\("touchmove", preventBackgroundScroll, \{ passive: false \}\)/);
    assert.match(header, /event\.preventDefault\(\)/);
    assert.match(header, /data-drawer-scroll-region/);
    assert.match(header, /overflow-y-auto overscroll-contain/);
  });

  it("keeps data tables captioned and column headers scoped", () => {
    const tableFiles = [
      "src/app/why-sell-on-grainline/page.tsx",
      "src/app/admin/cases/page.tsx",
      "src/app/admin/flagged/page.tsx",
      "src/app/admin/audit/page.tsx",
      "src/app/admin/users/page.tsx",
      "src/app/admin/orders/page.tsx",
      "src/app/dashboard/analytics/page.tsx",
    ];

    for (const path of tableFiles) {
      const text = source(path);
      const tableCount = (text.match(/<table\b/g) ?? []).length;
      const captionCount = (text.match(/<caption\b/g) ?? []).length;

      assert.ok(tableCount > 0, `${path} should contain a table`);
      assert.equal(captionCount, tableCount, `${path} should caption every table`);
      assert.doesNotMatch(text, /<th\b(?![^>]*\bscope=)/, `${path} should scope every table header`);
    }
  });

  it("keeps homepage heading order and the single-photo hero accessible", () => {
    const home = source("src/app/page.tsx");
    const globals = source("src/app/globals.css");
    const searchBar = source("src/components/SearchBar.tsx");
    const makersMap = source("src/components/MakersMapSection.tsx");

    assert.match(home, /<main className="overflow-x-hidden">/);
    assert.equal((home.match(/<h1\b/g) ?? []).length, 1);
    assert.ok(home.indexOf("<h1") < home.indexOf("<h2"), "homepage h1 should precede section h2s");
    assert.doesNotMatch(home, /<h[4-6]\b/);
    for (const heading of [
      "Shop by Category",
      "New Arrivals",
      "Top Picks",
      "From the Blog",
    ]) {
      assert.match(home, new RegExp(`<h2[^>]*>[\\s\\S]*?${heading}[\\s\\S]*?<\\/h2>`));
    }

    assert.match(home, /data-home-hero/);
    assert.match(home, /h-\[clamp\(520px,68svh,600px\)\]/);
    assert.match(home, /sm:h-\[clamp\(600px,78svh,760px\)\]/);
    assert.match(home, /src="\/hero-maple-cabinets\.jpg"/);
    assert.match(home, /quality=\{88\}/);
    assert.match(home, /sizes="\(max-width: 639px\) 150vw, 100vw"/);
    assert.match(home, /object-\[43%_58%\]/);
    assert.match(home, /lg:object-\[center_58%\]/);
    assert.match(home, /<span className="block whitespace-nowrap">Buy handmade\.<\/span>/);
    assert.match(home, /<span className="block whitespace-nowrap">Buy local\.<\/span>/);
    assert.match(home, /<span className="block whitespace-nowrap">Buy quality\.<\/span>/);
    assert.match(home, /href="\/browse"[\s\S]*>\s*Browse\s*<\/Link>/);
    assert.match(home, /href="\/map"[\s\S]*Find Shops Near You/);
    assert.doesNotMatch(home, /HeroMosaic|mosaicListings|getPopularListingTags|<SearchBar|Trending:/);
    assert.match(home, /data-home-stats/);
    assert.match(home, /aria-label="Grainline marketplace statistics"/);
    assert.match(home, /<dl\b/);
    assert.equal((home.match(/<dt\b/g) ?? []).length, 4);
    assert.equal((home.match(/<dd\b/g) ?? []).length, 4);
    assert.match(searchBar, /role="search"/);
    assert.match(searchBar, /aria-label="Search Grainline"/);
    assert.match(searchBar, /min-h-\[46px\]/);
    assert.match(searchBar, /min-w-11/);
    assert.match(searchBar, /className="min-w-0 flex-1/);
    assert.match(searchBar, /max-h-\[min\(28rem,calc\(100dvh-9rem\)\)\]/);
    assert.match(searchBar, /overflow-y-auto overscroll-contain/);
    assert.match(makersMap, /<section className="min-w-0">/);
    assert.match(makersMap, /lg:items-center/);
    assert.match(makersMap, /w-full min-w-0 flex-1/);
    assert.doesNotMatch(home, /animate-bounce motion-reduce:animate-none/);
    assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(globals, /animate-scroll-left|animate-scroll-right|@keyframes scroll-left|@keyframes scroll-right/);
    assert.match(globals, /\.animate-slide-in-right,[\s\S]*\.animate-slide-down \{[\s\S]*animation: none !important/);
    assert.match(globals, /transition-duration: 0\.01ms !important/);
  });

  it("keeps scroll reveal content visible until client observation can hide it", () => {
    const hook = source("src/hooks/useInView.ts");
    const section = source("src/components/ScrollSection.tsx");

    assert.match(hook, /const \[hasObserved, setHasObserved\] = useState\(false\)/);
    assert.match(hook, /typeof IntersectionObserver === "undefined"/);
    assert.match(hook, /setHasObserved\(true\)/);
    assert.match(hook, /setInView\(true\)/);
    assert.match(hook, /return \{ ref, hasObserved, inView \}/);
    assert.match(section, /const \{ ref, hasObserved, inView \} = useInView/);
    assert.match(section, /const shouldReveal = !hasObserved \|\| inView/);
    assert.match(section, /shouldReveal \? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"/);
  });
});
