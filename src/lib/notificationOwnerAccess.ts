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

type NotificationBellItem = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_BELL_SELECT;
}>;

type NotificationExportItem = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_EXPORT_SELECT;
}>;

type CountValue = bigint | number;

type NotificationBellRpcRow = {
  id: string | null;
  type: NotificationType | null;
  title: string | null;
  body: string | null;
  link: string | null;
  read: boolean | null;
  createdAt: Date | null;
  unreadCount: CountValue;
};

type NotificationPageRpcRow = NotificationBellRpcRow & {
  page: number;
  total: CountValue;
  totalPages: number;
};

function safeRpcCount(value: CountValue, label: string): number {
  const count = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count;
}

function notificationFromRpcRow(row: NotificationBellRpcRow): NotificationBellItem | null {
  if (row.id === null) return null;
  if (
    row.type === null
    || row.title === null
    || row.body === null
    || row.read === null
    || !(row.createdAt instanceof Date)
  ) {
    throw new TypeError("notification recipient RPC returned an invalid row");
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.read,
    createdAt: row.createdAt,
  };
}

export async function countUnreadOwnerNotifications(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: CountValue }>>`
    SELECT public.grainline_notification_unread_count(${userId}::text) AS count
  `;
  if (rows.length !== 1) throw new TypeError("notification unread RPC returned no row");
  return safeRpcCount(rows[0].count, "notification unread RPC");
}

export async function ownerNotificationBellData(userId: string) {
  const rows = await prisma.$queryRaw<NotificationBellRpcRow[]>`
    SELECT * FROM public.grainline_notification_bell(${userId}::text, 20)
  `;
  if (rows.length === 0) throw new TypeError("notification bell RPC returned no summary row");
  const notifications = rows
    .map(notificationFromRpcRow)
    .filter((notification): notification is NotificationBellItem => notification !== null);
  return {
    notifications,
    unreadCount: safeRpcCount(rows[0].unreadCount, "notification bell RPC"),
  };
}

export async function markOwnerNotificationRead(
  userId: string,
  notificationId: string,
) {
  const rows = await prisma.$queryRaw<Array<{ count: CountValue }>>`
    SELECT public.grainline_notification_mark_one_read(
      ${userId}::text,
      ${notificationId}::text
    ) AS count
  `;
  if (rows.length !== 1) throw new TypeError("notification mark-one RPC returned no row");
  return { count: safeRpcCount(rows[0].count, "notification mark-one RPC") };
}

export async function markOwnerNotificationsRead(
  userId: string,
  notificationIds: string[] = [],
) {
  const notificationIdsSql = notificationIds.length > 0
    ? Prisma.sql`ARRAY[${Prisma.join(notificationIds)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  const rows = await prisma.$queryRaw<Array<{ count: CountValue }>>`
    SELECT public.grainline_notification_mark_many_read(
      ${userId}::text,
      ${notificationIdsSql}
    ) AS count
  `;
  if (rows.length !== 1) throw new TypeError("notification mark-many RPC returned no row");
  return { count: safeRpcCount(rows[0].count, "notification mark-many RPC") };
}

export async function markOwnerMessageNotificationsRead(
  userId: string,
  conversationId: string,
) {
  const rows = await prisma.$queryRaw<Array<{ count: CountValue }>>`
    SELECT public.grainline_notification_mark_conversation_read(
      ${userId}::text,
      ${conversationId}::text
    ) AS count
  `;
  if (rows.length !== 1) throw new TypeError("notification conversation RPC returned no row");
  return { count: safeRpcCount(rows[0].count, "notification conversation RPC") };
}

export async function ownerNotificationPageData(
  userId: string,
  { requestedPage, pageSize }: { requestedPage: number; pageSize: number },
) {
  const rows = await prisma.$queryRaw<NotificationPageRpcRow[]>`
    SELECT * FROM public.grainline_notification_page(
      ${userId}::text,
      ${requestedPage}::integer,
      ${pageSize}::integer
    )
  `;
  if (rows.length === 0) throw new TypeError("notification page RPC returned no summary row");
  const summary = rows[0];
  const notifications = rows
    .map(notificationFromRpcRow)
    .filter((notification): notification is NotificationBellItem => notification !== null);
  return {
    notifications,
    page: summary.page,
    total: safeRpcCount(summary.total, "notification page RPC total"),
    totalPages: summary.totalPages,
    unreadCount: safeRpcCount(summary.unreadCount, "notification page RPC unread"),
  };
}

export async function ownerNotificationExportRows(
  userId: string,
): Promise<NotificationExportItem[]> {
  return prisma.$queryRaw<NotificationExportItem[]>`
    SELECT * FROM public.grainline_notification_export(${userId}::text)
  `;
}

export async function findRecentOwnerLowStockNotification(
  userId: string,
  link: string,
  since: Date,
) {
  const rows = await prisma.$queryRaw<Array<{ id: string | null }>>`
    SELECT public.grainline_notification_recent_low_stock(
      ${userId}::text,
      ${link}::text,
      ${since}::timestamp
    ) AS id
  `;
  if (rows.length !== 1) throw new TypeError("notification low-stock RPC returned no row");
  return rows[0].id ? { id: rows[0].id } : null;
}
