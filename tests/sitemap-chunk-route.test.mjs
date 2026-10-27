import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";

import * as publicPaths from "../src/lib/publicPaths.ts";
import * as sitemapIndex from "../src/lib/sitemapIndex.ts";

const sitemapPath = "src/app/sitemap.ts";
const BASE_URL = "https://thegrainline.com";

const COUNTS = {
  listingCount: 1,
  sellerCount: 1,
  customerPhotoSellerCount: 1,
  blogPostCount: 1,
  commissionCount: 1,
};

function fixture(counts = COUNTS) {
  const state = { sellerPageCalls: [], listingReads: [] };
  const updatedAt = new Date("2026-10-01T00:00:00.000Z");
  const prisma = {
    listing: {
      findMany: async (args) => {
        state.listingReads.push({ skip: args.skip, take: args.take });
        return [{ id: "listing-walnut-table", title: "Walnut table", updatedAt }];
      },
      groupBy: async () => [],
    },
    blogPost: {
      findMany: async () => [{ slug: "how-we-finish-walnut", updatedAt }],
      findFirst: async () => null,
    },
    commissionRequest: {
      findMany: async () => [{ id: "commission-dining-set", updatedAt }],
    },
    metro: {
      findMany: async () => [],
    },
  };
  const dependencies = {
    "@/lib/db": { prisma },
    "@sentry/nextjs": { captureMessage: () => {} },
    "@prisma/client": {
      BlogPostType: {
        GIFT_GUIDE: "GIFT_GUIDE",
        MAKER_SPOTLIGHT: "MAKER_SPOTLIGHT",
        BEHIND_THE_BUILD: "BEHIND_THE_BUILD",
        WOOD_EDUCATION: "WOOD_EDUCATION",
      },
    },
    "@/lib/categories": { CATEGORY_VALUES: ["FURNITURE"] },
    "@/lib/blogVisibility": { publicBlogPostWhere: (where = {}) => where },
    "@/lib/listingVisibility": { publicListingWhere: (where = {}) => where },
    "@/lib/publicPaths": publicPaths,
    "@/lib/popularTags": { getPopularListingTags: async () => [] },
    "@/lib/commissionExpiry": { openCommissionWhere: () => ({}) },
    "@/lib/sitemapIndex": sitemapIndex,
    "@/lib/sitemapSourceCounts": { sitemapSourceCounts: async () => counts },
    "@/lib/sellerProfilePublicAccess": {
      sellerPublicBlogAuthorSitemap: async () => [],
      sellerPublicMetroStaticSlugs: async () => [],
      sellerPublicSitemapPage: async (kind, skip, take) => {
        state.sellerPageCalls.push({ kind, skip, take });
        return [{ id: "seller-oak-grain", displayName: "Oak & Grain", updatedAt }];
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(sitemapPath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: sitemapPath });
  return {
    state,
    generateSitemaps: exports.generateSitemaps,
    // Next 16 passes the generateSitemaps id to the handler as a Promise<string>.
    chunkUrls: async (id) => {
      const entries = await exports.default({ id: Promise.resolve(String(id)) });
      return Array.from(entries, (entry) => entry.url);
    },
  };
}

describe("sitemap chunk route", () => {
  it("serves the static base routes on chunk 0", async () => {
    const urls = await fixture().chunkUrls(0);
    assert.ok(urls.includes(`${BASE_URL}/`));
    assert.ok(urls.includes(`${BASE_URL}/browse`));
    assert.ok(!urls.some((url) => url.includes("/listing/") || url.includes("/seller/")));
  });

  it("serves each generated chunk's own dynamic URLs instead of the base chunk", async () => {
    const subject = fixture();
    const generated = Array.from(await subject.generateSitemaps(), (item) => item.id);
    assert.equal(JSON.stringify(generated), JSON.stringify([0, 1, 2, 3, 4, 5]));
    assert.equal(generated.length, sitemapIndex.sitemapChunkCount(COUNTS));

    const sellerPath = publicPaths.publicSellerPath("seller-oak-grain", "Oak & Grain");
    const expectedByChunk = [
      [`${BASE_URL}${sellerPath}`, `${BASE_URL}${publicPaths.publicSellerShopPath("seller-oak-grain", "Oak & Grain")}`],
      [`${BASE_URL}${sellerPath}/customer-photos`],
      [`${BASE_URL}/blog/how-we-finish-walnut`],
      [`${BASE_URL}/commission/commission-dining-set`],
      [`${BASE_URL}${publicPaths.publicListingPath("listing-walnut-table", "Walnut table")}`],
    ];

    for (const [offset, expected] of expectedByChunk.entries()) {
      const urls = await subject.chunkUrls(generated[offset + 1]);
      assert.equal(JSON.stringify(urls), JSON.stringify(expected), `chunk ${offset + 1}`);
    }
    assert.equal(
      JSON.stringify(subject.state.sellerPageCalls),
      JSON.stringify([
        { kind: "SELLERS", skip: 0, take: sitemapIndex.SITEMAP_SELLER_ROWS_PER_CHUNK },
        { kind: "CUSTOMER_PHOTOS", skip: 0, take: sitemapIndex.SITEMAP_ENTRY_LIMIT },
      ]),
    );
  });

  it("pages later listing chunks by their own offset", async () => {
    const subject = fixture({
      ...COUNTS,
      listingCount: sitemapIndex.SITEMAP_CHUNK_SIZE + 1,
    });
    const urls = await subject.chunkUrls(6);
    assert.ok(urls.every((url) => url.includes("/listing/")));
    assert.equal(
      JSON.stringify(subject.state.listingReads),
      JSON.stringify([{ skip: sitemapIndex.SITEMAP_CHUNK_SIZE, take: sitemapIndex.SITEMAP_CHUNK_SIZE }]),
    );
  });
});
