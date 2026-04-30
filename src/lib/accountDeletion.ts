import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { deleteR2ObjectByUrl } from "@/lib/r2";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  Prisma,
  EmailSuppressionReason,
} from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import {
  markAccountDeletionAuditMetadata,
  redactAccountDeletionAuditMetadata,
  redactAccountDeletionText,
} from "@/lib/accountDeletionAuditRedaction";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";

const ACTIVE_FULFILLMENT_STATUSES = ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] as const;
const ACTIVE_CASE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] as const;
const ACTIVE_COMMISSION_STATUSES = ["OPEN", "IN_PROGRESS"] as const;
const ACCOUNT_DELETION_REDACTION_BATCH_SIZE = 500;

export type AccountDeletionBlocker = {
  code: "buyer_orders" | "seller_orders" | "open_cases" | "active_commissions";
  count: number;
  message: string;
};

type AuditLogRedactionCandidate = {
  metadata: Prisma.JsonValue;
  directAccountReference: boolean;
};

type NotificationRedactionCandidate = {
  title: string;
  body: string;
};

function mergeAuditLogRedactionCandidate(
  candidates: Map<string, AuditLogRedactionCandidate>,
  id: string,
  metadata: Prisma.JsonValue,
  directAccountReference: boolean,
) {
  const existing = candidates.get(id);
  candidates.set(id, {
    metadata: existing?.metadata ?? metadata,
    directAccountReference: Boolean(existing?.directAccountReference || directAccountReference),
  });
}

function normalizedSensitiveValues(values: Iterable<string | null | undefined>) {
  const seen = new Set<string>();
  return [...values]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function collectAuditLogsBySensitiveMetadata(
  tx: Prisma.TransactionClient,
  candidates: Map<string, AuditLogRedactionCandidate>,
  sensitiveValues: string[],
) {
  for (const value of sensitiveValues) {
    const normalized = value.toLowerCase();
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, metadata
          FROM "AdminAuditLog"
          WHERE id > ${cursor}
            AND position(${normalized} in lower(metadata::text)) > 0
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, metadata
          FROM "AdminAuditLog"
          WHERE position(${normalized} in lower(metadata::text)) > 0
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `;
      const matches: { id: string; metadata: Prisma.JsonValue }[] = await tx.$queryRaw(query);
      matches.forEach((log) => mergeAuditLogRedactionCandidate(candidates, log.id, log.metadata, false));

      if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
      cursor = matches[matches.length - 1]?.id ?? null;
      if (!cursor) break;
    }
  }
}

async function collectAuditLogsByAccountReference(
  tx: Prisma.TransactionClient,
  candidates: Map<string, AuditLogRedactionCandidate>,
  adminId: string,
  targetIds: string[],
) {
  let cursor: string | undefined;
  const where: Prisma.AdminAuditLogWhereInput = {
    OR: [
      { adminId },
      ...(targetIds.length > 0 ? [{ targetId: { in: targetIds } }] : []),
    ],
  };

  for (;;) {
    const matches = await tx.adminAuditLog.findMany({
      where,
      select: { id: true, metadata: true },
      orderBy: { id: "asc" },
      take: ACCOUNT_DELETION_REDACTION_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    matches.forEach((log) => mergeAuditLogRedactionCandidate(candidates, log.id, log.metadata, true));

    if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
    cursor = matches[matches.length - 1]?.id;
    if (!cursor) break;
  }
}

async function redactAdminAuditLogsForAccountDeletion({
  tx,
  adminId,
  targetIds,
  sensitiveValues,
}: {
  tx: Prisma.TransactionClient;
  adminId: string;
  targetIds: string[];
  sensitiveValues: string[];
}) {
  const candidates = new Map<string, AuditLogRedactionCandidate>();
  await collectAuditLogsBySensitiveMetadata(tx, candidates, sensitiveValues);
  await collectAuditLogsByAccountReference(tx, candidates, adminId, targetIds);

  for (const [id, candidate] of candidates) {
    const redacted = redactAccountDeletionAuditMetadata(
      candidate.metadata as Parameters<typeof redactAccountDeletionAuditMetadata>[0],
      sensitiveValues,
    );
    const marked = candidate.directAccountReference
      ? markAccountDeletionAuditMetadata(redacted.metadata)
      : { metadata: redacted.metadata, changed: false };

    if (!redacted.changed && !marked.changed) continue;
    await tx.adminAuditLog.update({
      where: { id },
      data: { metadata: marked.metadata as Prisma.InputJsonValue },
    });
  }
}

async function collectNotificationsBySensitiveText(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  const notifications = new Map<string, NotificationRedactionCandidate>();

  for (const value of sensitiveValues.filter((item) => item.length >= 3)) {
    const normalized = value.toLowerCase();
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, title, body
          FROM "Notification"
          WHERE id > ${cursor}
            AND "userId" <> ${deletedUserId}
            AND (
              position(${normalized} in lower(title)) > 0 OR
              position(${normalized} in lower(body)) > 0
            )
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, title, body
          FROM "Notification"
          WHERE "userId" <> ${deletedUserId}
            AND (
              position(${normalized} in lower(title)) > 0 OR
              position(${normalized} in lower(body)) > 0
            )
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `;
      const matches: { id: string; title: string; body: string }[] = await tx.$queryRaw(query);
      matches.forEach((notification) => {
        if (!notifications.has(notification.id)) {
          notifications.set(notification.id, {
            title: notification.title,
            body: notification.body,
          });
        }
      });

      if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
      cursor = matches[matches.length - 1]?.id ?? null;
      if (!cursor) break;
    }
  }

  return notifications;
}

