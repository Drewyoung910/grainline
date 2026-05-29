import { ListingStatus, ListingType } from "@prisma/client";

export const STAFF_REMOVAL_REJECTION_REASON = "Removed by Grainline staff.";

export type ListingActionState = {
  status: ListingStatus;
  listingType?: ListingType | null;
  stockQuantity?: number | null;
  isPrivate?: boolean | null;
  rejectionReason?: string | null;
};

const PUBLISHABLE_LISTING_STATUSES = new Set<ListingStatus>([
  ListingStatus.DRAFT,
  ListingStatus.HIDDEN,
  ListingStatus.SOLD,
  ListingStatus.SOLD_OUT,
  ListingStatus.REJECTED,
]);

export function hideListingBlockReason(listing: ListingActionState) {
  if (listing.status !== ListingStatus.ACTIVE && listing.status !== ListingStatus.SOLD_OUT) {
    return "Only active or sold-out listings can be hidden.";
  }
  return null;
}

export function unhideListingBlockReason(listing: ListingActionState) {
  if (listing.status !== ListingStatus.HIDDEN) {
    return "Only hidden listings can be unhidden.";
  }
  if (listing.isPrivate) {
    return "Archived listings cannot be unhidden.";
  }
  return null;
}

export function archiveListingBlockReason(listing: ListingActionState) {
  if (listing.status === ListingStatus.HIDDEN && listing.isPrivate) {
    return "Listing is already archived.";
  }
  if (listing.status === ListingStatus.PENDING_REVIEW) {
    return "Listings in review cannot be archived until review is complete.";
  }
  if (listing.status === ListingStatus.SOLD) {
    return "Sold listings cannot be archived from the shop page because they remain part of buyer order history.";
  }
  return null;
}

export function withdrawReviewBlockReason(listing: ListingActionState) {
  if (listing.status !== ListingStatus.PENDING_REVIEW) {
    return "Only listings in review can be withdrawn.";
  }
  return null;
}

export function markAvailableBlockReason(listing: ListingActionState) {
  if (listing.status !== ListingStatus.SOLD && listing.status !== ListingStatus.SOLD_OUT) {
    return "Only sold listings can be marked available.";
  }
  if (listing.listingType === ListingType.IN_STOCK && (listing.stockQuantity ?? 0) <= 0) {
    return "Add stock before marking this listing available.";
  }
  return null;
}

export function publishListingBlockReason(listing: ListingActionState) {
  if (!PUBLISHABLE_LISTING_STATUSES.has(listing.status)) {
    if (listing.status === ListingStatus.PENDING_REVIEW) {
      return "Listings already in review cannot be published. Withdraw to draft before changing them.";
    }
    return "This listing cannot be published from its current status.";
  }
  if (listing.status === ListingStatus.HIDDEN && listing.isPrivate) {
    return "Archived listings cannot be republished.";
  }
  if (listing.rejectionReason === STAFF_REMOVAL_REJECTION_REASON) {
    return "This listing was removed by Grainline staff and cannot be resubmitted.";
  }
  if (listing.listingType === ListingType.IN_STOCK && (listing.stockQuantity ?? 0) <= 0) {
    return "Add stock before publishing this listing.";
  }
  return null;
}
