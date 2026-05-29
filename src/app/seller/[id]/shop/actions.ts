"use server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { softDeleteListingWithCleanup } from "@/lib/listingSoftDelete";
import { ListingStatus, ListingType } from "@prisma/client";
import { fanOutListingToFollowers } from "@/lib/followerListingNotifications";
import {
  STAFF_REMOVAL_REJECTION_REASON,
  archiveListingBlockReason,
  hideListingBlockReason,
  markAvailableBlockReason,
  publishListingBlockReason,
  unhideListingBlockReason,
  withdrawReviewBlockReason,
} from "@/lib/listingActionState";
import { backfillEmptyAltTexts } from "@/lib/photoAltTextBackfill";
import { maybeGrantFoundingMaker } from "@/lib/foundingMaker";
import { expireOpenCheckoutSessionsForListing } from "@/lib/checkoutSessionExpiry";
import { listingMutationRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { syncGuildMemberListingThreshold } from "@/lib/guildListingThreshold";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";

const REPUBLISH_NOTIFY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

async function findOwnedListing(listingId: string, ownerId: string) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing || listing.seller.userId !== ownerId) return null;
  return listing;
}

type OwnedListing = NonNullable<Awaited<ReturnType<typeof findOwnedListing>>>;
type OwnedListingResult =
  | { ok: true; listing: OwnedListing }
  | { ok: false; error: string };

// Ensure the calling user owns this listing and the action is rate-limited.
async function getOwnedListing(listingId: string): Promise<OwnedListingResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to update listings." };

  const { success } = await safeRateLimit(listingMutationRatelimit, userId);
  if (!success) return { ok: false, error: "Too many listing updates. Try again shortly." };

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return { ok: false, error: "Account not found." };
  if (me.banned || me.deletedAt) return { ok: false, error: "Account access is restricted." };

  const listing = await findOwnedListing(listingId, me.id);
  if (!listing) return { ok: false, error: "Listing not found." };
  return { ok: true, listing };
}

function revalidateListingSurfaces(listingId: string, sellerId: string) {
  revalidateListingSearchCaches();
  revalidateFeaturedMakerCaches();
  revalidatePath(`/seller/${sellerId}/shop`);
  revalidatePath(`/seller/${sellerId}`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath("/dashboard");
  revalidatePath("/browse");
}

function queueCheckoutSessionExpiryForListing(listingId: string, sellerId: string, source: string) {
  after(() =>
    expireOpenCheckoutSessionsForListing({
      listingId,
      sellerId,
      source,
    }),
  );
}

function shouldNotifyFollowersOnActivation(listing: { status: ListingStatus; updatedAt: Date }) {
  if (
    listing.status === ListingStatus.DRAFT ||
    listing.status === ListingStatus.PENDING_REVIEW ||
    listing.status === ListingStatus.REJECTED
  ) {
    return true;
  }
  if (listing.status === ListingStatus.HIDDEN) {
    return Date.now() - listing.updatedAt.getTime() >= REPUBLISH_NOTIFY_AFTER_MS;
  }
  return false;
}

function queueFollowerFanoutForActiveListing(listing: {
  id: string;
  title: string;
  priceCents: number;
  currency: string | null;
  sellerId: string;
  seller: { displayName: string | null };
}) {
  after(async () => {
    try {
      const emailBucket = new Date().toISOString().slice(0, 10);
      await fanOutListingToFollowers({
        sellerProfileId: listing.sellerId,
        sellerDisplayName: listing.seller.displayName,
        listing,
        emailDedupKey: (followerId) => `followed-listing-active:${listing.id}:${followerId}:${emailBucket}`,
      });
    } catch (error) {
      // Non-fatal: listing activation should not roll back if follower fan-out fails.
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "listing_activation_follower_fanout" },
        extra: { listingId: listing.id, sellerProfileId: listing.sellerId },
      });
    }
  });
}

async function syncThreshold(sellerId: string) {
  await syncGuildMemberListingThreshold(sellerId);
}

export async function hideListingAction(listingId: string) {
  const owned = await getOwnedListing(listingId);
  if (!owned.ok) return { ok: false, error: owned.error };
  const listing = owned.listing;
  const blockReason = hideListingBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };
  const result = await prisma.listing.updateMany({
    where: { id: listingId, sellerId: listing.sellerId, status: ListingStatus.ACTIVE },
    data: { status: ListingStatus.HIDDEN },
  });
  if (result.count === 0) return { ok: false, error: "Listing state changed; refresh and try again." };
  await syncThreshold(listing.sellerId);
  queueCheckoutSessionExpiryForListing(listingId, listing.sellerId, "listing_hide");
  revalidateListingSurfaces(listingId, listing.sellerId);
  return { ok: true };
}

