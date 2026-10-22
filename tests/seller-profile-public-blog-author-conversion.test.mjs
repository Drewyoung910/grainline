import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/blog/author/[slug]/page.tsx", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261020020000_prepare_seller_profile_public_blog_author/migration.sql",
  "utf8",
);

test("blog-author landing page uses the bounded public projection", () => {
  assert.match(page, /const getPublicBlogAuthor = cache\(sellerPublicBlogAuthor\)/u);
  assert.doesNotMatch(page, /prisma\.sellerProfile|activeSellerProfileWhere/u);
  assert.match(page, /getBlockedUserIdsFor\(meDbId\)/u);
  assert.ok(
    page.indexOf("getBlockedUserIdsFor(meDbId)") < page.indexOf("permanentRedirect("),
    "blocked author viewers should still 404 before canonical redirects",
  );
});

test("blog-author projection preserves exact public-post eligibility and grants", () => {
  for (const predicate of [
    /seller\."ownerAccountActive" = true/u,
    /seller\."chargesEnabled" = true/u,
    /seller\."stripeAccountSupported" = true/u,
    /seller\."vacationMode" = false/u,
    /post\.status::text = 'PUBLISHED'/u,
    /post\."publishedAt" IS NOT NULL/u,
    /post\."authorAccountActive" = true/u,
  ]) {
    assert.match(migration, predicate);
  }
  assert.match(
    migration,
    /post\."publishedAt"\s+<= \(pg_catalog\.statement_timestamp\(\) AT TIME ZONE 'UTC'\)/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_public_blog_author\(text\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_blog_author\(text\)\s+TO grainline_app_runtime/u,
  );
});
