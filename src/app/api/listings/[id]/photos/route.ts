// src/app/api/listings/[id]/photos/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { listingMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { z } from "zod";

const R2_ORIGIN = process.env.CLOUDFLARE_R2_PUBLIC_URL ?? "";

const PhotosSchema = z.object({
  urls: z.array(z.string().url().refine(
    (u) => !R2_ORIGIN || u.startsWith(R2_ORIGIN),
    { message: "Invalid photo URL origin" }
  )).max(8).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success, reset } = await safeRateLimit(listingMutationRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many listing updates.");

  const { id: listingId } = await ctx.params;

  // Ensure this listing belongs to the signed-in user
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
  if (listing.status === "ACTIVE") {
    try {
      const allPhotos = await prisma.photo.findMany({
        where: { listingId },
        select: { url: true },
        orderBy: { sortOrder: "asc" },
        take: 4,
      });
      const seller = await prisma.sellerProfile.findFirst({
        where: { listings: { some: { id: listingId } } },
        select: { id: true, displayName: true, chargesEnabled: true, _count: { select: { listings: true } } },
      });
      if (!seller?.chargesEnabled) {
        await prisma.listing.update({ where: { id: listingId }, data: { status: "DRAFT" } });
        revalidatePath("/dashboard");
        revalidatePath(`/dashboard/listings/${listingId}/edit`);
        revalidatePath(`/listing/${listingId}`);
        return NextResponse.json({ added: toAdd.length });
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
        imageUrls: allPhotos.map((p) => p.url),
      }).catch(() => ({ approved: false, flags: ["AI review error"] as string[], confidence: 0, reason: "AI error" }));

      if (!aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8) {
        await prisma.listing.update({
          where: { id: listingId },
          data: { status: "PENDING_REVIEW", aiReviewFlags: aiResult.flags, aiReviewScore: aiResult.confidence },
        });
      }
    } catch { /* non-fatal */ }
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
        await prisma.photo.update({ where: { id: p.id }, data: { altText: alt } });
      }
    }
  } catch { /* non-fatal */ }

  // Revalidate pages that show these photos
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);

  return NextResponse.json({ added: toAdd.length });
}