export async function unhideListingAction(listingId: string) {
  const owned = await getOwnedListing(listingId);
  if (!owned.ok) return { error: owned.error };
  const listing = owned.listing;
  const blockReason = unhideListingBlockReason(listing);
  if (blockReason) return { error: blockReason };
  const result = await publishListingAction(listingId);
  revalidateListingSurfaces(listingId, listing.sellerId);
  return result;
}

export async function markSoldAction(listingId: string) {
  const owned = await getOwnedListing(listingId);
  if (!owned.ok) return { ok: false, error: owned.error };
  const listing = owned.listing;
  // Only ACTIVE and SOLD_OUT can be marked as sold
  if (listing.status !== "ACTIVE" && listing.status !== "SOLD_OUT") {
    return { ok: false, error: "Only active or sold-out listings can be marked sold." };
  }
  const result = await prisma.listing.updateMany({
    where: {
      id: listingId,
      sellerId: listing.sellerId,
      status: { in: [ListingStatus.ACTIVE, ListingStatus.SOLD_OUT] },
    },
    data: { status: ListingStatus.SOLD },
  });
  if (result.count === 0) return { ok: false, error: "Listing state changed; refresh and try again." };
  await syncThreshold(listing.sellerId);
  queueCheckoutSessionExpiryForListing(listingId, listing.sellerId, "listing_mark_sold");
  revalidateListingSurfaces(listingId, listing.sellerId);
  return { ok: true };
}

export async function deleteListingAction(listingId: string) {
  const owned = await getOwnedListing(listingId);
  if (!owned.ok) return { ok: false, error: owned.error };
  const listing = owned.listing;
  const blockReason = archiveListingBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };
  // Soft delete: preserve order history, remove current shopping intent records.
  try {
    await softDeleteListingWithCleanup(listingId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not archive this listing.",
    };
  }
  await syncGuildMemberListingThreshold(listing.sellerId);
  queueCheckoutSessionExpiryForListing(listingId, listing.sellerId, "listing_archive");
  revalidateListingSurfaces(listingId, listing.sellerId);
  return { ok: true };
}

export async function withdrawListingReviewAction(listingId: string) {
  const owned = await getOwnedListing(listingId);
  if (!owned.ok) return { ok: false, error: owned.error };
  const listing = owned.listing;
  const blockReason = withdrawReviewBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };

  const result = await prisma.listing.updateMany({
    where: {
      id: listingId,
      sellerId: listing.sellerId,
      status: ListingStatus.PENDING_REVIEW,
      updatedAt: listing.updatedAt,
    },
    data: {
      status: ListingStatus.DRAFT,
      aiReviewFlags: [],
      aiReviewScore: null,
      reviewedByAdmin: false,
      reviewedAt: null,
      rejectionReason: null,
    },
  });
  if (result.count === 0) return { ok: false, error: "Listing state changed; refresh and try again." };

  revalidateListingSurfaces(listingId, listing.sellerId);
  return { ok: true };
}

export async function markAvailableAction(listingId: string) {
  const owned = await getOwnedListing(listingId);
  if (!owned.ok) return { error: owned.error };
  const listing = owned.listing;
  const blockReason = markAvailableBlockReason(listing);
  if (blockReason) return { error: blockReason };
  // Seller-initiated reactivation must go through AI/admin review.
  if (listing.status === "REJECTED") return { error: "Rejected listings must be edited and resubmitted." };
  const result = await publishListingAction(listingId);
  revalidateListingSurfaces(listingId, listing.sellerId);
  return result;
}

