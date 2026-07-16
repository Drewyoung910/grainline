import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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

  it("uses discoverable, accessible search and clear controls in the inbox", () => {
    const inbox = source("src/app/messages/page.tsx");

    assert.match(inbox, /type="submit"[\s\S]*?aria-label="Search messages"[\s\S]*?<Search size=\{17\} \/>/);
    assert.match(inbox, /aria-label="Clear message search"[\s\S]*?<X size=\{15\} \/>/);
    assert.doesNotMatch(inbox, />\s*Clear\s*</);
  });

  it("keeps the blog input artifact-free and animates both dropdown directions", () => {
    const blogSearch = source("src/components/BlogSearchBar.tsx");

    assert.match(blogSearch, /focus-visible:outline-none focus-visible:shadow-none/);
    assert.match(blogSearch, /const \[closing, setClosing\] = React\.useState\(false\)/);
    assert.match(blogSearch, /closing \? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"/);
    assert.match(blogSearch, /aria-expanded=\{open && !closing && options\.length > 0\}/);
  });
});
