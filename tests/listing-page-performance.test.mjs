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

  it("starts the shared listing load before viewer-specific reads", () => {
    const listingPage = source("src/app/listing/[id]/page.tsx");
    const renderStart = listingPage.indexOf("export default async function ListingPage");
    const listingPromise = listingPage.indexOf(
      "const listingPromise = getListingForDetailPage(listingId)",
      renderStart,
    );
    const searchParamsRead = listingPage.indexOf("const sp = await searchParams", renderStart);
    const authRead = listingPage.indexOf("await auth()", renderStart);
    const listingAwait = listingPage.indexOf("const listing = await listingPromise", renderStart);

    assert.ok(listingPromise > renderStart, "page render should start the listing load");
    assert.ok(listingPromise < searchParamsRead, "listing load should start before search params parsing");
    assert.ok(listingPromise < authRead, "listing load should start before auth reads");
    assert.ok(listingAwait > authRead, "viewer checks can still complete before listing visibility decisions");
    assert.doesNotMatch(listingPage.slice(renderStart), /const listing = await getListingForDetailPage\(listingId\)/);
  });
});
