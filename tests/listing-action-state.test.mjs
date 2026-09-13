import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ListingStatus, ListingType } from "@prisma/client";

const {
  STAFF_REMOVAL_REJECTION_REASON,
  archiveListingBlockReason,
  hideListingBlockReason,
  markAvailableBlockReason,
  publishListingBlockReason,
  unhideListingBlockReason,
  withdrawReviewBlockReason,
} = await import("../src/lib/listingActionState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

function listing(overrides = {}) {
  return {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    rejectionReason: null,
    ...overrides,
  };
}

describe("listing shop action state", () => {
  it("hides active and sold-out listings", () => {
    assert.equal(hideListingBlockReason(listing()), null);
    assert.equal(hideListingBlockReason(listing({ status: ListingStatus.SOLD_OUT })), null);
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

  it("allows only in-review listings to be withdrawn back to drafts", () => {
    assert.equal(withdrawReviewBlockReason(listing({ status: ListingStatus.PENDING_REVIEW })), null);
    assert.match(withdrawReviewBlockReason(listing({ status: ListingStatus.ACTIVE })), /Only listings in review/);
    assert.match(withdrawReviewBlockReason(listing({ status: ListingStatus.DRAFT })), /Only listings in review/);
    assert.match(withdrawReviewBlockReason(listing({ status: ListingStatus.REJECTED })), /Only listings in review/);
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

  it("keeps invalid start states, archived, and staff-removed listings out of publish flow", () => {
    assert.equal(publishListingBlockReason(listing({ status: ListingStatus.DRAFT })), null);
    assert.equal(publishListingBlockReason(listing({ status: ListingStatus.HIDDEN })), null);
    assert.equal(publishListingBlockReason(listing({ status: ListingStatus.SOLD })), null);
    assert.equal(
      publishListingBlockReason(listing({
        status: ListingStatus.SOLD_OUT,
        listingType: ListingType.IN_STOCK,
        stockQuantity: 2,
      })),
      null,
    );
    assert.equal(publishListingBlockReason(listing({ status: ListingStatus.REJECTED })), null);
    assert.match(publishListingBlockReason(listing({ status: ListingStatus.ACTIVE })), /current status/);
    assert.match(publishListingBlockReason(listing({ status: ListingStatus.PENDING_REVIEW })), /already in review/);
    assert.match(
      publishListingBlockReason(listing({ status: ListingStatus.HIDDEN, isPrivate: true })),
      /Archived listings/,
    );
    assert.match(
      publishListingBlockReason(listing({ status: ListingStatus.REJECTED, rejectionReason: STAFF_REMOVAL_REJECTION_REASON })),
      /removed by Grainline staff/,
    );
    assert.match(
      publishListingBlockReason(listing({
        status: ListingStatus.DRAFT,
        listingType: ListingType.IN_STOCK,
        stockQuantity: 0,
      })),
      /Add stock/,
    );
  });

  it("wires pending-review withdrawal through guarded seller actions and UI", () => {
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const shopUi = source("src/app/seller/[id]/shop/ShopListingActions.tsx");
    const dashboard = source("src/app/dashboard/page.tsx");
    const inventoryRow = source("src/app/dashboard/inventory/InventoryRow.tsx");

    assert.match(shopActions, /export async function withdrawListingReviewAction/);
    assert.match(shopActions, /withdrawReviewBlockReason\(listing\)/);
    assert.match(shopActions, /publishListingBlockReason\(listing\)/);
    assert.match(shopActions, /status: ListingStatus\.PENDING_REVIEW/);
    assert.match(shopActions, /sellerId: listing\.sellerId/);
    assert.match(shopActions, /updatedAt: listing\.updatedAt/);
    assert.match(shopActions, /status: ListingStatus\.DRAFT/);
    assert.match(shopActions, /aiReviewFlags: \[\]/);
    assert.match(shopActions, /reviewedByAdmin: false/);

    assert.match(shopUi, /withdrawListingReviewAction/);
    assert.match(shopUi, /status === "PENDING_REVIEW"/);
    assert.match(shopUi, />\s*Withdraw\s*</);
    assert.match(shopUi, /status !== "PENDING_REVIEW" && \(/);

    assert.match(dashboard, /async function withdrawListingReview/);
    assert.match(dashboard, /withdrawReviewBlockReason\(listing\)/);
    assert.match(dashboard, /status: ListingStatus\.PENDING_REVIEW/);
    assert.match(dashboard, /sellerId: listing\.sellerId/);
    assert.match(dashboard, /updatedAt: listing\.updatedAt/);
    assert.match(dashboard, /status: ListingStatus\.DRAFT/);
    assert.match(dashboard, /action=\{withdrawListingReview\.bind\(null, l\.id\)\}/);
    assert.match(dashboard, />\s*Withdraw\s*</);

    assert.match(inventoryRow, /listing\.status === "PENDING_REVIEW"/);
    assert.match(inventoryRow, /`\$\{publicListingPath\(listing\.id, listing\.title\)\}\?preview=1`/);
    assert.match(inventoryRow, /: `\/dashboard\/listings\/\$\{listing\.id\}\/edit`/);
  });
});
