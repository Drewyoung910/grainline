import * as Sentry from "@sentry/nextjs";
import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";
import { ensureUser, isAccountAccessError } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { accountExportRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { accountExportJsonResponse } from "@/lib/accountExportFormat";
import { buildAccountExportPayload } from "@/lib/accountExportPayload";
import { exportActorMessages } from "@/lib/conversationMessageAuthority";
import {
  ownerCommissionInterestExport,
  ownerCommissionRequestExport,
} from "@/lib/commissionRequestAccess";
import { logUserAuditAction } from "@/lib/audit";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { exportOwnerSupportRequests } from "@/lib/supportRequestAccess";
import {
  ownerUserAccountEmailAddressState,
} from "@/lib/userEmailAddressOwnerAccess";
import {
  ACCOUNT_EXPORT_REVERIFICATION,
  hasFreshAccountExportSession,
} from "@/lib/accountExportReverification";
import { exportCheckoutStockReservations } from "@/lib/checkoutStockReservationAuthority";
import { logServerError } from "@/lib/serverErrorLogger";
import { ownerNotificationExportRows } from "@/lib/notificationOwnerAccess";
import { listOwnerSavedSearches } from "@/lib/savedSearchOwnerAccess";
import { ownerSavedBlogPostExportRows } from "@/lib/savedBlogPostOwnerAccess";
import { ownerCartExportRows } from "@/lib/cartOwnerAccess";
import { ownerFavoriteExportRows } from "@/lib/favoriteAccess";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { exportOwnedDirectUploads } from "@/lib/directUploadLifecycle";
import { exportParticipantCases } from "@/lib/caseAccountExportAuthority";
import { exportSellerPayoutEvents } from "@/lib/sellerPayoutEventAuthority";
import {
  exportBuyerOrderPaymentHistory,
  exportSellerOrderPaymentHistory,
} from "@/lib/orderPaymentEventReadAuthority";
import { withDbUserContext } from "@/lib/dbUserContext";
import { exportOwnerEmailServiceData } from "@/lib/emailServiceAccess";
import {
  exportBuyerOrders,
  exportSellerOrders,
} from "@/lib/orderParticipantExportAuthority";
import { sellerOwnerExportProfile } from "@/lib/sellerOwnerPrivateAccess";
import { sellerOwnerFollowExportRows } from "@/lib/sellerProfileParticipantAccess";
import { ownerStockNotificationExportRows } from "@/lib/stockNotificationAccess";
import { exportOwnerReviewVotes } from "@/lib/reviewVoteAccess";
import { exportOwnerMakerVerification } from "@/lib/makerVerificationAccess";
import { ownerSellerBroadcastExport } from "@/lib/sellerBroadcastAccess";
import { ownerBlockExportRows } from "@/lib/blockAccess";
import {
  exportReceivedUserReports,
  exportSubmittedUserReports,
} from "@/lib/userReportAccess";
import { ownerSellerFaqExportRows } from "@/lib/sellerFaqAccess";
import { listingOwnerExportRows } from "@/lib/listingOwnerAccess";
import { listingActorReviewContexts } from "@/lib/listingReviewHistoryAccess";

export const runtime = "nodejs";

type ExportableUser = Awaited<ReturnType<typeof ensureUser>>;

function jsonDownload(data: unknown, userId: string) {
  return accountExportJsonResponse(data, userId);
}

async function exportOwnerReviews(userId: string) {
  const reviews = await prisma.review.findMany({
    where: { reviewerId: userId },
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
    },
  });
  const contexts = await listingActorReviewContexts(
    userId,
    reviews.map((review) => review.id),
  );
  const contextByReviewId = new Map(contexts.map((context) => [context.reviewId, context]));
  if (contextByReviewId.size !== reviews.length) {
    throw new Error("Account export Listing review history is incomplete");
  }
  return reviews.map((review) => ({
    ...review,
    listing: { title: contextByReviewId.get(review.id)!.listingTitle },
  }));
}

async function buildExport(user: NonNullable<ExportableUser>) {
  const accountEmail = normalizeEmailAddress(user.email ?? "") ?? user.email?.trim().toLowerCase() ?? null;
  const accountEmailState = await ownerUserAccountEmailAddressState(
    user.id,
    accountEmail,
  );
  const accountEmailAddresses = accountEmailState.rows;
  const sellerProfile = await sellerOwnerExportProfile(user.id);

  const [
    listings,
    buyerOrders,
    sellerOrders,
    buyerPaymentHistory,
    sellerPaymentHistory,
    messageRows,
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
    emailServiceData,
    stockNotifications,
    checkoutStockReservationRows,
    makerVerification,
    sellerFaqs,
    sellerBroadcasts,
    sellerPayoutEvents,
    directUploads,
    reviewVotes,
  ] = await Promise.all([
    sellerProfile ? listingOwnerExportRows(user.id) : [],
    exportBuyerOrders(user.id),
    sellerProfile ? exportSellerOrders(user.id) : [],
    exportBuyerOrderPaymentHistory(user.id),
    sellerProfile ? exportSellerOrderPaymentHistory(user.id) : new Map(),
    exportActorMessages(user.id),
    exportParticipantCases(user.id),
    exportOwnerReviews(user.id),
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
    ownerFavoriteExportRows(user.id),
    listOwnerSavedSearches(user.id, prisma),
    sellerOwnerFollowExportRows(user.id),
    ownerSavedBlogPostExportRows(user.id),
    ownerCommissionRequestExport(user.id),
    ownerCommissionInterestExport(user.id),
    ownerNotificationExportRows(user.id),
    ownerBlockExportRows(user.id),
    exportSubmittedUserReports(user.id),
    exportReceivedUserReports(user.id),
    exportOwnerSupportRequests(user.id),
    withDbUserContext(user.id, (tx) => exportOwnerEmailServiceData(tx)),
    ownerStockNotificationExportRows(user.id),
    exportCheckoutStockReservations(user.id),
    sellerProfile ? exportOwnerMakerVerification(user.id) : null,
    ownerSellerFaqExportRows(user.id),
    sellerProfile ? ownerSellerBroadcastExport(user.id) : [],
    sellerProfile ? exportSellerPayoutEvents(user.id) : [],
    exportOwnedDirectUploads(user.id),
    exportOwnerReviewVotes(user.id),
  ]);
  const {
    emailSuppressions,
    emailOutboxRows,
    emailFailureCounts,
    newsletterSubscriptions,
  } = emailServiceData;
  const messagesSent = messageRows
    .filter((message) => message.senderId === user.id)
    .map(({ senderId: _senderId, ...message }) => message);
  const messagesReceived = messageRows
    .filter((message) => message.recipientId === user.id)
    .map(({ recipientId: _recipientId, ...message }) => message);
  const commissionRequests = commissionRequestRows;
  const checkoutStockReservations = checkoutStockReservationRows;
  const buyerOrdersWithPaymentHistory = buyerOrders.map((order) => ({
    ...order,
    paymentEvents: buyerPaymentHistory.get(order.id) ?? [],
  }));
  const sellerOrdersWithPaymentHistory = sellerOrders.map((order) => ({
    ...order,
    paymentEvents: sellerPaymentHistory.get(order.id) ?? [],
  }));

  return buildAccountExportPayload(user, {
    accountEmailAddresses,
    sellerProfile,
    listings,
    buyerOrders: buyerOrdersWithPaymentHistory,
    sellerOrders: sellerOrdersWithPaymentHistory,
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
