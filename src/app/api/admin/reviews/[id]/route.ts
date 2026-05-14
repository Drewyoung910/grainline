import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";
import { refreshSellerRatingSummary } from "@/lib/sellerRatingSummary";
import { deleteR2ObjectByUrl } from "@/lib/r2";
import { mapWithConcurrency } from "@/lib/concurrency";

function mediaUrlHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

function captureAdminReviewPhotoCleanupFailures({
  results,
  photos,
  reviewId,
}: {
  results: PromiseSettledResult<boolean>[];
  photos: { url: string }[];
  reviewId: string;
}) {
  results.forEach((result, index) => {
    const host = mediaUrlHost(photos[index]?.url ?? "");
    if (result.status === "rejected") {
      Sentry.captureException(result.reason, {
        level: "warning",
        tags: { source: "admin_review_photo_cleanup" },
        extra: { reviewId, host },
      });
      return;
    }
    if (result.value === false) {
      Sentry.captureMessage("Admin review photo cleanup skipped non-R2 media", {
        level: "warning",
        tags: { source: "admin_review_photo_cleanup", host },
        extra: { reviewId },
      });
    }
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const review = await prisma.review.findUnique({
    where: { id },
    select: {
      id: true,
      listingId: true,
      reviewerId: true,
      listing: { select: { sellerId: true } },
    },
  });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const photos = await prisma.reviewPhoto.findMany({
    where: { reviewId: id },
    select: { url: true },
  });

  await prisma.review.delete({ where: { id } });
  try {
    await refreshSellerRatingSummary(review.listing.sellerId);
  } catch (error) {
    console.error("Failed to refresh seller rating summary after admin review delete:", error);
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "admin_review_rating_summary_refresh" },
      extra: { reviewId: id, listingId: review.listingId, sellerId: review.listing.sellerId },
    });
  }
  const cleanupResults = await mapWithConcurrency(photos, 5, (photo) => deleteR2ObjectByUrl(photo.url));
  captureAdminReviewPhotoCleanupFailures({ results: cleanupResults, photos, reviewId: id });

  await logAdminAction({
    adminId: admin.id,
    action: "DELETE_REVIEW",
    targetType: "Review",
    targetId: id,
    metadata: { listingId: review.listingId, reviewerId: review.reviewerId },
  });

  return NextResponse.json({ ok: true });
}
