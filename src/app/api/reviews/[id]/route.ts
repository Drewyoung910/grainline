// src/app/api/reviews/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sanitizeRichText } from "@/lib/sanitize";
import { isR2PublicUrl } from "@/lib/urlValidation";
import { rateLimitResponse, reviewRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { deleteR2ObjectByUrl } from "@/lib/r2";
import { refreshSellerRatingSummary } from "@/lib/sellerRatingSummary";
import { mapWithConcurrency } from "@/lib/concurrency";

const ReviewPatchSchema = z.object({
  ratingX2: z.number().int().min(2).max(10),
  comment: z.string().max(2000).optional().nullable(),
  photos: z.array(
    z.string().url().refine((url) => isR2PublicUrl(url), { message: "Invalid image URL" })
  ).max(6).optional(),
});

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
    reviewPatchParsed = ReviewPatchSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { ratingX2, comment, photos = [] } = reviewPatchParsed;

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
  });
  try {
    await refreshSellerRatingSummary(r.listing.sellerId);
  } catch (error) {
    console.error("Failed to refresh seller rating summary after review edit:", error);
  }

  const retainedUrls = new Set(photos);
  await mapWithConcurrency(
    oldPhotos.filter((photo) => !retainedUrls.has(photo.url)),
    5,
    (photo) => deleteR2ObjectByUrl(photo.url),
  );

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

  await prisma.review.delete({ where: { id } });
  try {
    await refreshSellerRatingSummary(review.listing.sellerId);
  } catch (error) {
    console.error("Failed to refresh seller rating summary after review delete:", error);
  }
  await mapWithConcurrency(photos, 5, (photo) => deleteR2ObjectByUrl(photo.url));

  revalidatePath(`/listing/${review.listingId}`);
  revalidatePath("/account/reviews");
  return NextResponse.json({ ok: true });
}
