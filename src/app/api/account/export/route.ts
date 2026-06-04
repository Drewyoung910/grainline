import * as Sentry from "@sentry/nextjs";
import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";
import { ensureUser, isAccountAccessError } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { accountExportRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { accountExportJsonResponse } from "@/lib/accountExportFormat";
import { buildAccountExportPayload } from "@/lib/accountExportPayload";
import { resolvedInterestedCount } from "@/lib/commissionInterestCount";
import { logUserAuditAction } from "@/lib/audit";
import { emailSuppressionAddressKeys, normalizeEmailAddress } from "@/lib/emailSuppression";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { supportRequestAccountExportWhere } from "@/lib/supportRequest";
import {
  ACCOUNT_EXPORT_REVERIFICATION,
  hasFreshAccountExportSession,
} from "@/lib/accountExportReverification";

export const runtime = "nodejs";

type ExportableUser = Awaited<ReturnType<typeof ensureUser>>;

function jsonDownload(data: unknown, userId: string) {
  return accountExportJsonResponse(data, userId);
}

async function buildExport(user: NonNullable<ExportableUser>) {
  const accountEmail = normalizeEmailAddress(user.email ?? "") ?? user.email?.trim().toLowerCase() ?? null;
  const accountEmailSuppressionKeys = accountEmail ? emailSuppressionAddressKeys(accountEmail) : [];
  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      displayName: true,
      bio: true,
      city: true,
      state: true,
      lat: true,
      lng: true,
      radiusMeters: true,
      publicMapOptIn: true,
      chargesEnabled: true,
      shippingFlatRateCents: true,
      freeShippingOverCents: true,
      allowLocalPickup: true,
      useCalculatedShipping: true,
      preferredCarriers: true,
      tagline: true,
      bannerImageUrl: true,
      avatarImageUrl: true,
      workshopImageUrl: true,
      vacationMode: true,
      vacationMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const [
    listings,
    buyerOrders,
    sellerOrders,
    messagesSent,
    messagesReceived,
    caseRows,
    reviews,
    blogPosts,
    blogComments,
    cart,
    favorites,
    savedSearches,
    follows,
    savedBlogPosts,
    commissionRequestRows,
    commissionInterests,
    notifications,
    blocks,
    userReportsSubmitted,
    userReportsReceived,
    supportRequests,
    emailSuppressions,
    emailOutboxRows,
    emailFailureCounts,
    stockNotifications,
    makerVerification,
    sellerFaqs,
    newsletterSubscriptions,
    sellerBroadcasts,
    reviewVotes,
  ] = await Promise.all([
    sellerProfile
      ? prisma.listing.findMany({
          where: { sellerId: sellerProfile.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            description: true,
            priceCents: true,
            currency: true,
            status: true,
            isPrivate: true,
            listingType: true,
            stockQuantity: true,
            category: true,
            tags: true,
            createdAt: true,
            updatedAt: true,
            photos: { orderBy: { sortOrder: "asc" }, select: { url: true, originalUrl: true, altText: true, sortOrder: true } },
            variantGroups: {
              orderBy: { sortOrder: "asc" },
              select: {
                name: true,
                sortOrder: true,
                options: { orderBy: { sortOrder: "asc" }, select: { label: true, priceAdjustCents: true, sortOrder: true, inStock: true } },
              },
            },
          },
        })
      : [],
    prisma.order.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        paidAt: true,
        currency: true,
        itemsSubtotalCents: true,
        shippingTitle: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        buyerEmail: true,
        buyerName: true,
        shipToLine1: true,
        shipToLine2: true,
        shipToCity: true,
        shipToState: true,
        shipToPostalCode: true,
        shipToCountry: true,
        fulfillmentMethod: true,
        fulfillmentStatus: true,
        trackingCarrier: true,
        trackingNumber: true,
        shippedAt: true,
        deliveredAt: true,
        sellerRefundId: true,
        sellerRefundAmountCents: true,
        giftNote: true,
        giftWrapping: true,
        giftWrappingPriceCents: true,
        buyerDataPurgedAt: true,
        items: {
          select: {
            listingId: true,
            quantity: true,
            priceCents: true,
            selectedVariants: true,
            listingSnapshot: true,
            listing: { select: { title: true, sellerId: true } },
          },
        },
        paymentEvents: {
          orderBy: { createdAt: "desc" },
          select: {
            eventType: true,
            amountCents: true,
            currency: true,
            status: true,
            reason: true,
            description: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    }),
    sellerProfile
      ? prisma.order.findMany({
          where: {
            items: {
              some: { listing: { sellerId: sellerProfile.id } },
              every: { listing: { sellerId: sellerProfile.id } },
            },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            paidAt: true,
            currency: true,
            itemsSubtotalCents: true,
            shippingTitle: true,
            shippingAmountCents: true,
            taxAmountCents: true,
            fulfillmentMethod: true,
            fulfillmentStatus: true,
            trackingCarrier: true,
            trackingNumber: true,
            shippedAt: true,
            deliveredAt: true,
            sellerRefundId: true,
            sellerRefundAmountCents: true,
            items: {
              where: { listing: { sellerId: sellerProfile.id } },
              select: {
                listingId: true,
                quantity: true,
                priceCents: true,
                selectedVariants: true,
                listingSnapshot: true,
                listing: { select: { title: true } },
              },
            },
            paymentEvents: {
              orderBy: { createdAt: "desc" },
              select: {
                eventType: true,
                amountCents: true,
                currency: true,
                status: true,
                reason: true,
                description: true,
                metadata: true,
                createdAt: true,
              },
            },
          },
        })
      : [],
    prisma.message.findMany({
      where: { senderId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversationId: true, recipientId: true, body: true, kind: true, isSystemMessage: true, readAt: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { recipientId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversationId: true, senderId: true, body: true, kind: true, isSystemMessage: true, readAt: true, createdAt: true },
    }),
    prisma.case.findMany({
      where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderId: true,
        buyerId: true,
        sellerId: true,
        reason: true,
        description: true,
        status: true,
        resolution: true,
        refundAmountCents: true,
        sellerRespondBy: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        messages: { orderBy: { createdAt: "asc" }, select: { id: true, authorId: true, body: true, createdAt: true } },
      },
    }),
    prisma.review.findMany({
      where: { reviewerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        listingId: true,
        ratingX2: true,
        comment: true,
        verified: true,
        helpfulCount: true,
        sellerReply: true,
        sellerReplyAt: true,
        createdAt: true,
        updatedAt: true,
        photos: { orderBy: { sortOrder: "asc" }, select: { url: true, altText: true, sortOrder: true } },
        listing: { select: { title: true } },
      },
    }),
    prisma.blogPost.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        body: true,
        coverImageUrl: true,
        videoUrl: true,
        authorType: true,
        type: true,
        status: true,
        featuredListingIds: true,
        tags: true,
        metaDescription: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.blogComment.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, postId: true, body: true, approved: true, parentId: true, createdAt: true },
    }),
    prisma.cart.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            listingId: true,
            quantity: true,
            priceCents: true,
            selectedVariantOptionIds: true,
            variantKey: true,
            createdAt: true,
            listing: { select: { title: true } },
          },
        },
      },
    }),
    prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { listingId: true, createdAt: true, listing: { select: { title: true, status: true } } },
    }),
    prisma.savedSearch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.follow.findMany({
      where: { followerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { sellerProfileId: true, createdAt: true, sellerProfile: { select: { displayName: true } } },
    }),
    prisma.savedBlogPost.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { blogPostId: true, createdAt: true, blogPost: { select: { title: true, slug: true } } },
    }),
    prisma.commissionRequest.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        budgetMinCents: true,
        budgetMaxCents: true,
        timeline: true,
        referenceImageUrls: true,
        status: true,
        interestedCount: true,
        _count: { select: { interests: true } },
        expiresAt: true,
        isNational: true,
        lat: true,
        lng: true,
        radiusMeters: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    sellerProfile
      ? prisma.commissionInterest.findMany({
          where: { sellerProfileId: sellerProfile.id },
          orderBy: { createdAt: "desc" },
          select: { commissionRequestId: true, conversationId: true, createdAt: true },
        })
      : [],
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, title: true, body: true, link: true, read: true, createdAt: true },
    }),
    prisma.block.findMany({
      where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] },
      orderBy: { createdAt: "desc" },
      select: { blockerId: true, blockedId: true, createdAt: true },
    }),
    prisma.userReport.findMany({
      where: { reporterId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reportedId: true,
        reason: true,
        details: true,
        targetType: true,
        targetId: true,
        resolved: true,
        resolvedAt: true,
        resolutionNote: true,
        createdAt: true,
      },
    }),
    prisma.userReport.findMany({
      where: { reportedId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reason: true,
        targetType: true,
        targetId: true,
        resolved: true,
        resolvedAt: true,
        resolutionNote: true,
        createdAt: true,
      },
    }),
    prisma.supportRequest.findMany({
      where: supportRequestAccountExportWhere(user.id, accountEmail),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        status: true,
        name: true,
        email: true,
        topic: true,
        orderId: true,
        listingId: true,
        message: true,
        slaDueAt: true,
        emailSentAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    accountEmailSuppressionKeys.length > 0
      ? prisma.emailSuppression.findMany({
          where: { email: { in: accountEmailSuppressionKeys } },
          orderBy: { createdAt: "desc" },
          select: { email: true, reason: true, source: true, details: true, createdAt: true, updatedAt: true },
        })
      : [],
    prisma.emailOutbox.findMany({
      where:
        accountEmailSuppressionKeys.length > 0
          ? { OR: [{ userId: user.id }, { recipientEmail: { in: accountEmailSuppressionKeys } }] }
          : { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        recipientEmail: true,
        userId: true,
        preferenceKey: true,
        templateName: true,
        templateVersion: true,
        subject: true,
        html: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        sentAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    accountEmailSuppressionKeys.length > 0
      ? prisma.emailFailureCount.findMany({
          where: { email: { in: accountEmailSuppressionKeys } },
          orderBy: { lastFailedAt: "desc" },
          select: { email: true, count: true, firstFailedAt: true, lastFailedAt: true, lastEventId: true },
        })
      : [],
    prisma.stockNotification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { listingId: true, createdAt: true, listing: { select: { title: true, status: true } } },
    }),
    sellerProfile
      ? prisma.makerVerification.findUnique({
          where: { sellerProfileId: sellerProfile.id },
          select: {
            id: true,
            sellerProfileId: true,
            craftDescription: true,
            guildMasterCraftBusiness: true,
            yearsExperience: true,
            portfolioUrl: true,
            status: true,
            reviewNotes: true,
            appliedAt: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : null,
    sellerProfile
      ? prisma.sellerFaq.findMany({
          where: { sellerProfileId: sellerProfile.id },
          orderBy: { sortOrder: "asc" },
          select: { id: true, question: true, answer: true, sortOrder: true, createdAt: true },
        })
      : [],
    accountEmail
      ? prisma.newsletterSubscriber.findMany({
          where: { email: accountEmail },
          orderBy: { subscribedAt: "desc" },
          select: {
            id: true,
            email: true,
            name: true,
            subscribedAt: true,
            active: true,
            confirmedAt: true,
            confirmationSentAt: true,
          },
        })
      : [],
    sellerProfile
      ? prisma.sellerBroadcast.findMany({
          where: { sellerProfileId: sellerProfile.id },
          orderBy: { sentAt: "desc" },
          select: { id: true, message: true, imageUrl: true, sentAt: true, recipientCount: true },
        })
      : [],
    prisma.reviewVote.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { reviewId: true, value: true, createdAt: true, review: { select: { listingId: true } } },
    }),
  ]);
  const commissionRequests = commissionRequestRows.map(({ _count, ...request }) => ({
    ...request,
    interestedCount: resolvedInterestedCount({
      interestedCount: request.interestedCount,
      _count,
    }),
  }));

  return buildAccountExportPayload(user, {
    sellerProfile,
    listings,
    buyerOrders,
    sellerOrders,
    messagesSent,
    messagesReceived,
    caseRows,
    reviews,
    blogPosts,
    blogComments,
    cart,
    favorites,
    savedSearches,
    follows,
    savedBlogPosts,
    commissionRequests,
    commissionInterests,
    notifications,
    blocks,
    userReportsSubmitted,
    userReportsReceived,
    supportRequests,
    emailSuppressions,
    emailOutboxRows,
    emailFailureCounts,
    stockNotifications,
    makerVerification,
    sellerFaqs,
    newsletterSubscriptions,
    sellerBroadcasts,
    reviewVotes,
  });
}

async function handleExport(req: Request) {
  let exportUserId: string | null = null;
  const method = "POST";
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Cross-origin account export requests are not allowed." }, { status: 403 });
    }

    const session = await auth();
    if (!session.userId) return privateJson({ error: "Sign in required" }, { status: 401 });
    if (!hasFreshAccountExportSession(session.factorVerificationAge)) {
      return privateResponse(reverificationErrorResponse(ACCOUNT_EXPORT_REVERIFICATION));
    }

    const user = await ensureUser();
    if (!user) return privateJson({ error: "Sign in required" }, { status: 401 });
    exportUserId = user.id;

    const rate = await safeRateLimit(accountExportRatelimit, user.id);
    if (!rate.success) return privateResponse(rateLimitResponse(rate.reset, "Too many account export requests."));

    const payload = await buildExport(user);
    const auditLogId = await logUserAuditAction({
      actorId: user.id,
      action: "ACCOUNT_EXPORT",
      targetType: "USER",
      targetId: user.id,
      reason: "Account export generated",
      metadata: { route: "/api/account/export", method },
    });
    if (!auditLogId) {
      Sentry.captureMessage("Account export audit log unavailable", {
        level: "warning",
        tags: { source: "account_export_audit_log" },
        extra: { userId: user.id, method },
      });
      return privateJson(
        { error: "Could not record account export audit trail. Please try again." },
        { status: 503 },
      );
    }

    return jsonDownload(payload, user.id);
  } catch (error) {
    if (isAccountAccessError(error)) {
      return privateJson({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("account export failed", error);
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "account_export" },
      extra: { userId: exportUserId, method },
    });
    return privateJson({ error: "Could not generate account export" }, { status: 500 });
  }
}

export async function GET() {
  return privateJson({ error: "Use POST to download account data." }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(req: Request) {
  return handleExport(req);
}
