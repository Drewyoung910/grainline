import { prisma } from "@/lib/db";
import { accountDeletionMediaUrlsForCleanup } from "@/lib/urlValidation";
import { redis } from "@/lib/ratelimit";
import { removeSellerCommissionInterests } from "@/lib/commissionInterestCleanup";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";
import {
  normalizeEmailSuppressionAddress,
} from "@/lib/emailSuppression";
import {
  accountEmailFallbackEmailsForUser,
  accountEmailSuppressionKeysForEmails,
  userAccountEmailAddressState,
} from "@/lib/userEmailAddresses";
import { supportRequestAccountExportWhere } from "@/lib/supportRequest";
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
import { REFUND_LOCK_SENTINEL } from "@/lib/refundLockState";
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
import { CASE_WINDOW_DAYS } from "@/lib/caseCreateState";

export const ACCOUNT_DELETION_TERMINAL_ORDER_BLOCK_DAYS = CASE_WINDOW_DAYS;
const ACTIVE_CASE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] as const;
const ACTIVE_COMMISSION_STATUSES = ["OPEN", "IN_PROGRESS"] as const;
const ACCOUNT_DELETION_REDACTION_BATCH_SIZE = 500;
const ACCOUNT_DELETION_LOCK_TTL_SECONDS = 120;
const DELETED_SUPPORT_REQUEST_EMAIL = "deleted-account@deleted.thegrainline.local";
const DELETED_SUPPORT_REQUEST_MESSAGE = "[Support request removed after account deletion]";

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

