import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { deleteR2ObjectByUrl } from "@/lib/r2";
import { mapWithConcurrency } from "@/lib/concurrency";
import { EmailSuppressionReason } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

const ACTIVE_FULFILLMENT_STATUSES = ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] as const;
const ACTIVE_CASE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] as const;
const ACTIVE_COMMISSION_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

export type AccountDeletionBlocker = {
  code: "buyer_orders" | "seller_orders" | "open_cases" | "active_commissions";
  count: number;
  message: string;
};

export async function getAccountDeletionBlockers(userId: string): Promise<AccountDeletionBlocker[]> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  const [buyerOrders, sellerOrders, openCases, activeCommissions] = await Promise.all([
    prisma.order.count({
      where: {
        buyerId: userId,
        fulfillmentStatus: { in: [...ACTIVE_FULFILLMENT_STATUSES] },
        sellerRefundId: null,
      },
    }),
    seller
      ? prisma.order.count({
          where: {
            fulfillmentStatus: { in: [...ACTIVE_FULFILLMENT_STATUSES] },
            sellerRefundId: null,
            items: { some: { listing: { sellerId: seller.id } } },
          },
        })
      : Promise.resolve(0),
    prisma.case.count({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        status: { in: [...ACTIVE_CASE_STATUSES] },
      },
    }),
    prisma.commissionRequest.count({
      where: {
        buyerId: userId,
        status: { in: [...ACTIVE_COMMISSION_STATUSES] },
      },
    }),
  ]);

  const blockers: AccountDeletionBlocker[] = [];
  if (buyerOrders > 0) {
    blockers.push({
      code: "buyer_orders",
      count: buyerOrders,
      message: "You have buyer orders that are still open. Wait until delivery/pickup or refund before deleting your account.",
    });
  }
  if (sellerOrders > 0) {
    blockers.push({
      code: "seller_orders",
      count: sellerOrders,
      message: "You have sales that are still open. Fulfill or refund them before deleting your account.",
    });
  }
  if (openCases > 0) {
    blockers.push({
      code: "open_cases",
      count: openCases,
      message: "You have open cases. Resolve them before deleting your account.",
    });
  }
  if (activeCommissions > 0) {
    blockers.push({
      code: "active_commissions",
      count: activeCommissions,
      message: "You have active commission requests. Close them before deleting your account.",
    });
  }

  return blockers;
}

async function rejectConnectedStripeAccount(stripeAccountId: string, userId: string) {
  try {
    await stripe.accounts.reject(stripeAccountId, { reason: "other" });
    return true;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "account_delete_stripe_reject" },
      extra: { userId, stripeAccountId },
    });
    return false;
  }
}

async function collectAccountDeletionMediaUrls(userId: string): Promise<string[]> {
  const urls = new Set<string>();
  const [sellerProfile, reviewPhotos, commissionRequests] = await Promise.all([
    prisma.sellerProfile.findUnique({
      where: { userId },
      select: {
        avatarImageUrl: true,
        bannerImageUrl: true,
        workshopImageUrl: true,
        galleryImageUrls: true,
        listings: {
          select: {
            videoUrl: true,
            photos: { select: { url: true } },
          },
        },
      },
    }),
    prisma.reviewPhoto.findMany({
      where: { review: { reviewerId: userId } },
      select: { url: true },
    }),
    prisma.commissionRequest.findMany({
      where: { buyerId: userId },
      select: { referenceImageUrls: true },
    }),
  ]);

  if (sellerProfile) {
    [
      sellerProfile.avatarImageUrl,
      sellerProfile.bannerImageUrl,
      sellerProfile.workshopImageUrl,
      ...sellerProfile.galleryImageUrls,
    ].forEach((url) => {
      if (url) urls.add(url);
    });
    sellerProfile.listings.forEach((listing) => {
      if (listing.videoUrl) urls.add(listing.videoUrl);
      listing.photos.forEach((photo) => urls.add(photo.url));
    });
  }

  reviewPhotos.forEach((photo) => urls.add(photo.url));
  commissionRequests.forEach((request) => request.referenceImageUrls.forEach((url) => urls.add(url)));

  return [...urls];
}

function mediaUrlHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

export async function anonymizeUserAccount(userId: string) {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      deletedAt: true,
      sellerProfile: { select: { stripeAccountId: true } },
    },
  });

  if (!account) return { ok: true, alreadyDeleted: true };
  if (account.deletedAt) return { ok: true, alreadyDeleted: true };

  if (account.sellerProfile?.stripeAccountId) {
    await rejectConnectedStripeAccount(account.sellerProfile.stripeAccountId, userId);
  }

  const mediaUrls = await collectAccountDeletionMediaUrls(userId);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: { select: { id: true } } },
    });

    if (!user) return { ok: true, alreadyDeleted: true };
    if (user.deletedAt) return { ok: true, alreadyDeleted: true };

    const now = new Date();
    const deletedEmail = `deleted+${user.id}@deleted.thegrainline.local`;
    const deletedClerkId = `deleted:${user.id}:${now.getTime()}`;
    const auditTargetIds = [user.id, user.sellerProfile?.id].filter(Boolean) as string[];

    await tx.cart.deleteMany({ where: { userId: user.id } });
    await tx.favorite.deleteMany({ where: { userId: user.id } });
    await tx.savedSearch.deleteMany({ where: { userId: user.id } });
    await tx.stockNotification.deleteMany({ where: { userId: user.id } });
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await tx.savedBlogPost.deleteMany({ where: { userId: user.id } });
    await tx.reviewVote.deleteMany({ where: { userId: user.id } });
    await tx.block.deleteMany({ where: { blockerId: user.id } });
    await tx.message.updateMany({
      where: { senderId: user.id },
      data: { body: "[Message deleted]" },
    });
    await tx.caseMessage.updateMany({
      where: { authorId: user.id },
      data: { body: "[Message deleted]" },
    });
    await tx.case.updateMany({
      where: { buyerId: user.id },
      data: { description: "[Case description deleted]" },
    });
    await tx.review.updateMany({
      where: { reviewerId: user.id },
      data: { comment: null },
    });
    await tx.reviewPhoto.deleteMany({
      where: { review: { reviewerId: user.id } },
    });
    await tx.order.updateMany({
      where: { buyerId: user.id },
      data: {
        buyerEmail: null,
        buyerName: null,
        shipToLine1: null,
        shipToLine2: null,
        quotedToLine1: null,
        quotedToLine2: null,
        quotedToName: null,
        quotedToPhone: null,
        giftNote: null,
        buyerDataPurgedAt: now,
      },
    });
    await tx.userReport.updateMany({
      where: { OR: [{ reporterId: user.id }, { reportedId: user.id }] },
      data: { details: null },
    });
    const suppressionEmail = user.email.trim().toLowerCase();
    await tx.newsletterSubscriber.deleteMany({
      where: { email: suppressionEmail },
    });
    await tx.emailSuppression.upsert({
      where: { email: suppressionEmail },
      create: {
        email: suppressionEmail,
        reason: EmailSuppressionReason.MANUAL,
        source: "account_deletion",
        details: { accountDeleted: true },
      },
      update: {
        reason: EmailSuppressionReason.MANUAL,
        source: "account_deletion",
        details: { accountDeleted: true },
      },
    });
    await tx.adminAuditLog.updateMany({
      where: {
        OR: [
          { adminId: user.id },
          ...(auditTargetIds.length > 0 ? [{ targetId: { in: auditTargetIds } }] : []),
        ],
      },
      data: { metadata: { redactedForAccountDeletion: true } },
    });
    await tx.commissionRequest.updateMany({
      where: { buyerId: user.id, status: { in: [...ACTIVE_COMMISSION_STATUSES] } },
      data: { status: "CLOSED" },
    });

    if (user.sellerProfile) {
      await tx.photo.deleteMany({
        where: { listing: { sellerId: user.sellerProfile.id } },
      });
      await tx.listing.updateMany({
        where: { sellerId: user.sellerProfile.id },
        data: {
          status: "HIDDEN",
          isPrivate: true,
          description: "[Listing removed]",
          videoUrl: null,
          tags: [],
          metaDescription: null,
          materials: [],
          aiReviewFlags: [],
          aiReviewScore: null,
          rejectionReason: "Seller account deleted",
        },
      });
      await tx.makerVerification.updateMany({
        where: { sellerProfileId: user.sellerProfile.id },
        data: {
          craftDescription: "[Deleted]",
          guildMasterCraftBusiness: null,
          portfolioUrl: null,
          reviewNotes: null,
        },
      });
      await tx.follow.deleteMany({
        where: {
          OR: [
            { followerId: user.id },
            { sellerProfileId: user.sellerProfile.id },
          ],
        },
      });
      await tx.sellerBroadcast.deleteMany({
        where: { sellerProfileId: user.sellerProfile.id },
      });
      await tx.sellerProfile.update({
        where: { id: user.sellerProfile.id },
        data: {
          displayName: "Deleted maker",
          bio: null,
          city: null,
          state: null,
          lat: null,
          lng: null,
          radiusMeters: null,
          publicMapOptIn: false,
          stripeAccountId: null,
          chargesEnabled: false,
          shippingFlatRateCents: null,
          freeShippingOverCents: null,
          allowLocalPickup: false,
          shipFromName: null,
          shipFromLine1: null,
          shipFromLine2: null,
          shipFromCity: null,
          shipFromState: null,
          shipFromPostal: null,
          shipFromCountry: "US",
          defaultPkgWeightGrams: null,
          defaultPkgLengthCm: null,
          defaultPkgWidthCm: null,
          defaultPkgHeightCm: null,
          useCalculatedShipping: false,
          preferredCarriers: [],
          tagline: null,
          bannerImageUrl: null,
          avatarImageUrl: null,
          workshopImageUrl: null,
          storyTitle: null,
          storyBody: null,
          instagramUrl: null,
          facebookUrl: null,
          pinterestUrl: null,
          tiktokUrl: null,
          websiteUrl: null,
          yearsInBusiness: null,
          acceptsCustomOrders: false,
          acceptingNewOrders: false,
          customOrderTurnaroundDays: null,
          offersGiftWrapping: false,
          giftWrappingPriceCents: null,
          returnPolicy: null,
          customOrderPolicy: null,
          shippingPolicy: null,
          featuredListingIds: [],
          galleryImageUrls: [],
          vacationMode: true,
          vacationReturnDate: null,
          vacationMessage: null,
        },
      });
    } else {
      await tx.follow.deleteMany({ where: { followerId: user.id } });
    }

    await tx.commissionRequest.updateMany({
      where: { buyerId: user.id },
      data: {
        title: "Deleted commission request",
        description: "[Request deleted]",
        timeline: null,
        referenceImageUrls: [],
        lat: null,
        lng: null,
        radiusMeters: null,
        isNational: true,
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        clerkId: deletedClerkId,
        email: deletedEmail,
        name: null,
        imageUrl: null,
        shippingName: null,
        shippingLine1: null,
        shippingLine2: null,
        shippingCity: null,
        shippingState: null,
        shippingPostalCode: null,
        shippingPhone: null,
        notificationPreferences: {},
        banned: true,
        bannedAt: now,
        banReason: "Account deleted at user's request",
        bannedBy: "system",
        deletedAt: now,
      },
    });

    return { ok: true, alreadyDeleted: false };
  });

  const deletions = await mapWithConcurrency(mediaUrls, 5, (url) => deleteR2ObjectByUrl(url));
  deletions.forEach((deletion, index) => {
    if (deletion.status === "rejected") {
      Sentry.captureException(deletion.reason, {
        tags: { source: "account_delete_media_cleanup" },
        extra: { userId, host: mediaUrlHost(mediaUrls[index]) },
      });
      return;
    }
    if (deletion.value === false) {
      Sentry.captureMessage("Account deletion skipped non-R2 media cleanup", {
        level: "warning",
        tags: { source: "account_delete_media_cleanup", host: mediaUrlHost(mediaUrls[index]) },
        extra: { userId },
      });
    }
  });

  return result;
}

export async function anonymizeUserAccountByClerkId(clerkId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (!user) return { ok: true, alreadyDeleted: true };
  return anonymizeUserAccount(user.id);
}
