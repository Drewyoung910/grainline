import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { logAdminActionOrThrow } from "@/lib/audit";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { expireOpenCheckoutSessionsForListing } from "@/lib/checkoutSessionExpiry";
import { syncGuildMemberListingThreshold } from "@/lib/guildListingThreshold";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { withDbUserContext } from "@/lib/dbUserContext";
import { deleteCartItemsForAdminListing } from "@/lib/cartServiceAccess";
import { deleteStockNotificationsForAdminListing } from "@/lib/stockNotificationAccess";
import { deleteFavoritesForAdminListing } from "@/lib/favoriteAccess";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import { sellerStaffListingDetailProfile } from "@/lib/sellerProfileListingDetailAccess";
import { isInvalidJsonBodyError, isRequestBodyTooLargeError, readBoundedJson } from "@/lib/requestBody";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { z } from "zod";

const RemoveListingSchema = z.object({ reason: z.string().max(500) });
const REMOVE_LISTING_BODY_MAX_BYTES = 16 * 1024;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const admin = await userClerkGate(prisma, userId);
  if (!admin || admin.banned || admin.deletedAt || admin.role !== "ADMIN") {
    return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many admin actions. Try again shortly."));

  let reason: string;
  try {
    const body = RemoveListingSchema.parse(await readBoundedJson(request, REMOVE_LISTING_BODY_MAX_BYTES));
    reason = truncateText(sanitizeText(body.reason), 500).trim();
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (isInvalidJsonBodyError(error) || error instanceof z.ZodError) {
      return privateJson({ error: "A reason is required." }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    throw error;
  }
  if (!reason) return privateJson({ error: "A reason is required." }, { status: HTTP_STATUS.BAD_REQUEST });

  const { id } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, sellerId: true, status: true, isPrivate: true, rejectionReason: true },
  });
  if (!listing) return privateJson({ error: "Not found" }, { status: HTTP_STATUS.NOT_FOUND });

  // Staff removal should not be reversible by the seller. Use REJECTED rather
  // than HIDDEN, and clear buyer-facing references that would otherwise point
  // at a removed listing.
  const auditId = await withDbUserContext(admin.id, async (tx) => {
    await tx.listing.update({
      where: { id },
      data: {
        status: "REJECTED",
        isPrivate: true,
        rejectionReason: "Removed by Grainline staff.",
      },
    });
    await deleteFavoritesForAdminListing(tx, id);
    await deleteStockNotificationsForAdminListing(tx, id);
    await deleteCartItemsForAdminListing(tx, id);
    return logAdminActionOrThrow({
      client: tx,
      adminId: admin.id,
      action: "REMOVE_LISTING",
      targetType: "Listing",
      targetId: id,
      reason,
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

  // The maker cannot edit a removed listing, so this is how they learn why.
  try {
    const seller = await sellerStaffListingDetailProfile(getOrderStaffReadClient(), admin.id, id);
    if (seller) {
      await createNotification({
        userId: seller.userId,
        type: "LISTING_REJECTED",
        title: "Listing removed",
        body: `Grainline staff removed your listing "${listing.title}". Reason: ${reason}. Contact support@thegrainline.com if you think this is a mistake.`,
        link: "/dashboard",
        sourceType: NOTIFICATION_SOURCE_TYPES.LISTING_ADMIN_REVIEW,
        sourceId: auditId,
      });
    }
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "admin_listing_remove_notification" },
      extra: { listingId: id, sellerId: listing.sellerId },
    });
  }

  return privateJson({ ok: true });
}