function chunks<T>(items: T[], size = ACCOUNT_DELETION_REDACTION_BATCH_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function accountDeletionLockKey(userId: string) {
  return `account-delete:${userId}`;
}

function accountDeletionTerminalCutoff(now = new Date()) {
  return new Date(
    now.getTime() - ACCOUNT_DELETION_TERMINAL_ORDER_BLOCK_DAYS * 24 * 60 * 60 * 1000,
  );
}

const ACCOUNT_DELETION_FULL_REFUND_SQL = Prisma.sql`
  o."sellerRefundId" IS NOT NULL
  AND o."sellerRefundId" <> ${REFUND_LOCK_SENTINEL}
  AND COALESCE(o."sellerRefundAmountCents", 0) > 0
  AND COALESCE(o."sellerRefundAmountCents", 0) >= (
    COALESCE(o."itemsSubtotalCents", 0) +
    COALESCE(o."shippingAmountCents", 0) +
    COALESCE(o."giftWrappingPriceCents", 0) +
    COALESCE(o."taxAmountCents", 0)
  )
`;

function accountDeletionFulfillmentBlockerSql(terminalCutoff: Date) {
  return Prisma.sql`
    (
      o."fulfillmentStatus" IN ('PENDING', 'READY_FOR_PICKUP', 'SHIPPED')
      OR (
        o."fulfillmentStatus" = 'DELIVERED'
        AND (o."deliveredAt" IS NULL OR o."deliveredAt" >= ${terminalCutoff})
      )
      OR (
        o."fulfillmentStatus" = 'PICKED_UP'
        AND (o."pickedUpAt" IS NULL OR o."pickedUpAt" >= ${terminalCutoff})
      )
    )
    AND NOT (${ACCOUNT_DELETION_FULL_REFUND_SQL})
  `;
}

function rawCount(rows: Array<{ count: bigint | number | string }>) {
  return Number(rows[0]?.count ?? 0);
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

function supportClosureEvidenceTextMatchSql(value: string) {
  const normalized = value.toLowerCase();
  if (Array.from(normalized).length >= 3) {
    return Prisma.sql`position(${normalized} in lower(COALESCE("closureEvidence", ''))) > 0`;
  }

  const pattern = `(^|[^[:alnum:]])${escapePostgresRegex(normalized)}([^[:alnum:]]|$)`;
  return Prisma.sql`lower(COALESCE("closureEvidence", '')) ~ ${pattern}`;
}

function auditMetadataTextMatchSql(value: string) {
  const normalized = value.toLowerCase();
  if (Array.from(normalized).length >= 3) {
    return Prisma.sql`(
      position(${normalized} in lower(metadata::text)) > 0 OR
      position(${normalized} in lower(COALESCE(reason, ''))) > 0
    )`;
  }

  const pattern = `(^|[^[:alnum:]])${escapePostgresRegex(normalized)}([^[:alnum:]]|$)`;
  return Prisma.sql`(
    lower(metadata::text) ~ ${pattern} OR
    lower(COALESCE(reason, '')) ~ ${pattern}
  )`;
}

async function collectAuditLogsBySensitiveMetadata(
  db: AuditLogRedactionDb,
  candidates: Map<string, AuditLogRedactionCandidate>,
  sensitiveValues: string[],
) {
  for (const value of sensitiveValues.filter((item) => Array.from(item).length >= 2)) {
    const textMatchSql = auditMetadataTextMatchSql(value);
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, metadata, reason
          FROM "AdminAuditLog"
          WHERE id > ${cursor}
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, metadata, reason
          FROM "AdminAuditLog"
          WHERE ${textMatchSql}
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

async function deleteNotificationSourceRows(
  tx: Prisma.TransactionClient,
  sourceType: string,
  sourceIds: string[],
) {
  for (const sourceIdChunk of chunks(sourceIds)) {
    await tx.notification.deleteMany({
      where: { sourceType, sourceId: { in: sourceIdChunk } },
    });
  }
}

async function deleteNotificationLinkRows(
  tx: Prisma.TransactionClient,
  whereInputs: Prisma.NotificationWhereInput[],
) {
  for (const whereChunk of chunks(whereInputs, 100)) {
    await tx.notification.deleteMany({ where: { OR: whereChunk } });
  }
}

async function redactEmailOutboxRowsForDeletedMaker(
  tx: Prisma.TransactionClient,
  whereInputs: Prisma.EmailOutboxWhereInput[],
  now: Date,
) {
  for (const whereChunk of chunks(whereInputs, 100)) {
    const where = { OR: whereChunk };
    await tx.emailOutbox.updateMany({
      where: {
        ...where,
        sentAt: null,
        status: { in: ["PENDING", "PROCESSING", "FAILED", "DEAD"] },
      },
      data: {
        status: "SKIPPED",
        nextAttemptAt: null,
        sentAt: now,
        lastError: "Skipped because the source maker account was deleted.",
      },
    });
    await tx.emailOutbox.updateMany({
      where,
      data: {
        subject: "Email removed after maker deletion",
        html: "[Email removed after maker deletion]",
      },
    });
  }
}

async function cleanupDeletedSellerFanoutRows(
  tx: Prisma.TransactionClient,
  sellerProfileId: string,
  now: Date,
) {
  const [broadcasts, listings, blogPosts] = await Promise.all([
    tx.sellerBroadcast.findMany({
      where: { sellerProfileId },
      select: { id: true },
    }),
    tx.listing.findMany({
      where: { sellerId: sellerProfileId },
      select: { id: true },
    }),
    tx.blogPost.findMany({
      where: { sellerProfileId },
      select: { id: true, slug: true },
    }),
  ]);

  const broadcastIds = broadcasts.map((broadcast) => broadcast.id);
  const listingIds = listings.map((listing) => listing.id);
  const blogPostIds = blogPosts.map((post) => post.id);
  const blogPostLinks = blogPosts.map((post) => `/blog/${post.slug}`);

  await deleteNotificationSourceRows(tx, "seller_broadcast", broadcastIds);
  await deleteNotificationSourceRows(tx, "followed_maker_new_listing", listingIds);
  await deleteNotificationSourceRows(tx, "followed_maker_new_blog", blogPostIds);

  await deleteNotificationLinkRows(tx, [
    ...broadcastIds.map((id) => ({
      type: "SELLER_BROADCAST" as const,
      link: `/account/feed?broadcast=${id}`,
    })),
    ...listingIds.map((id) => ({
      type: "FOLLOWED_MAKER_NEW_LISTING" as const,
      link: { startsWith: `/listing/${id}--` },
    })),
    ...listingIds.map((id) => ({
      type: "FOLLOWED_MAKER_NEW_LISTING" as const,
      link: `/listing/${id}`,
    })),
    ...blogPostLinks.map((link) => ({
      type: "FOLLOWED_MAKER_NEW_BLOG" as const,
      link,
    })),
  ]);

  await redactEmailOutboxRowsForDeletedMaker(
    tx,
    [
      ...broadcastIds.flatMap((id) => [
        {
          sourceType: "seller_broadcast",
          sourceId: id,
        },
        {
          templateName: "seller_broadcast",
          preferenceKey: "EMAIL_SELLER_BROADCAST",
          dedupKey: { startsWith: `seller-broadcast:${id}:` },
        },
      ]),
      ...listingIds.flatMap((id) => [
        {
          sourceType: "followed_maker_new_listing",
          sourceId: id,
        },
        {
          templateName: "followed_maker_new_listing",
          preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
          dedupKey: { startsWith: `followed-listing:${id}:` },
        },
        {
          templateName: "followed_maker_new_listing",
          preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
          dedupKey: { startsWith: `admin-approved-listing:${id}:` },
        },
        {
          templateName: "followed_maker_new_listing",
          preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
          dedupKey: { startsWith: `followed-listing-active:${id}:` },
        },
      ]),
    ],
    now,
  );
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

async function redactSupportRequestsForDeletedAccount(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  accountEmails: string[],
  sensitiveValues: string[],
) {
  const where = supportRequestAccountExportWhere(deletedUserId, accountEmails);
  let cursor: string | undefined;

  for (;;) {
    const requests = await tx.supportRequest.findMany({
      where,
      select: { id: true, closureEvidence: true, emailLastError: true },
      orderBy: { id: "asc" },
      take: ACCOUNT_DELETION_REDACTION_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    for (const request of requests) {
      const closureEvidence = request.closureEvidence
        ? redactAccountDeletionText(request.closureEvidence, sensitiveValues).text
        : null;
      const emailLastError = request.emailLastError
        ? redactAccountDeletionText(request.emailLastError, sensitiveValues).text
        : null;

      await tx.supportRequest.update({
        where: { id: request.id },
        data: {
          userId: null,
          name: null,
          email: DELETED_SUPPORT_REQUEST_EMAIL,
          orderId: null,
          listingId: null,
          message: DELETED_SUPPORT_REQUEST_MESSAGE,
          emailLastError,
          closureEvidence,
        },
      });
    }

    if (requests.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
    cursor = requests[requests.length - 1]?.id;
    if (!cursor) break;
  }
}

async function redactSupportClosureEvidenceByDeletedAccount(
  tx: Prisma.TransactionClient,
  deletedUserId: string,
  sensitiveValues: string[],
) {
  await tx.supportRequest.updateMany({
    where: { closureEvidenceById: deletedUserId },
    data: { closureEvidenceById: null },
  });

  const requests = new Map<string, { closureEvidence: string }>();

  for (const value of sensitiveValues.filter((item) => Array.from(item).length >= 2)) {
    const textMatchSql = supportClosureEvidenceTextMatchSql(value);
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.Sql = cursor
        ? Prisma.sql`
          SELECT id, "closureEvidence"
          FROM "SupportRequest"
          WHERE id > ${cursor}
            AND "closureEvidence" IS NOT NULL
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `
        : Prisma.sql`
          SELECT id, "closureEvidence"
          FROM "SupportRequest"
          WHERE "closureEvidence" IS NOT NULL
            AND ${textMatchSql}
          ORDER BY id ASC
          LIMIT ${ACCOUNT_DELETION_REDACTION_BATCH_SIZE}
        `;
      const matches: { id: string; closureEvidence: string }[] = await tx.$queryRaw(query);
      matches.forEach((request) => {
        if (!requests.has(request.id)) {
          requests.set(request.id, { closureEvidence: request.closureEvidence });
        }
      });

      if (matches.length < ACCOUNT_DELETION_REDACTION_BATCH_SIZE) break;
      cursor = matches[matches.length - 1]?.id ?? null;
      if (!cursor) break;
    }
  }

  for (const [id, request] of requests) {
    const closureEvidence = redactAccountDeletionText(request.closureEvidence, sensitiveValues);
    if (!closureEvidence.changed) continue;

    await tx.supportRequest.update({
      where: { id },
      data: { closureEvidence: closureEvidence.text },
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
  const fulfillmentBlockerSql = accountDeletionFulfillmentBlockerSql(accountDeletionTerminalCutoff());

  const [buyerOrders, sellerOrders, openCases, activeCommissions] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM "Order" o
      WHERE o."buyerId" = ${userId}
        AND ${fulfillmentBlockerSql}
    `.then(rawCount),
    seller
      ? prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT o.id) AS count
          FROM "Order" o
          WHERE ${fulfillmentBlockerSql}
            AND EXISTS (
              SELECT 1
              FROM "OrderItem" oi
              JOIN "Listing" l ON l.id = oi."listingId"
              WHERE oi."orderId" = o.id
                AND l."sellerId" = ${seller.id}
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "OrderItem" oi
              JOIN "Listing" l ON l.id = oi."listingId"
              WHERE oi."orderId" = o.id
                AND l."sellerId" <> ${seller.id}
            )
        `.then(rawCount)
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
            photos: { select: { url: true, originalUrl: true } },
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
      listing.photos.forEach((photo) => {
        urls.add(photo.url);
        if (photo.originalUrl) urls.add(photo.originalUrl);
      });
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

async function deferProviderDeletedAccountAnonymization(input: {
  userId: string;
  clerkId: string;
  blockers: AccountDeletionBlocker[];
}) {
  const now = new Date();
  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: input.userId, deletedAt: null },
      data: {
        banned: true,
        bannedAt: now,
        banReason: "Clerk account deleted before Grainline deletion blockers cleared; support review required",
        bannedBy: "system",
      },
    }),
    prisma.sellerProfile.updateMany({
      where: { userId: input.userId },
      data: { chargesEnabled: false, vacationMode: true },
    }),
  ]);

  await invalidateAccountStateCache(input.clerkId, "provider_deleted_account_blocked_anonymization");
  revalidateDeletedAccountSearchCaches(input.userId);
  Sentry.captureMessage("Provider deleted account has Grainline deletion blockers; local anonymization deferred", {
    level: "warning",
    tags: { source: "clerk_deleted_account_blocked_anonymization" },
    extra: {
      userId: input.userId,
      blockerCodes: input.blockers.map((blocker) => blocker.code),
      blockerCounts: input.blockers.map((blocker) => ({ code: blocker.code, count: blocker.count })),
    },
  });
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
    const accountEmailState = await userAccountEmailAddressState(tx, {
      userId: user.id,
      currentEmail: user.email,
    });
    const accountEmails = await accountEmailFallbackEmailsForUser(tx, {
      userId: user.id,
      emails: accountEmailState.emails,
    });
    const fallbackSuppressionEmail =
      normalizeEmailSuppressionAddress(user.email) ?? user.email.trim().normalize("NFC").toLowerCase();
    const accountEmailSuppressionKeys = accountEmailSuppressionKeysForEmails(accountEmails);
    const suppressionEmailMatches =
      accountEmailSuppressionKeys.length > 0
        ? accountEmailSuppressionKeys
        : [fallbackSuppressionEmail];
    const accountSensitiveValues = normalizedSensitiveValues([
      user.id,
      user.clerkId,
      user.email,
      ...accountEmails,
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
    await tx.block.deleteMany({ where: { blockerId: user.id } });
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
    await tx.orderShippingRateQuote.deleteMany({
      where: {
        OR: [
          { order: { buyerId: user.id } },
          ...(user.sellerProfile
            ? [
                {
                  order: {
                    items: {
                      some: { listing: { sellerId: user.sellerProfile.id } },
                      every: { listing: { sellerId: user.sellerProfile.id } },
                    },
                  },
                },
              ]
            : []),
        ],
      },
    });
    await tx.userReport.updateMany({
      where: { OR: [{ reporterId: user.id }, { reportedId: user.id }] },
      data: { details: null },
    });
    await tx.userReport.updateMany({
      where: {
        OR: [{ reporterId: user.id }, { reportedId: user.id }],
        resolved: true,
        resolutionNote: { not: null },
      },
      data: {
        resolutionNote: "Resolution note removed after an involved account was deleted.",
      },
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
    await redactSupportClosureEvidenceByDeletedAccount(tx, user.id, accountSensitiveValues);
    await redactSupportRequestsForDeletedAccount(tx, user.id, accountEmails, accountSensitiveValues);
    await tx.emailOutbox.updateMany({
      where: {
        OR: [{ userId: user.id }, { recipientEmail: { in: suppressionEmailMatches } }],
        sentAt: null,
        status: { in: ["PENDING", "PROCESSING", "FAILED", "DEAD"] },
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
    await tx.emailOutbox.updateMany({
      where: {
        OR: [{ userId: user.id }, { recipientEmail: { in: suppressionEmailMatches } }],
      },
      data: {
        recipientEmail: "deleted-account@deleted.thegrainline.local",
        subject: "Email removed after account deletion",
        html: "[Email removed after account deletion]",
      },
    });
    await tx.emailFailureCount.deleteMany({
      where: { email: { in: suppressionEmailMatches } },
    });
    await tx.newsletterSubscriber.deleteMany({
      where: { email: { in: suppressionEmailMatches } },
    });
    const existingEmailSuppressions = await tx.emailSuppression.findMany({
      where: { email: { in: suppressionEmailMatches } },
      select: { email: true, reason: true },
    });
    const existingSuppressionEmails = new Set(existingEmailSuppressions.map((suppression) => suppression.email));
    const providerHardSuppressionEmails = new Set(
      existingEmailSuppressions
        .filter((suppression) =>
          suppression.reason === EmailSuppressionReason.BOUNCE ||
          suppression.reason === EmailSuppressionReason.COMPLAINT)
        .map((suppression) => suppression.email),
    );
    const manualSuppressionEmails = suppressionEmailMatches.filter(
      (email) => !providerHardSuppressionEmails.has(email),
    );
    if (manualSuppressionEmails.length > 0) {
      await tx.emailSuppression.updateMany({
        where: {
          email: { in: manualSuppressionEmails },
          reason: EmailSuppressionReason.MANUAL,
        },
        data: {
          source: "account_deletion",
          eventId: null,
          details: { accountDeleted: true },
        },
      });
      const suppressionEmailsToCreate = manualSuppressionEmails.filter(
        (email) => !existingSuppressionEmails.has(email),
      );
      for (const email of suppressionEmailsToCreate) {
        await tx.emailSuppression.create({
          data: {
            email,
            reason: EmailSuppressionReason.MANUAL,
            source: "account_deletion",
            details: { accountDeleted: true },
          },
        });
      }
    }
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
      await cleanupDeletedSellerFanoutRows(tx, user.sellerProfile.id, now);
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
          title: "Deleted listing",
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
          yearsExperience: 0,
          portfolioUrl: null,
          status: "REJECTED",
          reviewedById: null,
          reviewNotes: null,
          appliedAt: now,
          reviewedAt: null,
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
      await tx.sellerFaq.deleteMany({
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
          displayNameNormalized: "Deleted maker",
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
          isVerifiedMaker: false,
          verifiedAt: null,
          guildLevel: "NONE",
          guildMemberApprovedAt: null,
          guildMasterApprovedAt: null,
          guildMasterAppliedAt: null,
          guildMasterReviewNotes: null,
          consecutiveMetricFailures: 0,
          lastMetricCheckAt: null,
          metricWarningSentAt: null,
          listingsBelowThresholdSince: null,
          profileViews: 0,
          featuredUntil: null,
          metroId: null,
          cityMetroId: null,
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

    await tx.userEmailAddress.deleteMany({
      where: { userId: user.id },
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
        role: "USER",
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
    select: { id: true, deletedAt: true },
  });
  if (!user) return { ok: true, alreadyDeleted: true };
  if (user.deletedAt) return { ok: true, alreadyDeleted: true };

  const blockers = await getAccountDeletionBlockers(user.id);
  if (blockers.length > 0) {
    await deferProviderDeletedAccountAnonymization({ userId: user.id, clerkId, blockers });
    return { ok: false, alreadyDeleted: false, blocked: true, blockers };
  }

  return anonymizeUserAccount(user.id);
}
