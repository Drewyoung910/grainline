// src/app/api/listings/[id]/photos/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  listingMutationRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { isFirstPartyMediaUrl } from "@/lib/urlValidation";
import { sanitizeText, truncateText } from "@/lib/sanitize";
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
    const urls = clean.slice(0, Math.max(0, 10 - photoCount));
    if (urls.length === 0) return { urls, error: "full" as const };

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

  // Note: adding photos to an ACTIVE listing used to auto-flip the listing
  // into PENDING_REVIEW and re-run AI review. Removed 2026-05-11 — sellers
  // can keep adding/editing photos freely without triggering a re-review.
  // AI review only runs at explicit publish transitions
  // (publishListingAction for DRAFT/HIDDEN/REJECTED → ACTIVE, and the
  // initial new-listing publish flow). Photo-swap surveillance is admin-side.

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

  return NextResponse.json({ added: toAdd.length });
}
