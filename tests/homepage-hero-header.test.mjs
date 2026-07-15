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
    assert.match(home, /min-h-\[clamp\(500px,100svh,680px\)\]/);
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
    assert.match(header, /bg-\[#F7F5F0\]\/88/);
    assert.match(header, /backdrop-blur-xl/);
    assert.match(header, /lg:hidden/);
    assert.match(header, /className="h-5 w-auto min-\[360px\]:h-6 sm:h-7 lg:hidden"/);
    assert.match(header, /min-h-\[44px\]/);
    assert.match(header, /min-w-\[44px\]/);
    assert.match(header, /const mobileSearchId = React\.useId\(\)/);
    assert.match(header, /aria-expanded=\{searchOpen\}/);
    assert.match(header, /aria-controls=\{mobileSearchId\}/);
    assert.match(header, /id=\{mobileSearchId\}/);
    assert.match(header, /<SearchBar autoFocus \/>/);
  });

  it("keeps site search visually quiet without weakening its interaction contract", () => {
    const search = source("src/components/SearchBar.tsx");

    assert.match(search, /placeholder="Search pieces, shops, and more…"/);
    assert.match(search, /role="search"/);
    assert.match(search, /aria-label="Search Grainline"/);
    assert.match(search, /\{ autoFocus = false \}: \{ autoFocus\?: boolean \}/);
    assert.match(search, /autoFocus=\{autoFocus\}/);
    assert.match(search, /role="combobox"/);
    assert.match(search, /role="listbox"/);
    assert.match(search, /min-h-\[46px\]/);
    assert.match(search, /rounded-md border border-neutral-200 bg-white\/90/);
    assert.match(search, /type="submit"[\s\S]*min-w-11[\s\S]*<Search size=\{18\}/);
    assert.match(search, /aria-label="Clear search"[\s\S]*min-w-11/);
    assert.doesNotMatch(search, /variant === "glass"|bg-neutral-900 text-white|rounded-full border-2/);
    assert.match(search, /maxLength=\{MAX_SEARCH_QUERY_LENGTH\}/);
    assert.match(search, /encodeURIComponent\(normalized\)/);
    assert.match(search, /ArrowDown/);
    assert.match(search, /ArrowUp/);
    assert.match(search, /Escape/);
  });
});
