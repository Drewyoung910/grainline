"use server";
import { auth } from "@clerk/nextjs/server";
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
} from "@/lib/listingActionState";

const REPUBLISH_NOTIFY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// Ensure the calling user owns this listing; returns listing + seller or null
async function getOwnedListing(listingId: string) {
  const { userId } = await auth();
  if (!userId) return null;
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return null;
  if (me.banned || me.deletedAt) return null;
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing || listing.seller.userId !== me.id) return null;
  return listing;
}

function revalidateListingSurfaces(listingId: string, sellerId: string) {
  revalidatePath(`/seller/${sellerId}/shop`);
  revalidatePath(`/seller/${sellerId}`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath("/dashboard");
  revalidatePath("/browse");
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
    } catch {
      // Non-fatal: listing activation should not roll back if follower fan-out fails.
    }
  });
}

async function syncThreshold(sellerId: string) {
  const activeCount = await prisma.listing.count({ where: { sellerId, status: "ACTIVE" } });
  const sp = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { listingsBelowThresholdSince: true },
  });
  if (!sp) return;
  if (activeCount < 5 && !sp.listingsBelowThresholdSince) {
    await prisma.sellerProfile.update({ where: { id: sellerId }, data: { listingsBelowThresholdSince: new Date() } });
  } else if (activeCount >= 5 && sp.listingsBelowThresholdSince) {
    await prisma.sellerProfile.update({ where: { id: sellerId }, data: { listingsBelowThresholdSince: null } });
  }
}

export async function hideListingAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
  const blockReason = hideListingBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };
  const result = await prisma.listing.updateMany({
    where: { id: listingId, sellerId: listing.sellerId, status: ListingStatus.ACTIVE },
    data: { status: ListingStatus.HIDDEN },
  });
  if (result.count === 0) return { ok: false, error: "Listing state changed; refresh and try again." };
  await syncThreshold(listing.sellerId);
  revalidateListingSurfaces(listingId, listing.sellerId);
  return { ok: true };
}

export async function unhideListingAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { error: "Listing not found." };
  const blockReason = unhideListingBlockReason(listing);
  if (blockReason) return { error: blockReason };
  const result = await publishListingAction(listingId);
  revalidateListingSurfaces(listingId, listing.sellerId);
  return result;
}

export async function markSoldAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return;
  // Only ACTIVE and SOLD_OUT can be marked as sold
  if (listing.status !== "ACTIVE" && listing.status !== "SOLD_OUT") return;
  const result = await prisma.listing.updateMany({
    where: {
      id: listingId,
      sellerId: listing.sellerId,
      status: { in: [ListingStatus.ACTIVE, ListingStatus.SOLD_OUT] },
    },
    data: { status: ListingStatus.SOLD },
  });
  if (result.count === 0) return;
  await syncThreshold(listing.sellerId);
  revalidateListingSurfaces(listingId, listing.sellerId);
}

export async function deleteListingAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
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
  const activeCount = await prisma.listing.count({ where: { sellerId: listing.sellerId, status: "ACTIVE" } });
  const sp = await prisma.sellerProfile.findUnique({
    where: { id: listing.sellerId },
    select: { listingsBelowThresholdSince: true },
  });
  if (sp && activeCount < 5 && !sp.listingsBelowThresholdSince) {
    await prisma.sellerProfile.update({ where: { id: listing.sellerId }, data: { listingsBelowThresholdSince: new Date() } });
  }
  revalidateListingSurfaces(listingId, listing.sellerId);
  return { ok: true };
}

export async function markAvailableAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { error: "Listing not found." };
  const blockReason = markAvailableBlockReason(listing);
  if (blockReason) return { error: blockReason };
  // Seller-initiated reactivation must go through AI/admin review.
  if (listing.status === "REJECTED") return { error: "Rejected listings must be edited and resubmitted." };
  const result = await publishListingAction(listingId);
  revalidateListingSurfaces(listingId, listing.sellerId);
  return result;
}

export async function publishListingAction(listingId: string): Promise<{ status: "ACTIVE" | "PENDING_REVIEW" } | { error: string }> {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { status: "PENDING_REVIEW" };
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
      take: 8,
    });

    const aiResult = await reviewListingWithAI({
      sellerId: listing.sellerId,
      title: listing.title,
      description: listing.description,
      priceCents: listing.priceCents,
      category: listing.category ?? null,
      tags: listing.tags,
      sellerName: sellerInfo?.displayName ?? "Unknown",
      listingCount,
      imageUrls: photos.map((p) => p.url),
    }).catch(() => ({
      approved: false,
      flags: ["AI review error"],
      confidence: 0,
      reason: "AI error — sending to admin review",
    }));

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
          AND "listingType" = 'IN_STOCK'
          AND COALESCE("stockQuantity", 0) <= 0
          AND status = 'ACTIVE'
      `;
      await syncThreshold(listing.sellerId);
      if (shouldNotifyFollowers) {
        queueFollowerFanoutForActiveListing(listing);
      }
      revalidateListingSurfaces(listingId, listing.sellerId);
      return { status: "ACTIVE" };
    }
  } catch {
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
    });
    if (updateResult.count === 0) {
      return { error: "Listing state changed; refresh and try again." };
    }
    revalidateListingSurfaces(listingId, listing.sellerId);
    return { status: "PENDING_REVIEW" as const };
  }
}
