import { ListingStatus } from "@prisma/client";

export type ConversationRecipientState = {
  id: string;
  banned?: boolean | null;
  deletedAt?: Date | string | null;
} | null | undefined;

export type ConversationContextListingState = {
  id: string;
  status: ListingStatus | string;
  isPrivate: boolean;
  reservedForUserId?: string | null;
  seller: {
    chargesEnabled: boolean;
    vacationMode?: boolean | null;
    user?: {
      id?: string | null;
      banned?: boolean | null;
      deletedAt?: Date | string | null;
    } | null;
  };
} | null | undefined;

function hasActiveSeller(listing: Exclude<ConversationContextListingState, null | undefined>) {
  return (
    listing.seller.chargesEnabled &&
    !listing.seller.vacationMode &&
    !listing.seller.user?.banned &&
    !listing.seller.user?.deletedAt
  );
}

export function canStartConversationWith(
  currentUserId: string,
  recipient: ConversationRecipientState,
  blocked: boolean,
) {
  return Boolean(
    recipient &&
      recipient.id !== currentUserId &&
      !recipient.banned &&
      !recipient.deletedAt &&
      !blocked,
  );
}

export function canAttachConversationContextListing(
  listing: ConversationContextListingState,
  participantUserIds: readonly string[],
) {
  if (!listing || listing.status !== ListingStatus.ACTIVE || !hasActiveSeller(listing)) {
    return false;
  }

  if (!listing.isPrivate) return true;

  const participants = new Set(participantUserIds);
  const sellerUserId = listing.seller.user?.id;
  return Boolean(
    sellerUserId &&
      participants.has(sellerUserId) &&
      listing.reservedForUserId &&
      participants.has(listing.reservedForUserId),
  );
}
