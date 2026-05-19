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
    const profilePage = read("src/app/dashboard/profile/page.tsx");
    assert.match(uploader, /name="galleryImageUrlsTouched"/);
    assert.match(profilePage, /galleryImageUrlsTouched \? \{ galleryImageUrls, galleryAltTexts \} : \{\}/);
  });

  it("builds saved listing filters with only public active or sold-out listings", () => {
    assert.deepEqual(savedListingFavoriteWhere("user_1", ["seller_2"]), {
      userId: "user_1",
      listing: {
        AND: [
          {
            status: { in: ["ACTIVE", "SOLD_OUT"] },
            isPrivate: false,
            seller: {
              chargesEnabled: true,
              OR: [
                { stripeAccountVersion: null },
                { stripeAccountVersion: "v2" },
              ],
              vacationMode: false,
              user: { banned: false, deletedAt: null },
            },
          },
          { sellerId: { notIn: ["seller_2"] } },
        ],
      },
    });
  });

  it("cleans up follow rows if a block races the follow write", () => {
    const followRoute = read("src/app/api/follow/[sellerId]/route.ts");

    assert.match(followRoute, /const blockAfterFollow = await prisma\.block\.findFirst/);
    assert.match(followRoute, /await prisma\.follow\.deleteMany\(\{\s*where: \{ followerId: me\.id, sellerProfileId: sellerProfile\.id \}/s);
    assert.match(followRoute, /return NextResponse\.json\(\{ error: "Blocked" \}, \{ status: 403 \}\)/);
    assert.ok(
      followRoute.indexOf("const blockAfterFollow") > followRoute.indexOf("await prisma.follow.upsert"),
      "follow route must re-check block state after the follow write",
    );
    assert.ok(
      followRoute.indexOf("const followerCount", followRoute.indexOf("const blockAfterFollow")) >
        followRoute.indexOf("const blockAfterFollow"),
      "follow route must not count or notify until the post-write block recheck passes",
    );
  });
});
