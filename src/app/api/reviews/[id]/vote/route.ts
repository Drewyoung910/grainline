// src/app/api/reviews/[id]/vote/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; // review id
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
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

  // Toggle helpful vote (value=+1)
  const existing = await prisma.reviewVote.findUnique({
    where: { reviewId_userId: { reviewId: id, userId: me.id } },
  });

  const updated = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.reviewVote.delete({
        where: { reviewId_userId: { reviewId: id, userId: me.id } },
      });
      return tx.review.update({
        where: { id },
        data: { helpfulCount: { decrement: 1 } },
        select: { helpfulCount: true },
      });
    }
    await tx.reviewVote.create({
      data: { reviewId: id, userId: me.id, value: 1 },
    });
    return tx.review.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true },
    });
  });

  return NextResponse.json({ ok: true, helpfulCount: updated.helpfulCount, voted: !existing });
}
