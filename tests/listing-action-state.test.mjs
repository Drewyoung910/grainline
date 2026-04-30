import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListingStatus, ListingType } from "@prisma/client";

const {
  STAFF_REMOVAL_REJECTION_REASON,
  archiveListingBlockReason,
  hideListingBlockReason,
  markAvailableBlockReason,
  publishListingBlockReason,
  unhideListingBlockReason,
} = await import("../src/lib/listingActionState.ts");

function listing(overrides = {}) {
  return {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    rejectionReason: null,
    ...overrides,
  };
}

describe("listing shop action state", () => {
  it("hides only active listings", () => {
    assert.equal(hideListingBlockReason(listing()), null);
    assert.match(hideListingBlockReason(listing({ status: ListingStatus.SOLD })), /Only active/);
    assert.match(hideListingBlockReason(listing({ status: ListingStatus.HIDDEN })), /Only active/);
  });

  it("unhides only non-archived hidden listings", () => {
    assert.equal(unhideListingBlockReason(listing({ status: ListingStatus.HIDDEN })), null);
    assert.match(
      unhideListingBlockReason(listing({ status: ListingStatus.HIDDEN, isPrivate: true })),
      /Archived listings/,
    );
    assert.match(unhideListingBlockReason(listing({ status: ListingStatus.ACTIVE })), /Only hidden/);
  });

  it("blocks archive for in-review, sold, and already archived listings", () => {
    assert.equal(archiveListingBlockReason(listing({ status: ListingStatus.ACTIVE })), null);
    assert.equal(archiveListingBlockReason(listing({ status: ListingStatus.REJECTED })), null);
    assert.match(archiveListingBlockReason(listing({ status: ListingStatus.PENDING_REVIEW })), /review/);
    assert.match(archiveListingBlockReason(listing({ status: ListingStatus.SOLD })), /buyer order history/);
    assert.match(
      archiveListingBlockReason(listing({ status: ListingStatus.HIDDEN, isPrivate: true })),
      /already archived/,
    );
  });

  it("limits mark-available to sold states", () => {
    assert.equal(markAvailableBlockReason(listing({ status: ListingStatus.SOLD })), null);
    assert.equal(markAvailableBlockReason(listing({ status: ListingStatus.SOLD_OUT })), null);
    assert.match(
      markAvailableBlockReason(listing({
        status: ListingStatus.SOLD_OUT,
        listingType: ListingType.IN_STOCK,
        stockQuantity: 0,
      })),
      /Add stock/,
    );
    assert.equal(
      markAvailableBlockReason(listing({
        status: ListingStatus.SOLD_OUT,
        listingType: ListingType.IN_STOCK,
        stockQuantity: 2,
      })),
      null,
    );
    assert.match(markAvailableBlockReason(listing({ status: ListingStatus.ACTIVE })), /Only sold/);
  });

  it("keeps archived and staff-removed listings out of publish flow", () => {
    assert.equal(publishListingBlockReason(listing({ status: ListingStatus.DRAFT })), null);
    assert.match(
      publishListingBlockReason(listing({ status: ListingStatus.HIDDEN, isPrivate: true })),
      /Archived listings/,
    );
    assert.match(
      publishListingBlockReason(listing({ status: ListingStatus.REJECTED, rejectionReason: STAFF_REMOVAL_REJECTION_REASON })),
      /removed by Grainline staff/,
    );
  });
});
