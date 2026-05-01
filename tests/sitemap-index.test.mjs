import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { SITEMAP_CHUNK_SIZE, sitemapChunkCount, sitemapIndexXml } = await import(
  "../src/lib/sitemapIndex.ts"
);

describe("sitemap chunk count", () => {
  it("returns 1 for empty catalog so the static chunk is still indexed", () => {
    assert.equal(sitemapChunkCount(0), 1);
  });

  it("adds one listing chunk per SITEMAP_CHUNK_SIZE listings", () => {
    assert.equal(sitemapChunkCount(1), 2);
    assert.equal(sitemapChunkCount(SITEMAP_CHUNK_SIZE), 2);
    assert.equal(sitemapChunkCount(SITEMAP_CHUNK_SIZE + 1), 3);
    assert.equal(sitemapChunkCount(SITEMAP_CHUNK_SIZE * 3), 4);
  });

  it("treats invalid counts as the empty catalog (1 static chunk)", () => {
    assert.equal(sitemapChunkCount(-5), 1);
    assert.equal(sitemapChunkCount(Number.NaN), 1);
    assert.equal(sitemapChunkCount(Number.POSITIVE_INFINITY), 1);
  });
});

describe("sitemap index xml", () => {
  it("emits one <sitemap> per chunk and includes lastmod", () => {
    const xml = sitemapIndexXml("https://example.com", 3, "2026-05-01T00:00:00.000Z");
    assert.match(xml, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<sitemapindex /);
    assert.match(xml, /<loc>https:\/\/example\.com\/sitemap\/0\.xml<\/loc>/);
    assert.match(xml, /<loc>https:\/\/example\.com\/sitemap\/1\.xml<\/loc>/);
    assert.match(xml, /<loc>https:\/\/example\.com\/sitemap\/2\.xml<\/loc>/);
    assert.equal((xml.match(/<sitemap>/g) ?? []).length, 3);
    assert.match(xml, /<lastmod>2026-05-01T00:00:00\.000Z<\/lastmod>/);
  });

  it("emits a valid empty index for a catalog with only the static chunk", () => {
    const xml = sitemapIndexXml("https://example.com", 1, "2026-05-01T00:00:00.000Z");
    assert.match(xml, /<sitemapindex /);
    assert.equal((xml.match(/<sitemap>/g) ?? []).length, 1);
    assert.match(xml, /<loc>https:\/\/example\.com\/sitemap\/0\.xml<\/loc>/);
  });
});
