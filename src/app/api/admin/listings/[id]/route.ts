import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { expireOpenCheckoutSessionsForListing } from "@/lib/checkoutSessionExpiry";
import { syncGuildMemberListingThreshold } from "@/lib/guildListingThreshold";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import { sellerProfileStaffListingRemovalTransition } from "@/lib/sellerProfileStaffAccess";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";

const RemoveListingSchema = z.object({
  reviewedAt: z.iso.datetime({ offset: true }),
});
const ADMIN_LISTING_REMOVE_BODY_MAX_BYTES = 4 * 1024;

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

  const { id } = await params;
  let body;
  try {
    body = RemoveListingSchema.parse(
      await readBoundedJson(request, ADMIN_LISTING_REMOVE_BODY_MAX_BYTES),
    );
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson(
        { error: "Request body too large" },
        { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
      );
    }
    if (isInvalidJsonBodyError(error)) {
      return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    if (error instanceof z.ZodError) {
      return privateJson(
        { error: "Invalid input", details: error.issues },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    throw error;
  }
  const { reviewedAt } = body;

  // Staff removal should not be reversible by the seller. Use REJECTED rather
  // than HIDDEN, and clear buyer-facing references that would otherwise point
  // at a removed listing.
  const transition = await sellerProfileStaffListingRemovalTransition(
    getOrderStaffReadClient(),
    {
      actorId: admin.id,
      listingId: id,
      reviewedAt: new Date(reviewedAt),
    },
  );
  if (!transition) {
    return privateJson({ error: "Not found" }, { status: HTTP_STATUS.NOT_FOUND });
  }
  if (transition.blockReason === "LISTING_VERSION_CHANGED") {
    return privateJson(
      { error: "Listing changed after this review card loaded. Refresh and review the current version." },
      { status: HTTP_STATUS.CONFLICT },
    );
  }
  if (!transition.applied || !transition.auditId) {
    throw new Error("Listing removal transition did not return its audit authority");
  }
  const listing = transition.listing;

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
