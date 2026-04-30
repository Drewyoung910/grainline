// src/app/api/listings/[id]/photos/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  listingMutationRatelimit,
  listingPhotoAiRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { isR2PublicUrl } from "@/lib/urlValidation";
import { sanitizeText } from "@/lib/sanitize";
import { listingPhotoReviewImageUrls } from "@/lib/listingPhotoReview";
import { ListingStatus } from "@prisma/client";
import { z } from "zod";

const PhotosSchema = z.object({
  urls: z.array(z.string().url().refine(
    (u) => isR2PublicUrl(u),
    { message: "Invalid photo URL origin" }
  )).max(8).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me || me.banned || me.deletedAt) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success, reset } = await safeRateLimit(listingMutationRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many listing updates.");

  const { id: listingId } = await ctx.params;

  // Ensure this listing belongs to the signed-in user
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      seller: {
        userId: me.id,
        user: { banned: false, deletedAt: null },
      },
    },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (listing.status === ListingStatus.HIDDEN && listing.isPrivate) {
    return NextResponse.json({ error: "Archived listings cannot be edited." }, { status: 400 });
  }

  let parsed;
  try {
    parsed = PhotosSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const clean = (parsed.urls ?? []).filter(Boolean);

  if (clean.length === 0) {
    return NextResponse.json({ added: 0 });
  }

  if (listing.status === ListingStatus.ACTIVE) {
    const { success: aiSuccess, reset: aiReset } = await safeRateLimit(
      listingPhotoAiRatelimit,
      me.id,
    );
    if (!aiSuccess) return rateLimitResponse(aiReset, "Too many photo review requests.");
  }

  const addResult = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
    const currentListing = await tx.listing.findFirst({
      where: {
        id: listingId,
        seller: {
          userId: me.id,
          user: { banned: false, deletedAt: null },
        },
      },
      select: { status: true, isPrivate: true },
    });
    if (!currentListing) return { urls: [], error: "not-found" as const };
    if (currentListing.status === ListingStatus.HIDDEN && currentListing.isPrivate) {
      return { urls: [], error: "archived" as const };
    }

    const photoCount = await tx.photo.count({ where: { listingId } });
    const urls = clean.slice(0, Math.max(0, 8 - photoCount));
    if (urls.length === 0) return { urls, error: "full" as const };

    await tx.photo.createMany({
      data: urls.map((url, i) => ({
        listingId,
        url,
        sortOrder: photoCount + i,
      })),
    });
    return { urls, error: null };
  });

  if (addResult.error === "not-found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (addResult.error === "archived") {
    return NextResponse.json({ error: "Archived listings cannot be edited." }, { status: 400 });
  }
  if (addResult.urls.length === 0) {
    return NextResponse.json({ added: 0, warning: "Listing already has the maximum number of photos." });
  }
  const toAdd = addResult.urls;

  let generateAltTextForNewPhotos = false;

  // Re-trigger AI review if listing is ACTIVE (image content changed)
  if (listing.status === ListingStatus.ACTIVE) {
    const pending = await prisma.listing.updateMany({
      where: { id: listingId, status: ListingStatus.ACTIVE, updatedAt: listing.updatedAt },
      data: {
        status: ListingStatus.PENDING_REVIEW,
        aiReviewFlags: ["pending-ai-review"],
        aiReviewScore: 0,
      },
    });
    if (pending.count === 0) {
      revalidatePath("/dashboard");
      revalidatePath(`/dashboard/listings/${listingId}/edit`);
      revalidatePath(`/listing/${listingId}`);
      revalidatePath(`/seller/${listing.sellerId}`);
      revalidatePath(`/seller/${listing.sellerId}/shop`);
      return NextResponse.json({ added: toAdd.length, warning: "Listing state changed; refresh and try again." });
    }
    const reviewSnapshot = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { updatedAt: true },
    });
    if (!reviewSnapshot) return NextResponse.json({ added: toAdd.length });
    try {
      const seller = await prisma.sellerProfile.findFirst({
        where: { listings: { some: { id: listingId } } },
        select: { id: true, displayName: true, chargesEnabled: true, _count: { select: { listings: true } } },
      });
      if (!seller?.chargesEnabled) {
        await prisma.listing.updateMany({
          where: { id: listingId, updatedAt: reviewSnapshot.updatedAt, status: ListingStatus.PENDING_REVIEW },
          data: { status: ListingStatus.DRAFT },
        });
        revalidatePath("/dashboard");
        revalidatePath(`/dashboard/listings/${listingId}/edit`);
        revalidatePath(`/listing/${listingId}`);
        revalidatePath(`/seller/${listing.sellerId}`);
        revalidatePath(`/seller/${listing.sellerId}/shop`);
        return NextResponse.json({
          added: toAdd.length,
          warning: "Stripe disconnected — listing moved to draft. Reconnect Stripe to publish.",
        });
      }
      const { reviewListingWithAI } = await import("@/lib/ai-review");
      const aiResult = await reviewListingWithAI({
        sellerId: seller?.id ?? "",
        title: listing.title,
        description: listing.description,
        priceCents: listing.priceCents,
        category: listing.category ?? null,
        tags: listing.tags,
        sellerName: seller?.displayName ?? "Unknown",
        listingCount: seller?._count.listings ?? 0,
        imageUrls: listingPhotoReviewImageUrls(toAdd, listing.photos.map((p) => p.url)),
      }).catch(() => ({ approved: false, flags: ["AI review error"] as string[], confidence: 0, reason: "AI error" }));

      if (aiResult.approved && aiResult.flags.length === 0 && aiResult.confidence >= 0.8) {
        const activated = await prisma.listing.updateMany({
          where: { id: listingId, updatedAt: reviewSnapshot.updatedAt, status: ListingStatus.PENDING_REVIEW },
          data: { status: ListingStatus.ACTIVE, aiReviewFlags: aiResult.flags, aiReviewScore: aiResult.confidence },
        });
        generateAltTextForNewPhotos = activated.count === 1;
        await prisma.$executeRaw`
          UPDATE "Listing"
          SET status = 'SOLD_OUT'
          WHERE id = ${listingId}
            AND "listingType" = 'IN_STOCK'
            AND COALESCE("stockQuantity", 0) <= 0
            AND status = 'ACTIVE'
        `;
      } else {
        await prisma.listing.updateMany({
          where: { id: listingId, updatedAt: reviewSnapshot.updatedAt, status: ListingStatus.PENDING_REVIEW },
          data: { status: ListingStatus.PENDING_REVIEW, aiReviewFlags: aiResult.flags, aiReviewScore: aiResult.confidence },
        });
      }
    } catch {
      await prisma.listing.updateMany({
        where: { id: listingId, updatedAt: reviewSnapshot.updatedAt, status: ListingStatus.PENDING_REVIEW },
        data: { status: ListingStatus.PENDING_REVIEW, aiReviewFlags: ["AI review error"], aiReviewScore: 0 },
      });
    }
  }

  // Generate alt text for new photos (fire-and-forget, non-blocking)
  if (generateAltTextForNewPhotos) {
    try {
      const { generateAltText } = await import("@/lib/ai-review");
      const newPhotos = await prisma.photo.findMany({
        where: { listingId, altText: null, url: { in: toAdd } },
        select: { id: true, url: true },
      });
      for (const p of newPhotos) {
        const alt = await generateAltText(p.url);
        if (alt) {
          const altText = sanitizeText(alt).slice(0, 200);
          if (altText) {
            await prisma.photo.update({ where: { id: p.id }, data: { altText } });
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  // Revalidate pages that show these photos
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);

  return NextResponse.json({ added: toAdd.length });
}
