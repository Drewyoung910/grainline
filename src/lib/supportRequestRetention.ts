import { runBoundedDeletionBatches } from "@/lib/cronBatchState";
import { deleteSupportRequestRetentionBatch } from "@/lib/supportRequestAccess";
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
  if (retentionDays !== undefined && retentionDays !== 365 * 2) {
    throw new Error("Support request retention is fixed at two years.");
  }
  const cutoff = supportRequestRetentionCutoff({ retentionDays });
  const result = await runBoundedDeletionBatches({
    batchSize,
    timeBudgetMs,
    deleteBatch: () => deleteSupportRequestRetentionBatch(batchSize),
  });

  return { ...result, cutoff };
}
