// src/app/api/reviews/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ratingX2 = Number(body?.ratingX2);
  const comment = typeof body?.comment === "string" ? body.comment.slice(0, 2000) : null;
  const photos = Array.isArray(body?.photos) ? body.photos.filter((u: unknown) => typeof u === "string" && u) : [];

  if (!Number.isFinite(ratingX2) || ratingX2 < 2 || ratingX2 > 10) {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }

  // ensure owner & editable
  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const r = await prisma.review.findUnique({
    where: { id },
    select: { id: true, reviewerId: true, createdAt: true, listingId: true, sellerReplyAt: true },
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

  await prisma.$transaction(async (tx) => {
    await tx.review.update({
      where: { id },
      data: { ratingX2, comment },
    });

    // Replace photos
    await tx.reviewPhoto.deleteMany({ where: { reviewId: id } });
    await tx.reviewPhoto.createMany({
      data: photos.slice(0, 6).map((url: string, i: number) => ({
        reviewId: id,
        url,
        sortOrder: i,
      })),
    });
  });

  // revalidate listing page
  revalidatePath(`/listing/${r.listingId}`);
  return NextResponse.json({ ok: true });
}
