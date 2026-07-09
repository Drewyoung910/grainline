import { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type NotificationOwnerAccessClient = Pick<Prisma.TransactionClient, "notification">;

export const NOTIFICATION_BELL_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  read: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export const NOTIFICATION_EXPORT_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  sourceType: true,
  sourceId: true,
  read: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export async function countUnreadOwnerNotifications(
  userId: string,
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.count({ where: { userId, read: false } });
}

export async function countOwnerNotifications(
  userId: string,
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.count({ where: { userId } });
}

export async function ownerNotificationBellData(
  userId: string,
  db: NotificationOwnerAccessClient = prisma,
) {
  const notifications = await db.notification.findMany({
    where: { userId },
    select: NOTIFICATION_BELL_SELECT,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const unreadCount = await countUnreadOwnerNotifications(userId, db);
  return { notifications, unreadCount };
}

export async function markOwnerNotificationRead(
  userId: string,
  notificationId: string,
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
}

export async function markOwnerNotificationsRead(
  userId: string,
  notificationIds: string[] = [],
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.updateMany({
    where: {
      userId,
      read: false,
      ...(notificationIds.length > 0 ? { id: { in: notificationIds } } : {}),
    },
    data: { read: true },
  });
}

export async function markOwnerMessageNotificationsRead(
  userId: string,
  conversationId: string,
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.updateMany({
    where: {
      userId,
      type: NotificationType.NEW_MESSAGE,
      read: false,
      link: { contains: `/messages/${conversationId}` },
    },
    data: { read: true },
  });
}

export async function ownerNotificationPageData(
  userId: string,
  { skip, take }: { skip: number; take: number },
  db: NotificationOwnerAccessClient = prisma,
) {
  const total = await countOwnerNotifications(userId, db);
  const unreadCount = await countUnreadOwnerNotifications(userId, db);
  const notifications = await ownerNotificationPageRows(userId, { skip, take }, db);
  return { notifications, total, unreadCount };
}

export async function ownerNotificationPageRows(
  userId: string,
  { skip, take }: { skip: number; take: number },
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
  });
}

export async function ownerNotificationExportRows(
  userId: string,
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: NOTIFICATION_EXPORT_SELECT,
  });
}

export async function findRecentOwnerLowStockNotification(
  userId: string,
  link: string,
  since: Date,
  db: NotificationOwnerAccessClient = prisma,
) {
  return db.notification.findFirst({
    where: {
      userId,
      type: NotificationType.LOW_STOCK,
      link,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
}
