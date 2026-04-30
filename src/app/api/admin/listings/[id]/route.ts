import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";

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

  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id);
  if (!success) return rateLimitResponse(reset, "Too many admin actions. Try again shortly.");

  const { id } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, sellerId: true, status: true, isPrivate: true, rejectionReason: true },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Staff removal should not be reversible by the seller. Use REJECTED rather
  // than HIDDEN, and clear buyer-facing references that would otherwise point
  // at a removed listing.
  await prisma.$transaction([
    prisma.favorite.deleteMany({ where: { listingId: id } }),
    prisma.stockNotification.deleteMany({ where: { listingId: id } }),
    prisma.cartItem.deleteMany({ where: { listingId: id } }),
    prisma.listing.update({
      where: { id },
      data: {
        status: "REJECTED",
        isPrivate: true,
        rejectionReason: "Removed by Grainline staff.",
      },
    }),
  ]);

  await logAdminAction({
    adminId: admin.id,
    action: "REMOVE_LISTING",
    targetType: "Listing",
    targetId: id,
    metadata: {
      title: listing.title,
      sellerId: listing.sellerId,
      previousStatus: listing.status,
      previousIsPrivate: listing.isPrivate,
      previousRejectionReason: listing.rejectionReason,
    },
  });

  return NextResponse.json({ ok: true });
}
