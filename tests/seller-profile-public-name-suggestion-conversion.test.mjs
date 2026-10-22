import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalSuggestions = readFileSync(
  "src/app/api/search/suggestions/route.ts",
  "utf8",
);
const blogSuggestions = readFileSync(
  "src/app/api/blog/search/suggestions/route.ts",
  "utf8",
);
const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
const sitemapCounts = readFileSync("src/lib/sitemapSourceCounts.ts", "utf8");

test("public seller-name suggestion callers use the bounded authority", () => {
  assert.match(
    globalSuggestions,
    /sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, true, 2\)/u,
  );
  assert.match(
    blogSuggestions,
    /sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, false, 3\)/u,
  );
  assert.doesNotMatch(globalSuggestions, /sellerProfile\.findMany/u);
  assert.doesNotMatch(blogSuggestions, /sellerProfile\.findMany/u);
});

test("public seller sitemap callers use the bounded authorities", () => {
  assert.match(sitemap, /sellerPublicSitemapPage\(\s*"SELLERS"/su);
  assert.match(sitemap, /sellerPublicSitemapPage\(\s*"CUSTOMER_PHOTOS"/su);
  assert.doesNotMatch(sitemap, /sellerProfile\.findMany/u);
  assert.match(sitemapCounts, /sellerPublicSitemapCounts\(\)/u);
  assert.doesNotMatch(sitemapCounts, /sellerProfile\.count/u);
});
