import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY,
  LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY,
  SEARCH_SUGGESTION_QUERY_MAX_CHARS,
  normalizeSearchSuggestionQuery,
} = await import("../src/lib/searchSuggestionState.ts");

describe("search suggestion state", () => {
  it("normalizes whitespace and compatibility characters before querying", () => {
    assert.equal(normalizeSearchSuggestionQuery("  walnut\u3000table  "), "walnut table");
  });

  it("caps query length before raw SQL similarity comparisons", () => {
    assert.equal(
      normalizeSearchSuggestionQuery("x".repeat(SEARCH_SUGGESTION_QUERY_MAX_CHARS + 20)).length,
      SEARCH_SUGGESTION_QUERY_MAX_CHARS,
    );
  });

  it("keeps fuzzy thresholds conservative enough to avoid very weak matches", () => {
    assert.equal(LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY >= 0.35, true);
    assert.equal(BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY >= 0.25, true);
  });
});
