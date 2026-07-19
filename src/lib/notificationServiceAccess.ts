import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";

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
  const rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
    SELECT public.grainline_notification_create(
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
