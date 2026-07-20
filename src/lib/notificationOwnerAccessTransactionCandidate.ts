import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { NOTIFICATION_BELL_SELECT } from "@/lib/notificationOwnerAccess";

type NotificationTransactionCandidateClient = Pick<
  DbUserContextTransactionClient,
  "notification"
>;

async function transactionCandidateUnreadCount(
  userId: string,
  db: NotificationTransactionCandidateClient,
) {
  return db.notification.count({ where: { userId, read: false } });
}

export function transactionCandidateNotificationBellData(userId: string) {
  return withDbUserContext(userId, async (db) => {
    const notifications = await db.notification.findMany({
      where: { userId },
      select: NOTIFICATION_BELL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    const unreadCount = await transactionCandidateUnreadCount(userId, db);
    return { notifications, unreadCount };
  });
}

export function transactionCandidateNotificationPageData(
  userId: string,
  { requestedPage, pageSize }: { requestedPage: number; pageSize: number },
) {
  return withDbUserContext(userId, async (db) => {
    const total = await db.notification.count({ where: { userId } });
    const unreadCount = await transactionCandidateUnreadCount(userId, db);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const notifications = await db.notification.findMany({
      where: { userId },
      select: NOTIFICATION_BELL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { notifications, page, total, totalPages, unreadCount };
  });
}
