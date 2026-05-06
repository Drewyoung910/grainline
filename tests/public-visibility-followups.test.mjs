import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const { savedListingFavoriteWhere } = await import("../src/lib/savedListingVisibility.ts");

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("public visibility follow-ups", () => {
  it("keeps account dashboard saved listings on the shared saved-page filter", () => {
    const accountPage = read("src/app/account/page.tsx");
    assert.match(accountPage, /savedListingFavoriteWhere\(me\.id, blockedSellerIds\)/);
  });

  it("validates favorite targets through public listing detail visibility", () => {
    const favoritesRoute = read("src/app/api/favorites/route.ts");
    assert.match(favoritesRoute, /publicListingDetailWhere\(\{ id: listingId \}\)/);
    assert.doesNotMatch(favoritesRoute, /favorite\.upsert\(\{[\s\S]*create: \{ userId: me\.id, listingId \}[\s\S]*findUnique\(\{[\s\S]*where: \{ id: listingId \}/);
  });

  it("allows sellers to clear their workshop gallery explicitly", () => {
    const uploader = read("src/components/GalleryUploader.tsx");
    const sellerPage = read("src/app/dashboard/seller/page.tsx");
    assert.match(uploader, /name="galleryImageUrlsTouched"/);
    assert.match(sellerPage, /galleryImageUrlsTouched \? \{ galleryImageUrls \} : \{\}/);
  });

  it("builds saved listing filters with only public active or sold-out listings", () => {
    assert.deepEqual(savedListingFavoriteWhere("user_1", ["seller_2"]), {
      userId: "user_1",
      listing: {
        status: { in: ["ACTIVE", "SOLD_OUT"] },
        isPrivate: false,
        sellerId: { notIn: ["seller_2"] },
        seller: {
          chargesEnabled: true,
          vacationMode: false,
          user: { banned: false, deletedAt: null },
        },
      },
    });
  });
});
