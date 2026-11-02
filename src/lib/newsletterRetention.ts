import { prisma } from "@/lib/db";
import { deleteExpiredUnconfirmedNewsletterBatch } from "@/lib/emailServiceAccess";

const NEWSLETTER_UNCONFIRMED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const NEWSLETTER_RETENTION_BATCH_SIZE = 500;
const NEWSLETTER_RETENTION_TIME_BUDGET_MS = 8_000;

export async function pruneExpiredUnconfirmedNewsletterRows({
  now = new Date(),
  batchSize = NEWSLETTER_RETENTION_BATCH_SIZE,
  timeBudgetMs = NEWSLETTER_RETENTION_TIME_BUDGET_MS,
}: {
  now?: Date;
  batchSize?: number;
  timeBudgetMs?: number;
} = {}): Promise<{ count: number; complete: boolean }> {
  const deadline = Date.now() + timeBudgetMs;
  const cutoff = new Date(now.getTime() - NEWSLETTER_UNCONFIRMED_RETENTION_MS);
  let totalDeleted = 0;

  while (Date.now() < deadline) {
    const count = await deleteExpiredUnconfirmedNewsletterBatch(prisma, {
      cutoff,
      limit: batchSize,
    });
    totalDeleted += count;
    if (count === 0 || count < batchSize) {
      return { count: totalDeleted, complete: true };
    }
  }

  return { count: totalDeleted, complete: false };
}
