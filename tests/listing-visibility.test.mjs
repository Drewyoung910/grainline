import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListingStatus } from "@prisma/client";

const {
  canViewListingDetail,
  isPublicListing,
  publicListingWhere,
} = await import("../src/lib/listingVisibility.ts");

function listing(overrides = {}) {
  return {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    reservedForUserId: null,
    seller: {
      chargesEnabled: true,
      vacationMode: false,
      user: {
        id: "user_1",
        clerkId: "clerk_1",
        banned: false,
        deletedAt: null,
      },
    },
    ...overrides,
  };
}

describe("listing visibility", () => {
  it("composes public listing safety filters so callers cannot override them", () => {
    assert.deepEqual(publicListingWhere({ sellerId: "seller_1" }), {
      AND: [
        {
          status: ListingStatus.ACTIVE,
          isPrivate: false,
          seller: {
            chargesEnabled: true,
            vacationMode: false,
            user: { banned: false, deletedAt: null },
          },
        },
        { sellerId: "seller_1" },
      ],
    });

    assert.deepEqual(publicListingWhere({ seller: { id: "seller_1" } }), {
      AND: [
        {
          status: ListingStatus.ACTIVE,
          isPrivate: false,
          seller: {
            chargesEnabled: true,
            vacationMode: false,
            user: { banned: false, deletedAt: null },
          },
        },
        { seller: { id: "seller_1" } },
      ],
    });
  });

  it("requires active, public, payable, non-vacation, non-banned seller state", () => {
    assert.equal(isPublicListing(listing()), true);
    assert.equal(isPublicListing(listing({ status: ListingStatus.HIDDEN })), false);
    assert.equal(isPublicListing(listing({ isPrivate: true })), false);
    assert.equal(isPublicListing(listing({ seller: { ...listing().seller, chargesEnabled: false } })), false);
    assert.equal(isPublicListing(listing({ seller: { ...listing().seller, vacationMode: true } })), false);
    assert.equal(
      isPublicListing(listing({ seller: { ...listing().seller, user: { ...listing().seller.user, banned: true } } })),
      false,
    );
    assert.equal(
      isPublicListing(listing({ seller: { ...listing().seller, user: { ...listing().seller.user, deletedAt: new Date() } } })),
      false,
    );
  });

  it("allows owners and reserved buyers without bypassing seller account safety", () => {
    assert.equal(canViewListingDetail(listing({ status: ListingStatus.HIDDEN }), { clerkUserId: "clerk_1" }), true);
    assert.equal(
      canViewListingDetail(
        listing({ isPrivate: true, reservedForUserId: "buyer_1" }),
        { dbUserId: "buyer_1" },
      ),
      true,
    );
    assert.equal(
      canViewListingDetail(
        listing({
          isPrivate: true,
          reservedForUserId: "buyer_1",
          seller: { ...listing().seller, user: { ...listing().seller.user, banned: true } },
        }),
        { dbUserId: "buyer_1" },
      ),
      false,
    );
    assert.equal(
      canViewListingDetail(
        listing({ isPrivate: true, reservedForUserId: "buyer_1" }),
        { dbUserId: "buyer_2" },
      ),
      false,
    );
  });
});
