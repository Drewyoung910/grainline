import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("public Listing aggregates use the shared bounded catalog count", async () => {
  const paths = [
    "src/app/about/page.tsx",
    "src/app/why-grainline/page.tsx",
    "src/app/seller/[id]/page.tsx",
    "src/lib/homepageStats.ts",
    "src/lib/sitemapSourceCounts.ts",
  ];
  const sources = await Promise.all(paths.map(async (path) => [
    path,
    await readFile(new URL(path, root), "utf8"),
  ]));

  for (const [path, source] of sources) {
    assert.match(
      source,
      /listingPublicCatalogCount/u,
      `${path} should use the bounded public count authority`,
    );
    assert.doesNotMatch(
      source,
      /prisma\.listing\.count\(/u,
      `${path} should not count the Listing table directly`,
    );
  }

  const seller = sources.find(([path]) => path === "src/app/seller/[id]/page.tsx")?.[1];
  assert.match(seller, /listingPublicCatalogCount\(meId, \{ sellerId: seller\.id \}\)/u);
});
