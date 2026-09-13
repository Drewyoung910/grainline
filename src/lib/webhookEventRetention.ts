import { prisma } from "@/lib/db";
import {
  WEBHOOK_EVENT_RETENTION_BATCH_SIZE,
  WEBHOOK_EVENT_RETENTION_TIME_BUDGET_MS,
  webhookEventRetentionBatchSize,
  webhookEventRetentionCutoff,
} from "@/lib/webhookEventRetentionState";
import { pruneStripeWebhookEventServiceBatch } from "@/lib/stripeWebhookMaintenance";

type PruneResult = { count: number; complete: boolean };

export async function pruneWebhookEventRetention({
  now = new Date(),
  batchSize = WEBHOOK_EVENT_RETENTION_BATCH_SIZE,
  timeBudgetMs = WEBHOOK_EVENT_RETENTION_TIME_BUDGET_MS,
}: {
  now?: Date;
  batchSize?: number;
  timeBudgetMs?: number;
} = {}): Promise<PruneResult> {
  const deadline = Date.now() + timeBudgetMs;
  const cutoff = webhookEventRetentionCutoff(now);
  const effectiveBatchSize = webhookEventRetentionBatchSize(batchSize);
  let totalDeleted = 0;

  const pruners = [
    () => pruneStripeWebhookEventServiceBatch(effectiveBatchSize),
    () => pruneResendWebhookEvents(cutoff, effectiveBatchSize),
    () => pruneClerkWebhookEvents(cutoff, effectiveBatchSize),
  ];

  while (Date.now() < deadline) {
    let anyBatchMayRemain = false;
    for (const prune of pruners) {
      if (Date.now() >= deadline) return { count: totalDeleted, complete: false };
      const count = await prune();
      totalDeleted += count;
      if (count >= effectiveBatchSize) anyBatchMayRemain = true;
    }
    if (!anyBatchMayRemain) {
      return { count: totalDeleted, complete: true };
    }
  }

  return { count: totalDeleted, complete: false };
}

function pruneResendWebhookEvents(cutoff: Date, batchSize: number) {
  return prisma.$executeRaw<number>`
    DELETE FROM "ResendWebhookEvent"
    WHERE "svixId" IN (
      SELECT "svixId"
      FROM "ResendWebhookEvent"
      WHERE "processedAt" IS NOT NULL
        AND "processedAt" < ${cutoff}
      ORDER BY "processedAt" ASC
      LIMIT ${batchSize}
    )
  `;
}

function pruneClerkWebhookEvents(cutoff: Date, batchSize: number) {
  return prisma.$executeRaw<number>`
    DELETE FROM "ClerkWebhookEvent"
    WHERE "svixId" IN (
      SELECT "svixId"
      FROM "ClerkWebhookEvent"
      WHERE "processedAt" IS NOT NULL
        AND "processedAt" < ${cutoff}
      ORDER BY "processedAt" ASC
      LIMIT ${batchSize}
    )
  `;
}
