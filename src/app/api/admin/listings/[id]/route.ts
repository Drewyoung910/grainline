import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { logAdminActionOrThrow } from "@/lib/audit";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { expireOpenCheckoutSessionsForListing } from "@/lib/checkoutSessionExpiry";
import { syncGuildMemberListingThreshold } from "@/lib/guildListingThreshold";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || admin.role !== "ADMIN") {
    return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many admin actions. Try again shortly."));

  const { id } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, sellerId: true, status: true, isPrivate: true, rejectionReason: true },
  });
  if (!listing) return privateJson({ error: "Not found" }, { status: HTTP_STATUS.NOT_FOUND });

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

  revalidatePath("/browse");
  revalidatePath(`/listing/${id}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
  revalidateListingSearchCaches();
  revalidateFeaturedMakerCaches();

  after(async () => {
    await expireOpenCheckoutSessionsForListing({
      listingId: id,
      sellerId: listing.sellerId,
      source: "admin_listing_remove",
    });
  });

  return privateJson({ ok: true });
}