async function redactNotificationsAboutDeletedAccount(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  const notifications = await collectNotificationsBySensitiveText(tx, deletedUserId, sensitiveValues);

  for (const [id, notification] of notifications) {
    const title = redactAccountDeletionText(notification.title, sensitiveValues);
    const body = redactAccountDeletionText(notification.body, sensitiveValues);
    if (!title.changed && !body.changed) continue;

    await tx.notification.update({
      where: { id },
      data: {
        title: title.text,
        body: body.text,
      },
    });
  }
}

async function archiveBlogPostsForDeletedAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  sellerProfileId: string | null,
) {
  let cursor: string | undefined;
  const where: Prisma.BlogPostWhereInput = {
    OR: [
      { authorId: userId },
      ...(sellerProfileId ? [{ sellerProfileId }] : []),
    ],
  };

  for (;;) {
    const posts = await tx.blogPost.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
      take: ACCOUNT_DELETION_REDACTION_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    for (const post of posts) {
      await tx.blogPost.update({
        where: { id: post.id },
        data: {
          slug: `deleted-${post.id}`,
          title: "Deleted blog post",
          excerpt: null,
          body: "[Post removed]",
          coverImageUrl: null,
          videoUrl: null,
          authorId: null,
          sellerProfileId: null,
          status: "ARCHIVED",
          featuredListingIds: [],
          tags: [],
          metaDescription: null,
          publishedAt: null,
        },
      });
    }

    if (posts.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
    cursor = posts[posts.length - 1]?.id;
    if (!cursor) break;
  }
}

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
        paymentEvents: { none: blockingRefundLedgerWhere() },
      },
    }),
    seller
      ? prisma.order.count({
          where: {
            fulfillmentStatus: { in: [...ACTIVE_FULFILLMENT_STATUSES] },
            sellerRefundId: null,
            paymentEvents: { none: blockingRefundLedgerWhere() },
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

function messageAttachmentUrl(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { kind?: unknown }).kind === "file" &&
      typeof (parsed as { url?: unknown }).url === "string"
    ) {
      return (parsed as { url: string }).url;
    }
  } catch {
    return null;
  }
  return null;
}

function markdownImageUrls(markdown: string) {
  const urls = new Set<string>();
  const imagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(markdown)) !== null) {
    urls.add(match[1]);
  }

  return [...urls];
}

async function collectAccountDeletionMediaUrls(userId: string): Promise<string[]> {
  const urls = new Set<string>();
  const [sellerProfile, reviewPhotos, commissionRequests, messages, blogPosts] = await Promise.all([
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
    prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      select: { body: true },
    }),
    prisma.blogPost.findMany({
      where: { OR: [{ authorId: userId }, { sellerProfile: { userId } }] },
      select: { coverImageUrl: true, videoUrl: true, body: true },
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
  messages.forEach((message) => {
    const url = messageAttachmentUrl(message.body);
    if (url) urls.add(url);
  });
  blogPosts.forEach((post) => {
    if (post.coverImageUrl) urls.add(post.coverImageUrl);
    if (post.videoUrl) urls.add(post.videoUrl);
    markdownImageUrls(post.body).forEach((url) => urls.add(url));
  });

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

  const stripeAccountId = account.sellerProfile?.stripeAccountId ?? null;
  const stripeRejectSucceeded = stripeAccountId
    ? await rejectConnectedStripeAccount(stripeAccountId, userId)
    : true;

  const mediaUrls = await collectAccountDeletionMediaUrls(userId);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: { select: { id: true, displayName: true } } },
    });

    if (!user) return { ok: true, alreadyDeleted: true };
    if (user.deletedAt) return { ok: true, alreadyDeleted: true };

    const now = new Date();
    const deletedEmail = `deleted+${user.id}@deleted.thegrainline.local`;
    const deletedClerkId = `deleted:${user.id}:${now.getTime()}`;
    const auditTargetIds = [user.id, user.sellerProfile?.id].filter(Boolean) as string[];
    const accountSensitiveValues = normalizedSensitiveValues([
      user.id,
      user.clerkId,
      user.email,
      user.name,
      user.sellerProfile?.id,
      user.sellerProfile?.displayName,
    ]);

    await tx.cart.deleteMany({ where: { userId: user.id } });
    await tx.favorite.deleteMany({ where: { userId: user.id } });
    await tx.savedSearch.deleteMany({ where: { userId: user.id } });
    await tx.stockNotification.deleteMany({ where: { userId: user.id } });
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await tx.savedBlogPost.deleteMany({ where: { userId: user.id } });
    await tx.reviewVote.deleteMany({ where: { userId: user.id } });
    await tx.block.deleteMany({ where: { blockerId: user.id } });
    await redactNotificationsAboutDeletedAccount(tx, user.id, accountSensitiveValues);
    await tx.conversation.deleteMany({
      where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
    });
    await tx.message.updateMany({
      where: { senderId: user.id },
      data: { body: "[Message deleted]" },
    });
    await tx.caseMessage.updateMany({
      where: { authorId: user.id },
      data: { body: "[Message deleted]" },
    });
    await tx.blogComment.updateMany({
      where: { authorId: user.id },
      data: { body: "[Comment deleted]", approved: false },
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
    await redactAdminAuditLogsForAccountDeletion({
      tx,
      adminId: user.id,
      targetIds: auditTargetIds,
      sensitiveValues: accountSensitiveValues,
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
          manualStripeReconciliationNeeded: !stripeRejectSucceeded,
          manualStripeReconciliationNote: stripeRejectSucceeded
            ? null
            : `Account deletion could not reject Stripe Connect account ${stripeAccountId}; manual Stripe dashboard reconciliation required.`,
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

    await archiveBlogPostsForDeletedAccount(tx, user.id, user.sellerProfile?.id ?? null);
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
