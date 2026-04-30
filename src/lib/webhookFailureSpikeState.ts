export const WEBHOOK_FAILURE_SPIKE_WINDOW_MINUTES = 15;
export const WEBHOOK_FAILURE_SPIKE_THRESHOLD = 10;

function safeKeySegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

export function webhookFailureMinuteBucket(date = new Date()): number {
  return Math.floor(date.getTime() / 60_000);
}

export function webhookFailureCounterKey({
  webhook,
  kind,
  bucket,
}: {
  webhook: string;
  kind: string;
  bucket: number;
}): string {
  return `webhook_failure:${safeKeySegment(webhook)}:${safeKeySegment(kind)}:${bucket}`;
}

export function webhookFailureAlertKey({
  webhook,
  kind,
}: {
  webhook: string;
  kind: string;
}): string {
  return `webhook_failure_alert:${safeKeySegment(webhook)}:${safeKeySegment(kind)}`;
}

export function webhookFailureWindowBuckets({
  now = new Date(),
  windowMinutes = WEBHOOK_FAILURE_SPIKE_WINDOW_MINUTES,
}: {
  now?: Date;
  windowMinutes?: number;
} = {}): number[] {
  const current = webhookFailureMinuteBucket(now);
  return Array.from({ length: Math.max(1, windowMinutes) }, (_, index) => current - index);
}

export function webhookFailureCount(values: Array<unknown>): number {
  let sum = 0;
  for (const value of values) {
    const count = Number(value);
    if (Number.isFinite(count) && count > 0) sum += count;
  }
  return sum;
}

export function shouldEmitWebhookFailureSpike({
  count,
  threshold = WEBHOOK_FAILURE_SPIKE_THRESHOLD,
}: {
  count: number;
  threshold?: number;
}): boolean {
  return count >= threshold;
}
