import { ListingStatus } from "@prisma/client";

export const LISTING_UNDO_FALLBACK_STATUS = ListingStatus.HIDDEN;

function validListingStatus(value: unknown): value is ListingStatus {
  return typeof value === "string" && Object.values(ListingStatus).includes(value as ListingStatus);
}

export function listingUndoDataFromMetadata(metadata: Record<string, unknown>) {
  const hasValidPreviousStatus = validListingStatus(metadata.previousStatus);
  const previousStatus = hasValidPreviousStatus
    ? metadata.previousStatus as ListingStatus
    : LISTING_UNDO_FALLBACK_STATUS;
  const data: {
    status: ListingStatus;
    isPrivate?: boolean;
    rejectionReason?: string | null;
  } = {
    status: previousStatus,
  };

  if (typeof metadata.previousIsPrivate === "boolean") {
    data.isPrivate = metadata.previousIsPrivate;
  } else if (!hasValidPreviousStatus) {
    data.isPrivate = true;
  }

  if (typeof metadata.previousRejectionReason === "string") {
    data.rejectionReason = metadata.previousRejectionReason;
  } else if ("previousRejectionReason" in metadata) {
    data.rejectionReason = null;
  }

  return data;
}

export function listingUndoCurrentStatusWhere(action: string, targetId: string) {
  if (action === "REMOVE_LISTING") {
    return { id: targetId, status: ListingStatus.REJECTED, isPrivate: true };
  }
  if (action === "HOLD_LISTING") {
    return { id: targetId, status: ListingStatus.HIDDEN };
  }
  return { id: targetId };
}
