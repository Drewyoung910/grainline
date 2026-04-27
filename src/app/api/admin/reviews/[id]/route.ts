import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";
import { refreshSellerRatingSummary } from "@/lib/sellerRatingSummary";
import { deleteR2ObjectByUrl } from "@/lib/r2";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true },
  });
  if (!admin || admin.role !== "ADMIN") {
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
  }
  await Promise.allSettled(photos.map((photo) => deleteR2ObjectByUrl(photo.url)));

  await logAdminAction({
    adminId: admin.id,
    action: "DELETE_REVIEW",
    targetType: "Review",
    targetId: id,
    metadata: { listingId: review.listingId, reviewerId: review.reviewerId },
  });

  return NextResponse.json({ ok: true });
}
