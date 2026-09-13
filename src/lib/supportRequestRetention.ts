import { prisma } from "@/lib/db";
import { runBoundedDeletionBatches } from "@/lib/cronBatchState";
import {
  SUPPORT_REQUEST_RETENTION_BATCH_SIZE,
  SUPPORT_REQUEST_RETENTION_TIME_BUDGET_MS,
  supportRequestRetentionCutoff,
} from "@/lib/supportRequestRetentionState";

export {
  SUPPORT_REQUEST_RETENTION_BATCH_SIZE,
  SUPPORT_REQUEST_RETENTION_DAYS,
  SUPPORT_REQUEST_RETENTION_TIME_BUDGET_MS,
  supportRequestRetentionCutoff,
} from "@/lib/supportRequestRetentionState";

export async function pruneClosedSupportRequests({
  retentionDays,
  batchSize = SUPPORT_REQUEST_RETENTION_BATCH_SIZE,
  timeBudgetMs = SUPPORT_REQUEST_RETENTION_TIME_BUDGET_MS,
}: {
  retentionDays?: number;
  batchSize?: number;
  timeBudgetMs?: number;
} = {}): Promise<{ count: number; complete: boolean; cutoff: Date }> {
  const cutoff = supportRequestRetentionCutoff({ retentionDays });
  const result = await runBoundedDeletionBatches({
    batchSize,
    timeBudgetMs,
    deleteBatch: async () => prisma.$executeRaw<number>`
      DELETE FROM "SupportRequest"
      WHERE id IN (
        SELECT id
        FROM "SupportRequest"
        WHERE status = 'CLOSED'
          AND "closedAt" IS NOT NULL
          AND "closedAt" < ${cutoff}
        ORDER BY "closedAt" ASC, id ASC
        LIMIT ${batchSize}
      )
    `,
  });

  return { ...result, cutoff };
}
