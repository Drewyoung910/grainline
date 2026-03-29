// src/app/api/listings/[id]/photos/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: listingId } = await ctx.params;

  // Ensure this listing belongs to the signed-in user
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { urls } = (await req.json()) as { urls?: string[] };
  const clean = (urls ?? []).filter(Boolean);

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

  // Revalidate pages that show these photos
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);

  return NextResponse.json({ added: toAdd.length });
}
