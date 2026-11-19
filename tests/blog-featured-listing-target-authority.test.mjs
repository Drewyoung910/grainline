import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const targetPath = new URL(
  "../src/lib/blogFeaturedListingAccess.ts",
  import.meta.url,
);
const newPagePath = new URL(
  "../src/app/dashboard/blog/new/page.tsx",
  import.meta.url,
);
const editPagePath = new URL(
  "../src/app/dashboard/blog/[id]/edit/page.tsx",
  import.meta.url,
);

test("blog featured-listing writes use bounded Listing authorities", async () => {
  const [target, newPage, editPage] = await Promise.all([
    readFile(targetPath, "utf8"),
    readFile(newPagePath, "utf8"),
    readFile(editPagePath, "utf8"),
  ]);

  assert.match(target, /export async function verifiedBlogFeaturedListingIds/u);
  assert.match(target, /listingOwnerSummaryRows\(actorUserId,[\s\S]*status: ListingStatus\.ACTIVE/u);
  assert.match(target, /listingPublicCatalogPage\([\s\S]*listingIds: uniqueListingIds[\s\S]*0,[\s\S]*uniqueListingIds\.length/u);
  assert.match(target, /uniqueListingIds\.filter\(\(listingId\) => allowedIds\.has\(listingId\)\)/u);

  for (const source of [newPage, editPage]) {
    assert.match(source, /verifiedBlogFeaturedListingIds\(/u);
    assert.doesNotMatch(source, /prisma\.listing\.findMany\(/u);
  }
});
