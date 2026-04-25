// src/app/api/reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendNewReviewEmail } from "@/lib/email";
import { reviewRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { logSecurityEvent } from "@/lib/security";
import { sanitizeRichText } from "@/lib/sanitize";
import { containsProfanity } from "@/lib/profanity";
import { filterR2PublicUrls, isR2PublicUrl } from "@/lib/urlValidation";
import { z } from "zod";

const ReviewSchema = z.object({
  listingId: z.string().min(1),
  ratingX2: z.number().int().min(2).max(10),
  comment: z.string().max(2000).optional().nullable(),
  photoUrls: z.array(z.string().url().refine(
    (u) => isR2PublicUrl(u),
    { message: "Invalid photo URL" }
  )).max(6).optional(),
});

const REVIEW_WINDOW_DAYS = 90;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewRatelimit, userId);
  if (!success) {
    return rateLimitResponse(reset, "Too many review submissions.");
  }

  let parsed;
  try {
    parsed = ReviewSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { listingId, ratingX2, comment, photoUrls } = parsed;

  // Profanity check (log-only — does not block submission)
  if (comment) {
    const profanityResult = containsProfanity(comment);
    if (profanityResult.flagged) {
      console.error(`[PROFANITY] Review comment flagged — matches: ${profanityResult.matches.join(", ")}`);
    }
  }

  // Who am I?
  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt) return NextResponse.json({ error: "Account is suspended" }, { status: 403 });

  // Prevent reviewing own listing
  const listingForOwnerCheck = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { seller: { select: { userId: true } } },
  });
  if (listingForOwnerCheck?.seller?.userId === me.id) {
    logSecurityEvent("spam_attempt", { userId: me.id, route: "/api/reviews", reason: "self-review attempt" });
    return NextResponse.json({ error: "Cannot review your own listing" }, { status: 403 });
  }

  // Ensure no duplicate review
  const exists = await prisma.review.findFirst({
    where: { listingId, reviewerId: me.id },
    select: { id: true },
  });
  if (exists) return NextResponse.json({ error: "Already reviewed" }, { status: 409 });

  // Gate: must have a PAID + DELIVERED/PICKED_UP order for this listing within 90 days
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const orderItem = await prisma.orderItem.findFirst({
    where: {
      listingId,
      order: {
        buyerId: me.id,
        paidAt: { not: null },
        createdAt: { gte: since },
        fulfillmentStatus: { in: ["DELIVERED", "PICKED_UP"] },
        sellerRefundId: null,
      },
    },
    select: { id: true },
  });
  if (!orderItem) {
    return NextResponse.json({ error: "You can leave a review after your order has been delivered." }, { status: 403 });
  }

  const urls = filterR2PublicUrls(photoUrls ?? [], 6);

  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.review.create({
      data: {
        listingId,
        reviewerId: me.id,
        ratingX2,
        comment: sanitizeRichText((comment ?? "").slice(0, 2000)),
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

    try {
      if (await shouldSendEmail(listing.seller.userId, "EMAIL_NEW_REVIEW")) {
        const sellerUser = await prisma.user.findUnique({
          where: { id: listing.seller.userId },
          select: { email: true, name: true },
        });
        if (sellerUser?.email) {
          await sendNewReviewEmail({
            sellerEmail: sellerUser.email,
            sellerName: sellerUser.name ?? "there",
            buyerName: me.name ?? "A buyer",
            listingTitle: listing.title,
            rating: ratingX2 / 2,
            reviewPreview: (comment ?? "").slice(0, 200),
            reviewUrl: `https://thegrainline.com/listing/${listingId}#reviews`,
          });
        }
      }
    } catch (e) {
      console.error("Failed to send review notification email:", e);
    }
  }

  return NextResponse.json({ ok: true, id: created.id });
}
