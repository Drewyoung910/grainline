import { prisma } from "@/lib/db";
import { accountDeletionMediaUrlsForCleanup } from "@/lib/urlValidation";
import { redis } from "@/lib/ratelimit";
import { removeSellerCommissionInterests } from "@/lib/commissionInterestCleanup";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
import { invalidateAccountStateCache } from "@/lib/accountStateCache";
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
import {
  ACCOUNT_DELETION_SIDE_EFFECT_KIND,
  type AccountDeletionAuditRedactionUpdate,
  enqueueAccountDeletionAuditRedactionSideEffects,
  enqueueAccountDeletionLocalAnonymizeSideEffect,
  enqueueAccountDeletionMediaDeleteSideEffects,
  markAccountDeletionLocalAnonymizeDone,
  processAccountDeletionSideEffectsForUser,
  runAccountDeletionStripeRejectSideEffect,
} from "@/lib/accountDeletionSideEffects";

const ACTIVE_FULFILLMENT_STATUSES = ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] as const;
export const ACCOUNT_DELETION_TERMINAL_ORDER_BLOCK_DAYS = 30;
const ACTIVE_CASE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] as const;
const ACTIVE_COMMISSION_STATUSES = ["OPEN", "IN_PROGRESS"] as const;
const ACCOUNT_DELETION_REDACTION_BATCH_SIZE = 500;
const ACCOUNT_DELETION_LOCK_TTL_SECONDS = 120;

export type AccountDeletionLock = {
  key: string;
  userId: string;
};

export type AccountDeletionBlocker = {
  code: "buyer_orders" | "seller_orders" | "open_cases" | "active_commissions";
  count: number;
  message: string;
};

type AuditLogRedactionCandidate = {
  metadata: Prisma.JsonValue;
  reason: string | null;
  directAccountReference: boolean;
};

type NotificationRedactionCandidate = {
  title: string;
  body: string;
};

type BodyRedactionCandidate = {
  body: string;
};

type AuditLogRedactionDb = Pick<Prisma.TransactionClient, "$queryRaw" | "adminAuditLog">;
type AccountDeletionMediaDb = Pick<
  Prisma.TransactionClient,
  "sellerProfile" | "reviewPhoto" | "commissionRequest" | "message" | "blogPost"
>;

function accountDeletionLockKey(userId: string) {
  return `account-delete:${userId}`;
}

function accountDeletionFulfillmentBlockerWhere(now = new Date()): Prisma.OrderWhereInput {
  const terminalCutoff = new Date(
    now.getTime() - ACCOUNT_DELETION_TERMINAL_ORDER_BLOCK_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    OR: [
      { fulfillmentStatus: { in: [...ACTIVE_FULFILLMENT_STATUSES] } },
      {
        fulfillmentStatus: "DELIVERED",
        OR: [
          { deliveredAt: null },
          { deliveredAt: { gte: terminalCutoff } },
        ],
      },
      {
        fulfillmentStatus: "PICKED_UP",
        OR: [
          { pickedUpAt: null },
          { pickedUpAt: { gte: terminalCutoff } },
        ],
      },
    ],
  };
}

export async function acquireAccountDeletionLock(userId: string): Promise<AccountDeletionLock | null> {
  const key = accountDeletionLockKey(userId);
  const lockResult = await redis.set(key, "1", {
    nx: true,
    ex: ACCOUNT_DELETION_LOCK_TTL_SECONDS,
  });
  return lockResult === "OK" ? { key, userId } : null;
}

export async function releaseAccountDeletionLock(lock: AccountDeletionLock) {
  await redis.del(lock.key).catch((error) => {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "account_delete_lock_release" },
      extra: { userId: lock.userId },
    });
  });
}

