// src/app/api/reviews/[id]/vote/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { rateLimitResponse, reviewVoteRatelimit, safeRateLimit } from "@/lib/ratelimit";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; // review id
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewVoteRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many review votes.");

  const me = await ensureUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const review = await prisma.review.findUnique({
    where: { id },
    include: { listing: { select: { id: true, seller: { select: { userId: true } } } } },
  });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Don't allow voting on your own review
  if (review.reviewerId === me.id) {
    return NextResponse.json({ error: "Cannot vote own review" }, { status: 400 });
  }

  // Optional gate: only buyers of this listing can vote (helpful)
  const hasBought = await prisma.orderItem.findFirst({
    where: { listingId: review.listingId, order: { buyerId: me.id, paidAt: { not: null } } },
    select: { id: true },
  });
  if (!hasBought) {
    return NextResponse.json({ error: "Only buyers can vote" }, { status: 403 });
  }

  let updated: { helpfulCount: number; voted: boolean };
  try {
    updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.reviewVote.findUnique({
        where: { reviewId_userId: { reviewId: id, userId: me.id } },
      });

      if (existing) {
        await tx.reviewVote.delete({
          where: { reviewId_userId: { reviewId: id, userId: me.id } },
        });
        const reviewUpdated = await tx.review.update({
          where: { id },
          data: { helpfulCount: { decrement: 1 } },
          select: { helpfulCount: true },
        });
        return { helpfulCount: reviewUpdated.helpfulCount, voted: false };
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
      return NextResponse.json({ ok: true, helpfulCount: current?.helpfulCount ?? review.helpfulCount, voted: true });
    }
    throw error;
  }

  return NextResponse.json({ ok: true, helpfulCount: updated.helpfulCount, voted: updated.voted });
}
