import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("listing detail page query guardrails", () => {
  it("shares the actor-keyed listing detail loader between metadata and page render", () => {
    const listingPage = source("src/app/listing/[id]/page.tsx");

    assert.match(listingPage, /import \{ cache \} from "react"/);
    assert.match(listingPage, /const getListingForDetailPage = cache\(\s*async \(viewerUserId: string \| null, listingId: string\) =>/);
    assert.match(listingPage, /export async function generateMetadata[\s\S]*getListingForDetailPage\(null, listingId\)/);
    assert.match(listingPage, /export default async function ListingPage[\s\S]*getListingForDetailPage\(meId, listingId\)/);
    assert.doesNotMatch(listingPage, /prisma\.listing\.findUnique\(/);
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

  it("resolves the viewer before the actor-bound listing load", () => {
    const listingPage = source("src/app/listing/[id]/page.tsx");
    const renderStart = listingPage.indexOf("export default async function ListingPage");
    const authRead = listingPage.indexOf("await auth()", renderStart);
    const listingAwait = listingPage.indexOf("const listingCore = staffClient", renderStart);
    const sellerAwait = listingPage.indexOf("await getListingSellerForDetailPage(meId, listingId)", renderStart);

    assert.ok(authRead > renderStart, "page render should resolve authentication");
    assert.ok(listingAwait > authRead, "the Listing authority must receive the server-resolved actor");
    assert.ok(sellerAwait > authRead, "viewer-aware seller access must follow the authenticated actor lookup");
    assert.doesNotMatch(listingPage.slice(renderStart), /getListingForDetailPage\(null, listingId\)/);
  });
});