export async function publishListingAction(listingId: string): Promise<{ status: "ACTIVE" | "PENDING_REVIEW" } | { error: string }> {
  const owned = await getOwnedListing(listingId);
  if (!owned.ok) return { error: owned.error };
  const listing = owned.listing;
  const blockReason = publishListingBlockReason(listing);
  if (blockReason) return { error: blockReason };

  const sellerCheck = await prisma.sellerProfile.findUnique({
    where: { id: listing.sellerId },
    select: { chargesEnabled: true, vacationMode: true },
  });
  if (!sellerCheck?.chargesEnabled || sellerCheck.vacationMode) {
    return { error: "Connect your bank account in Shop Settings to publish." };
  }

  try {
    const sellerInfo = await prisma.sellerProfile.findUnique({
      where: { id: listing.sellerId },
      select: {
        displayName: true,
        _count: { select: { listings: { where: { status: { in: ["ACTIVE", "SOLD", "SOLD_OUT"] } } } } },
      },
    });
    const listingCount = sellerInfo?._count.listings ?? 0;

    const { reviewListingWithAI } = await import("@/lib/ai-review");
    const { logAdminAction } = await import("@/lib/audit");

    const photos = await prisma.photo.findMany({
      where: { listingId: listing.id },
      select: { url: true },
      orderBy: { sortOrder: "asc" },
      take: 10,
    });

    const aiResult = await reviewListingWithAI({
      sellerId: listing.sellerId,
      title: listing.title,
      description: listing.description,
      priceCents: listing.priceCents,
      currency: listing.currency,
      category: listing.category ?? null,
      tags: listing.tags,
      sellerName: sellerInfo?.displayName ?? "Unknown",
      listingCount,
      imageUrls: photos.map((p) => p.url),
    }).catch((error) => {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "listing_publish_ai_review" },
        extra: { listingId: listing.id, sellerProfileId: listing.sellerId },
      });
      return {
        approved: false,
        flags: ["AI review error"],
        confidence: 0,
        reason: "AI error — sending to admin review",
        altTexts: [] as string[],
      };
    });

    // Backfill AI-generated alt texts on photos that don't already have seller-provided alt text.
    // Runs regardless of approval status — alt text content is independent of moderation decision.
    await backfillEmptyAltTexts(listing.id, aiResult.altTexts);

    const shouldHold = !aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8;

    if (shouldHold) {
      const updateResult = await prisma.listing.updateMany({
        where: {
          id: listingId,
          sellerId: listing.sellerId,
          status: listing.status,
          updatedAt: listing.updatedAt,
          ...(listing.listingType === ListingType.IN_STOCK ? { stockQuantity: { gt: 0 } } : {}),
          OR: [{ rejectionReason: null }, { rejectionReason: { not: STAFF_REMOVAL_REJECTION_REASON } }],
        },
        data: {
          status: "PENDING_REVIEW",
          aiReviewFlags: aiResult.flags,
          aiReviewScore: aiResult.confidence,
          rejectionReason: null,
        },
      });
      if (updateResult.count === 0) {
        return { error: "Listing state changed; refresh and try again." };
      }
      await logAdminAction({
        adminId: listing.seller.userId,
        action: "AI_HOLD_LISTING",
        targetType: "LISTING",
        targetId: listingId,
        reason: aiResult.reason,
        metadata: { flags: aiResult.flags, confidence: aiResult.confidence },
      });
      queueCheckoutSessionExpiryForListing(listingId, listing.sellerId, "listing_ai_hold");
      revalidateListingSurfaces(listingId, listing.sellerId);
      return { status: "PENDING_REVIEW" };
    } else {
      const shouldNotifyFollowers = shouldNotifyFollowersOnActivation(listing);
      const updateResult = await prisma.listing.updateMany({
        where: {
          id: listingId,
          sellerId: listing.sellerId,
          status: listing.status,
          updatedAt: listing.updatedAt,
          ...(listing.listingType === ListingType.IN_STOCK ? { stockQuantity: { gt: 0 } } : {}),
          OR: [{ rejectionReason: null }, { rejectionReason: { not: STAFF_REMOVAL_REJECTION_REASON } }],
        },
        data: {
          status: "ACTIVE",
          aiReviewFlags: aiResult.flags,
          aiReviewScore: aiResult.confidence,
          rejectionReason: null,
        },
      });
      if (updateResult.count === 0) {
        return { error: "Listing state changed; refresh and try again." };
      }
      await prisma.$executeRaw`
        UPDATE "Listing"
        SET status = 'SOLD_OUT'
        WHERE id = ${listingId}
          AND "sellerId" = ${listing.sellerId}
          AND "listingType" = 'IN_STOCK'
          AND COALESCE("stockQuantity", 0) <= 0
          AND status = 'ACTIVE'
      `;
      await syncThreshold(listing.sellerId);
      // First active listing for this seller might earn the Founding Maker badge.
      await maybeGrantFoundingMaker(listing.sellerId);
      if (shouldNotifyFollowers) {
        queueFollowerFanoutForActiveListing(listing);
      }
      revalidateListingSurfaces(listingId, listing.sellerId);
      return { status: "ACTIVE" };
    }
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "listing_publish_ai_review_followup" },
      extra: { listingId, sellerProfileId: listing.sellerId },
    });
    // Fail closed: AI review error → send to admin review (not ACTIVE)
    const updateResult = await prisma.listing.updateMany({
      where: {
        id: listingId,
        sellerId: listing.sellerId,
        status: listing.status,
        updatedAt: listing.updatedAt,
        OR: [{ rejectionReason: null }, { rejectionReason: { not: STAFF_REMOVAL_REJECTION_REASON } }],
      },
      data: {
        status: "PENDING_REVIEW",
        aiReviewFlags: ["AI review error"],
        aiReviewScore: 0,
        rejectionReason: null,
      },
    }).catch((updateError) => {
      Sentry.captureException(updateError, {
        level: "error",
        tags: { source: "listing_publish_ai_error_mark_failed" },
        extra: { listingId, sellerProfileId: listing.sellerId },
      });
      return { count: 0 };
    });
    if (updateResult.count === 0) {
      return { error: "Listing state changed; refresh and try again." };
    }
    revalidateListingSurfaces(listingId, listing.sellerId);
    return { status: "PENDING_REVIEW" as const };
  }
}
