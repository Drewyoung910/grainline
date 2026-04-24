"use server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createNotification } from "@/lib/notifications";
import { softDeleteListingWithCleanup } from "@/lib/listingSoftDelete";
import { ListingStatus } from "@prisma/client";

// Ensure the calling user owns this listing; returns listing + seller or null
async function getOwnedListing(listingId: string) {
  const { userId } = await auth();
  if (!userId) return null;
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return null;
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing || listing.seller.userId !== me.id) return null;
  return listing;
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
  revalidatePath(`/seller/${listing.sellerId}/shop`);
}

export async function unhideListingAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return;
  // REJECTED listings cannot be unhidden — seller must edit and resubmit for review
  if (listing.status === "REJECTED") return;
  // Soft-deleted listings (isPrivate=true + HIDDEN) cannot be unhidden — they're "deleted"
  if (listing.status === "HIDDEN" && listing.isPrivate) return;
  await prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.ACTIVE } });
  await syncThreshold(listing.sellerId);
  // Notify followers
  after(async () => {
    try {
      const followers = await prisma.follow.findMany({
        where: { sellerProfileId: listing.sellerId },
        select: { followerId: true },
      });
      if (followers.length > 0) {
        await Promise.all(
          followers.map((f) =>
            createNotification({
              userId: f.followerId,
              type: "FOLLOWED_MAKER_NEW_LISTING",
              title: `New listing from ${listing.seller.displayName}`,
              body: listing.title,
              link: `/listing/${listing.id}`,
            })
          )
        );
      }
    } catch { /* non-fatal */ }
  });
  revalidatePath(`/seller/${listing.sellerId}/shop`);
}

export async function markSoldAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return;
  // Only ACTIVE and SOLD_OUT can be marked as sold
  if (listing.status !== "ACTIVE" && listing.status !== "SOLD_OUT") return;
  await prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.SOLD } });
  await syncThreshold(listing.sellerId);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
}

export async function deleteListingAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return;
  // Soft delete: preserve order history, remove current shopping intent records.
  await softDeleteListingWithCleanup(listingId);
  const activeCount = await prisma.listing.count({ where: { sellerId: listing.sellerId, status: "ACTIVE" } });
  const sp = await prisma.sellerProfile.findUnique({
    where: { id: listing.sellerId },
    select: { listingsBelowThresholdSince: true },
  });
  if (sp && activeCount < 5 && !sp.listingsBelowThresholdSince) {
    await prisma.sellerProfile.update({ where: { id: listing.sellerId }, data: { listingsBelowThresholdSince: new Date() } });
  }
  revalidatePath(`/seller/${listing.sellerId}/shop`);
}

export async function markAvailableAction(listingId: string) {
  const listing = await getOwnedListing(listingId);
  if (!listing) return;
  // REJECTED listings cannot bypass moderation via markAvailable
  if (listing.status === "REJECTED") return;
  await prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.ACTIVE } });
  await syncThreshold(listing.sellerId);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
  revalidatePath("/dashboard");
}

export async function publishListingAction(listingId: string): Promise<{ status: "ACTIVE" | "PENDING_REVIEW" } | { error: string }> {
  const listing = await getOwnedListing(listingId);
  if (!listing) return { status: "PENDING_REVIEW" };

  const sellerCheck = await prisma.sellerProfile.findUnique({
    where: { id: listing.sellerId },
    select: { chargesEnabled: true },
  });
  if (!sellerCheck?.chargesEnabled) {
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
      await prisma.listing.update({
        where: { id: listingId },
        data: {
          status: "PENDING_REVIEW",
          aiReviewFlags: aiResult.flags,
          aiReviewScore: aiResult.confidence,
          rejectionReason: null,
        },
      });
      await logAdminAction({
        adminId: listing.seller.userId,
        action: "AI_HOLD_LISTING",
        targetType: "LISTING",
        targetId: listingId,
        reason: aiResult.reason,
        metadata: { flags: aiResult.flags, confidence: aiResult.confidence },
      });
      revalidatePath(`/seller/${listing.sellerId}/shop`);
      return { status: "PENDING_REVIEW" };
    } else {
      await prisma.listing.update({ where: { id: listingId }, data: { status: "ACTIVE", rejectionReason: null } });
      await syncThreshold(listing.sellerId);
      revalidatePath(`/seller/${listing.sellerId}/shop`);
      return { status: "ACTIVE" };
    }
  } catch {
    // Fail closed: AI review error → send to admin review (not ACTIVE)
    await prisma.listing.update({ where: { id: listingId }, data: { status: "PENDING_REVIEW", rejectionReason: null } });
    revalidatePath(`/seller/${listing.sellerId}/shop`);
    return { status: "PENDING_REVIEW" as const };
  }
}
