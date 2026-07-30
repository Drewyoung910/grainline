import { prisma } from "@/lib/db";
import {
  ORDER_BUYER_PII_RETENTION_DAYS,
} from "@/lib/orderPiiRetentionState";

export {
  ORDER_BUYER_PII_RETENTION_DAYS,
  orderBuyerPiiRetentionCutoff,
} from "@/lib/orderPiiRetentionState";
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const MAX_TIME_BUDGET_MS = 55_000;

export type OrderPiiPruneResult = {
  purged: number;
  complete: boolean;
  cutoff: Date;
};

export async function purgeOldFulfilledOrderBuyerPii({
  retentionDays = ORDER_BUYER_PII_RETENTION_DAYS,
  batchSize = DEFAULT_BATCH_SIZE,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
}: {
  retentionDays?: number;
  batchSize?: number;
  timeBudgetMs?: number;
} = {}): Promise<OrderPiiPruneResult> {
  if (retentionDays !== ORDER_BUYER_PII_RETENTION_DAYS) {
    throw new TypeError(
      "Order buyer-PII pruning requires the database-fixed 90-day retention window",
    );
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new TypeError("Order buyer-PII prune batch size is invalid");
  }
  if (
    !Number.isSafeInteger(timeBudgetMs)
    || timeBudgetMs < 1
    || timeBudgetMs > MAX_TIME_BUDGET_MS
  ) {
    throw new TypeError("Order buyer-PII prune time budget is invalid");
  }

  const deadline = Date.now() + timeBudgetMs;
  let purged = 0;
  let cutoff: Date | null = null;
  let attemptedBatch = false;

  while (!attemptedBatch || Date.now() < deadline) {
    attemptedBatch = true;
    const rows = await prisma.$queryRaw<
      Array<{ purged: bigint | number; cutoff: Date }>
    >`
      SELECT *
        FROM public.grainline_order_buyer_pii_prune_batch(
          ${batchSize}::integer
        )
    `;
    if (rows.length !== 1) {
      throw new TypeError(
        "Order buyer-PII prune authority returned an invalid row count",
      );
    }
    const row = rows[0];
    if (
      (typeof row.purged !== "bigint" && typeof row.purged !== "number")
      || row.purged < 0
      || row.purged > Number.MAX_SAFE_INTEGER
      || (typeof row.purged === "number" && !Number.isSafeInteger(row.purged))
      || !(row.cutoff instanceof Date)
      || Number.isNaN(row.cutoff.getTime())
    ) {
      throw new TypeError(
        "Order buyer-PII prune authority returned an invalid result",
      );
    }
    const count = Number(row.purged);
    cutoff ??= row.cutoff;
    purged += count;
    if (count === 0 || count < batchSize) {
      return { purged, complete: true, cutoff: cutoff ?? row.cutoff };
    }
  }

  if (!cutoff) {
    throw new Error("Order buyer-PII prune authority did not return a cutoff");
  }
  return { purged, complete: false, cutoff };
}
