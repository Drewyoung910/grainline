import * as Sentry from "@sentry/nextjs";
import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";
import { ensureUser, isAccountAccessError } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { accountExportRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { accountExportJsonResponse } from "@/lib/accountExportFormat";
import { buildAccountExportPayload } from "@/lib/accountExportPayload";
import { resolvedInterestedCount } from "@/lib/commissionInterestCount";
import { logUserAuditAction } from "@/lib/audit";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { supportRequestAccountExportWhere } from "@/lib/supportRequest";
import {
  accountEmailFallbackEmailsForUser,
  accountEmailSuppressionKeysForEmails,
  userAccountEmailAddressState,
} from "@/lib/userEmailAddresses";
import {
  ACCOUNT_EXPORT_REVERIFICATION,
  hasFreshAccountExportSession,
} from "@/lib/accountExportReverification";
import { parseCheckoutStockReservationItems } from "@/lib/checkoutStockRestore";
import { logServerError } from "@/lib/serverErrorLogger";
import { ownerNotificationExportRows } from "@/lib/notificationOwnerAccess";
import { listOwnerSavedSearches } from "@/lib/savedSearchOwnerAccess";
import { withDbUserContext } from "@/lib/dbUserContext";
import { ownerSavedBlogPostExportRows } from "@/lib/savedBlogPostOwnerAccess";
import { ownerCartExportRows } from "@/lib/cartOwnerAccess";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";

type ExportableUser = Awaited<ReturnType<typeof ensureUser>>;

function jsonDownload(data: unknown, userId: string) {
  return accountExportJsonResponse(data, userId);
}

async function buildExport(user: NonNullable<ExportableUser>) {
  const accountEmail = normalizeEmailAddress(user.email ?? "") ?? user.email?.trim().toLowerCase() ?? null;
  const accountEmailState = await userAccountEmailAddressState(prisma, {
    userId: user.id,
    currentEmail: accountEmail,
  });
  const accountEmails = await accountEmailFallbackEmailsForUser(prisma, {
    userId: user.id,
    emails: accountEmailState.emails,
  });
  const accountEmailSuppressionKeys = accountEmailSuppressionKeysForEmails(accountEmails);
  const accountEmailAddresses = accountEmailState.rows;
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
      stripeAccountId: true,
      stripeAccountVersion: true,
      stripeControllerType: true,
      manualStripeReconciliationNeeded: true,
      shippingFlatRateCents: true,
      freeShippingOverCents: true,
      allowLocalPickup: true,
      useCalculatedShipping: true,
      preferredCarriers: true,
      defaultPkgWeightGrams: true,
      defaultPkgLengthCm: true,
      defaultPkgWidthCm: true,
      defaultPkgHeightCm: true,
      shipFromName: true,
      shipFromLine1: true,
      shipFromLine2: true,
      shipFromCity: true,
      shipFromState: true,
      shipFromPostal: true,
      shipFromCountry: true,
      tagline: true,
      bannerImageUrl: true,
      avatarImageUrl: true,
      workshopImageUrl: true,
      storyTitle: true,
      storyBody: true,
      instagramUrl: true,
      facebookUrl: true,
      pinterestUrl: true,
      tiktokUrl: true,
      websiteUrl: true,
      yearsInBusiness: true,
      acceptsCustomOrders: true,
      acceptingNewOrders: true,
      customOrderTurnaroundDays: true,
      offersGiftWrapping: true,
      giftWrappingPriceCents: true,
      returnPolicy: true,
      customOrderPolicy: true,
      shippingPolicy: true,
      featuredListingIds: true,
      galleryImageUrls: true,
      galleryAltTexts: true,
      isVerifiedMaker: true,
      verifiedAt: true,
      guildLevel: true,
      guildMemberApprovedAt: true,
      guildMasterApprovedAt: true,
      guildMasterAppliedAt: true,
      guildMasterReviewNotes: true,
      consecutiveMetricFailures: true,
      lastMetricCheckAt: true,
      metricWarningSentAt: true,
      listingsBelowThresholdSince: true,
      onboardingStep: true,
      onboardingComplete: true,
      vacationMode: true,
      vacationReturnDate: true,
      vacationMessage: true,
      isFoundingMaker: true,
      foundingMakerNumber: true,
      foundingMakerAt: true,
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
    checkoutStockReservationRows,
    makerVerification,
    sellerFaqs,
    newsletterSubscriptions,
    sellerBroadcasts,
    sellerPayoutEvents,
    directUploads,
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
            priceVersion: true,
            currency: true,
            status: true,
            videoUrl: true,
            isPrivate: true,
            listingType: true,
            stockQuantity: true,
            processingTimeMinDays: true,
            processingTimeMaxDays: true,
            shipsWithinDays: true,
            category: true,
            tags: true,
            packagedWeightGrams: true,
            packagedLengthCm: true,
            packagedWidthCm: true,
            packagedHeightCm: true,
            reservedForUserId: true,
            customOrderConversationId: true,
            metaDescription: true,
            materials: true,
            productLengthIn: true,
            productWidthIn: true,
            productHeightIn: true,
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
            id: true,
            orderId: true,
            stripeEventId: true,
            stripeObjectId: true,
            stripeObjectType: true,
            eventType: true,
            amountCents: true,
            currency: true,
            status: true,
            reason: true,
            description: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        shippingRateQuotes: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            orderId: true,
            shipmentId: true,
            rates: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
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
                id: true,
                orderId: true,
                stripeEventId: true,
                stripeObjectId: true,
                stripeObjectType: true,
                eventType: true,
                amountCents: true,
                currency: true,
                status: true,
                reason: true,
                description: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            shippingRateQuotes: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                orderId: true,
                shipmentId: true,
                rates: true,
                expiresAt: true,
                createdAt: true,
                updatedAt: true,
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
        materialDisclosure: true,
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
    ownerCartExportRows(user.id),
    prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { listingId: true, createdAt: true, listing: { select: { title: true, status: true } } },
    }),
    withDbUserContext(user.id, (tx) => listOwnerSavedSearches(user.id, tx)),
    prisma.follow.findMany({
      where: { followerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { sellerProfileId: true, createdAt: true, sellerProfile: { select: { displayName: true } } },
    }),
    ownerSavedBlogPostExportRows(user.id),
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
    ownerNotificationExportRows(user.id),
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
      where: supportRequestAccountExportWhere(user.id, accountEmails),
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
        emailLastError: true,
        closedAt: true,
        closureEvidence: true,
        closureEvidenceAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    accountEmailSuppressionKeys.length > 0
      ? prisma.emailSuppression.findMany({
          where: { email: { in: accountEmailSuppressionKeys } },
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, reason: true, source: true, eventId: true, details: true, createdAt: true, updatedAt: true },
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
        sourceType: true,
        sourceId: true,
        subject: true,
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
    prisma.checkoutStockReservation.findMany({
      where: {
        OR: [
          { buyerId: user.id },
          ...(sellerProfile ? [{ sellerId: sellerProfile.id }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        stripeSessionId: true,
        status: true,
        reservedItems: true,
        expiresAt: true,
        restoredAt: true,
        restoreReason: true,
        createdAt: true,
        updatedAt: true,
      },
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
    accountEmailSuppressionKeys.length > 0
      ? prisma.newsletterSubscriber.findMany({
          where: { email: { in: accountEmailSuppressionKeys } },
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
    sellerProfile
      ? prisma.sellerPayoutEvent.findMany({
          where: { sellerProfileId: sellerProfile.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            sellerProfileId: true,
            stripePayoutId: true,
            status: true,
            amountCents: true,
            currency: true,
            failureCode: true,
            failureMessage: true,
            stripeEventId: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : [],
    prisma.directUpload.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        key: true,
        endpoint: true,
        publicUrl: true,
        contentType: true,
        expectedSize: true,
        status: true,
        cleanupAfter: true,
        verifiedAt: true,
        claimedAt: true,
        claimedByType: true,
        claimedById: true,
        deletedAt: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
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
  const checkoutStockReservations = checkoutStockReservationRows.map((reservation) => {
    const exportedAsBuyer = reservation.buyerId === user.id;
    const exportedAsSeller = Boolean(sellerProfile && reservation.sellerId === sellerProfile.id);
    return {
      id: reservation.id,
      exportedAsBuyer,
      exportedAsSeller,
      buyerId: exportedAsBuyer ? reservation.buyerId : null,
      sellerId: exportedAsSeller ? reservation.sellerId : null,
      stripeSessionId: exportedAsBuyer ? reservation.stripeSessionId : null,
      status: reservation.status,
      reservedItems: parseCheckoutStockReservationItems(reservation.reservedItems),
      expiresAt: reservation.expiresAt,
      restoredAt: reservation.restoredAt,
      restoreReason: reservation.restoreReason,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  });

  return buildAccountExportPayload(user, {
    accountEmailAddresses,
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
    checkoutStockReservations,
    makerVerification,
    sellerFaqs,
    newsletterSubscriptions,
    sellerBroadcasts,
    sellerPayoutEvents,
    directUploads,
    reviewVotes,
  });
}

async function handleExport(req: Request) {
  let exportUserId: string | null = null;
  const method = "POST";
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson(
        { error: "Cross-origin account export requests are not allowed." },
        { status: HTTP_STATUS.FORBIDDEN },
      );
    }

    const session = await auth();
    if (!session.userId) return privateJson({ error: "Sign in required" }, { status: HTTP_STATUS.UNAUTHORIZED });
    if (!hasFreshAccountExportSession(session.factorVerificationAge)) {
      return privateResponse(reverificationErrorResponse(ACCOUNT_EXPORT_REVERIFICATION));
    }

    const user = await ensureUser();
    if (!user) return privateJson({ error: "Sign in required" }, { status: HTTP_STATUS.UNAUTHORIZED });
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
        { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
      );
    }

    return jsonDownload(payload, user.id);
  } catch (error) {
    if (isAccountAccessError(error)) {
      return privateJson({ error: error.message, code: error.code }, { status: error.status });
    }
    logServerError(error, {
      source: "account_export",
      level: "warning",
      extra: { userId: exportUserId, method },
    });
    return privateJson({ error: "Could not generate account export" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}

export async function GET() {
  return privateJson(
    { error: "Use POST to download account data." },
    { status: HTTP_STATUS.METHOD_NOT_ALLOWED, headers: { Allow: "POST" } },
  );
}

export async function POST(req: Request) {
  return handleExport(req);
}
