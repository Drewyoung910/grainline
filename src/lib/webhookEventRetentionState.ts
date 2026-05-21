const DAY_MS = 24 * 60 * 60 * 1000;

export const WEBHOOK_EVENT_RETENTION_DAYS = 90;
export const WEBHOOK_EVENT_RETENTION_BATCH_SIZE = 1000;
export const WEBHOOK_EVENT_RETENTION_TIME_BUDGET_MS = 30_000;

export function webhookEventRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_DAYS * DAY_MS);
}
