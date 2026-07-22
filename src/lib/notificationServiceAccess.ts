import { randomUUID } from "node:crypto";
import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";

type ContextualNotificationServiceClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

export type NotificationServiceCreateInput = {
  notificationId: string;
  userId: string;
  type: NotificationType;
  sourceType: string | null;
  sourceId: string | null;
  relatedUserId: string | null;
};

export async function createNotificationServiceRow({
  notificationId,
  userId,
  type,
  sourceType,
  sourceId,
  relatedUserId,
}: NotificationServiceCreateInput): Promise<string | null> {
  if (sourceId === null) {
    throw new Error("notification create family is not implemented for a source-less event");
  }
  const socialSource = sourceType === NOTIFICATION_SOURCE_TYPES.FAVORITE
    || sourceType === NOTIFICATION_SOURCE_TYPES.FOLLOW
    || sourceType === NOTIFICATION_SOURCE_TYPES.REVIEW;
  const messageSource = sourceType === NOTIFICATION_SOURCE_TYPES.MESSAGE;
  const commissionSource = sourceType === NOTIFICATION_SOURCE_TYPES.COMMISSION_INTEREST
    || sourceType === NOTIFICATION_SOURCE_TYPES.COMMISSION_REQUEST;
  const inventorySource = sourceType === NOTIFICATION_SOURCE_TYPES.CHECKOUT_LOW_STOCK
    || sourceType === NOTIFICATION_SOURCE_TYPES.MANUAL_LOW_STOCK;
  const verificationSource = sourceType === NOTIFICATION_SOURCE_TYPES.GUILD_ADMIN_ACTION
    || sourceType === NOTIFICATION_SOURCE_TYPES.GUILD_SYSTEM_ACTION;
  const moderationSource = sourceType === NOTIFICATION_SOURCE_TYPES.LISTING_ADMIN_REVIEW
    || sourceType === NOTIFICATION_SOURCE_TYPES.LISTING_USER_REPORT;
  const accountWarningSource = sourceType === NOTIFICATION_SOURCE_TYPES.ADMIN_ACCOUNT_MESSAGE
    || sourceType === NOTIFICATION_SOURCE_TYPES.BANNED_SELLER_ORDER;
  const orderSource = sourceType === NOTIFICATION_SOURCE_TYPES.ORDER_CHECKOUT
    || sourceType === NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT
    || sourceType === NOTIFICATION_SOURCE_TYPES.ORDER_PAYMENT
    || sourceType === NOTIFICATION_SOURCE_TYPES.STRIPE_PAYOUT_FAILURE;
  const caseSource = sourceType === NOTIFICATION_SOURCE_TYPES.CASE
    || sourceType === NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE
    || sourceType === NOTIFICATION_SOURCE_TYPES.CASE_RESOLUTION_MARK
    || sourceType === NOTIFICATION_SOURCE_TYPES.CASE_SYSTEM_ACTION;
  const fanoutSource = sourceType === NOTIFICATION_SOURCE_TYPES.BLOG_COMMENT
    || sourceType === NOTIFICATION_SOURCE_TYPES.FOLLOWED_MAKER_NEW_BLOG
    || sourceType === NOTIFICATION_SOURCE_TYPES.FOLLOWED_MAKER_NEW_LISTING
    || sourceType === NOTIFICATION_SOURCE_TYPES.SELLER_BROADCAST;
  if (!socialSource && !messageSource && !commissionSource && !inventorySource && !verificationSource && !moderationSource && !accountWarningSource && !orderSource && !caseSource && !fanoutSource) {
    throw new Error("notification create family is not implemented for this source");
  }
  let rows: Array<{ id: string | null }>;
  if (socialSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_social_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (caseSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_case_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (commissionSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_commission_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (verificationSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_verification_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (moderationSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_moderation_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (accountWarningSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_account_warning(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (orderSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_order_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (inventorySource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_inventory_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else if (messageSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_message_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  } else {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_source_fanout(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text
        ) AS id
      `;
  }
  const id = rows[0]?.id ?? null;
  if (id !== null && typeof id !== "string") {
    throw new TypeError("notification service returned an invalid id");
  }
  return id;
}

export type BackInStockNotificationClaim = {
  claimed: boolean;
  userId: string | null;
  notificationId: string | null;
};

export async function claimBackInStockNotification({
  restockAuditId,
  stockNotificationId,
}: {
  restockAuditId: string;
  stockNotificationId: string;
}): Promise<BackInStockNotificationClaim> {
  const rows = await prisma.$queryRaw<Array<{
    claimed: boolean | null;
    userId: string | null;
    notificationId: string | null;
  }>>`
    SELECT
      result.claimed,
      result.user_id AS "userId",
      result.notification_id AS "notificationId"
    FROM public.grainline_notification_claim_back_in_stock(
      ${randomUUID()}::text,
      ${restockAuditId}::text,
      ${stockNotificationId}::text
    ) AS result
  `;
  const row = rows[0];
  if (!row || typeof row.claimed !== "boolean") {
    throw new TypeError("back-in-stock notification service returned an invalid claim");
  }
  if (row.userId !== null && typeof row.userId !== "string") {
    throw new TypeError("back-in-stock notification service returned an invalid user id");
  }
  if (row.notificationId !== null && typeof row.notificationId !== "string") {
    throw new TypeError("back-in-stock notification service returned an invalid notification id");
  }
  if (row.claimed && !row.userId) {
    throw new TypeError("back-in-stock notification service claimed a subscription without a user");
  }
  return {
    claimed: row.claimed,
    userId: row.userId,
    notificationId: row.notificationId,
  };
}

async function notificationServiceCount(
  rows: Array<{ count: number | bigint | null }>,
): Promise<number> {
  const count = rows[0]?.count;
  if (typeof count === "bigint") return Number(count);
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("notification service returned an invalid count");
  }
  return count;
}

export async function deleteAccountNotificationServiceRows(
  db: ContextualNotificationServiceClient,
  userId: string,
) {
  const rows = await db.$queryRaw<Array<{ count: number | bigint | null }>>`
    SELECT public.grainline_notification_delete_for_account(${userId}::text) AS count
  `;
  return notificationServiceCount(rows);
}

export async function deleteBlogCommentNotificationServiceRows(
  db: ContextualNotificationServiceClient,
  commentId: string,
) {
  const rows = await db.$queryRaw<Array<{ count: number | bigint | null }>>`
    SELECT public.grainline_notification_delete_blog_comment(${commentId}::text) AS count
  `;
  return notificationServiceCount(rows);
}

export async function deleteSellerBroadcastNotificationServiceRows(
  db: ContextualNotificationServiceClient,
  broadcastId: string,
) {
  const rows = await db.$queryRaw<Array<{ count: number | bigint | null }>>`
    SELECT public.grainline_notification_delete_seller_broadcast(${broadcastId}::text) AS count
  `;
  return notificationServiceCount(rows);
}

export async function pruneReadNotificationServiceBatch() {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint | null }>>`
    SELECT public.grainline_notification_prune_read_batch() AS count
  `;
  return notificationServiceCount(rows);
}

export async function pruneUnreadNotificationServiceBatch() {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint | null }>>`
    SELECT public.grainline_notification_prune_unread_batch() AS count
  `;
  return notificationServiceCount(rows);
}
