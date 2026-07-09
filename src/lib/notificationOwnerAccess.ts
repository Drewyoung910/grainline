import { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

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

export async function countUnreadOwnerNotifications(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function countOwnerNotifications(userId: string) {
  return prisma.notification.count({ where: { userId } });
}

export async function ownerNotificationBellData(userId: string) {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    select: NOTIFICATION_BELL_SELECT,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const unreadCount = await countUnreadOwnerNotifications(userId);
  return { notifications, unreadCount };
}

export async function markOwnerNotificationRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
}

export async function markOwnerNotificationsRead(userId: string, notificationIds: string[] = []) {
  return prisma.notification.updateMany({
    where: {
      userId,
      read: false,
      ...(notificationIds.length > 0 ? { id: { in: notificationIds } } : {}),
    },
    data: { read: true },
  });
}

export async function markOwnerMessageNotificationsRead(userId: string, conversationId: string) {
  return prisma.notification.updateMany({
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
) {
  const total = await countOwnerNotifications(userId);
  const unreadCount = await countUnreadOwnerNotifications(userId);
  const notifications = await ownerNotificationPageRows(userId, { skip, take });
  return { notifications, total, unreadCount };
}

export async function ownerNotificationPageRows(
  userId: string,
  { skip, take }: { skip: number; take: number },
) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
  });
}

export async function ownerNotificationExportRows(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: NOTIFICATION_EXPORT_SELECT,
  });
}

export async function findRecentOwnerLowStockNotification(
  userId: string,
  link: string,
  since: Date,
) {
  return prisma.notification.findFirst({
    where: {
      userId,
      type: NotificationType.LOW_STOCK,
      link,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
}
