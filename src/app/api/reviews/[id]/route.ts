// src/app/api/reviews/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sanitizeRichText } from "@/lib/sanitize";
import { isFirstPartyMediaUrlForUser } from "@/lib/urlValidation";
import { rateLimitResponse, reviewRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { deleteR2ObjectByUrl } from "@/lib/r2";
import { refreshSellerRatingSummary } from "@/lib/sellerRatingSummary";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";

const ReviewPhotoUrlsSchema = z.array(z.string().url()).max(6).optional();

const ReviewPatchSchema = z.object({
  ratingX2: z.number().int().min(2).max(10),
  comment: z.string().max(2000).optional().nullable(),
  photos: ReviewPhotoUrlsSchema,
  photoUrls: ReviewPhotoUrlsSchema,
});
const REVIEW_PATCH_BODY_MAX_BYTES = 24 * 1024;

function mediaUrlHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

function captureReviewPhotoCleanupFailures({
  results,
  photos,
  reviewId,
  source,
}: {
  results: PromiseSettledResult<boolean>[];
  photos: { url: string }[];
  reviewId: string;
  source: string;
}) {
  results.forEach((result, index) => {
    const host = mediaUrlHost(photos[index]?.url ?? "");
    if (result.status === "rejected") {
      Sentry.captureException(result.reason, {
        level: "warning",
        tags: { source },
        extra: { reviewId, host },
      });
      return;
    }
    if (result.value === false) {
      Sentry.captureMessage("Review photo cleanup skipped non-R2 media", {
        level: "warning",
        tags: { source, host },
        extra: { reviewId },
      });
    }
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many review edits.");

  let reviewPatchParsed;
  try {
    reviewPatchParsed = ReviewPatchSchema.parse(await readBoundedJson(req, REVIEW_PATCH_BODY_MAX_BYTES));
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
  const { ratingX2, comment } = reviewPatchParsed;
  const photos = reviewPatchParsed.photos ?? reviewPatchParsed.photoUrls ?? [];

  // ensure owner & editable
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt) return NextResponse.json({ error: "Account is suspended" }, { status: 403 });

  const r = await prisma.review.findUnique({
    where: { id },
    select: {
      id: true,
      reviewerId: true,
      createdAt: true,
      listingId: true,
      sellerReplyAt: true,
      listing: { select: { sellerId: true } },
    },
  });
  if (!r || r.reviewerId !== me.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (r.sellerReplyAt) {
    return NextResponse.json({ error: "Locked: seller has replied" }, { status: 403 });
  }
  const days = (Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days > 90) {
    return NextResponse.json({ error: "Edit window expired" }, { status: 403 });
  }

  const oldPhotos = await prisma.reviewPhoto.findMany({
    where: { reviewId: id },
    select: { url: true },
  });
  const oldPhotoUrls = new Set(oldPhotos.map((photo) => photo.url));
  if (photos.some((url) => !oldPhotoUrls.has(url) && !isFirstPartyMediaUrlForUser(url, userId, ["reviewPhoto"]))) {
    return NextResponse.json({ error: "Use uploaded Grainline images only." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.review.update({
      where: { id },
      data: { ratingX2, comment: comment ? sanitizeRichText(comment) : undefined },
    });

    // Replace photos
    await tx.reviewPhoto.deleteMany({ where: { reviewId: id } });
    await tx.reviewPhoto.createMany({
      data: photos.slice(0, 6).map((url, i) => ({
        reviewId: id,
        url,
        sortOrder: i,
      })),
    });

    await refreshSellerRatingSummary(r.listing.sellerId, tx);
  });

  const retainedUrls = new Set(photos);
  const removedPhotos = oldPhotos.filter((photo) => !retainedUrls.has(photo.url));
  const cleanupResults = await mapWithConcurrency(
    removedPhotos,
    5,
    (photo) => deleteR2ObjectByUrl(photo.url),
  );
  captureReviewPhotoCleanupFailures({
    results: cleanupResults,
    photos: removedPhotos,
    reviewId: id,
    source: "review_photo_cleanup_edit",
  });

  // revalidate listing page
  revalidatePath(`/listing/${r.listingId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many review updates.");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt) return NextResponse.json({ error: "Account is suspended" }, { status: 403 });

  const review = await prisma.review.findUnique({
    where: { id },
    select: {
      id: true,
      reviewerId: true,
      listingId: true,
      listing: { select: { sellerId: true } },
    },
  });
  if (!review || review.reviewerId !== me.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photos = await prisma.reviewPhoto.findMany({
    where: { reviewId: id },
    select: { url: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.review.delete({ where: { id } });
    await refreshSellerRatingSummary(review.listing.sellerId, tx);
  });
  const cleanupResults = await mapWithConcurrency(photos, 5, (photo) => deleteR2ObjectByUrl(photo.url));
  captureReviewPhotoCleanupFailures({
    results: cleanupResults,
    photos,
    reviewId: id,
    source: "review_photo_cleanup_delete",
  });

  revalidatePath(`/listing/${review.listingId}`);
  revalidatePath("/account/reviews");
  return NextResponse.json({ ok: true });
}
