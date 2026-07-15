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
    const asset = statSync("public/hero-maple-cabinets.jpg");

    assert.ok(asset.size > 100_000, "hero asset should contain the full-resolution photograph");
    assert.ok(asset.size < 1_500_000, "hero asset should stay reasonably compressed before Next image optimization");
    assert.equal((home.match(/src="\/hero-maple-cabinets\.jpg"/g) ?? []).length, 1);
    assert.match(home, /import Image from "next\/image"/);
    assert.match(home, /src="\/hero-maple-cabinets\.jpg"[\s\S]*alt=""[\s\S]*aria-hidden="true"[\s\S]*fill[\s\S]*preload[\s\S]*sizes="100vw"/);
    assert.match(home, /object-\[18%_58%\][\s\S]*sm:object-\[26%_58%\][\s\S]*md:object-\[35%_58%\][\s\S]*lg:object-\[center_58%\]/);
    assert.match(home, /h-\[clamp\(570px,82svh,700px\)\]/);
    assert.match(home, /sm:h-\[clamp\(600px,78svh,760px\)\]/);
    assert.match(home, /text-\[clamp\(2\.125rem,10\.5vw,4rem\)\]/);
    assert.match(home, /sm:text-\[clamp\(3\.5rem,7vw,4\.75rem\)\]/);
    assert.match(home, /lg:text-\[clamp\(4rem,5vw,5\.25rem\)\]/);
    assert.doesNotMatch(home, /11\.5vw|5\.75rem/);
    assert.doesNotMatch(home, /HeroMosaic|mosaicListings|heroCollagePhotos/);
  });

  it("overlays the header only on the homepage and keeps other pages in normal cream flow", () => {
    const header = source("src/components/Header.tsx");
    const globals = source("src/app/globals.css");
    const headerSurface = openingTagWith(header, "data-home-header-surface");

    assert.match(header, /const isHome = pathname === "\/"/);
    assert.match(header, /isHome \? "absolute inset-x-0 top-0 bg-transparent" : "relative bg-\[#F7F5F0\]"/);
    assert.match(header, /data-home-overlay=\{isHome \? "true" : undefined\}/);
    assert.match(header, /data-home-logo-mark/);
    assert.equal((header.match(/src="\/logo-espresso\.svg"/g) ?? []).length, 2);
    assert.match(globals, /\.hero-logo-mark \{[\s\S]*background-color: #E5DFD2;[\s\S]*mask: url\("\/logo\.svg"\) center \/ contain no-repeat;/);
    assert.match(header, /aria-label="Grainline home"/);
    assert.match(header, /rounded-2xl border border-white\/25 bg-\[#F7F5F0\]\/38/);
    assert.match(header, /rounded-2xl border border-white\/20 bg-\[#F7F5F0\]\/32/);
    assert.match(header, /backdrop-blur-lg/);
    assert.match(header, /lg:gap-12/);
    assert.match(header, /xl:gap-16/);
    assert.match(header, /lg:pl-10/);
    assert.match(headerSurface, /relative isolate p-2/);
    assert.doesNotMatch(headerSurface, /pl-3/);
    assert.match(header, /data-header-search-slot className="flex min-w-\[220px\] flex-1"/);
    assert.match(header, /data-header-actions className="flex items-center gap-1 xl:gap-2"/);
    assert.doesNotMatch(header, /max-w-\[820px\]|data-header-actions className="ml-auto/);
    assert.match(header, /<SearchBar overlay=\{isHome\} \/>/);
    assert.equal((header.match(/<NotificationBell[^>]*overlay=\{isHome\}/g) ?? []).length, 2);
    assert.match(header, /<UserAvatarMenu[\s\S]*?overlay=\{isHome\}/);
    assert.match(header, /href="\/browse"[\s\S]*?rounded-full/);
    assert.match(header, /href="\/blog"[\s\S]*?rounded-full/);
    assert.match(header, /href="\/commission"[\s\S]*?rounded-full/);
    assert.match(header, /lg:hidden/);
    assert.match(header, /className="h-5 w-auto min-\[360px\]:h-6 sm:h-7 lg:hidden"/);
    assert.match(header, /min-h-\[44px\]/);
    assert.match(header, /min-w-\[44px\]/);
    assert.match(header, /const mobileSearchId = React\.useId\(\)/);
    assert.match(header, /aria-expanded=\{searchOpen\}/);
    assert.match(header, /aria-controls=\{mobileSearchId\}/);
    assert.match(header, /id=\{mobileSearchId\}/);
    assert.match(header, /data-mobile-search-popup/);
    assert.match(header, /left-3 right-3 top-\[calc\(100%\+0\.25rem\)\]/);
    assert.match(header, /bg-transparent p-0 shadow-none/);
    assert.match(header, /<SearchBar autoFocus overlay=\{isHome\} \/>/);
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
    assert.match(primary, /bg-\[#E5DFD2\]\/70/);
    assert.match(primary, /backdrop-blur-md/);
    assert.match(primary, /hover:bg-\[#E5DFD2\]\/85/);
    assert.doesNotMatch(primary, /w-full|hover:bg-white/);
    assert.match(secondary, /w-fit/);
    assert.match(secondary, /bg-\[#E5DFD2\]\/\[0\.08\]/);
    assert.match(secondary, /hover:bg-\[#E5DFD2\]\/15/);
    assert.match(secondary, /active:bg-\[#E5DFD2\]\/20/);
    assert.doesNotMatch(secondary, /w-full|hover:bg-\[#F7F5F0\]|hover:text-\[#2C1F1A\]/);
  });

  it("keeps homepage popovers translucent while retaining opaque defaults", () => {
    const header = source("src/components/Header.tsx");
    const bell = source("src/components/NotificationBell.tsx");
    const account = source("src/components/UserAvatarMenu.tsx");

    for (const text of [bell, account]) {
      assert.match(text, /overlay = false/);
      assert.match(text, /bg-\[#F7F5F0\]\/\[0\.78\]/);
      assert.match(text, /backdrop-blur-xl/);
      assert.match(text, /ring-1 ring-black\/5 bg-white/);
    }
    assert.match(bell, /data-home-notification-surface=\{overlay \? "true" : undefined\}/);
    assert.match(account, /data-home-account-surface=\{overlay \? "true" : undefined\}/);
    assert.match(header, /data-home-menu-surface=\{isHome \? "true" : undefined\}/);
    assert.match(header, /bg-\[#F7F5F0\]\/\[0\.78\][\s\S]*backdrop-blur-xl/);
    assert.match(header, /from-\[#F7F5F0\]\/90 via-\[#F7F5F0\]\/55/);
    assert.match(header, /bg-\[#F7F5F0\] ring-1 ring-black\/5/);
    assert.doesNotMatch(header, /fixed inset-0[^\n]*backdrop-blur/);
  });

  it("keeps site search visually quiet without weakening its interaction contract", () => {
    const search = source("src/components/SearchBar.tsx");

    assert.match(search, /placeholder="Search pieces, shops, and more…"/);
    assert.match(search, /role="search"/);
    assert.match(search, /aria-label="Search Grainline"/);
    assert.match(search, /autoFocus = false,[\s\S]*overlay = false,[\s\S]*autoFocus\?: boolean;[\s\S]*overlay\?: boolean;/);
    assert.match(search, /autoFocus=\{autoFocus\}/);
    assert.match(search, /role="combobox"/);
    assert.match(search, /role="listbox"/);
    assert.match(search, /min-h-\[46px\]/);
    assert.match(search, /rounded-2xl border shadow-sm/);
    assert.match(search, /border-white\/25 bg-\[#F7F5F0\]\/42 backdrop-blur-lg/);
    assert.match(search, /focus-within:bg-\[#F7F5F0\]\/60/);
    assert.match(search, /border-neutral-200 bg-white\/90/);
    assert.match(search, /rounded-xl border border-stone-200\/60 bg-white\/95/);
    assert.match(search, /type="submit"[\s\S]*min-w-11[\s\S]*<Search size=\{18\}/);
    assert.match(search, /aria-label="Clear search"[\s\S]*min-w-11/);
    assert.doesNotMatch(search, /variant === "glass"|bg-neutral-900 text-white|rounded-full border-2/);
    assert.match(search, /maxLength=\{MAX_SEARCH_QUERY_LENGTH\}/);
    assert.match(search, /encodeURIComponent\(normalized\)/);
    assert.match(search, /ArrowDown/);
    assert.match(search, /ArrowUp/);
    assert.match(search, /Escape/);
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
    assert.match(statsSurface, /bg-\[#F7F5F0\]\/58/);
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
