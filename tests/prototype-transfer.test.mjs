import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { parseSmartSearch, highlightParts, isSearchShortcut } = await import("../src/lib/smartSearch.ts");
const { loadRecentSearches, rememberRecentSearch, clearRecentSearches, MAX_RECENT_SEARCHES } = await import(
  "../src/lib/recentSearches.ts"
);
const { clearSignedOutLocalAccountState } = await import("../src/lib/localAccountState.ts");
const { parseSearchSuggestionDetail, buildSearchSuggestionItems } = await import(
  "../src/lib/searchSuggestionResults.ts"
);

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

function params(href) {
  const url = new URL(href, "https://example.test");
  assert.equal(url.pathname, "/browse");
  return Object.fromEntries(url.searchParams.entries());
}

describe("smart search", () => {
  it("turns words into the real Browse parameters", () => {
    const smart = parseSmartSearch("walnut desk under 900");
    assert.deepEqual([...smart.chips], ["Walnut", "Furniture", "Under $900"]);
    assert.deepEqual(params(smart.href), { category: "FURNITURE", max: "900", q: "walnut desk" });
    assert.equal(smart.explicitFilter, true);
  });

  it("handles availability and comma prices", () => {
    const smart = parseSmartSearch("cutting board ready to ship under $1,200");
    assert.deepEqual(params(smart.href), { category: "KITCHEN", max: "1200", type: "IN_STOCK", q: "cutting board" });
    assert.equal(smart.explicitFilter, true);
  });

  it("keeps a wood and a piece as an offer, not an automatic filter", () => {
    const smart = parseSmartSearch("walnut desk");
    assert.equal(smart.explicitFilter, false);
    assert.deepEqual(params(smart.href), { category: "FURNITURE", q: "walnut desk" });
  });

  it("stays out of the way for ordinary searches", () => {
    for (const term of ["", "walnut", "live edge", "Litter Shack", "dj table", "under 900"]) {
      assert.equal(parseSmartSearch(term), null, term);
    }
  });

  it("does not match inside other words", () => {
    assert.equal(parseSmartSearch("ashley table"), null);
    assert.equal(parseSmartSearch("tablet pinewood"), null);
  });

  it("ignores prices it cannot honor", () => {
    const smart = parseSmartSearch("walnut table under 99999999");
    assert.equal(new URL(smart.href, "https://example.test").searchParams.has("max"), false);
    assert.equal(smart.explicitFilter, false);
    assert.equal(parseSmartSearch("oak under 0"), null);
  });

  it("encodes every value into the URL safely", () => {
    const smart = parseSmartSearch(`walnut desk "><script> under 900`);
    assert.equal(params(smart.href).q, `walnut desk "><script>`);
    assert.doesNotMatch(smart.href, /<script>/);
  });
});

describe("match highlighting", () => {
  it("marks each typed word case-insensitively", () => {
    assert.deepEqual(highlightParts("Walnut Dining Table", "table walnut"), [
      { text: "Walnut", match: true },
      { text: " Dining ", match: false },
      { text: "Table", match: true },
    ]);
  });

  it("treats typed punctuation as plain text", () => {
    assert.deepEqual(highlightParts("Bowl (large)", "(large)"), [
      { text: "Bowl ", match: false },
      { text: "(large)", match: true },
    ]);
    assert.deepEqual(highlightParts("A.B", ".*"), [{ text: "A.B", match: false }]);
  });

  it("returns the text unchanged without a usable query", () => {
    assert.deepEqual(highlightParts("Walnut", ""), [{ text: "Walnut", match: false }]);
    assert.deepEqual(highlightParts("Walnut", "w"), [{ text: "Walnut", match: false }]);
  });

  it("preserves every character of the label", () => {
    for (const label of ["🪵 Walnut bowl 🪵", "Ünïcode wälnut", "walnut walnut"]) {
      assert.equal(highlightParts(label, "walnut").map((part) => part.text).join(""), label);
    }
  });
});

