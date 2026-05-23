import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/app/sitemap.ts", "utf8");

describe("sitemap entry limit guardrails", () => {
  it("keeps the static base chunk bounded without packing dynamic row sources into it", () => {
    assert.match(source, /SITEMAP_ENTRY_LIMIT/);
    assert.match(source, /function assertSitemapEntryLimit/);
    assert.match(source, /Sitemap entry limit exceeded/);
    assert.match(source, /assertSitemapEntryLimit\(\[/);
    assert.doesNotMatch(source, /\]\.slice\(0, SITEMAP_ENTRY_LIMIT\)/);
    assert.doesNotMatch(source, /function limitSitemapEntries/);
    assert.doesNotMatch(source, /\.\.\.sellerRoutes/);
    assert.doesNotMatch(source, /\.\.\.customerPhotoRoutes/);
    assert.doesNotMatch(source, /\.\.\.blogRoutes/);
    assert.doesNotMatch(source, /\.\.\.commissionRoutes/);
  });

  it("keeps every large dynamic source on first-class sitemap chunks", () => {
    assert.match(source, /sitemapChunkCount\(await sitemapSourceCounts\(\)\)/);
    assert.match(source, /sitemapChunkForId\(id, await sitemapSourceCounts\(\)\)/);
    assert.match(source, /chunk\.kind === "sellers"/);
    assert.match(source, /chunk\.kind === "customerPhotos"/);
    assert.match(source, /chunk\.kind === "blogPosts"/);
    assert.match(source, /chunk\.kind === "commissions"/);
    assert.match(source, /if \(id > 0\) \{/);
    assert.match(source, /skip: chunk\.rowSkip/);
    assert.match(source, /take: chunk\.rowTake/);
  });
});
