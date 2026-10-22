import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sources = [
  "src/app/api/search/suggestions/route.ts",
  "src/app/api/blog/search/suggestions/route.ts",
  "src/app/api/blog/search/route.ts",
  "src/app/blog/page.tsx",
].map((file) => ({ file, source: readFileSync(file, "utf8") }));

test("blog search SQL delegates seller eligibility to the bounded blog-author authority", () => {
  for (const { file, source } of sources) {
    assert.match(
      source,
      /grainline_seller_public_blog_author/u,
      `${file} must use the bounded blog-author authority`,
    );
    assert.doesNotMatch(
      source,
      /LEFT JOIN "SellerProfile"/u,
      `${file} must not retain a raw SellerProfile join`,
    );
  }
});
