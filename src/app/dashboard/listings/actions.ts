"use server";

// Seller listing actions used by the Workshop Listings page.
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { ListingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { deleteListingWithCleanup, listingDeletePublicError } from "@/lib/listingDelete";
import { expireOpenCheckoutSessionsForListing } from "@/lib/checkoutSessionExpiry";
import { deleteListingBlockReason, hideListingBlockReason, withdrawReviewBlockReason } from "@/lib/listingActionState";
import { listingMutationRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import { syncGuildMemberListingThreshold } from "@/lib/guildListingThreshold";
import { logServerError } from "@/lib/serverErrorLogger";
import {
  listingOwnerActionState,
  listingOwnerTransition,
} from "@/lib/listingOwnerAccess";

type DashboardActionState = { ok: boolean; error?: string };

// Server action: set status (Active / Hidden / Sold)
export async function setStatus(
  listingId: string,
  nextStatus: ListingStatus,
  _prevState?: unknown,
  _formData?: FormData,
): Promise<DashboardActionState> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to update listings." };

  const { success } = await safeRateLimit(listingMutationRatelimit, userId);
  if (!success) return { ok: false, error: "Too many listing updates. Try again shortly." };

  // ensure ownership
  const me = await userClerkGate(prisma, userId);
  if (!me) return { ok: false, error: "Account not found." };
  if (me.banned || me.deletedAt) return { ok: false, error: "Account access is restricted." };
  const listing = await listingOwnerActionState(me.id, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
  if (listing.archivedAt) {
    return { ok: false, error: "Archived listings cannot be changed here." };
  }

  // Seller-initiated reactivation must go through publishListingAction so AI/admin
  // moderation cannot be bypassed by forged server-action posts.
  if (nextStatus === ListingStatus.ACTIVE) {
    return { ok: false, error: "Use Resubmit to make listings active." };
  }
  if (nextStatus === ListingStatus.HIDDEN) {
    const blockReason = hideListingBlockReason(listing);
    if (blockReason) return { ok: false, error: blockReason };
  } else if (nextStatus === ListingStatus.SOLD) {
    if (listing.status !== ListingStatus.ACTIVE && listing.status !== ListingStatus.SOLD_OUT) {
      return { ok: false, error: "Only active or sold-out listings can be marked sold." };
    }
  } else {
    return { ok: false, error: "That status change is not available here." };
  }

  const updated = await listingOwnerTransition(me.id, {
    listingId,
    operation: nextStatus === ListingStatus.HIDDEN ? "HIDE" : "MARK_SOLD",
  });
  if (!updated) {
    return { ok: false, error: "Listing changed in another tab. Refresh and try again." };
  }

  after(() =>
    expireOpenCheckoutSessionsForListing({
      listingId,
      sellerId: listing.sellerId,
      source: nextStatus === ListingStatus.HIDDEN ? "listing_hide" : "listing_mark_sold",
    }),
  );

  await syncGuildMemberListingThreshold(listing.sellerId);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/listings");
  revalidatePath("/browse");
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
  revalidateListingSearchCaches();
  revalidateFeaturedMakerCaches();

  return { ok: true };
}

// Server action: delete listing
export async function deleteListing(
  listingId: string,
  _prevState?: unknown,
  _formData?: FormData,
): Promise<DashboardActionState> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to delete listings." };

  const { success } = await safeRateLimit(listingMutationRatelimit, userId);
  if (!success) return { ok: false, error: "Too many listing updates. Try again shortly." };

  const me = await userClerkGate(prisma, userId);
  if (!me) return { ok: false, error: "Account not found." };
  if (me.banned || me.deletedAt) return { ok: false, error: "Account access is restricted." };
  const listing = await listingOwnerActionState(me.id, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
  const blockReason = deleteListingBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };

  let outcome: "deleted" | "archived";
  try {
    outcome = await deleteListingWithCleanup(listingId, me.id);
  } catch (err) {
    logServerError(err, {
      source: "seller_listing_delete",
      extra: { listingId, sellerId: listing.sellerId },
    });
    return {
      ok: false,
      error: listingDeletePublicError(err) ?? "Could not delete this listing. Please try again.",
    };
  }

  after(() =>
    expireOpenCheckoutSessionsForListing({
      listingId,
      sellerId: listing.sellerId,
      source: outcome === "archived" ? "listing_delete_archive" : "listing_delete_hard",
    }),
  );

  await syncGuildMemberListingThreshold(listing.sellerId).catch((error) => {
    logServerError(error, {
      source: "seller_listing_delete_guild_threshold",
      extra: { listingId, sellerId: listing.sellerId },
    });
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/listings");
  revalidatePath("/browse");
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
  revalidateListingSearchCaches();
  revalidateFeaturedMakerCaches();

  return { ok: true };
}

export async function withdrawListingReview(
  listingId: string,
  _prevState?: unknown,
  _formData?: FormData,
): Promise<DashboardActionState> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to withdraw listings." };

  const { success } = await safeRateLimit(listingMutationRatelimit, userId);
  if (!success) return { ok: false, error: "Too many listing updates. Try again shortly." };

  const me = await userClerkGate(prisma, userId);
  if (!me) return { ok: false, error: "Account not found." };
  if (me.banned || me.deletedAt) return { ok: false, error: "Account access is restricted." };
  const listing = await listingOwnerActionState(me.id, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
  const blockReason = withdrawReviewBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };

  const updated = await listingOwnerTransition(me.id, {
    listingId,
    operation: "WITHDRAW_REVIEW",
    expectedUpdatedAt: listing.updatedAt,
  });
  if (!updated) {
    return { ok: false, error: "Listing changed in another tab. Refresh and try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/listings");
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);

  return { ok: true };
}
