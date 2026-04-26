// src/app/api/listings/[id]/photos/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { listingMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { isR2PublicUrl } from "@/lib/urlValidation";
import { sanitizeText } from "@/lib/sanitize";
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

  // Enforce max 8 photos total
  const remaining = Math.max(0, 8 - listing.photos.length);
  const toAdd = clean.slice(0, remaining);

  // Determine next sortOrder start
  const startOrder = listing.photos.length;
  await prisma.photo.createMany({
    data: toAdd.map((url, i) => ({
      listingId,
      url,
      sortOrder: startOrder + i,
    })),
  });

  // Re-trigger AI review if listing is ACTIVE (image content changed)
  if (listing.status === ListingStatus.ACTIVE) {
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.PENDING_REVIEW,
        aiReviewFlags: ["pending-ai-review"],
        aiReviewScore: 0,
      },
    });
    try {
      const seller = await prisma.sellerProfile.findFirst({
        where: { listings: { some: { id: listingId } } },
        select: { id: true, displayName: true, chargesEnabled: true, _count: { select: { listings: true } } },
      });
      if (!seller?.chargesEnabled) {
        await prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.DRAFT } });
        revalidatePath("/dashboard");
        revalidatePath(`/dashboard/listings/${listingId}/edit`);
        revalidatePath(`/listing/${listingId}`);
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
        imageUrls: toAdd.slice(0, 4),
      }).catch(() => ({ approved: false, flags: ["AI review error"] as string[], confidence: 0, reason: "AI error" }));

      if (aiResult.approved && aiResult.flags.length === 0 && aiResult.confidence >= 0.8) {
        await prisma.listing.update({
          where: { id: listingId },
          data: { status: ListingStatus.ACTIVE, aiReviewFlags: aiResult.flags, aiReviewScore: aiResult.confidence },
        });
        await prisma.$executeRaw`
          UPDATE "Listing"
          SET status = 'SOLD_OUT'
          WHERE id = ${listingId}
            AND "listingType" = 'IN_STOCK'
            AND COALESCE("stockQuantity", 0) <= 0
            AND status = 'ACTIVE'
        `;
      } else {
        await prisma.listing.update({
          where: { id: listingId },
          data: { status: ListingStatus.PENDING_REVIEW, aiReviewFlags: aiResult.flags, aiReviewScore: aiResult.confidence },
        });
      }
    } catch {
      await prisma.listing.update({
        where: { id: listingId },
        data: { status: ListingStatus.PENDING_REVIEW, aiReviewFlags: ["AI review error"], aiReviewScore: 0 },
      });
    }
  }

  // Generate alt text for new photos (fire-and-forget, non-blocking)
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

  // Revalidate pages that show these photos
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);

  return NextResponse.json({ added: toAdd.length });
}
