"use server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { softDeleteListingWithCleanup } from "@/lib/listingSoftDelete";
import { ListingStatus } from "@prisma/client";
import { renderNewListingFromFollowedMakerEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { publicListingPath } from "@/lib/publicPaths";

const STAFF_REMOVAL_REJECTION_REASON = "Removed by Grainline staff.";
const FOLLOWER_FANOUT_LIMIT = 10000;
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
      const followers = await prisma.follow.findMany({
        where: {
          sellerProfileId: listing.sellerId,
          follower: { banned: false, deletedAt: null },
        },
        select: { followerId: true, follower: { select: { email: true } } },
        take: FOLLOWER_FANOUT_LIMIT,
      });
      const sellerDisplay = listing.seller.displayName ?? "A maker you follow";
      const listingPath = publicListingPath(listing.id, listing.title);
      await mapWithConcurrency(followers, 10, (f) =>
        createNotification({
          userId: f.followerId,
          type: "FOLLOWED_MAKER_NEW_LISTING",
          title: `New listing from ${sellerDisplay}`,
          body: listing.title,
          link: listingPath,
        }),
      );

      const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com"}${listingPath}`;
      const listingPrice = `$${(listing.priceCents / 100).toFixed(2)}`;
      const emailBucket = new Date().toISOString().slice(0, 10);
      await mapWithConcurrency(followers.filter((f) => f.follower?.email), 5, async (f) => {
        if (await shouldSendEmail(f.followerId, "EMAIL_FOLLOWED_MAKER_NEW_LISTING")) {
          const email = renderNewListingFromFollowedMakerEmail({
            to: f.follower.email!,
            makerName: sellerDisplay,
            listingTitle: listing.title,
            listingPrice,
            listingUrl,
          });
          await enqueueEmailOutbox({
            ...email,
            dedupKey: `followed-listing-active:${listing.id}:${f.followerId}:${emailBucket}`,
            userId: f.followerId,
            preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
          });
        }
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
  if (!listing) return;
  await prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.HIDDEN } });
  await syncThreshold(listing.sellerId);
  revalidateListingSurfaces(listingId, listing.sellerId);
}

export async function unhideListingAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { error: "Listing not found." };
  // Seller-initiated reactivation must go through AI/admin review.
  if (listing.status === "REJECTED") return { error: "Rejected listings must be edited and resubmitted." };
  // Soft-deleted listings (isPrivate=true + HIDDEN) cannot be unhidden — they're "deleted"
  if (listing.status === "HIDDEN" && listing.isPrivate) return { error: "Archived listings cannot be unhidden." };
  const result = await publishListingAction(listingId);
  revalidateListingSurfaces(listingId, listing.sellerId);
  return result;
}

export async function markSoldAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return;
  // Only ACTIVE and SOLD_OUT can be marked as sold
  if (listing.status !== "ACTIVE" && listing.status !== "SOLD_OUT") return;
  await prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.SOLD } });
  await syncThreshold(listing.sellerId);
  revalidateListingSurfaces(listingId, listing.sellerId);
}

export async function deleteListingAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
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
  // Seller-initiated reactivation must go through AI/admin review.
  if (listing.status === "REJECTED") return { error: "Rejected listings must be edited and resubmitted." };
  const result = await publishListingAction(listingId);
  revalidateListingSurfaces(listingId, listing.sellerId);
  return result;
}

export async function publishListingAction(listingId: string): Promise<{ status: "ACTIVE" | "PENDING_REVIEW" } | { error: string }> {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { status: "PENDING_REVIEW" };
  if (listing.status === ListingStatus.HIDDEN && listing.isPrivate) {
    return { error: "Archived listings cannot be republished." };
  }
  if (listing.rejectionReason === STAFF_REMOVAL_REJECTION_REASON) {
    return { error: "This listing was removed by Grainline staff and cannot be resubmitted." };
  }

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
      take: 4,
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
          updatedAt: listing.updatedAt,
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
          updatedAt: listing.updatedAt,
          OR: [{ rejectionReason: null }, { rejectionReason: { not: STAFF_REMOVAL_REJECTION_REASON } }],
        },
        data: { status: "ACTIVE", rejectionReason: null },
      });
      if (updateResult.count === 0) {
        return { error: "Listing state changed; refresh and try again." };
      }
      await syncThreshold(listing.sellerId);
      if (shouldNotifyFollowers) {
        queueFollowerFanoutForActiveListing(listing);
      }
      revalidateListingSurfaces(listingId, listing.sellerId);
      return { status: "ACTIVE" };
    }
  } catch {
    // Fail closed: AI review error → send to admin review (not ACTIVE)
    await prisma.listing.updateMany({
      where: {
        id: listingId,
        sellerId: listing.sellerId,
        OR: [{ rejectionReason: null }, { rejectionReason: { not: STAFF_REMOVAL_REJECTION_REASON } }],
      },
      data: { status: "PENDING_REVIEW", rejectionReason: null },
    });
    revalidateListingSurfaces(listingId, listing.sellerId);
    return { status: "PENDING_REVIEW" as const };
  }
}
