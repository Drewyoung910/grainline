type ListingCreationAIReviewClient = {
  listing: {
    updateMany(args: {
      where: {
        id: string;
        sellerId: string;
        status: "PENDING_REVIEW";
        updatedAt: Date;
      };
      data: {
        status: "PENDING_REVIEW" | "ACTIVE";
        aiReviewFlags: string[];
        aiReviewScore: number;
      };
    }): Promise<{ count: number }>;
  };
};

type ListingCreationAIReviewInput = {
  listingId: string;
  sellerId: string;
  reviewedUpdatedAt: Date;
  approved: boolean;
  flags: string[];
  confidence: number;
};

export async function applyListingCreationAIReviewResult(
  client: ListingCreationAIReviewClient,
  input: ListingCreationAIReviewInput,
) {
  const shouldHold = !input.approved
    || input.flags.length > 0
    || input.confidence < 0.8;
  const result = await client.listing.updateMany({
    where: {
      id: input.listingId,
      sellerId: input.sellerId,
      status: "PENDING_REVIEW",
      updatedAt: input.reviewedUpdatedAt,
    },
    data: {
      status: shouldHold
        ? "PENDING_REVIEW"
        : "ACTIVE",
      aiReviewFlags: input.flags,
      aiReviewScore: input.confidence,
    },
  });

  return Object.freeze({
    applied: result.count === 1,
    activated: result.count === 1 && !shouldHold,
  });
}
