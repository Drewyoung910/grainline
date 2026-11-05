import { ListingStatus } from "@prisma/client";
import { sanitizeText, truncateText } from "./sanitize.ts";

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
    listing.rejectionReason?.startsWith(STAFF_REMOVAL_REJECTION_REASON)
  ) {
    // The stored text is the marker followed by the reason staff gave.
    return `This listing was removed by Grainline staff and cannot be edited.${listing.rejectionReason.slice(STAFF_REMOVAL_REJECTION_REASON.length)}`;
  }

  return null;
}

// The public status a listing returns to once AI approves an edit, from the
// row as it stands then. Mirrors the manual stock route's status rule.
export function approvedListingStatus(
  previousStatus: ListingStatus,
  current: { listingType: string; stockQuantity: number | null; isPrivate: boolean },
): ListingStatus {
  if (current.listingType !== "IN_STOCK") return previousStatus;
  const stock = current.stockQuantity ?? 0;
  if (previousStatus === ListingStatus.ACTIVE && stock <= 0) return ListingStatus.SOLD_OUT;
  if (previousStatus === ListingStatus.SOLD_OUT && stock > 0 && !current.isPrivate) return ListingStatus.ACTIVE;
  return previousStatus;
}

// Comma-separated form text to a bounded list. Every listing view renders it,
// and neither the app nor the database otherwise limits an entry's length.
export function parseListingMaterials(input: FormDataEntryValue | null): string[] {
  return sanitizeText(String(input ?? ""))
    .split(",")
    .map((item) => truncateText(item.trim(), 100))
    .filter(Boolean)
    .slice(0, 20);
}
