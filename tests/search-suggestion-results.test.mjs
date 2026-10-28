import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { normalizeSearchSuggestionQuery } = await import("../src/lib/searchSuggestionState.ts");
const { normalizeDisplayNameForLookup } = await import("../src/lib/sanitize.ts");
const {
  SEARCH_SUGGESTION_ITEM_LIMIT,
  buildSearchSuggestionItems,
  humanizeSearchTag,
  sellerNameSuggestionInputSupported,
} = await import("../src/lib/searchSuggestionResults.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

// The input from audit #1264: an emoji plus `&`, repeated.
const crashInput = "(🪵&)".repeat(16);

describe("search suggestion seller-name input bounds (#1264)", () => {
  it("reproduces the normalized query that the seller-name lookup rejects", () => {
    const q = normalizeSearchSuggestionQuery(crashInput);
    const normalized = normalizeDisplayNameForLookup(q);

    // `&` expands to `&amp;` and the cap counts code points, so the
    // normalized key fits 100 code points but not 100 UTF-16 units, which
    // is what sellerPublicNameSuggestions() measures.
    assert.equal(Array.from(normalized).length, 100);
    assert.ok(normalized.length > 100, `expected > 100 UTF-16 units, got ${normalized.length}`);
    assert.equal(sellerNameSuggestionInputSupported(q, normalized), false);
  });

  it("accepts ordinary queries, including short emoji ones", () => {
    for (const raw of ["walnut", "Oak & Iron", "🪵 boards", "(🪵&)".repeat(4)]) {
      const q = normalizeSearchSuggestionQuery(raw);
      assert.equal(sellerNameSuggestionInputSupported(q, normalizeDisplayNameForLookup(q)), true, raw);
    }
    assert.equal(sellerNameSuggestionInputSupported("", ""), false);
  });

  it("mirrors the bounds the seller-name lookup enforces", () => {
    const access = source("src/lib/sellerProfilePublicAccess.ts");
    const lookup = access.slice(access.indexOf("export async function sellerPublicNameSuggestions"));
    assert.match(lookup, /query\.length < 1\s*\|\| query\.length > 200\s*\|\| normalizedQuery\.length > 100/);
  });

  it("gates both suggestion routes' seller-name lookups on the supported range", () => {
    const globalSuggestions = source("src/app/api/search/suggestions/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");
    assert.match(
      globalSuggestions,
      /sellerNameSuggestionInputSupported\(q, normalizedDisplayNameQuery\)\s*\?\s*sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, true, 2\)\s*:\s*Promise\.resolve\(\[\]\)/,
    );
    assert.match(
      blogSuggestions,
      /sellerNameSuggestionInputSupported\(q, normalizedDisplayNameQuery\)\s*\?\s*sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, false, 3\)\s*:\s*Promise\.resolve\(\[\]\)/,
    );
  });
});

describe("typed header search suggestions (UI-19)", () => {
  it("links makers and tags to their pages and keeps titles without ids as searches", () => {
    const items = buildSearchSuggestionItems({
      listingTitles: [{ title: "Custom DJ Table with large base" }],
      tags: ["custom-dj-table", "dj-table"],
      makers: [{ id: "cmoxk16o4000004jp08936xtp", displayName: "Custom-DJ" }],
      fuzzyListingTitles: [],
    });

    assert.deepEqual(items, [
      {
        type: "search",
        label: "Custom DJ Table with large base",
        href: "/browse?q=Custom%20DJ%20Table%20with%20large%20base",
      },
      { type: "tag", label: "custom dj table", href: "/tag/custom-dj-table" },
      { type: "tag", label: "dj table", href: "/tag/dj-table" },
      { type: "maker", label: "Custom-DJ", href: "/seller/cmoxk16o4000004jp08936xtp--custom-dj" },
    ]);
  });

  it("links a listing title straight to the piece when its id is known", () => {
    const [item] = buildSearchSuggestionItems({
      listingTitles: [{ id: "cmlisting000000000000001", title: "Walnut Bowl" }],
      tags: [],
      makers: [],
      fuzzyListingTitles: [],
    });
    assert.deepEqual(item, {
      type: "listing",
      label: "Walnut Bowl",
      href: "/listing/cmlisting000000000000001--walnut-bowl",
    });
  });

  it("dedupes searches by label but keeps a maker and piece that share a name", () => {
    const items = buildSearchSuggestionItems({
      listingTitles: [{ title: "Walnut Works" }, { title: "walnut works " }],
      tags: [],
      makers: [{ id: "cmseller00000000000001", displayName: "Walnut Works" }],
      fuzzyListingTitles: [{ title: "WALNUT WORKS" }],
    });
    assert.deepEqual(items.map((item) => item.type), ["search", "maker"]);
  });

  it("caps the list at the item limit", () => {
    const items = buildSearchSuggestionItems({
      listingTitles: Array.from({ length: 6 }, (_, i) => ({ title: `Furniture piece ${i}` })),
      tags: ["furniture", "furniture-set"],
      makers: [{ id: "cmseller00000000000002", displayName: "Furniture Co" }],
      fuzzyListingTitles: [{ title: "Furnture bench" }],
    });
    assert.equal(items.length, SEARCH_SUGGESTION_ITEM_LIMIT);
    assert.ok(items.every((item) => ["listing", "search", "maker", "tag"].includes(item.type)));
  });

  it("humanizes hyphenated tags for display", () => {
    assert.equal(humanizeSearchTag("custom-dj-table"), "custom dj table");
    assert.equal(humanizeSearchTag("hand_carved"), "hand carved");
  });

  it("returns typed items alongside the backward-compatible flat list", () => {
    const route = source("src/app/api/search/suggestions/route.ts");
    assert.match(route, /suggestions: suggestions\.slice\(0, 8\),\s*items,\s*blogs,/);
    assert.match(route, /categories: matchingCategoryValues\.map/);
  });

  it("renders typed items in the dropdown instead of the flat list", () => {
    const searchBar = source("src/components/SearchBar.tsx");
    assert.match(searchBar, /data\.items\.filter\(isSuggestionItem\)/);
    assert.doesNotMatch(searchBar, /data\.suggestions/);
    assert.match(searchBar, /router\.push\(safeInternalPath\(option\.item\.href, browseSearchUrl\(option\.item\.label\)\)\)/);
    assert.match(searchBar, /section: "No matches"/);
    assert.match(searchBar, /if \(!res\.ok\) throw new Error/);
  });
});
