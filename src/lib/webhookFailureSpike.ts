import * as Sentry from "@sentry/nextjs";
import { redis } from "@/lib/ratelimit";
import {
  WEBHOOK_FAILURE_SPIKE_THRESHOLD,
  WEBHOOK_FAILURE_SPIKE_WINDOW_MINUTES,
  shouldEmitWebhookFailureSpike,
  webhookFailureAlertKey,
  webhookFailureCounterKey,
  webhookFailureCount,
  webhookFailureMinuteBucket,
  webhookFailureWindowBuckets,
} from "@/lib/webhookFailureSpikeState";

type RecordWebhookFailureSpikeInput = {
  webhook: string;
  kind: string;
  status: number;
  now?: Date;
  threshold?: number;
  windowMinutes?: number;
  extra?: Record<string, unknown>;
};

export async function recordWebhookFailureSpike({
  webhook,
  kind,
  status,
  now = new Date(),
  threshold = WEBHOOK_FAILURE_SPIKE_THRESHOLD,
  windowMinutes = WEBHOOK_FAILURE_SPIKE_WINDOW_MINUTES,
  extra = {},
}: RecordWebhookFailureSpikeInput): Promise<void> {
  try {
    const bucket = webhookFailureMinuteBucket(now);
    const counterKey = webhookFailureCounterKey({ webhook, kind, bucket });
    const currentCount = await redis.incr(counterKey);
    if (currentCount === 1) {
      await redis.expire(counterKey, windowMinutes * 60 + 60);
    }

    const bucketKeys = webhookFailureWindowBuckets({ now, windowMinutes }).map((windowBucket) =>
      webhookFailureCounterKey({ webhook, kind, bucket: windowBucket }),
    );
    const counts = await Promise.all(bucketKeys.map((key) => redis.get<number | string>(key)));
    const failureCount = webhookFailureCount(counts);
    if (!shouldEmitWebhookFailureSpike({ count: failureCount, threshold })) return;

    const alertKey = webhookFailureAlertKey({ webhook, kind });
    const claimed = await redis.set(alertKey, "1", { nx: true, ex: windowMinutes * 60 });
    if (claimed !== "OK") return;

    Sentry.captureMessage("Webhook failure spike detected", {
      level: "error",
      tags: {
        source: `${webhook}_webhook_failure_spike`,
        webhook,
        kind,
        status: String(status),
      },
      extra: {
        ...extra,
        failureCount,
        threshold,
        windowMinutes,
      },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "webhook_failure_spike_record", webhook, kind },
      extra: { status },
    });
  }
}
