import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
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
    assert.match(home, /object-\[18%_center\][\s\S]*sm:object-\[26%_center\][\s\S]*lg:object-center/);
    assert.match(home, /h-\[clamp\(570px,82svh,700px\)\]/);
    assert.match(home, /sm:h-\[clamp\(600px,78svh,760px\)\]/);
    assert.match(home, /text-\[clamp\(2\.25rem,11\.5vw,4\.5rem\)\]/);
    assert.doesNotMatch(home, /HeroMosaic|mosaicListings|heroCollagePhotos/);
  });

  it("overlays the header only on the homepage and keeps other pages in normal cream flow", () => {
    const header = source("src/components/Header.tsx");

    assert.match(header, /const isHome = pathname === "\/"/);
    assert.match(header, /isHome \? "absolute inset-x-0 top-0 bg-transparent" : "relative bg-\[#F7F5F0\]"/);
    assert.match(header, /data-home-overlay=\{isHome \? "true" : undefined\}/);
    assert.match(header, /src=\{isHome \? "\/logo\.svg" : "\/logo-espresso\.svg"\}/);
    assert.match(header, /aria-label="Grainline home"/);
    assert.match(header, /rounded-2xl border border-white\/25 bg-\[#F7F5F0\]\/38/);
    assert.match(header, /rounded-2xl border border-white\/20 bg-\[#F7F5F0\]\/32/);
    assert.match(header, /backdrop-blur-lg/);
    assert.match(header, /lg:gap-8/);
    assert.match(header, /xl:gap-10/);
    assert.match(header, /lg:pl-10/);
    assert.match(header, /<SearchBar overlay=\{isHome\} \/>/);
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

    assert.match(home, /import \{ getCachedHomepageStats \} from "@\/lib\/homepageStats"/);
    assert.match(home, /getCachedHomepageStats\(\)/);
    assert.match(home, /data-home-stats/);
    assert.match(home, /aria-label="Grainline marketplace statistics"/);
    assert.match(home, /className="relative z-30 h-0/);
    assert.match(home, /<dl className="[^"]*-translate-y-1\/2/);
    assert.match(home, /<dt[^>]*>pieces listed<\/dt>/);
    assert.match(home, /<dt[^>]*>active makers<\/dt>/);
    assert.match(home, /<dt[^>]*>members<\/dt>/);
    assert.match(home, /<dt[^>]*>orders fulfilled<\/dt>/);
    assert.equal((home.match(/<dd\b/g) ?? []).length, 4);
    assert.doesNotMatch(home, /data-home-stats[\s\S]{0,500}-mt-\d/);
  });
});