function mergeAuditLogRedactionCandidate(
  candidates: Map<string, AuditLogRedactionCandidate>,
  id: string,
  metadata: Prisma.JsonValue,
  reason: string | null,
  directAccountReference: boolean,
) {
  const existing = candidates.get(id);
  candidates.set(id, {
    metadata: existing?.metadata ?? metadata,
    reason: existing?.reason ?? reason,
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

function escapePostgresRegex(value: string) {
  return value.replace(/[\\.^$|?*+()[\]{}]/g, "\\$&");
}

function notificationTextMatchSql(value: string) {
  const normalized = value.toLowerCase();
  if (Array.from(normalized).length >= 3) {
    return Prisma.sql`(
      position(${normalized} in lower(title)) > 0 OR
      position(${normalized} in lower(body)) > 0
    )`;
  }

  const pattern = `(^|[^[:alnum:]])${escapePostgresRegex(normalized)}([^[:alnum:]]|$)`;
  return Prisma.sql`(
    lower(title) ~ ${pattern} OR
    lower(body) ~ ${pattern}
  )`;
}

function bodyTextMatchSql(value: string) {
  const normalized = value.toLowerCase();
  if (Array.from(normalized).length >= 3) {
    return Prisma.sql`position(${normalized} in lower(body)) > 0`;
  }

  const pattern = `(^|[^[:alnum:]])${escapePostgresRegex(normalized)}([^[:alnum:]]|$)`;
  return Prisma.sql`lower(body) ~ ${pattern}`;
}

async function collectAuditLogsBySensitiveMetadata(
  db: AuditLogRedactionDb,
  candidates: Map<string, AuditLogRedactionCandidate>,
  sensitiveValues: string[],
) {
  for (const value of sensitiveValues) {
    const normalized = value.toLowerCase();
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, metadata, reason
          FROM "AdminAuditLog"
          WHERE id > ${cursor}
            AND (
              position(${normalized} in lower(metadata::text)) > 0 OR
              position(${normalized} in lower(COALESCE(reason, ''))) > 0
            )
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, metadata, reason
          FROM "AdminAuditLog"
          WHERE (
            position(${normalized} in lower(metadata::text)) > 0 OR
            position(${normalized} in lower(COALESCE(reason, ''))) > 0
          )
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `;
      const matches: { id: string; metadata: Prisma.JsonValue; reason: string | null }[] = await db.$queryRaw(query);
      matches.forEach((log) => mergeAuditLogRedactionCandidate(candidates, log.id, log.metadata, log.reason, false));

      if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
      cursor = matches[matches.length - 1]?.id ?? null;
      if (!cursor) break;
    }
  }
}

async function collectAuditLogsByAccountReference(
  db: AuditLogRedactionDb,
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
    const matches = await db.adminAuditLog.findMany({
      where,
      select: { id: true, metadata: true, reason: true },
      orderBy: { id: "asc" },
      take: ACCOUNT_DELETION_REDACTION_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    matches.forEach((log) => mergeAuditLogRedactionCandidate(candidates, log.id, log.metadata, log.reason, true));

    if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
    cursor = matches[matches.length - 1]?.id;
    if (!cursor) break;
  }
}

async function collectAdminAuditLogRedactionUpdates({
  db,
  adminId,
  targetIds,
  sensitiveValues,
}: {
  db: AuditLogRedactionDb;
  adminId: string;
  targetIds: string[];
  sensitiveValues: string[];
}): Promise<AccountDeletionAuditRedactionUpdate[]> {
  const candidates = new Map<string, AuditLogRedactionCandidate>();
  await collectAuditLogsBySensitiveMetadata(db, candidates, sensitiveValues);
  await collectAuditLogsByAccountReference(db, candidates, adminId, targetIds);

  const updates: AccountDeletionAuditRedactionUpdate[] = [];
  for (const [id, candidate] of candidates) {
    const redacted = redactAccountDeletionAuditMetadata(
      candidate.metadata as Parameters<typeof redactAccountDeletionAuditMetadata>[0],
      sensitiveValues,
    );
    const marked = candidate.directAccountReference
      ? markAccountDeletionAuditMetadata(redacted.metadata)
      : { metadata: redacted.metadata, changed: false };
    const reason = candidate.reason
      ? redactAccountDeletionText(candidate.reason, sensitiveValues)
      : { text: null, changed: false };

    if (!redacted.changed && !marked.changed && !reason.changed) continue;
    updates.push({
      logId: id,
      metadata: marked.metadata,
      ...(reason.changed && reason.text !== null ? { reason: reason.text } : {}),
    });
  }
  return updates;
}

async function collectNotificationsBySensitiveText(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  const notifications = new Map<string, NotificationRedactionCandidate>();

  for (const value of sensitiveValues.filter((item) => Array.from(item).length >= 2)) {
    const textMatchSql = notificationTextMatchSql(value);
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, title, body
          FROM "Notification"
          WHERE id > ${cursor}
            AND "userId" <> ${deletedUserId}
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, title, body
          FROM "Notification"
          WHERE "userId" <> ${deletedUserId}
            AND ${textMatchSql}
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

async function collectMessagesBySensitiveText(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  const messages = new Map<string, BodyRedactionCandidate>();

  for (const value of sensitiveValues.filter((item) => Array.from(item).length >= 2)) {
    const textMatchSql = bodyTextMatchSql(value);
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, body
          FROM "Message"
          WHERE id > ${cursor}
            AND "senderId" <> ${deletedUserId}
            AND "recipientId" = ${deletedUserId}
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, body
          FROM "Message"
          WHERE "senderId" <> ${deletedUserId}
            AND "recipientId" = ${deletedUserId}
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `;
      const matches: { id: string; body: string }[] = await tx.$queryRaw(query);
      matches.forEach((message) => {
        if (!messages.has(message.id)) {
          messages.set(message.id, { body: message.body });
        }
      });

      if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
      cursor = matches[matches.length - 1]?.id ?? null;
      if (!cursor) break;
    }
  }

  return messages;
}

async function redactMessagesAboutDeletedAccount(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  const messages = await collectMessagesBySensitiveText(tx, deletedUserId, sensitiveValues);

  for (const [id, message] of messages) {
    const body = redactAccountDeletionText(message.body, sensitiveValues);
    if (!body.changed) continue;

    await tx.message.update({
      where: { id },
      data: { body: body.text },
    });
  }
}

async function collectCaseMessagesBySensitiveText(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  const messages = new Map<string, BodyRedactionCandidate>();

  for (const value of sensitiveValues.filter((item) => Array.from(item).length >= 2)) {
    const textMatchSql = bodyTextMatchSql(value);
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, body
          FROM "CaseMessage"
          WHERE id > ${cursor}
            AND "authorId" <> ${deletedUserId}
            AND "caseId" IN (
              SELECT id
              FROM "Case"
              WHERE "buyerId" = ${deletedUserId}
                OR "sellerId" = ${deletedUserId}
            )
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, body
          FROM "CaseMessage"
          WHERE "authorId" <> ${deletedUserId}
            AND "caseId" IN (
              SELECT id
              FROM "Case"
              WHERE "buyerId" = ${deletedUserId}
                OR "sellerId" = ${deletedUserId}
            )
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `;
      const matches: { id: string; body: string }[] = await tx.$queryRaw(query);
      matches.forEach((message) => {
        if (!messages.has(message.id)) {
          messages.set(message.id, { body: message.body });
        }
      });

      if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
      cursor = matches[matches.length - 1]?.id ?? null;
      if (!cursor) break;
    }
  }

  return messages;
}

async function redactCaseMessagesAboutDeletedAccount(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  const messages = await collectCaseMessagesBySensitiveText(tx, deletedUserId, sensitiveValues);

  for (const [id, message] of messages) {
    const body = redactAccountDeletionText(message.body, sensitiveValues);
    if (!body.changed) continue;

    await tx.caseMessage.update({
      where: { id },
      data: { body: body.text },
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

  function deletedAccountBlogSlug(postId: string, collisionIndex = 0) {
    return collisionIndex === 0 ? `deleted-${postId}` : `deleted-${postId}-${collisionIndex}`;
  }

  async function deletedAccountAvailableBlogSlug(postId: string) {
    for (let collisionIndex = 0; collisionIndex < 100; collisionIndex += 1) {
      const slug = deletedAccountBlogSlug(postId, collisionIndex);
      const existing = await tx.blogPost.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!existing || existing.id === postId) return slug;
    }
    throw new Error("Could not allocate deleted-account blog archive slug.");
  }

  for (;;) {
    const posts = await tx.blogPost.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
      take: ACCOUNT_DELETION_REDACTION_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    for (const post of posts) {
      const archivedSlug = await deletedAccountAvailableBlogSlug(post.id);
      await tx.blogPost.update({
        where: { id: post.id },
        data: {
          slug: archivedSlug,
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
  const fulfillmentBlockerWhere = accountDeletionFulfillmentBlockerWhere();

  const [buyerOrders, sellerOrders, openCases, activeCommissions] = await Promise.all([
    prisma.order.count({
      where: {
        buyerId: userId,
        ...fulfillmentBlockerWhere,
        sellerRefundId: null,
        paymentEvents: { none: blockingRefundLedgerWhere() },
      },
    }),
    seller
      ? prisma.order.count({
          where: {
            ...fulfillmentBlockerWhere,
            sellerRefundId: null,
            paymentEvents: { none: blockingRefundLedgerWhere() },
            items: {
              some: { listing: { sellerId: seller.id } },
              every: { listing: { sellerId: seller.id } },
            },
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
      message: "You have buyer orders that are still open or within the case window. Wait until the case window closes or a refund is issued before deleting your account.",
    });
  }
  if (sellerOrders > 0) {
    blockers.push({
      code: "seller_orders",
      count: sellerOrders,
      message: "You have sales that are still open or within the case window. Fulfill, refund, or wait until the case window closes before deleting your account.",
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

async function collectAccountDeletionMediaUrls(
  db: AccountDeletionMediaDb,
  userId: string,
  clerkUserId: string,
): Promise<string[]> {
  const urls = new Set<string>();
  const [sellerProfile, reviewPhotos, commissionRequests, messages, blogPosts] = await Promise.all([
    db.sellerProfile.findUnique({
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
    db.reviewPhoto.findMany({
      where: { review: { reviewerId: userId } },
      select: { url: true },
    }),
    db.commissionRequest.findMany({
      where: { buyerId: userId },
      select: { referenceImageUrls: true },
    }),
    db.message.findMany({
      where: { senderId: userId },
      select: { body: true },
    }),
    db.blogPost.findMany({
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

  return accountDeletionMediaUrlsForCleanup(urls, clerkUserId);
}

function revalidateDeletedAccountSearchCaches(userId: string) {
  try {
    revalidatePublicSellerVisibilityCaches();
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "account_delete_search_cache_revalidate" },
      extra: { userId },
    });
  }
}

async function disableSellerOrderabilityAfterStripeReject(input: {
  userId: string;
  stripeAccountId: string;
  stripeAccountVersion: string | null;
  stripeControllerType: string | null;
}) {
  try {
    await prisma.sellerProfile.updateMany({
      where: { userId: input.userId, stripeAccountId: input.stripeAccountId },
      data: { chargesEnabled: false, vacationMode: true },
    });
    revalidateDeletedAccountSearchCaches(input.userId);
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "account_delete_stripe_reject_local_disable" },
      extra: {
        userId: input.userId,
        stripeAccountId: input.stripeAccountId,
        stripeAccountVersion: input.stripeAccountVersion,
        stripeControllerType: input.stripeControllerType,
      },
    });
  }
}

export async function anonymizeUserAccount(
  userId: string,
  options: { lockAlreadyAcquired?: boolean } = {},
) {
  const deletionLockKey = accountDeletionLockKey(userId);
  const lock = options.lockAlreadyAcquired
    ? { key: deletionLockKey, userId }
    : await acquireAccountDeletionLock(userId);
  if (!lock) return { ok: false, alreadyDeleted: false, inProgress: true };

  try {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      clerkId: true,
      deletedAt: true,
      sellerProfile: {
        select: {
          stripeAccountId: true,
          stripeAccountVersion: true,
          stripeControllerType: true,
        },
      },
    },
  });

  if (!account) return { ok: true, alreadyDeleted: true };
  if (account.deletedAt) return { ok: true, alreadyDeleted: true };
  await enqueueAccountDeletionLocalAnonymizeSideEffect(prisma, userId);

  const stripeAccountId = account.sellerProfile?.stripeAccountId ?? null;
  const stripeAccountVersion = account.sellerProfile?.stripeAccountVersion ?? null;
  const stripeControllerType = account.sellerProfile?.stripeControllerType ?? null;
  const stripeRejectSucceeded = stripeAccountId
    ? await runAccountDeletionStripeRejectSideEffect({
        userId,
        stripeAccountId,
        stripeAccountVersion,
        stripeControllerType,
      })
    : true;
  if (stripeRejectSucceeded && stripeAccountId) {
    await disableSellerOrderabilityAfterStripeReject({
      userId,
      stripeAccountId,
      stripeAccountVersion,
      stripeControllerType,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: { select: { id: true, displayName: true } } },
    });

    if (!user) return { ok: true, alreadyDeleted: true, auditTargetIds: [], accountSensitiveValues: [] };
    if (user.deletedAt) return { ok: true, alreadyDeleted: true, auditTargetIds: [], accountSensitiveValues: [] };

    const now = new Date();
    const deletedEmail = `deleted+${user.id}@deleted.thegrainline.local`;
    const deletedClerkId = `deleted:${user.id}:${now.getTime()}`;
    const auditTargetIds = [user.id, user.sellerProfile?.id].filter(Boolean) as string[];
    const accountSensitiveValues = normalizedSensitiveValues([
      user.id,
      user.clerkId,
      user.email,
      user.name,
      user.shippingName,
      user.shippingLine1,
      user.shippingLine2,
      user.shippingCity,
      user.shippingState,
      user.shippingPostalCode,
      user.shippingPhone,
      user.sellerProfile?.id,
      user.sellerProfile?.displayName,
    ]);
    const mediaUrls = await collectAccountDeletionMediaUrls(tx, user.id, user.clerkId);
    await enqueueAccountDeletionMediaDeleteSideEffects(tx, user.id, mediaUrls);

    await tx.adminAuditLog.create({
      data: {
        adminId: user.id,
        action: "USER_ACCOUNT_DELETE",
        targetType: "USER",
        targetId: user.id,
        reason: "User requested account deletion",
        metadata: {
          actorKind: "user",
          hadSellerProfile: Boolean(user.sellerProfile),
          hadStripeAccount: Boolean(stripeAccountId),
          stripeRejectSucceeded,
          deletedAt: now.toISOString(),
        },
      },
    });

    await tx.cart.deleteMany({ where: { userId: user.id } });
    await tx.favorite.deleteMany({ where: { userId: user.id } });
    await tx.savedSearch.deleteMany({ where: { userId: user.id } });
    await tx.stockNotification.deleteMany({ where: { userId: user.id } });
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await tx.savedBlogPost.deleteMany({ where: { userId: user.id } });
    await tx.reviewVote.deleteMany({ where: { userId: user.id } });
    await tx.block.deleteMany({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] } });
    await redactNotificationsAboutDeletedAccount(tx, user.id, accountSensitiveValues);
    await tx.message.updateMany({
      where: { senderId: user.id },
      data: { body: "[Message deleted]" },
    });
    await redactMessagesAboutDeletedAccount(tx, user.id, accountSensitiveValues);
    await tx.caseMessage.updateMany({
      where: { authorId: user.id },
      data: { body: "[Message deleted]" },
    });
    await redactCaseMessagesAboutDeletedAccount(tx, user.id, accountSensitiveValues);
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
        shipToCity: null,
        shipToState: null,
        shipToPostalCode: null,
        shipToCountry: null,
        quotedToLine1: null,
        quotedToLine2: null,
        quotedToCity: null,
        quotedToState: null,
        quotedToPostalCode: null,
        quotedToCountry: null,
        quotedToName: null,
        quotedToPhone: null,
        trackingCarrier: null,
        trackingNumber: null,
        sellerNotes: null,
        shippoShipmentId: null,
        shippoRateObjectId: null,
        shippoTransactionId: null,
        labelUrl: null,
        labelCarrier: null,
        labelTrackingNumber: null,
        giftNote: null,
        buyerDataPurgedAt: now,
      },
    });
    await tx.userReport.updateMany({
      where: { OR: [{ reporterId: user.id }, { reportedId: user.id }] },
      data: { details: null },
    });
    await tx.userReport.updateMany({
      where: { reportedId: user.id, resolved: false },
      data: {
        resolved: true,
        resolvedAt: now,
        resolvedById: null,
        resolutionNote: "Auto-resolved after the reported account was deleted.",
      },
    });
    const suppressionEmail = normalizeEmailAddress(user.email) ?? user.email.trim().toLowerCase();
    await tx.emailOutbox.updateMany({
      where: {
        OR: [{ userId: user.id }, { recipientEmail: suppressionEmail }],
        sentAt: null,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      data: {
        status: "SKIPPED",
        subject: "Email skipped after account deletion",
        html: "[Email removed after account deletion]",
        nextAttemptAt: null,
        sentAt: now,
        lastError: "Skipped because the recipient account was deleted.",
      },
    });
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
    await tx.commissionRequest.updateMany({
      where: { buyerId: user.id, status: { in: [...ACTIVE_COMMISSION_STATUSES] } },
      data: { status: "CLOSED" },
    });

    if (user.sellerProfile) {
      if (stripeRejectSucceeded) {
        await tx.sellerProfile.updateMany({
          where: { userId: user.id },
          data: { chargesEnabled: false, vacationMode: true },
        });
      }
      await removeSellerCommissionInterests(tx, user.sellerProfile.id);
      await tx.sellerMetrics.deleteMany({
        where: { sellerProfileId: user.sellerProfile.id },
      });
      await tx.sellerRatingSummary.deleteMany({
        where: { sellerProfileId: user.sellerProfile.id },
      });
      await tx.review.updateMany({
        where: { listing: { sellerId: user.sellerProfile.id } },
        data: { sellerReply: null, sellerReplyAt: null },
      });
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
      await tx.order.updateMany({
        where: {
          items: {
            some: { listing: { sellerId: user.sellerProfile.id } },
            every: { listing: { sellerId: user.sellerProfile.id } },
          },
        },
        data: { sellerNotes: null },
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
          stripeAccountVersion: null,
          stripeControllerType: null,
          chargesEnabled: false,
          manualStripeReconciliationNeeded: !stripeRejectSucceeded,
          manualStripeReconciliationNote: stripeRejectSucceeded
            ? null
            : `Account deletion could not reject Stripe Connect account ${stripeAccountId} (${stripeAccountVersion ?? "legacy/unknown"}; ${stripeControllerType ?? "controller unknown"}); manual Stripe dashboard reconciliation required.`,
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
          galleryAltTexts: [],
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

    return {
      ok: true,
      alreadyDeleted: false,
      auditTargetIds,
      accountSensitiveValues,
    };
  }, { timeout: 30000, maxWait: 10000 }).catch((error) => {
    if (stripeRejectSucceeded && stripeAccountId) {
      Sentry.captureException(error, {
        tags: { source: "account_delete_partial" },
        extra: {
          userId,
          stripeAccountId,
          stripeAccountVersion,
          stripeControllerType,
        },
      });
    }
    throw error;
  });

  await markAccountDeletionLocalAnonymizeDone(prisma, userId);

  if (!result.alreadyDeleted) {
    await invalidateAccountStateCache(account.clerkId, "account_delete_account_state_cache_invalidate");
    revalidateDeletedAccountSearchCaches(userId);

    try {
      const redactionUpdates = await collectAdminAuditLogRedactionUpdates({
        db: prisma,
        adminId: userId,
        targetIds: result.auditTargetIds,
        sensitiveValues: result.accountSensitiveValues,
      });
      await enqueueAccountDeletionAuditRedactionSideEffects(prisma, userId, redactionUpdates);
      const redactionResult = await processAccountDeletionSideEffectsForUser(userId, [
        ACCOUNT_DELETION_SIDE_EFFECT_KIND.AUDIT_REDACT,
      ]);
      if (redactionResult.failed > 0) {
        Sentry.captureMessage("Account deletion audit redaction side effects pending retry", {
          level: "warning",
          tags: { source: "account_delete_audit_redaction" },
          extra: { userId, failed: redactionResult.failed },
        });
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: "account_delete_audit_redaction" },
        extra: { userId },
      });
    }

    const mediaResult = await processAccountDeletionSideEffectsForUser(userId, [
      ACCOUNT_DELETION_SIDE_EFFECT_KIND.MEDIA_DELETE,
    ]);
    if (mediaResult.failed > 0) {
      Sentry.captureMessage("Account deletion media cleanup side effects pending retry", {
        level: "warning",
        tags: { source: "account_delete_media_cleanup" },
        extra: { userId, failed: mediaResult.failed },
      });
    }
  }

  return { ok: result.ok, alreadyDeleted: result.alreadyDeleted };
  } finally {
    await releaseAccountDeletionLock(lock);
  }
}

export async function anonymizeUserAccountByClerkId(clerkId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (!user) return { ok: true, alreadyDeleted: true };
  return anonymizeUserAccount(user.id);
}
