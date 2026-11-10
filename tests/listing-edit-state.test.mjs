import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListingStatus } from "@prisma/client";

const { approvedListingStatus, listingEditBlockReason, parseListingMaterials } = await import("../src/lib/listingEditState.ts");

function listing(overrides = {}) {
  return {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    archivedAt: null,
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
      listingEditBlockReason(listing({ status: ListingStatus.HIDDEN, isPrivate: true, archivedAt: new Date() })),
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

it("listing materials are bounded per item and in number", () => {
  assert.deepEqual(parseListingMaterials(" walnut, maple ,, brass hardware "), ["walnut", "maple", "brass hardware"]);
  assert.deepEqual(parseListingMaterials(null), []);
  assert.deepEqual(parseListingMaterials(""), []);
  const [long] = parseListingMaterials("x".repeat(100_000));
  assert.equal(long.length, 100);
  assert.equal(parseListingMaterials(Array(50).fill("oak").join(",")).length, 20);
});

it("a sold-out piece switched to made to order comes back for sale after approval", () => {
  const madeToOrder = { listingType: "MADE_TO_ORDER", stockQuantity: null, isPrivate: false };
  assert.equal(approvedListingStatus(ListingStatus.SOLD_OUT, madeToOrder), ListingStatus.ACTIVE);
  assert.equal(approvedListingStatus(ListingStatus.ACTIVE, madeToOrder), ListingStatus.ACTIVE);
  assert.equal(
    approvedListingStatus(ListingStatus.SOLD_OUT, { ...madeToOrder, isPrivate: true }),
    ListingStatus.SOLD_OUT,
  );
});
