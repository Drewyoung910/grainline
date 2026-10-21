import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicBlogAuthorPresentation } from "../src/lib/blogVisibility.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("public blog author presentation prefers the maintained seller mirrors", () => {
  assert.deepEqual(
    publicBlogAuthorPresentation({
      authorName: "Private account name",
      authorImageUrl: "https://example.test/account.jpg",
      authorSellerName: "Public shop name",
      authorSellerAvatarUrl: "https://example.test/shop.jpg",
    }, "Former author"),
    {
      name: "Public shop name",
      imageUrl: "https://example.test/shop.jpg",
    },
  );

  assert.deepEqual(
    publicBlogAuthorPresentation({
      authorName: "Staff writer",
      authorImageUrl: null,
      authorSellerName: null,
      authorSellerAvatarUrl: null,
    }, "Former author"),
    {
      name: "Staff writer",
      imageUrl: null,
    },
  );

  assert.deepEqual(
    publicBlogAuthorPresentation({
      authorName: null,
      authorImageUrl: null,
      authorSellerName: null,
      authorSellerAvatarUrl: null,
    }, "Former author"),
    {
      name: "Former author",
      imageUrl: null,
    },
  );
});

test("public blog list surfaces do not project SellerProfile presentation fields", () => {
  for (const path of [
    "src/app/api/blog/route.ts",
    "src/app/api/blog/search/route.ts",
    "src/app/blog/page.tsx",
  ]) {
    const text = source(path);
    assert.doesNotMatch(
      text,
      /sellerProfile:\s*\{\s*select:\s*\{[^}]*displayName/u,
      `${path} must use the maintained BlogPost seller mirrors`,
    );
  }

  const homepage = source("src/app/page.tsx");
  const blogQuery = homepage.slice(
    homepage.indexOf("prisma.blogPost.findMany({"),
    homepage.indexOf("getFeaturedMakerBlock", homepage.indexOf("prisma.blogPost.findMany({")),
  );
  assert.doesNotMatch(blogQuery, /sellerProfile:\s*\{\s*select:/u);
  assert.match(blogQuery, /authorSellerName:\s*true/u);
  assert.match(blogQuery, /authorSellerAvatarUrl:\s*true/u);

  const detailPage = source("src/app/blog/[slug]/page.tsx");
  assert.doesNotMatch(detailPage, /post\.sellerProfile\b/u);
  assert.doesNotMatch(detailPage, /sellerProfile:\s*\{\s*select:/u);
  assert.match(detailPage, /publicBlogAuthorPresentation\(post, "Former author"\)/u);
  assert.match(detailPage, /publicBlogAuthorPresentation\(r, "Former author"\)/u);
});
