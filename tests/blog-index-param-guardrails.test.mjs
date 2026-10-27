import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("blog index query guardrails", () => {
  it("bounds public blog index search and pagination params before querying", () => {
    const page = source("src/app/blog/page.tsx");

    assert.match(page, /import \{ normalizeSearchQueryParameter \} from "@\/lib\/searchQueryState"/);
    assert.match(page, /import \{ parseBoundedPositiveIntParam \} from "@\/lib\/queryParams"/);
    assert.match(page, /const q = normalizeSearchQueryParameter\(sp\.bq, BLOG_SEARCH_QUERY_MAX_CHARS\)/);
    assert.match(page, /\.map\(\(tag\) => normalizeSearchQueryParameter\(tag, BLOG_TAG_MAX_CHARS\)\)/);
    assert.match(page, /\.slice\(0, BLOG_TAG_FILTER_MAX_COUNT\)/);
    assert.match(page, /const authorFilter = normalizeSearchQueryParameter\(sp\.author, BLOG_AUTHOR_FILTER_MAX_CHARS\)/);
    assert.match(page, /const page = parseBoundedPositiveIntParam\(sp\.page, 1, 1000\)/);
    assert.doesNotMatch(page, /Math\.max\(1,\s*parseInt\(/);
  });
});
