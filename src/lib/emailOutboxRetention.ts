import { prisma } from "@/lib/db";
import {
  EMAIL_OUTBOX_RETENTION_BATCH_SIZE,
  EMAIL_OUTBOX_RETENTION_TIME_BUDGET_MS,
  emailOutboxRetentionCutoffs,
} from "@/lib/emailOutboxRetentionState";
import { deleteEmailOutboxRetentionBatch } from "@/lib/emailServiceAccess";

export async function pruneEmailOutboxRetention({
  now = new Date(),
  batchSize = EMAIL_OUTBOX_RETENTION_BATCH_SIZE,
  timeBudgetMs = EMAIL_OUTBOX_RETENTION_TIME_BUDGET_MS,
}: {
  now?: Date;
  batchSize?: number;
  timeBudgetMs?: number;
} = {}): Promise<{ count: number; complete: boolean }> {
  const deadline = Date.now() + timeBudgetMs;
  const { sentOrSkippedCutoff, deadCutoff } = emailOutboxRetentionCutoffs(now);
  let totalDeleted = 0;

  while (Date.now() < deadline) {
    const count = await deleteEmailOutboxRetentionBatch(prisma, {
      sentOrSkippedCutoff,
      deadCutoff,
      limit: batchSize,
    });
    totalDeleted += count;
    if (count === 0 || count < batchSize) {
      return { count: totalDeleted, complete: true };
    }
  }

  return { count: totalDeleted, complete: false };
}
