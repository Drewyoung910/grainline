import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/db";

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
