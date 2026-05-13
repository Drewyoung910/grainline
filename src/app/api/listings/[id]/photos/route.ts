// src/app/api/listings/[id]/photos/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  listingPhotoAiRatelimit,
  listingMutationRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { isFirstPartyMediaUrl } from "@/lib/urlValidation";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { revalidateListingSearchCaches } from "@/lib/searchCache";
import { ListingStatus } from "@prisma/client";
import { z } from "zod";

const PhotosSchema = z.object({
  urls: z.array(z.string().url().refine(
    (u) => isFirstPartyMediaUrl(u),
    { message: "Invalid photo URL origin" }
  )).max(10).optional(),
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
    const aiLimit = await safeRateLimit(listingPhotoAiRatelimit, userId);
    if (!aiLimit.success) {
      return rateLimitResponse(aiLimit.reset, "Too many photo review attempts. Try again later.");
    }
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
    if (!currentListing) return { urls: [], error: "not-found" as const, reviewRequired: false };
    if (currentListing.status === ListingStatus.HIDDEN && currentListing.isPrivate) {
      return { urls: [], error: "archived" as const, reviewRequired: false };
    }

    const photoCount = await tx.photo.count({ where: { listingId } });
    const urls = clean.slice(0, Math.max(0, 10 - photoCount));
    if (urls.length === 0) return { urls, error: "full" as const, reviewRequired: false };

    await tx.photo.createMany({
      data: urls.map((url, i) => ({
        listingId,
        url,
        // New uploads through AddPhotosButton don't crop — `url` IS the
        // pre-crop original. Preserving it now means future re-crops can
        // zoom back out to the full frame.
        originalUrl: url,
        sortOrder: photoCount + i,
      })),
    });
    return {
      urls,
      error: null,
      reviewRequired: currentListing.status === ListingStatus.ACTIVE,
    };
  });

  if (addResult.error === "not-found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (addResult.error === "archived") {
    return NextResponse.json({ error: "Archived listings cannot be edited." }, { status: 400 });
  }
  if (addResult.urls.length === 0) {
    return NextResponse.json({ added: 0, warning: "Listing already has the maximum number of photos." });
  }
  const toAdd = addResult.urls;

  let finalStatus: ListingStatus | null = null;

  // New public photos on ACTIVE listings must go through the same content
  // review gate as publish/save. Otherwise a seller could publish a clean
  // listing and then attach unreviewed public images through this endpoint.
  if (addResult.reviewRequired) {
    const held = await prisma.listing.updateMany({
      where: { id: listingId, status: ListingStatus.ACTIVE },
      data: {
        status: ListingStatus.PENDING_REVIEW,
        aiReviewFlags: ["Photo review in progress"],
        aiReviewScore: 0,
      },
    });

    if (held.count > 0) {
      finalStatus = ListingStatus.PENDING_REVIEW;
      try {
        const reviewTarget = await prisma.listing.findUnique({
          where: { id: listingId },
          select: {
            title: true,
            description: true,
            priceCents: true,
            category: true,
            tags: true,
            sellerId: true,
            seller: {
              select: {
                id: true,
                displayName: true,
                chargesEnabled: true,
                _count: { select: { listings: true } },
              },
            },
            photos: {
              orderBy: { sortOrder: "asc" },
              take: 10,
              select: { url: true },
            },
          },
        });

        if (!reviewTarget?.seller.chargesEnabled) {
          await prisma.listing.updateMany({
            where: { id: listingId, status: ListingStatus.PENDING_REVIEW },
            data: { status: ListingStatus.DRAFT },
          });
          finalStatus = ListingStatus.DRAFT;
        } else {
          const { reviewListingWithAI } = await import("@/lib/ai-review");
          const aiResult = await reviewListingWithAI({
            sellerId: reviewTarget.seller.id,
            title: reviewTarget.title,
            description: reviewTarget.description,
            priceCents: reviewTarget.priceCents,
            category: reviewTarget.category ?? null,
            tags: reviewTarget.tags,
            sellerName: reviewTarget.seller.displayName,
            listingCount: reviewTarget.seller._count.listings,
            imageUrls: reviewTarget.photos.map((p) => p.url),
          }).catch(() => ({
            approved: false,
            flags: ["AI review error"] as string[],
            confidence: 0,
            reason: "AI error",
            altTexts: [] as string[],
          }));

          const { backfillEmptyAltTexts } = await import("@/lib/photoAltTextBackfill");
          await backfillEmptyAltTexts(listingId, aiResult.altTexts);

          const shouldHold =
            !aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8;
          await prisma.listing.updateMany({
            where: { id: listingId, status: ListingStatus.PENDING_REVIEW },
            data: shouldHold
              ? {
                  aiReviewFlags: aiResult.flags,
                  aiReviewScore: aiResult.confidence,
                }
              : {
                  status: ListingStatus.ACTIVE,
                  aiReviewFlags: aiResult.flags,
                  aiReviewScore: aiResult.confidence,
                },
          });
          finalStatus = shouldHold ? ListingStatus.PENDING_REVIEW : ListingStatus.ACTIVE;
        }
      } catch (error) {
        console.error("[listing photo add] AI re-review failed:", error);
        await prisma.listing.updateMany({
          where: { id: listingId, status: ListingStatus.PENDING_REVIEW },
          data: {
            aiReviewFlags: ["AI review error"],
            aiReviewScore: 0,
          },
        });
        finalStatus = ListingStatus.PENDING_REVIEW;
      }
    }
  }

  // Generate alt text for newly-added photos when the seller didn't provide
  // their own. Cheap fire-and-forget — non-blocking on errors.
  try {
    const { generateAltText } = await import("@/lib/ai-review");
    const newPhotos = await prisma.photo.findMany({
      where: { listingId, altText: null, url: { in: toAdd } },
      select: { id: true, url: true },
    });
    for (const p of newPhotos) {
      const alt = await generateAltText(p.url);
      if (alt) {
        const altText = truncateText(sanitizeText(alt), 200);
        if (altText) {
          await prisma.photo.update({ where: { id: p.id }, data: { altText } });
        }
      }
    }
  } catch { /* non-fatal */ }

  // Revalidate pages that show these photos
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
  if (finalStatus) revalidateListingSearchCaches();

  return NextResponse.json({ added: toAdd.length, status: finalStatus });
}
