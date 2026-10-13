export type ListingRetainedReferenceState = {
  hasOrderItems: boolean;
  hasReviews: boolean;
  hasConversations: boolean;
  hasMessages: boolean;
  hasCheckoutReservations: boolean;
};

export function listingDeleteDisposition(
  customOrderConversationId: string | null,
  references: ListingRetainedReferenceState,
): "delete" | "archive" | "blocked_checkout" {
  if (references.hasCheckoutReservations) return "blocked_checkout";
  return customOrderConversationId ||
    references.hasOrderItems ||
    references.hasReviews ||
    references.hasConversations ||
    references.hasMessages
    ? "archive"
    : "delete";
}
