import { prisma } from "@/lib/db";
import {
  ORDER_BUYER_PII_RETENTION_DAYS,
  orderBuyerPiiRetentionCutoff,
} from "@/lib/orderPiiRetentionState";

export {
  ORDER_BUYER_PII_RETENTION_DAYS,
  orderBuyerPiiRetentionCutoff,
} from "@/lib/orderPiiRetentionState";
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_TIME_BUDGET_MS = 45_000;

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
  const cutoff = orderBuyerPiiRetentionCutoff({ retentionDays });
  const deadline = Date.now() + timeBudgetMs;
  let purged = 0;

  while (Date.now() < deadline) {
    const updated = await prisma.$executeRaw<number>`
      UPDATE "Order"
      SET
        "buyerEmail" = NULL,
        "buyerName" = NULL,
        "shipToLine1" = NULL,
        "shipToLine2" = NULL,
        "quotedToLine1" = NULL,
        "quotedToLine2" = NULL,
        "quotedToName" = NULL,
        "quotedToPhone" = NULL,
        "giftNote" = NULL,
        "buyerDataPurgedAt" = NOW()
      WHERE id IN (
        SELECT id
        FROM "Order"
        WHERE "buyerDataPurgedAt" IS NULL
          AND "fulfillmentStatus" IN ('DELIVERED', 'PICKED_UP')
          AND COALESCE("deliveredAt", "pickedUpAt") IS NOT NULL
          AND COALESCE("deliveredAt", "pickedUpAt") < ${cutoff}
          AND (
            "buyerEmail" IS NOT NULL OR
            "buyerName" IS NOT NULL OR
            "shipToLine1" IS NOT NULL OR
            "shipToLine2" IS NOT NULL OR
            "quotedToLine1" IS NOT NULL OR
            "quotedToLine2" IS NOT NULL OR
            "quotedToName" IS NOT NULL OR
            "quotedToPhone" IS NOT NULL OR
            "giftNote" IS NOT NULL
          )
        ORDER BY COALESCE("deliveredAt", "pickedUpAt") ASC
        LIMIT ${batchSize}
      )
    `;
    const count = Number(updated);
    purged += count;
    if (count === 0 || count < batchSize) {
      return { purged, complete: true, cutoff };
    }
  }

  return { purged, complete: false, cutoff };
}
