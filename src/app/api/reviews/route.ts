// src/app/api/reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendNewReviewEmail } from "@/lib/email";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { reviewRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { logSecurityEvent } from "@/lib/security";
import { sanitizeRichText, truncateText } from "@/lib/sanitize";
import { containsProfanity } from "@/lib/profanity";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { filterFirstPartyMediaUrlsForUser, isFirstPartyMediaUrl } from "@/lib/urlValidation";
import { refreshSellerRatingSummary } from "@/lib/sellerRatingSummary";
import { publicListingPath } from "@/lib/publicPaths";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";

const ReviewPhotoUrlsSchema = z.array(z.string().url().refine(
  (u) => isFirstPartyMediaUrl(u),
  { message: "Invalid photo URL" }
)).max(6).optional();

const ReviewSchema = z.object({
  listingId: z.string().min(1),
  ratingX2: z.number().int().min(2).max(10),
  comment: z.string().max(2000).optional().nullable(),
  photoUrls: ReviewPhotoUrlsSchema,
  photos: ReviewPhotoUrlsSchema,
});

const REVIEW_WINDOW_DAYS = 90;
const REVIEW_BODY_MAX_BYTES = 24 * 1024;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewRatelimit, userId);
  if (!success) {
    return rateLimitResponse(reset, "Too many review submissions.");
  }

  let parsed;
  try {
    parsed = ReviewSchema.parse(await readBoundedJson(req, REVIEW_BODY_MAX_BYTES));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(e)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    throw e;
  }
  const { listingId, ratingX2, comment } = parsed;
  const photoUrls = parsed.photoUrls ?? parsed.photos ?? [];

  // Profanity check (log-only — does not block submission)
  if (comment) {
    const profanityResult = containsProfanity(comment);
    if (profanityResult.flagged) {
      captureProfanityFlag({
        source: "review_create",
        matchCount: profanityResult.matches.length,
        extra: { listingId },
      });
    }
  }

  // Who am I?
  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  // Prevent reviewing own listing
  const listingForOwnerCheck = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      seller: {
        select: {
          userId: true,
          user: { select: { banned: true, deletedAt: true } },
        },
      },
    },
  });
  if (listingForOwnerCheck?.seller?.userId === me.id) {
    logSecurityEvent("spam_attempt", { userId: me.id, route: "/api/reviews", reason: "self-review attempt" });
    return NextResponse.json({ error: "Cannot review your own listing" }, { status: 403 });
  }
  if (listingForOwnerCheck?.seller?.user.banned || listingForOwnerCheck?.seller?.user.deletedAt) {
    logSecurityEvent("account_state_violation", {
      userId: me.id,
      route: "/api/reviews",
      reason: listingForOwnerCheck.seller.user.banned
        ? "review target seller banned"
        : "review target seller deleted",
      listingId,
    });
    return NextResponse.json(
      { error: "Reviews are unavailable for this maker." },
      { status: 403 },
    );
  }

  // Ensure no duplicate review
  const exists = await prisma.review.findFirst({
    where: { listingId, reviewerId: me.id },
    select: { id: true, listing: { select: { sellerId: true } } },
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
        paymentEvents: { none: blockingRefundLedgerWhere() },
      },
    },
    select: { id: true, listing: { select: { sellerId: true } } },
  });
  if (!orderItem) {
    return NextResponse.json({ error: "You can leave a review after your order has been delivered." }, { status: 403 });
  }

  const urls = filterFirstPartyMediaUrlsForUser(photoUrls ?? [], 6, userId, ["reviewPhoto"]);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const r = await tx.review.create({
        data: {
          listingId,
          reviewerId: me.id,
          ratingX2,
          comment: truncateText(sanitizeRichText(comment ?? ""), 2000),
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

      await refreshSellerRatingSummary(orderItem.listing.sellerId, tx);
      return r;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Already reviewed" }, { status: 409 });
    }
    throw error;
  }

  // Notify the seller
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      seller: {
        select: {
          userId: true,
          id: true,
          displayName: true,
          user: { select: { banned: true, deletedAt: true } },
        },
      },
    },
  });
  if (listing?.seller.userId && !listing.seller.user.banned && !listing.seller.user.deletedAt) {
    const stars = (ratingX2 / 2).toFixed(1).replace(".0", "");
    const reviewerName = me.name ?? me.email?.split("@")[0] ?? "Someone";
    try {
      await createNotification({
        userId: listing.seller.userId,
        type: "NEW_REVIEW",
        title: `${reviewerName} left you a ${stars}-star review`,
        body: listing.title,
        link: `${publicListingPath(listingId, listing.title)}#reviews`,
        dedupScope: created.id,
      });
    } catch (e) {
      console.error("Failed to create review notification:", e);
      Sentry.captureException(e, {
        level: "warning",
        tags: { source: "review_notification" },
        extra: { reviewId: created.id, listingId, sellerUserId: listing.seller.userId },
      });
    }

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
            reviewPreview: truncateText(comment ?? "", 200),
            reviewUrl: `https://thegrainline.com${publicListingPath(listingId, listing.title)}#reviews`,
          });
        }
      }
    } catch (e) {
      console.error("Failed to send review notification email:", e);
      Sentry.captureException(e, {
        level: "warning",
        tags: { source: "review_notification_email" },
        extra: { reviewId: created.id, listingId, sellerUserId: listing.seller.userId },
      });
    }
  }

  return NextResponse.json({ ok: true, id: created.id });
}
