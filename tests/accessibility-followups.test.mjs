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

    assert.match(shippingRates, /<fieldset className="space-y-2">/);
    assert.match(shippingRates, /<legend className="text-sm font-medium text-neutral-500">Shipping from/);
    assert.match(filters, /<fieldset>/);
    assert.match(filters, /<legend className="font-medium mb-1.5">Listing type<\/legend>/);
    assert.match(filters, /<legend className="font-medium mb-1.5">Price \(USD\)<\/legend>/);
    assert.match(filters, /<legend className="font-medium mb-1.5">Near location<\/legend>/);
    assert.match(filters, /htmlFor=\{`\$\{baseId\}-min`\}/);
    assert.match(filters, /htmlFor=\{`\$\{baseId\}-max`\}/);
    assert.match(filters, /htmlFor=\{`\$\{baseId\}-radius`\}/);
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

  it("labels report forms and address autocomplete listboxes", () => {
    const report = source("src/components/BlockReportButton.tsx");
    const address = source("src/components/AddressAutocomplete.tsx");

    assert.match(report, /htmlFor="report-reason"/);
    assert.match(report, /id="report-reason"/);
    assert.match(report, /htmlFor="report-details"/);
    assert.match(report, /id="report-details"/);
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
    assert.match(favorite, /p-3/);
    assert.match(saveBlog, /p-3/);
    assert.match(imageLightbox, /<span aria-hidden="true">✕<\/span>/);
    assert.match(listingGallery, /<span aria-hidden="true">✕<\/span>/);
    assert.match(home, /<svg aria-hidden="true" width="24" height="24"/);
  });

  it("keeps account popover and rating slider semantics honest", () => {
    const avatarMenu = source("src/components/UserAvatarMenu.tsx");
    const starInput = source("src/components/StarInput.tsx");
    const layout = source("src/app/layout.tsx");

    assert.doesNotMatch(avatarMenu, /role="menu"/);
    assert.doesNotMatch(avatarMenu, /role="menuitem"/);
    assert.match(starInput, /role="slider"/);
    assert.match(starInput, /tabIndex=\{0\}/);
    assert.match(starInput, /aria-valuetext=\{`\$\{\(valueX2 \/ 2\)\.toFixed\(1\)\} out of 5 stars`\}/);
    assert.match(starInput, /ArrowRight/);
    assert.match(starInput, /ArrowLeft/);
    assert.match(starInput, /Home/);
    assert.match(starInput, /End/);
    assert.match(starInput, /htmlFor=\{selectId\}/);
    assert.match(layout, /text-stone-100/);
    assert.doesNotMatch(layout, /text-stone-300\/60/);
    assert.doesNotMatch(layout, /text-stone-300\/80/);
    assert.doesNotMatch(source("src/app/page.tsx"), /text-amber-600">Blog post/);
    assert.doesNotMatch(source("src/components/VariantSelector.tsx"), /text-amber-600">Please select/);
  });

  it("makes background content inert while the mobile drawer is open", () => {
    const header = source("src/components/Header.tsx");

    assert.match(header, /const main = document\.getElementById\("main-content"\)/);
    assert.match(header, /main\.setAttribute\("inert", ""\)/);
    assert.match(header, /main\.setAttribute\("aria-hidden", "true"\)/);
    assert.match(header, /main\.removeAttribute\("inert"\)/);
    assert.match(header, /main\.removeAttribute\("aria-hidden"\)/);
    assert.match(header, /\}, \[drawerOpen\]\)/);
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

  it("keeps homepage heading order and reduced-motion hero controls auditable", () => {
    const home = source("src/app/page.tsx");
    const heroMosaic = source("src/components/HeroMosaic.tsx");
    const globals = source("src/app/globals.css");

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

    assert.match(heroMosaic, /aria-label=\{paused \? "Play hero animation" : "Pause hero animation"\}/);
    assert.match(heroMosaic, /aria-pressed=\{paused\}/);
    assert.match(heroMosaic, /motion-reduce:animate-none/);
    assert.match(heroMosaic, /motion-reduce:blur-none/);
    assert.match(heroMosaic, /motion-reduce:scale-100/);
    assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(globals, /\.animate-scroll-left,[\s\S]*\.animate-slide-down \{[\s\S]*animation: none !important/);
    assert.match(globals, /transition-duration: 0\.01ms !important/);
  });
});
