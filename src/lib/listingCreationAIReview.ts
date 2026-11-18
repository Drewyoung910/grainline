type ListingCreationAIReviewClient = {
  applyTransition(input: {
    listingId: string;
    sellerId: string;
    reviewedUpdatedAt: Date;
    status: "PENDING_REVIEW" | "ACTIVE";
    flags: string[];
    confidence: number;
    reason: string | null;
  }): Promise<boolean>;
};

type ListingCreationAIReviewInput = {
  listingId: string;
  sellerId: string;
  reviewedUpdatedAt: Date;
  approved: boolean;
  flags: string[];
  confidence: number;
  reason: string;
};

export async function applyListingCreationAIReviewResult(
  client: ListingCreationAIReviewClient,
  input: ListingCreationAIReviewInput,
) {
  const shouldHold = !input.approved
    || input.flags.length > 0
    || input.confidence < 0.8;
  const applied = await client.applyTransition({
    listingId: input.listingId,
    sellerId: input.sellerId,
    reviewedUpdatedAt: input.reviewedUpdatedAt,
    status: shouldHold ? "PENDING_REVIEW" : "ACTIVE",
    flags: input.flags,
    confidence: input.confidence,
    reason: shouldHold ? input.reason : null,
  });

  return Object.freeze({
    applied,
    activated: applied && !shouldHold,
  });
}
