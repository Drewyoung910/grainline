import { NotificationType, Prisma } from "@prisma/client";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";

export type NotificationOwnerAccessClient = Pick<DbUserContextTransactionClient, "notification">;

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

async function countUnreadOwnerNotificationsInContext(
  userId: string,
  db: NotificationOwnerAccessClient,
) {
  return db.notification.count({ where: { userId, read: false } });
}

async function countOwnerNotificationsInContext(
  userId: string,
  db: NotificationOwnerAccessClient,
) {
  return db.notification.count({ where: { userId } });
}

export async function countUnreadOwnerNotifications(userId: string) {
  return withDbUserContext(userId, (db) =>
    countUnreadOwnerNotificationsInContext(userId, db));
}

export async function ownerNotificationBellData(
  userId: string,
) {
  return withDbUserContext(userId, async (db) => {
    const notifications = await db.notification.findMany({
      where: { userId },
      select: NOTIFICATION_BELL_SELECT,
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const unreadCount = await countUnreadOwnerNotificationsInContext(userId, db);
    return { notifications, unreadCount };
  });
}

export async function markOwnerNotificationRead(
  userId: string,
  notificationId: string,
) {
  return withDbUserContext(userId, (db) =>
    db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    }));
}

export async function markOwnerNotificationsRead(
  userId: string,
  notificationIds: string[] = [],
) {
  return withDbUserContext(userId, (db) =>
    db.notification.updateMany({
      where: {
        userId,
        read: false,
        ...(notificationIds.length > 0 ? { id: { in: notificationIds } } : {}),
      },
      data: { read: true },
    }));
}

export async function markOwnerMessageNotificationsRead(
  userId: string,
  conversationId: string,
) {
  return withDbUserContext(userId, (db) =>
    db.notification.updateMany({
      where: {
        userId,
        type: NotificationType.NEW_MESSAGE,
        read: false,
        link: { contains: `/messages/${conversationId}` },
      },
      data: { read: true },
    }));
}

export async function ownerNotificationPageData(
  userId: string,
  { requestedPage, pageSize }: { requestedPage: number; pageSize: number },
) {
  return withDbUserContext(userId, async (db) => {
    const total = await countOwnerNotificationsInContext(userId, db);
    const unreadCount = await countUnreadOwnerNotificationsInContext(userId, db);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const notifications = await db.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { notifications, page, total, totalPages, unreadCount };
  });
}

export async function ownerNotificationExportRows(
  userId: string,
) {
  return withDbUserContext(userId, (db) =>
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: NOTIFICATION_EXPORT_SELECT,
    }));
}

export async function findRecentOwnerLowStockNotification(
  userId: string,
  link: string,
  since: Date,
) {
  return withDbUserContext(userId, (db) =>
    db.notification.findFirst({
      where: {
        userId,
        type: NotificationType.LOW_STOCK,
        link,
        createdAt: { gte: since },
      },
      select: { id: true },
    }));
}
