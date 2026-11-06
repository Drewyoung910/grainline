import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { defaultOpenGraphImages } = await import("../src/lib/siteMetadata.ts");

describe("site metadata", () => {
  it("provides a complete public fallback image for nested Open Graph metadata", () => {
    assert.deepEqual(defaultOpenGraphImages(), [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Grainline",
      },
    ]);
  });

  it("does not share mutable image arrays across metadata requests", () => {
    const first = defaultOpenGraphImages();
    const second = defaultOpenGraphImages();
    assert.notEqual(first, second);
  });

  it("keeps every public page that replaces Open Graph metadata on the shared fallback", () => {
    const pages = [
      "src/app/browse/page.tsx",
      "src/app/browse/[metroSlug]/page.tsx",
      "src/app/browse/[metroSlug]/[category]/page.tsx",
      "src/app/map/page.tsx",
      "src/app/makers/[metroSlug]/page.tsx",
      "src/app/tag/[slug]/page.tsx",
      "src/app/seller-handbook/page.tsx",
      "src/app/commission/[param]/page.tsx",
    ];

    for (const page of pages) {
      assert.match(
        readFileSync(page, "utf8"),
        /images:\s*defaultOpenGraphImages\(\)/u,
        `${page} must keep a public fallback social image`,
      );
    }
  });
});
