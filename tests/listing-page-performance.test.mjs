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
    assert.match(listingPage, /const getListingForDetailPage = cache\([\s\S]*viewerUserId: string \| null[\s\S]*listingId: string/);
    assert.match(listingPage, /export async function generateMetadata[\s\S]*getListingForDetailPage\(null, listingId\)/);
    assert.match(listingPage, /export default async function ListingPage[\s\S]*getListingForDetailPage\(meId, listingId\)/);
    assert.equal(
      (listingPage.match(/prisma\.listing\.findUnique\(/g) ?? []).length,
      0,
      "metadata and page render must use the bounded Listing detail authority",
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

  it("resolves the actor before the viewer-bound listing authority", () => {
    const listingPage = source("src/app/listing/[id]/page.tsx");
    const renderStart = listingPage.indexOf("export default async function ListingPage");
    const searchParamsRead = listingPage.indexOf("const sp = await searchParams", renderStart);
    const authRead = listingPage.indexOf("await auth()", renderStart);
    const listingAwait = listingPage.indexOf("await getListingForDetailPage(meId, listingId)", renderStart);
    const sellerAwait = listingPage.indexOf("await getListingSellerForDetailPage(meId, listingId)", renderStart);

    assert.ok(searchParamsRead > renderStart, "page render should parse its route state");
    assert.ok(listingAwait > authRead, "viewer checks can still complete before listing visibility decisions");
    assert.ok(sellerAwait > authRead, "viewer-aware seller access must follow the authenticated actor lookup");
    assert.doesNotMatch(listingPage.slice(renderStart), /getListingForDetailPage\(null, listingId\)/);
  });
});
