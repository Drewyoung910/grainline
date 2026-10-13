import { ListingStatus } from "@prisma/client";

const STAFF_REMOVAL_REJECTION_REASON = "Removed by Grainline staff.";

export type EditableListingState = {
  status: ListingStatus;
  isPrivate: boolean;
  archivedAt?: Date | string | null;
  rejectionReason?: string | null;
};

export function listingEditBlockReason(listing: EditableListingState): string | null {
  if (listing.archivedAt) {
    return "Archived listings cannot be edited.";
  }

  if (listing.status === ListingStatus.SOLD) {
    return "Sold listings cannot be edited because they are part of completed order history.";
  }

  if (listing.status === ListingStatus.PENDING_REVIEW) {
    return "This listing is already in review. Wait for review to finish before editing it again.";
  }

  if (
    listing.status === ListingStatus.REJECTED &&
    listing.rejectionReason === STAFF_REMOVAL_REJECTION_REASON
  ) {
    return "This listing was removed by Grainline staff and cannot be edited.";
  }

  return null;
}
