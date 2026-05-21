const DAY_MS = 24 * 60 * 60 * 1000;

export const READ_NOTIFICATION_RETENTION_DAYS = 90;
export const UNREAD_NOTIFICATION_RETENTION_DAYS = 365;
export const NOTIFICATION_RETENTION_BATCH_SIZE = 1000;
export const NOTIFICATION_RETENTION_TIME_BUDGET_MS = 45_000;

export function notificationRetentionCutoffs(now = new Date()) {
  return {
    readCutoff: new Date(now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * DAY_MS),
    unreadCutoff: new Date(now.getTime() - UNREAD_NOTIFICATION_RETENTION_DAYS * DAY_MS),
  };
}
