import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { popularSearchPresentation, searchSuggestionPhase } = await import("../src/lib/searchSuggestionPresentation.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("search UI regression guardrails", () => {
  it("keeps route-local message queries out of the global marketplace search", () => {
    const searchBar = source("src/components/SearchBar.tsx");

    assert.match(
      searchBar,
      /pathname === "\/browse" \? \(searchParams\.get\("q"\) \?\? ""\) : ""/,
    );
    assert.match(searchBar, /\[pathname, searchParams\]/);
  });

  it("keeps the site header in the first HTML flush", () => {
    const header = source("src/components/Header.tsx");
    const searchBar = source("src/components/SearchBar.tsx");
    const layout = source("src/app/layout.tsx");
    const listener = source("src/components/SearchParamsListener.tsx");

    // useSearchParams suspends during prerender, which would hide the header
    // until after paint and shift the page. Only the null-rendering listener
    // may call it, inside its own boundary.
    assert.doesNotMatch(header, /useSearchParams/);
    assert.doesNotMatch(searchBar, /useSearchParams/);
    assert.match(header, /<SearchParamsListener onChange=\{setSearchQuery\} \/>/);
    assert.match(searchBar, /<SearchParamsListener onChange=\{setSearchQuery\} \/>/);
    assert.match(listener, /<React\.Suspense fallback=\{null\}>\s*<SearchParamsReporter/);
    assert.doesNotMatch(layout, /<Suspense[^>]*>\s*<Header \/>/);
  });

  it("uses discoverable, accessible search and clear controls in the inbox", () => {
    const inbox = source("src/app/messages/page.tsx");
    const inboxControls = source("src/components/MessageInboxControls.tsx");

    assert.match(inbox, /import MessageInboxControls/);
    assert.match(inbox, /<MessageInboxControls/);
    assert.match(inboxControls, /type="submit"[\s\S]*?aria-label="Search messages"[\s\S]*?<Search size=\{17\} \/>/);
    assert.match(inboxControls, /aria-label="Clear message search"[\s\S]*?<X size=\{15\} \/>/);
    assert.doesNotMatch(inboxControls, />\s*Clear\s*</);
  });

  it("keeps the blog input artifact-free and animates both dropdown directions", () => {
    const blogSearch = source("src/components/BlogSearchBar.tsx");

    assert.match(blogSearch, /focus-visible:outline-none focus-visible:shadow-none/);
    assert.match(blogSearch, /const \[closing, setClosing\] = React\.useState\(false\)/);
    assert.match(blogSearch, /closing \? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"/);
    assert.match(blogSearch, /aria-expanded=\{open && !closing && options\.length > 0\}/);
  });

  it("never presents stale suggestion results for a newer visible query", () => {
    assert.equal(searchSuggestionPhase({ query: "ch", resolvedQuery: null, hasItems: true, noMatches: false }), "waiting");
    assert.equal(searchSuggestionPhase({ query: "chair", resolvedQuery: "ch", hasItems: true, noMatches: false }), "waiting");
    assert.equal(searchSuggestionPhase({ query: "chair", resolvedQuery: "chair", hasItems: true, noMatches: false }), "results");
    assert.equal(searchSuggestionPhase({ query: "chair", resolvedQuery: "chair", hasItems: false, noMatches: true }), "empty");
    assert.equal(searchSuggestionPhase({ query: "c", resolvedQuery: null, hasItems: false, noMatches: false }), "fallback");
  });

  it("never flashes fallback recommendations ahead of the first live response", () => {
    const fallback = ["furniture", "decor"];

    assert.deepEqual(popularSearchPresentation({ loaded: false, tags: [], fallback }), []);
    assert.deepEqual(popularSearchPresentation({ loaded: true, tags: ["chairs"], fallback }), ["chairs"]);
    assert.deepEqual(popularSearchPresentation({ loaded: true, tags: [], fallback }), fallback);
  });
});
