import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listingTags = readFileSync("src/lib/popularTags.ts", "utf8");
const blogTags = readFileSync("src/lib/popularBlogTags.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019060000_prepare_seller_profile_public_marketplace_counts/migration.sql",
  "utf8",
);

test("popular tag callers use bounded SellerProfile aggregate authorities", () => {
  assert.match(listingTags, /sellerPublicListingTags\(limit\)/u);
  assert.match(listingTags, /sellerPublicSellerTags\(sellerId, PUBLIC_SELLER_TOP_TAG_LIMIT\)/u);
  assert.doesNotMatch(listingTags, /prisma\.\$queryRaw|JOIN "SellerProfile"/u);

  assert.match(blogTags, /sellerPublicBlogTags\(limit\)/u);
  assert.doesNotMatch(blogTags, /prisma\.\$queryRaw|JOIN "SellerProfile"/u);
});

test("tag authorities preserve listing, blog, seller, and deterministic ordering scopes", () => {
  for (const signature of [
    "grainline_seller_public_listing_tags(integer)",
    "grainline_seller_public_seller_tags(text, integer)",
    "grainline_seller_public_blog_tags(integer)",
  ]) {
    assert.match(migration, new RegExp(signature.replace(/[()]/gu, "\\$&"), "u"));
  }
  assert.match(migration, /listing\.status::text = 'ACTIVE'[\s\S]*listing\."isPrivate" = false/u);
  assert.match(migration, /post\.status::text = 'PUBLISHED'[\s\S]*post\."publishedAt" <= pg_catalog\.now\(\)[\s\S]*post\."authorAccountActive" = true/u);
  assert.match(migration, /seller\."chargesEnabled" = true[\s\S]*seller\."stripeAccountSupported" = true[\s\S]*seller\."vacationMode" = false[\s\S]*seller\."ownerAccountActive" = true/u);
  assert.match(migration, /ORDER BY pg_catalog\.count\(\*\) DESC, tags\.tag ASC/gu);
});
