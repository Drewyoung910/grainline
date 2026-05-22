import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/app/sitemap.ts", "utf8");

describe("sitemap entry limit guardrails", () => {
  it("caps the non-listing sitemap chunk at the XML entry limit", () => {
    assert.match(source, /const SITEMAP_ENTRY_LIMIT = 50_000/);
    assert.match(source, /function limitSitemapEntries\(entries: MetadataRoute\.Sitemap\): MetadataRoute\.Sitemap \{/);
    assert.match(source, /return entries\.slice\(0, SITEMAP_ENTRY_LIMIT\)/);
    assert.match(source, /return limitSitemapEntries\(\[/);
  });

  it("keeps listing chunks separate from the capped metadata chunk", () => {
    assert.match(source, /if \(id > 0\) \{/);
    assert.match(source, /take: SITEMAP_CHUNK_SIZE/);
    assert.match(source, /skip: \(id - 1\) \* SITEMAP_CHUNK_SIZE/);
  });
});
