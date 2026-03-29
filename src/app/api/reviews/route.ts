// src/app/api/reviews/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";

const REVIEW_WINDOW_DAYS = 90;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listingId, ratingX2, comment, photoUrls } = (await req.json()) as {
    listingId: string;
    ratingX2: number; // 2..10
    comment?: string;
    photoUrls?: string[];
  };

  if (!listingId || !Number.isInteger(ratingX2) || ratingX2 < 2 || ratingX2 > 10) {
    return NextResponse.json({ error: "Bad input" }, { status: 400 });
  }

  // Who am I?
  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Ensure no duplicate review
  const exists = await prisma.review.findFirst({
    where: { listingId, reviewerId: me.id },
    select: { id: true },
  });
  if (exists) return NextResponse.json({ error: "Already reviewed" }, { status: 409 });

  // Gate: must have a PAID order for this listing within 90 days
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const orderItem = await prisma.orderItem.findFirst({
    where: {
      listingId,
      order: {
        buyerId: me.id,
        paidAt: { not: null },
        createdAt: { gte: since },
      },
    },
    select: { id: true },
  });
  if (!orderItem) {
    return NextResponse.json({ error: "Not eligible to review" }, { status: 403 });
  }

  const urls = (photoUrls ?? []).filter(Boolean).slice(0, 6);

  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.review.create({
      data: {
        listingId,
        reviewerId: me.id,
        ratingX2,
        comment: (comment ?? "").slice(0, 2000),
        verified: true,
      },
    });

    if (urls.length) {
      await tx.reviewPhoto.createMany({
        data: urls.map((url, i) => ({
          reviewId: r.id,
          url,
          sortOrder: i,
        })),
      });
    }

    return r;
  });

  // Notify the seller
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { title: true, seller: { select: { userId: true, id: true } } },
  });
  if (listing?.seller.userId) {
    const stars = (ratingX2 / 2).toFixed(1).replace(".0", "");
    const reviewerName = me.name ?? me.email?.split("@")[0] ?? "Someone";
    await createNotification({
      userId: listing.seller.userId,
      type: "NEW_REVIEW",
      title: `${reviewerName} left you a ${stars}-star review`,
      body: listing.title,
      link: `/seller/${listing.seller.id}`,
    });
  }

  return NextResponse.json({ ok: true, id: created.id });
}
