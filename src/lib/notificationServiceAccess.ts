import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { extractRouteId } from "@/lib/publicPaths";

type ContextualNotificationServiceClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

export type NotificationServiceCreateInput = {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  sourceType: string | null;
  sourceId: string | null;
  relatedUserId: string | null;
  dedupKey: string;
};

export async function createNotificationServiceRow({
  notificationId,
  userId,
  type,
  title,
  body,
  link,
  sourceType,
  sourceId,
  relatedUserId,
  dedupKey,
}: NotificationServiceCreateInput): Promise<string | null> {
  if (sourceId === null) {
    throw new Error("notification create family is not implemented for a source-less event");
  }
  const socialSource = sourceType === NOTIFICATION_SOURCE_TYPES.FAVORITE
    || sourceType === NOTIFICATION_SOURCE_TYPES.FOLLOW
    || sourceType === NOTIFICATION_SOURCE_TYPES.REVIEW;
  const messageSource = sourceType === NOTIFICATION_SOURCE_TYPES.MESSAGE;
  const fanoutSource = sourceType === NOTIFICATION_SOURCE_TYPES.BLOG_COMMENT
    || sourceType === NOTIFICATION_SOURCE_TYPES.FOLLOWED_MAKER_NEW_BLOG
    || sourceType === NOTIFICATION_SOURCE_TYPES.FOLLOWED_MAKER_NEW_LISTING
    || sourceType === NOTIFICATION_SOURCE_TYPES.SELLER_BROADCAST;
  if (!socialSource && !messageSource && !fanoutSource) {
    throw new Error("notification create family is not implemented for this source");
  }
  let rows: Array<{ id: string | null }>;
  if (socialSource) {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_social_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${title}::text,
          ${body}::text,
          ${link}::text,
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text,
          ${dedupKey}::text
        ) AS id
      `;
  } else if (messageSource) {
    const listingRouteSegment = type === "CUSTOM_ORDER_LINK" && link?.startsWith("/listing/")
      ? link.slice("/listing/".length).split(/[/?#]/, 1)[0]
      : "";
    const authorityContextId = listingRouteSegment ? extractRouteId(listingRouteSegment) : null;
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_message_event(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${title}::text,
          ${body}::text,
          ${link}::text,
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text,
          ${dedupKey}::text,
          ${authorityContextId}::text
        ) AS id
      `;
  } else {
    rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
        SELECT public.grainline_notification_create_source_fanout(
          ${notificationId}::text,
          ${userId}::text,
          ${type}::public."NotificationType",
          ${title}::text,
          ${body}::text,
          ${link}::text,
          ${sourceType}::text,
          ${sourceId}::text,
          ${relatedUserId}::text,
          ${dedupKey}::text
        ) AS id
      `;
  }
  const id = rows[0]?.id ?? null;
  if (id !== null && typeof id !== "string") {
    throw new TypeError("notification service returned an invalid id");
  }
  return id;
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
