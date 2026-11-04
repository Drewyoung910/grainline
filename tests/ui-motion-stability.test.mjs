import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("motion stability guardrails", () => {
  it("locks dialogs without changing either document scroll container", () => {
    const dialog = source("src/lib/dialogFocus.ts");
    assert.match(dialog, /installScrollGuards/);
    assert.match(
      dialog,
      /previouslyFocused\.focus\(\{ preventScroll: true \}\)/,
    );
    assert.match(
      dialog,
      /document\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/,
    );
    assert.match(
      dialog,
      /document\.addEventListener\("touchmove", onTouchMove, \{ passive: false \}\)/,
    );
    assert.match(dialog, /document\.addEventListener\("keydown", onKeyDown\)/);
    assert.doesNotMatch(
      dialog,
      /style\.overflow =|style\.position =|style\.top =|window\.scrollTo/,
    );
    assert.match(source("src/app/globals.css"), /scrollbar-gutter: stable/);
  });

  it("keeps repeat purchase and follow clicks inert without dropping focus or opacity", () => {
    const add = source("src/components/AddToCartButton.tsx");
    const follow = source("src/components/FollowButton.tsx");
    assert.match(add, /if \(loadingRef\.current\) return;/);
    assert.match(add, /loadingRef\.current = true;/);
    assert.match(add, /aria-disabled=\{loading \|\| undefined\}/);
    assert.match(add, /aria-busy=\{loading \|\| undefined\}/);
    assert.doesNotMatch(add, /disabled=\{loading\}/);
    assert.match(follow, /if \(loadingRef\.current\) return;/);
    assert.match(follow, /loadingRef\.current = true;/);
    assert.match(follow, /aria-disabled=\{loading \|\| undefined\}/);
    assert.doesNotMatch(follow, /disabled=\{loading\}/);
    const css = source("src/app/globals.css");
    assert.match(css, /&\[aria-busy="true"\] \{\s*cursor: wait;/);
    assert.doesNotMatch(css, /&:disabled,\s*&\[aria-disabled="true"\]/);
  });

  it("collapses removed cart rows while their content fades", () => {
    const cart = source("src/app/cart/page.tsx");
    const css = source("src/app/globals.css");
    assert.match(
      cart,
      /className=\{`cart-row\$\{removingIds\.has\(i\.id\) \? " cart-row-leaving" : ""\}`\}/,
    );
    assert.match(
      cart,
      /className="cart-row-content flex items-center gap-3 py-3"/,
    );
    assert.match(css, /\.cart-row\s*\{[\s\S]*grid-template-rows: 1fr/);
    assert.match(css, /\.cart-row-leaving\s*\{[\s\S]*grid-template-rows: 0fr/);
  });

  it("never fades a newly selected gallery photo to partial opacity", () => {
    const gallery = source("src/components/ListingGallery.tsx");
    const swap = gallery.slice(gallery.indexOf("function playPhotoSwap"));
    assert.match(swap, /transform: "scale\(1\.01\)"/);
    assert.doesNotMatch(swap, /opacity:/);
  });

  it("reserves the desktop auth slot and makes the homepage map cooperative", () => {
    const header = source("src/components/Header.tsx");
    const map = source("src/components/AllSellersMap.tsx");
    const mapSection = source("src/components/MakersMapSection.tsx");
    assert.match(header, /inline-flex min-w-\[76px\] justify-end/);
    assert.match(header, /fallback=\{[\s\S]*isLoaded \? \(/);
    assert.match(map, /cooperativeGestures: true/);
    assert.match(mapSection, /w-full min-w-0 lg:flex-1/);
    assert.doesNotMatch(mapSection, /w-full min-w-0 flex-1/);
  });

  it("fades map cards without springing them against the moving map", () => {
    const card = source("src/components/MakerMapCard.tsx");
    const css = source("src/app/globals.css");

    assert.match(card, /map-card-in/);
    assert.match(card, /min-h-\[15rem\]/);
    assert.doesNotMatch(card, /animate-menu-in/);
    assert.match(
      css,
      /@keyframes map-card-fade-in \{[\s\S]*from \{ opacity: 0; \}[\s\S]*to \{ opacity: 1; \}/,
    );
  });

  it("does not replay browse-card entrances on Back or sort navigation", () => {
    const css = source("src/app/globals.css");
    assert.doesNotMatch(
      css,
      /\.results-stagger >|\.card-rise\s*\{|@keyframes card-rise/,
    );
  });

  it("glides only changed, visible browse results and respects reduced motion", () => {
    const flip = source("src/components/FlipList.tsx");
    const browse = source("src/app/browse/page.tsx");
    assert.match(
      flip,
      /previousKeyRef\.current !== null && previousKeyRef\.current !== itemKey/,
    );
    assert.match(flip, /prefers-reduced-motion: reduce/);
    assert.match(flip, /window\.innerHeight \+ VIEWPORT_MARGIN/);
    assert.match(flip, /ResizeObserver/);
    assert.match(browse, /<FlipList/);
    assert.match(browse, /flipId=\{l\.id\}/);
    assert.doesNotMatch(browse, /results-stagger/);
  });

  it("reveals unsaved card actions without moving their hit areas", () => {
    const css = source("src/app/globals.css");
    const card = source("src/components/ListingCard.tsx");
    const favorite = source("src/components/FavoriteButton.tsx");
    const blogSave = source("src/components/SaveBlogButton.tsx");
    assert.match(
      css,
      /\.listing-card-photo \.listing-save-control\[data-saved="false"\]/,
    );
    assert.match(
      css,
      /\.listing-card-photo:hover \.listing-save-control\[data-saved="false"\]/,
    );
    assert.doesNotMatch(
      css,
      /\.group:hover \.listing-save-control\[data-saved="false"\]/,
    );
    assert.match(css, /translate: 0 3px;/);
    assert.match(css, /scale: 0\.94;/);
    assert.doesNotMatch(css, /transform: translateY\(3px\) scale\(0\.94\)/);
    assert.match(card, /group\/photo/);
    assert.match(card, /group-hover\/photo:data-\[ready=true\]:opacity-100/);
    assert.match(favorite, /data-saved=\{saved \? "true" : "false"\}/);
    assert.match(blogSave, /data-saved=\{saved \? "true" : "false"\}/);
    assert.match(
      favorite,
      /transform-gpu items-center justify-center[\s\S]*transition-\[opacity,translate,scale\]/,
    );
    assert.match(
      blogSave,
      /transform-gpu items-center justify-center[\s\S]*transition-\[opacity,translate,scale\]/,
    );
  });

  it("keeps every legacy listing and story save action inside the photo surface", () => {
    const paths = [
      "src/components/RecentlyViewed.tsx",
      "src/app/browse/page.tsx",
      "src/app/listing/[id]/page.tsx",
      "src/app/account/feed/FeedClient.tsx",
      "src/app/page.tsx",
      "src/app/blog/page.tsx",
      "src/app/blog/author/[slug]/page.tsx",
    ];
    for (const path of paths) {
      const text = source(path);
      assert.match(text, /photo-save-surface/);
    }

    const css = source("src/app/globals.css");
    assert.match(
      css,
      /\.photo-save-surface \.listing-save-control\[data-saved="false"\]/,
    );
    assert.match(
      css,
      /\.photo-save-surface:hover \.listing-save-control\[data-saved="false"\]/,
    );
    assert.doesNotMatch(css, /\.card-listing:hover \.listing-save-control/);
  });

  it("limits legacy card image zoom to the photo instead of the metadata", () => {
    const paths = [
      "src/components/SimilarMakers.tsx",
      "src/app/account/page.tsx",
    ];
    for (const path of paths) {
      const text = source(path);
      assert.match(text, /group\/photo[\s\S]*group-hover\/photo:scale-/);
      assert.doesNotMatch(text, /group-hover:scale-/);
    }
  });

  it("paints seller tabs edge to edge without introducing viewport-width overflow", () => {
    const tabs = source("src/components/SectionTabs.tsx");
    assert.match(tabs, /clip-path:inset\(0_-100vmax\)/);
    assert.match(tabs, /boxShadow: "0 0 0 100vmax/);
    assert.doesNotMatch(tabs, /w-screen|-ml-\[50vw\]|-mr-\[50vw\]/);
  });

  it("keeps hover hit areas still and preserves toast exit geometry", () => {
    const home = source("src/app/page.tsx");
    const seller = source("src/app/seller/[id]/page.tsx");
    const toast = source("src/components/Toast.tsx");
    assert.doesNotMatch(
      home,
      /hover:-translate-y-\[3px\]|hover:-translate-y-1/,
    );
    assert.doesNotMatch(seller, /hover:-translate-y-1/);
    const leaving = toast.slice(
      toast.indexOf("t.leaving ?"),
      toast.indexOf(") : (", toast.indexOf("t.leaving ?")),
    );
    assert.match(leaving, /t\.action\.label/);
    assert.match(leaving, /t\.type === "error"/);
    assert.match(leaving, /<X size=\{14\}/);
  });

  it("swallows the first mobile notification outside tap", () => {
    const bell = source("src/components/NotificationBell.tsx");
    assert.match(bell, /className="fixed inset-0 z-40 md:hidden"/);
    assert.match(
      bell,
      /onPointerDown=\{\(event\) => \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*onClick=\{\(event\) => \{[\s\S]*closeDropdown\(\)/,
    );
  });

  it("keeps navigation state aligned during rapid browse interactions", () => {
    const filters = source("src/components/FilterSidebar.tsx");
    const segmented = source("src/components/SegmentedControl.tsx");
    const chip = source("src/components/FilterChipLink.tsx");
    const saved = source("src/components/SaveSearchButton.tsx");
    assert.match(filters, /pendingParamsRef/);
    assert.match(filters, /resetKey=\{searchKey\}/);
    assert.match(segmented, /setPendingValue\(null\);[\s\S]*\[resetKey\]/);
    assert.match(segmented, /if \(next === activeValue\) return/);
    assert.doesNotMatch(chip, /setTimeout|filter-chip-out|useRouter/);
    assert.match(saved, /activeSearchKey\.current = searchKey/);
    assert.match(saved, /activeSearchKey\.current === savedSearchKey/);
  });

  it("keeps commission categories compact instead of wrapping into a wall of controls", () => {
    const commission = source("src/app/commission/page.tsx");
    const categoryRow = commission.slice(
      commission.indexOf("{/* Filters */}"),
      commission.indexOf("{requests.length === 0"),
    );

    assert.match(categoryRow, /<ScrollFadeRow/);
    assert.match(categoryRow, /overflow-x-auto/);
    assert.match(categoryRow, /flex min-w-max gap-2/);
    assert.doesNotMatch(categoryRow, /flex-wrap/);
  });

  it("composes listing story and facts side by side without dropping policy content", () => {
    const listing = source("src/app/listing/[id]/page.tsx");
    const composition = listing.slice(
      listing.indexOf("{/* ── Story and details"),
      listing.indexOf("{/* ── Pickup area map"),
    );

    assert.match(
      composition,
      /lg:grid-cols-\[minmax\(0,1\.25fr\)_minmax\(18rem,0\.75fr\)\]/,
    );
    assert.match(composition, /About this piece/);
    assert.match(composition, />\s*Details\s*</);
    assert.match(composition, /Shop policies/);
    assert.match(composition, /listing\.seller\.returnPolicy/);
    assert.match(composition, /listing\.seller\.shippingPolicy/);
    assert.match(composition, /listing\.seller\.customOrderPolicy/);
  });

  it("makes the review breakdown prominent while preserving review behavior", () => {
    const reviews = source("src/components/ReviewsSection.tsx");

    assert.match(reviews, /lg:grid-cols-\[17rem_minmax\(0,1fr\)\]/);
    assert.match(reviews, /aria-label="Rating breakdown"/);
    assert.match(reviews, /rating-bar-fill/);
    assert.match(reviews, /My review/);
    assert.match(reviews, /<ImageLightbox[\s\S]*?images=\{mine\.photos/);
    assert.match(reviews, /<ImageLightbox[\s\S]*?images=\{r\.photos/);
    assert.match(reviews, /reply=\{mine\.sellerReply\}/);
    assert.match(reviews, /<SellerReplyForm[\s\S]*?reviewId=\{r\.id\}/);
    assert.match(reviews, /<HelpfulButton/);
    assert.match(reviews, /<BlockReportButton/);
  });

  it("keeps shared pill geometry without flattening action meaning", () => {
    const css = source("src/app/globals.css");
    const listingAdmin = source("src/components/ReviewListingButtons.tsx");
    const resolution = source("src/components/CaseResolutionPanel.tsx");
    const profile = source("src/app/dashboard/profile/page.tsx");
    const queue = source("src/lib/workshopData.ts");

    for (const tone of [
      "btn-danger",
      "btn-danger-solid",
      "btn-success",
      "btn-success-solid",
      "btn-warning",
      "btn-warning-solid",
    ]) {
      assert.match(css, new RegExp(`@utility ${tone} \\{`));
    }
    assert.match(listingAdmin, /btn btn-success-solid btn-sm/);
    assert.match(listingAdmin, /btn btn-danger btn-sm/);
    assert.match(resolution, /btn btn-warning btn-sm/);
    assert.match(profile, /isFeatured \? "btn-warning" : "btn-secondary"/);
    assert.match(queue, /sellerRefundOutcomes/);
  });

  it("shows cart quantity presses immediately while serializing server saves", () => {
    const cart = source("src/app/cart/page.tsx");
    const steps = source("src/lib/useQuantitySteps.ts");
    assert.match(steps, /draftsRef\.current\.set\(itemId, quantity\)/);
    assert.match(steps, /if \(savingRef\.current\.has\(itemId\)\) return/);
    assert.match(
      steps,
      /while \(ok && draftsRef\.current\.get\(itemId\) !== saved\)/,
    );
    assert.match(cart, /aria-label="One fewer"/);
    assert.match(cart, /aria-label="One more"/);
    assert.match(cart, /aria-disabled=\{atLeast \|\| undefined\}/);
    assert.match(cart, /aria-disabled=\{atMost \|\| undefined\}/);
    assert.match(
      cart,
      /<RollingNumber value=\{shownQuantity\} grouped=\{false\}/,
    );
    assert.doesNotMatch(cart, /\sdisabled=\{atLeast|\sdisabled=\{atMost/);
  });

  it("does not drop a signed-in Buy Now tap while Clerk hydrates", () => {
    const button = source("src/components/BuyNowButton.tsx");
    const panel = source("src/components/ListingPurchasePanel.tsx");
    assert.match(
      button,
      /const signedInNow = signedIn \|\| isSignedIn === true/,
    );
    assert.doesNotMatch(button, /disabled=\{!isLoaded\}/);
    assert.match(panel, /<BuyNowButton\s+signedIn/);
  });

  it("falls back to original listing images when optimization fails", () => {
    const gallery = source("src/components/ListingGallery.tsx");
    assert.match(gallery, /optimizerFailures\.has\(activeUrl\)/);
    assert.match(
      gallery,
      /setOptimizerFailures\(\(current\) => new Set\(current\)\.add\(activeUrl\)\)/,
    );
    assert.match(gallery, /optimizerFailures\.has\(p\.url\)/);
  });
});
