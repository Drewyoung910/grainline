import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { rateLimitResponse, reviewVoteRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { canViewListingDetail } from "@/lib/listingVisibility";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; // review id
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewVoteRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many review votes."));

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const review = await prisma.review.findUnique({
    where: { id },
    select: {
      reviewerId: true,
      helpfulCount: true,
      listing: {
        select: {
          id: true,
          status: true,
          isPrivate: true,
          reservedForUserId: true,
          seller: {
            select: {
              userId: true,
              chargesEnabled: true,
              stripeAccountVersion: true,
              vacationMode: true,
              user: { select: { id: true, clerkId: true, banned: true, deletedAt: true } },
            },
          },
        },
      },
    },
  });
  if (!review) return privateJson({ error: "Not found" }, { status: 404 });
  if (!canViewListingDetail(review.listing, { dbUserId: me.id })) {
    return privateJson({ error: "Not found" }, { status: 404 });
  }

  // Don't allow voting on your own review
  if (review.reviewerId === me.id) {
    return privateJson({ error: "Cannot vote own review" }, { status: 400 });
  }
  // Don't allow the seller to vote helpful on reviews of their own listing
  // (would let sellers boost their best reviews).
  if (review.listing.seller.userId === me.id) {
    return privateJson({ error: "Cannot vote on your own listing" }, { status: 400 });
  }

  let updated: { helpfulCount: number; voted: boolean };
  try {
    updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.reviewVote.findUnique({
        where: { reviewId_userId: { reviewId: id, userId: me.id } },
      });

      if (existing) {
        const deleted = await tx.reviewVote.deleteMany({
          where: { reviewId: id, userId: me.id },
        });
        if (deleted.count === 1) {
          await tx.$executeRaw`
            UPDATE "Review"
            SET "helpfulCount" = GREATEST("helpfulCount" - 1, 0)
            WHERE id = ${id}
          `;
        }
        const reviewUpdated = await tx.review.findUnique({
          where: { id },
          select: { helpfulCount: true },
        });
        return { helpfulCount: reviewUpdated?.helpfulCount ?? 0, voted: false };
      }
      await tx.reviewVote.create({
        data: { reviewId: id, userId: me.id, value: 1 },
      });
      const reviewUpdated = await tx.review.update({
        where: { id },
        data: { helpfulCount: { increment: 1 } },
        select: { helpfulCount: true },
      });
      return { helpfulCount: reviewUpdated.helpfulCount, voted: true };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const current = await prisma.review.findUnique({
        where: { id },
        select: { helpfulCount: true },
      });
      return privateJson({ ok: true, helpfulCount: current?.helpfulCount ?? review.helpfulCount, voted: true });
    }
    throw error;
  }

  return privateJson({ ok: true, helpfulCount: updated.helpfulCount, voted: updated.voted });
}
