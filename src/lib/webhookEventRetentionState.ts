const DAY_MS = 24 * 60 * 60 * 1000;

export const WEBHOOK_EVENT_RETENTION_DAYS = 90;
export const WEBHOOK_EVENT_RETENTION_BATCH_SIZE = 1000;
export const WEBHOOK_EVENT_RETENTION_TIME_BUDGET_MS = 30_000;

export function webhookEventRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_DAYS * DAY_MS);
}

export function webhookEventRetentionBatchSize(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Webhook event retention batch size must be finite");
  }
  return Math.min(
    WEBHOOK_EVENT_RETENTION_BATCH_SIZE,
    Math.max(1, Math.trunc(value)),
  );
}
