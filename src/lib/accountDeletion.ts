import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
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

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: { select: { id: true } } },
    });

    if (!user) return { ok: true, alreadyDeleted: true };
    if (user.deletedAt) return { ok: true, alreadyDeleted: true };

    const now = new Date();
    const deletedEmail = `deleted+${user.id}@deleted.thegrainline.local`;
    const deletedClerkId = `deleted:${user.id}:${now.getTime()}`;

    await tx.cart.deleteMany({ where: { userId: user.id } });
    await tx.favorite.deleteMany({ where: { userId: user.id } });
    await tx.savedSearch.deleteMany({ where: { userId: user.id } });
    await tx.stockNotification.deleteMany({ where: { userId: user.id } });
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await tx.savedBlogPost.deleteMany({ where: { userId: user.id } });
    await tx.reviewVote.deleteMany({ where: { userId: user.id } });
    await tx.block.deleteMany({
      where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] },
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
        details: { userId: user.id },
      },
      update: {
        reason: EmailSuppressionReason.MANUAL,
        source: "account_deletion",
        details: { userId: user.id },
      },
    });
    await tx.commissionRequest.updateMany({
      where: { buyerId: user.id, status: { in: [...ACTIVE_COMMISSION_STATUSES] } },
      data: { status: "CLOSED" },
    });

    if (user.sellerProfile) {
      await tx.listing.updateMany({
        where: { sellerId: user.sellerProfile.id },
        data: { status: "HIDDEN", isPrivate: true },
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
}

export async function anonymizeUserAccountByClerkId(clerkId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (!user) return { ok: true, alreadyDeleted: true };
  return anonymizeUserAccount(user.id);
}
