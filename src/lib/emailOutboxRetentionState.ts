const DAY_MS = 24 * 60 * 60 * 1000;

export const EMAIL_OUTBOX_SENT_RETENTION_DAYS = 30;
export const EMAIL_OUTBOX_DEAD_RETENTION_DAYS = 30;
export const EMAIL_OUTBOX_RETENTION_BATCH_SIZE = 1000;
export const EMAIL_OUTBOX_RETENTION_TIME_BUDGET_MS = 45_000;

export function emailOutboxRetentionCutoffs(now = new Date()) {
  return {
    sentOrSkippedCutoff: new Date(now.getTime() - EMAIL_OUTBOX_SENT_RETENTION_DAYS * DAY_MS),
    deadCutoff: new Date(now.getTime() - EMAIL_OUTBOX_DEAD_RETENTION_DAYS * DAY_MS),
  };
}
