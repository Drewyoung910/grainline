import type { ListingStatus, Prisma } from "@prisma/client";

type ListingAiReviewTransitionClient = Pick<Prisma.TransactionClient, "listing">;

export type VersionBoundListingAiReviewInput = Readonly<{
  listingId: string;
  sellerId: string;
  reviewedAt: Date;
  status: ListingStatus;
  flags: readonly string[];
  score: number;
}>;

/**
 * Apply an AI result only to the exact listing version the reviewer saw.
 * Returning false is an expected stale-result outcome; callers must not run
 * activation side effects for that result.
 */
export async function applyVersionBoundListingAiReviewTransition(
  client: ListingAiReviewTransitionClient,
  input: VersionBoundListingAiReviewInput,
) {
  const result = await client.listing.updateMany({
    where: {
      id: input.listingId,
      sellerId: input.sellerId,
      status: "PENDING_REVIEW",
      updatedAt: input.reviewedAt,
    },
    data: {
      status: input.status,
      aiReviewFlags: [...input.flags],
      aiReviewScore: input.score,
    },
  });
  if (result.count !== 0 && result.count !== 1) {
    throw new Error("Listing AI review transition returned an invalid row count");
  }
  return result.count === 1;
}