describe("search shortcut", () => {
  const press = (over = {}) => ({
    key: "/",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: { tagName: "BODY", isContentEditable: false },
    ...over,
  });

  it("fires from the page", () => {
    assert.equal(isSearchShortcut(press()), true);
    assert.equal(isSearchShortcut(press({ target: null })), true);
  });

  it("leaves typing and browser shortcuts alone", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      assert.equal(isSearchShortcut(press({ target: { tagName } })), false, tagName);
    }
    assert.equal(isSearchShortcut(press({ target: { tagName: "DIV", isContentEditable: true } })), false);
    assert.equal(isSearchShortcut(press({ metaKey: true })), false);
    assert.equal(isSearchShortcut(press({ ctrlKey: true })), false);
    assert.equal(isSearchShortcut(press({ altKey: true })), false);
    assert.equal(isSearchShortcut(press({ defaultPrevented: true })), false);
    assert.equal(isSearchShortcut(press({ key: "?" })), false);
  });
});

describe("recent searches", () => {
  it("keeps the newest five, without duplicates", () => {
    const storage = memoryStorage();
    for (const term of ["oak", "maple", "OAK", "ash", "pine", "teak", "elm"]) {
      rememberRecentSearch(term, storage);
    }
    const list = loadRecentSearches(storage);
    assert.equal(list.length, MAX_RECENT_SEARCHES);
    assert.deepEqual(list, ["elm", "teak", "pine", "ash", "OAK"]);
  });

  it("survives corrupt or hostile stored data", () => {
    const key = "grainline:recent-searches";
    assert.deepEqual(loadRecentSearches(memoryStorage({ [key]: "{not json" })), []);
    assert.deepEqual(loadRecentSearches(memoryStorage({ [key]: '{"a":1}' })), []);
    assert.deepEqual(loadRecentSearches(memoryStorage({ [key]: '[1,null,"  ok  ",{"x":1}]' })), ["ok"]);
    assert.equal(loadRecentSearches(memoryStorage({ [key]: JSON.stringify(["x".repeat(500)]) }))[0].length, 80);
  });

  it("works when storage throws", () => {
    const broken = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    };
    assert.deepEqual(loadRecentSearches(broken), []);
    assert.deepEqual(rememberRecentSearch("oak", broken), ["oak"]);
    clearRecentSearches(broken);
    assert.deepEqual(loadRecentSearches(null), []);
  });

  it("is cleared with the rest of this person's local state on sign-out", () => {
    const storage = memoryStorage();
    rememberRecentSearch("private search", storage);
    clearSignedOutLocalAccountState({
      anonymousCartStorage: null,
      cartSessionStorage: null,
      recentSearchStorage: storage,
    });
    assert.deepEqual(loadRecentSearches(storage), []);
  });
});

describe("piece row facts", () => {
  const good = { priceCents: 75000, currency: "usd", photoUrl: "https://cdn.example/a.jpg", makerName: "Shop", location: "Austin, TX" };

  it("accepts well-formed facts", () => {
    assert.deepEqual(parseSearchSuggestionDetail(good), good);
  });

  it("drops malformed facts instead of rendering them", () => {
    for (const bad of [null, 1, {}, { ...good, priceCents: -1 }, { ...good, priceCents: 1.5 }, { ...good, priceCents: "9" }, { ...good, currency: "" }]) {
      assert.equal(parseSearchSuggestionDetail(bad), undefined);
    }
  });

  it("refuses non-https photo addresses", () => {
    for (const photoUrl of ["javascript:alert(1)", "http://x/a.jpg", "//x/a.jpg", "", 7]) {
      assert.equal(parseSearchSuggestionDetail({ ...good, photoUrl }).photoUrl, null);
    }
  });

  it("carries facts through to listing rows only when present", () => {
    const items = buildSearchSuggestionItems({
      listingTitles: [{ id: "a", title: "Walnut Bowl", detail: good }, { id: "b", title: "Oak Bowl" }],
      tags: [],
      makers: [],
      fuzzyListingTitles: [],
    });
    assert.deepEqual(items[0].detail, good);
    assert.equal("detail" in items[1], false);
  });
});

describe("homepage category counts", async () => {
  const { categoryCountLabel } = await import("../src/lib/categoryCountLabel.ts");
  it("reads naturally at every size", () => {
    assert.equal(categoryCountLabel(0), "Coming soon");
    assert.equal(categoryCountLabel(-1), "Coming soon");
    assert.equal(categoryCountLabel(1), "1 piece");
    assert.equal(categoryCountLabel(2), "2 pieces");
    assert.equal(categoryCountLabel(1204), "1,204 pieces");
  });
});
