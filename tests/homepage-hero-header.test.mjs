import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function openingTagWith(text, marker) {
  const markerIndex = text.indexOf(marker);
  assert.notEqual(markerIndex, -1, `expected ${marker}`);
  const start = text.lastIndexOf("<", markerIndex);
  const end = text.indexOf(">", markerIndex);
  assert.ok(start >= 0 && end > markerIndex, `expected an opening tag around ${marker}`);
  return text.slice(start, end + 1);
}

describe("homepage hero and header contracts", () => {
  it("ships one optimized local cabinet photograph as the decorative hero", () => {
    const home = source("src/app/page.tsx");
    const nextConfig = source("next.config.ts");
    const asset = statSync("public/hero-maple-cabinets.jpg");

    assert.ok(asset.size > 100_000, "hero asset should contain the full-resolution photograph");
    assert.ok(asset.size < 1_500_000, "hero asset should stay reasonably compressed before Next image optimization");
    assert.equal((home.match(/src="\/hero-maple-cabinets\.jpg"/g) ?? []).length, 1);
    assert.match(home, /import Image from "next\/image"/);
    assert.match(home, /src="\/hero-maple-cabinets\.jpg"[\s\S]*alt=""[\s\S]*aria-hidden="true"[\s\S]*fill[\s\S]*preload[\s\S]*quality=\{88\}[\s\S]*sizes="\(max-width: 639px\) 150vw, 100vw"/);
    assert.match(nextConfig, /images:\s*\{[\s\S]*qualities: \[75, 88\]/);
    assert.match(home, /object-\[43%_58%\][\s\S]*sm:object-\[26%_58%\][\s\S]*md:object-\[35%_58%\][\s\S]*lg:object-\[center_58%\]/);
    assert.match(home, /h-\[clamp\(520px,68svh,600px\)\]/);
    assert.match(home, /sm:h-\[clamp\(600px,78svh,760px\)\]/);
    assert.ok(home.includes("rgba(44,31,26,0.78)_0%,rgba(44,31,26,0.62)_44%,rgba(44,31,26,0.24)_76%,rgba(44,31,26,0.04)_100%"));
    assert.ok(home.includes("lg:bg-[linear-gradient(90deg,rgba(44,31,26,0.78)_0%,rgba(44,31,26,0.60)_28%,rgba(44,31,26,0.18)_48%,rgba(44,31,26,0)_66%)]"));
    assert.ok(home.includes("rgba(44,31,26,0.12)_0%,rgba(44,31,26,0)_24%,rgba(44,31,26,0)_82%,rgba(44,31,26,0.10)_100%"));
    assert.doesNotMatch(home, /rgba\(10,16,15|rgba\(6,10,9/);
    assert.match(home, /text-\[clamp\(2\.125rem,10\.5vw,4rem\)\]/);
    assert.match(home, /sm:text-\[clamp\(3\.5rem,7vw,4\.75rem\)\]/);
    assert.match(home, /lg:text-\[clamp\(4rem,5vw,5\.25rem\)\]/);
    assert.doesNotMatch(home, /11\.5vw|5\.75rem/);
    assert.doesNotMatch(home, /HeroMosaic|mosaicListings|heroCollagePhotos/);
  });

  it("pins one frosted header: clear over the homepage photo, frosted paper everywhere else", () => {
    const header = source("src/components/Header.tsx");
    const globals = source("src/app/globals.css");

    assert.match(header, /const isHome = pathname === "\/"/);
    // Clear only at the top of the homepage; frosted on scroll and on every
    // other page (Drew, 2026-10-30: "frosted on other pages same as home").
    assert.match(header, /const clear = isHome && !scrolled;/);
    assert.match(header, /setScrolled\(window\.scrollY > 24\)/);
    assert.match(header, /window\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
    // Message threads keep their own pinned chat header, so the site header
    // scrolls away there.
    assert.match(header, /const pinned = !pathname\.startsWith\("\/messages\/"\);/);
    assert.match(header, /\$\{isHome \? "fixed" : pinned \? "sticky" : "relative"\} inset-x-0 top-0 z-\[50\]/);
    assert.match(header, /data-header-state=\{clear \? "clear" : "frosted"\}/);
    // The frost is its own layer so the menu's fixed click-catcher is not
    // trapped inside a backdrop-filtered header box.
    const frost = openingTagWith(header, "data-header-frost");
    assert.match(frost, /absolute inset-0 -z-10 bg-\[#F7F5F0\]\/85[^"]*backdrop-blur-xl/);
    assert.match(frost, /clear \? "opacity-0" : "opacity-100"/);
    const headerTag = openingTagWith(header, "data-header-state");
    assert.doesNotMatch(headerTag, /backdrop-blur/);
    // One masked logo tinted cream over the photo and espresso on paper.
    assert.equal((header.match(/data-site-logo-mark/g) ?? []).length, 1);
    assert.match(header, /logo-mark block h-5 w-\[92px\][^`]*lg:h-8 lg:w-\[148px\]/);
    assert.match(header, /clear \? "bg-\[#E5DFD2\]" : "bg-\[#2C1F1A\]"/);
    assert.match(globals, /\.logo-mark \{[\s\S]*mask: url\("\/logo\.svg"\) center \/ contain no-repeat;/);
    assert.doesNotMatch(globals, /\.hero-logo-mark|\.logo-mark \{[^}]*background-color/);
    assert.match(header, /aria-label="Grainline home"/);
    // Desktop: search, then text nav with a sliding underline, then tools.
    assert.match(header, /data-header-search-slot className="flex min-w-\[220px\] max-w-\[640px\] flex-1"/);
    assert.match(header, /<SearchBar tone=\{clear \? "glass" : "solid"\} \/>/);
    assert.match(header, /after:origin-left after:bg-current/);
    assert.match(header, /hover:after:scale-x-100/);
    for (const href of ["/browse", "/blog", "/commission"]) {
      assert.match(header, new RegExp(`href="${href}" aria-current=\\{navLinkCurrent\\("${href}"\\)\\}`));
    }
    assert.match(header, /data-header-actions className="ml-auto flex shrink-0 items-center gap-1"/);
    assert.match(header, /border border-current\/35 px-4 text-sm font-medium/);
    // Popovers are solid in every state.
    assert.doesNotMatch(header, /overlay=\{/);
    assert.doesNotMatch(header, /data-home-(overlay|header-surface|logo-mark|menu-surface)/);
    // Header icon buttons follow the header color.
    assert.match(header, /text-current transition-\[background-color,scale\] duration-200 ease-out hover:bg-current\/10/);
    assert.match(header, /lg:hidden/);
    assert.match(header, /min-h-\[44px\]/);
    assert.match(header, /min-w-\[44px\]/);
    // Mobile search popup.
    assert.match(header, /const mobileSearchId = React\.useId\(\)/);
    assert.match(header, /const \[searchClosing, setSearchClosing\] = React\.useState\(false\)/);
    assert.match(header, /const mobileSearchCloseTimerRef = React\.useRef<number \| null>\(null\)/);
    assert.match(header, /const closeMobileSearch = React\.useCallback/);
    assert.match(header, /const openMobileSearch = React\.useCallback/);
    assert.match(header, /aria-expanded=\{searchOpen\}/);
    assert.match(header, /aria-controls=\{mobileSearchId\}/);
    assert.match(header, /id=\{mobileSearchId\}/);
    assert.match(header, /data-mobile-search-popup/);
    assert.match(header, /left-3 right-3 top-\[calc\(100%\+0\.5rem\)\]/);
    assert.match(header, /onClick=\{closeMobileSearch\}/);
    assert.match(header, /searchClosing \? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"/);
    assert.match(header, /<SearchBar autoFocus tone="solid" \/>/);
    // Sticky elements and anchors clear the pinned header.
    assert.match(globals, /--site-header-h: 4rem;/);
    assert.match(globals, /scroll-padding-top: calc\(var\(--site-header-h\) \+ 0\.75rem\);/);
  });

  it("uses the deeper cream and touch-safe frosted CTA states", () => {
    const home = source("src/app/page.tsx");
    const primary = openingTagWith(home, "data-home-primary-cta");
    const secondary = openingTagWith(home, "data-home-secondary-cta");

    assert.match(home, /text-\[#E5DFD2\]/);
    assert.match(home, /text-\[#E5DFD2\]\/85/);
    assert.doesNotMatch(home, /text-\[#F7F1E6\]/);
    assert.match(primary, /min-h-\[46px\]/);
    assert.match(primary, /w-fit/);
    assert.match(primary, /rounded-full/);
    assert.match(primary, /bg-\[#E5DFD2\]\/70/);
    assert.match(primary, /backdrop-blur-md/);
    assert.match(primary, /hover:bg-\[#E5DFD2\]\/85/);
    assert.doesNotMatch(primary, /w-full|rounded-md|hover:bg-white/);
    assert.match(secondary, /w-fit/);
    assert.match(secondary, /rounded-full/);
    assert.match(secondary, /bg-\[#E5DFD2\]\/\[0\.08\]/);
    assert.match(secondary, /hover:bg-\[#E5DFD2\]\/15/);
    assert.match(secondary, /active:bg-\[#E5DFD2\]\/20/);
    assert.doesNotMatch(secondary, /w-full|rounded-md|hover:bg-\[#F7F5F0\]|hover:text-\[#2C1F1A\]/);
  });

  it("uses shop-forward local discovery copy on the homepage", () => {
    const home = source("src/app/page.tsx");
    const mapSection = source("src/components/MakersMapSection.tsx");

    assert.match(home, /More than what&apos;s made for everyone\./);
    assert.match(home, /data-home-primary-cta[\s\S]*>\s*Browse\s*<\/Link>/);
    assert.doesNotMatch(home, /Browse the Workshop/);
    assert.match(home, /data-home-secondary-cta[\s\S]*>\s*Find Shops Near You\s*<\/Link>/);
    assert.match(home, /heading="Find Shops Near You"/);
    assert.match(home, /See what people are building nearby, or explore shops across the country\./);
    assert.doesNotMatch(home, /Find Makers Near You|One-of-a-kind pieces, made with care/);
    assert.match(mapSection, /import \{ Navigation \} from "@\/components\/icons"/);
    // The location icon spins while the browser looks up the position.
    assert.match(mapSection, /<Navigation size=\{15\} className=\{`shrink-0\$\{locating \? " motion-safe:animate-spin" : ""\}`\} \/>[\s\S]*Use my location/);
    assert.match(mapSection, />\s*Explore the full map\s*</);
  });

  it("keeps homepage discovery and commerce sections in the intended source order", () => {
    const home = source("src/app/page.tsx");
    const markers = [
      "data-home-map",
      "data-home-top-picks",
      "data-home-categories",
      "data-home-new-arrivals",
      "data-home-followed-makers",
      "data-home-workshop",
      "data-home-blog",
    ];

    // Several sections are conditional at runtime. Their source positions are
    // still the stable ordering contract whenever those sections render.
    const positions = markers.map((marker) => {
      openingTagWith(home, marker);
      assert.equal(
        home.split(marker).length - 1,
        1,
        `expected exactly one ${marker} section`,
      );
      return home.indexOf(marker);
    });

    for (let index = 1; index < markers.length; index += 1) {
      assert.ok(
        positions[index - 1] < positions[index],
        `expected ${markers[index - 1]} before ${markers[index]}`,
      );
    }
  });

  it("keeps homepage editorial links and featured surfaces visually consistent", () => {
    const home = source("src/app/page.tsx");
    const sharedLinkClass =
      "group text-sm font-semibold text-neutral-800 underline-offset-4 transition-colors hover:text-amber-800 hover:underline";
    const storiesLink = openingTagWith(home, "Read more stories");
    const alsoFeaturedIndex = home.indexOf("Also featured this week");

    assert.ok(
      storiesLink.includes(`className="${sharedLinkClass}"`),
      "Read more stories should share the View more and Visit shop link treatment",
    );
    assert.match(home, /Read more stories <span aria-hidden="true"[^>]*>→<\/span>/);
    assert.notEqual(alsoFeaturedIndex, -1, "expected the Also featured strip");
    assert.match(
      home.slice(alsoFeaturedIndex, alsoFeaturedIndex + 1_000),
      /className="[^"]*card-section !bg-\[#EFEAE0\][^"]*"/,
    );
    assert.match(
      home.slice(alsoFeaturedIndex),
      /w-full items-center justify-between[\s\S]*sm:w-auto/,
    );
  });

  it("keeps header popovers opaque in every header state", () => {
    const header = source("src/components/Header.tsx");
    const bell = source("src/components/NotificationBell.tsx");
    const account = source("src/components/UserAvatarMenu.tsx");

    // The header no longer asks for translucent popovers; the components'
    // opaque defaults apply on every page.
    assert.doesNotMatch(header, /overlay=\{/);
    for (const text of [bell, account]) {
      assert.match(text, /overlay = false/);
      assert.match(text, /ring-1 ring-black\/5 bg-white/);
    }
    assert.match(header, /rounded-2xl bg-\[#F7F5F0\] text-neutral-900 shadow-2xl ring-1 ring-black\/5/);
    assert.match(header, /from-\[#F7F5F0\] via-\[#F7F5F0\]\/75/);
    assert.doesNotMatch(header, /fixed inset-0[^\n]*backdrop-blur/);
    assert.match(bell, /className="text-\[13px\] font-medium leading-tight"/);
    assert.doesNotMatch(bell, /border-amber-200|bg-amber-50\/80|text-amber-700/);
    assert.match(bell, /<span className="sr-only">Unread: <\/span>/);
  });

  it("turns the search box solid on focus and keeps its interaction contract", () => {
    const search = source("src/components/SearchBar.tsx");

    assert.match(search, /placeholder="Search pieces, shops, and more…"/);
    assert.match(search, /role="search"/);
    assert.match(search, /aria-label="Search Grainline"/);
    assert.match(search, /autoFocus = false,[\s\S]*tone = "solid",[\s\S]*autoFocus\?: boolean;[\s\S]*tone\?: SearchBarTone;/);
    assert.match(search, /export type SearchBarTone = "glass" \| "solid";/);
    assert.match(search, /autoFocus=\{autoFocus\}/);
    assert.match(search, /if \(autoFocus && value\.length === 0\) openDropdown\(\)/);
    assert.match(search, /section: "Recommended searches"/);
    assert.match(search, /role="combobox"/);
    assert.match(search, /role="listbox"/);
    assert.match(search, /min-h-\[46px\]/);
    // Pill box: frosted glass over the photo, white elsewhere, solid white
    // while focused. No "/" keyboard hint.
    assert.match(search, /rounded-full border transition-\[background-color,border-color,box-shadow,color\]/);
    assert.match(search, /focus-within:border-white focus-within:bg-white focus-within:text-neutral-900/);
    assert.match(search, /border-white\/35 bg-white\/15 text-\[#F5EFE6\] backdrop-blur-md/);
    assert.match(search, /border-\[#2C1F1A\]\/\[0\.18\] bg-white text-neutral-900/);
    assert.doesNotMatch(search, /<kbd/);
    // Suggestions panel is always solid white.
    assert.match(search, /rounded-2xl bg-white p-1\.5 text-neutral-900/);
    assert.doesNotMatch(search, /overlay/);
    assert.match(search, /w-full rounded-lg px-3 py-2 text-left/);
    assert.match(search, /type="submit"[\s\S]*min-w-11[\s\S]*<Search size=\{18\}/);
    assert.match(search, /aria-label="Clear search"[\s\S]*min-w-11/);
    assert.match(search, /group flex min-w-11[\s\S]*flex size-9 items-center justify-center rounded-full/);
    assert.doesNotMatch(search, /bg-neutral-900 text-white|rounded-full border-2/);
    assert.match(search, /maxLength=\{MAX_SEARCH_QUERY_LENGTH\}/);
    assert.match(search, /encodeURIComponent\(normalized\)/);
    assert.match(search, /ArrowDown/);
    assert.match(search, /ArrowUp/);
    assert.match(search, /Escape/);
  });

  it("keeps the suggestions panel steady while typing", () => {
    const search = source("src/components/SearchBar.tsx");

    // The first letter narrows the panel locally instead of closing it, and
    // the entrance stagger plays only when the panel opens.
    assert.doesNotMatch(search, /\} else \{\s*closeDropdown\(\);\s*\}\s*return;/);
    assert.match(search, /const SUGGESTION_STAGGER_MS = 520;/);
    assert.match(search, /className=\{staggerItems \? "search-option-in" : undefined\}/);
    assert.match(search, /const SUGGESTION_DEBOUNCE_MS = 150;/);
    assert.match(search, /\{ kind: "query", key: "query", section: "Search", label: query \}/);
    // Pieces and shops before categories.
    assert.ok(search.indexOf("...ITEM_SECTION_ORDER.flatMap") < search.indexOf("...categories.map"));
  });

  it("restores a semantic marketplace stat bar at an exact half overlap", () => {
    const home = source("src/app/page.tsx");
    const statsSurface = openingTagWith(home, "data-home-stats-surface");

    assert.match(home, /import \{ getCachedHomepageStats \} from "@\/lib\/homepageStats"/);
    assert.match(home, /getCachedHomepageStats\(\)/);
    assert.match(home, /data-home-stats/);
    assert.match(home, /data-home-stats-surface/);
    assert.match(home, /aria-label="Grainline marketplace statistics"/);
    assert.match(home, /className="relative z-30 h-0/);
    assert.match(home, /<dl[\s\S]{0,160}className="[^"]*-translate-y-1\/2/);
    assert.match(statsSurface, /bg-\[#F7F5F0\]\/46/);
    assert.match(statsSurface, /rounded-2xl/);
    assert.match(statsSurface, /backdrop-blur-xl/);
    assert.doesNotMatch(statsSurface, /bg-white\/95|backdrop-blur-sm/);
    assert.match(home, /<dt[^>]*>pieces listed<\/dt>/);
    assert.match(home, /<dt[^>]*>active makers<\/dt>/);
    assert.match(home, /<dt[^>]*>members<\/dt>/);
    assert.match(home, /<dt[^>]*>orders fulfilled<\/dt>/);
    assert.equal((home.match(/<dd\b/g) ?? []).length, 4);
    assert.doesNotMatch(home, /data-home-stats[\s\S]{0,500}-mt-\d/);
  });
});
