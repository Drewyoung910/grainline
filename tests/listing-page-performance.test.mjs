import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("listing detail page query guardrails", () => {
  it("shares the listing detail loader between metadata and page render", () => {
    const listingPage = source("src/app/listing/[id]/page.tsx");

    assert.match(listingPage, /import \{ cache \} from "react"/);
    assert.match(listingPage, /const getListingForDetailPage = cache\(async \(listingId: string\) =>/);
    assert.match(listingPage, /export async function generateMetadata[\s\S]*getListingForDetailPage\(listingId\)/);
    assert.match(listingPage, /export default async function ListingPage[\s\S]*getListingForDetailPage\(listingId\)/);
    assert.equal(
      (listingPage.match(/prisma\.listing\.findUnique\(/g) ?? []).length,
      1,
      "metadata and page render should not duplicate the listing findUnique call",
    );
  });

  it("keeps viewer-specific reads outside the shared listing cache", () => {
    const listingPage = source("src/app/listing/[id]/page.tsx");
    const cachedLoader = listingPage.slice(
      listingPage.indexOf("const getListingForDetailPage"),
      listingPage.indexOf("export async function generateMetadata"),
    );

    assert.doesNotMatch(cachedLoader, /auth\(\)/);
    assert.doesNotMatch(cachedLoader, /getBlockedUserIdsFor/);
    assert.doesNotMatch(cachedLoader, /prisma\.favorite/);
    assert.doesNotMatch(cachedLoader, /prisma\.follow/);
    assert.doesNotMatch(cachedLoader, /prisma\.stockNotification/);
  });
});
