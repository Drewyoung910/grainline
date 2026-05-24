import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { logAdminActionOrThrow } from "@/lib/audit";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { expireOpenCheckoutSessionsForListing } from "@/lib/checkoutSessionExpiry";
import { syncGuildMemberListingThreshold } from "@/lib/guildListingThreshold";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || admin.role !== "ADMIN") {
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
  await prisma.$transaction(async (tx) => {
    await tx.favorite.deleteMany({ where: { listingId: id } });
    await tx.stockNotification.deleteMany({ where: { listingId: id } });
    await tx.cartItem.deleteMany({ where: { listingId: id } });
    await tx.listing.update({
      where: { id },
      data: {
        status: "REJECTED",
        isPrivate: true,
        rejectionReason: "Removed by Grainline staff.",
      },
    });
    await logAdminActionOrThrow({
      client: tx,
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
  });

  await syncGuildMemberListingThreshold(listing.sellerId).catch((error) => {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "admin_listing_remove_guild_threshold" },
      extra: { listingId: id, sellerId: listing.sellerId },
    });
  });

  after(async () => {
    await expireOpenCheckoutSessionsForListing({
      listingId: id,
      sellerId: listing.sellerId,
      source: "admin_listing_remove",
    });
  });

  return NextResponse.json({ ok: true });
}
