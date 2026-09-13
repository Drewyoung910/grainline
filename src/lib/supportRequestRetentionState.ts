export const SUPPORT_REQUEST_RETENTION_DAYS = 365 * 2;
export const SUPPORT_REQUEST_RETENTION_BATCH_SIZE = 500;
export const SUPPORT_REQUEST_RETENTION_TIME_BUDGET_MS = 45_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function supportRequestRetentionCutoff({
  now = new Date(),
  retentionDays = SUPPORT_REQUEST_RETENTION_DAYS,
}: {
  now?: Date;
  retentionDays?: number;
} = {}) {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}
