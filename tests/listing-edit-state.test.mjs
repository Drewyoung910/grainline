import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListingStatus } from "@prisma/client";

const { listingEditBlockReason } = await import("../src/lib/listingEditState.ts");

function listing(overrides = {}) {
  return {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    rejectionReason: null,
    ...overrides,
  };
}

describe("listing edit state", () => {
  it("allows draft, active, hidden, sold-out, and normal rejected listings through the edit flow", () => {
    assert.equal(listingEditBlockReason(listing({ status: ListingStatus.DRAFT })), null);
    assert.equal(listingEditBlockReason(listing({ status: ListingStatus.ACTIVE })), null);
    assert.equal(listingEditBlockReason(listing({ status: ListingStatus.HIDDEN })), null);
    assert.equal(listingEditBlockReason(listing({ status: ListingStatus.SOLD_OUT })), null);
    assert.equal(listingEditBlockReason(listing({ status: ListingStatus.REJECTED, rejectionReason: "Needs clearer photos." })), null);
  });

  it("blocks archived, sold, in-review, and staff-removed listings", () => {
    assert.match(
      listingEditBlockReason(listing({ status: ListingStatus.HIDDEN, isPrivate: true })),
      /Archived listings/,
    );
    assert.match(
      listingEditBlockReason(listing({ status: ListingStatus.SOLD })),
      /Sold listings/,
    );
    assert.match(
      listingEditBlockReason(listing({ status: ListingStatus.PENDING_REVIEW })),
      /already in review/,
    );
    assert.match(
      listingEditBlockReason(listing({
        status: ListingStatus.REJECTED,
        rejectionReason: "Removed by Grainline staff.",
      })),
      /removed by Grainline staff/,
    );
  });
});
