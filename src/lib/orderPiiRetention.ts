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
      WITH pii_candidates AS (
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
            "shipToCity" IS NOT NULL OR
            "shipToState" IS NOT NULL OR
            "shipToPostalCode" IS NOT NULL OR
            "shipToCountry" IS NOT NULL OR
            "quotedToLine1" IS NOT NULL OR
            "quotedToLine2" IS NOT NULL OR
            "quotedToCity" IS NOT NULL OR
            "quotedToState" IS NOT NULL OR
            "quotedToPostalCode" IS NOT NULL OR
            "quotedToCountry" IS NOT NULL OR
            "quotedToName" IS NOT NULL OR
            "quotedToPhone" IS NOT NULL OR
            "trackingCarrier" IS NOT NULL OR
            "trackingNumber" IS NOT NULL OR
            "sellerNotes" IS NOT NULL OR
            "shippoShipmentId" IS NOT NULL OR
            "shippoRateObjectId" IS NOT NULL OR
            "shippoTransactionId" IS NOT NULL OR
            "labelUrl" IS NOT NULL OR
            "labelCarrier" IS NOT NULL OR
            "labelTrackingNumber" IS NOT NULL OR
            "giftNote" IS NOT NULL OR
            EXISTS (
              SELECT 1
              FROM "OrderShippingRateQuote" quote
              WHERE quote."orderId" = "Order".id
            )
          )
        ORDER BY COALESCE("deliveredAt", "pickedUpAt") ASC
        LIMIT ${batchSize}
      ),
      deleted_quotes AS (
        DELETE FROM "OrderShippingRateQuote" quote
        USING pii_candidates
        WHERE quote."orderId" = pii_candidates.id
        RETURNING quote.id
      )
      UPDATE "Order"
      SET
        "buyerEmail" = NULL,
        "buyerName" = NULL,
        "shipToLine1" = NULL,
        "shipToLine2" = NULL,
        "shipToCity" = NULL,
        "shipToState" = NULL,
        "shipToPostalCode" = NULL,
        "shipToCountry" = NULL,
        "quotedToLine1" = NULL,
        "quotedToLine2" = NULL,
        "quotedToCity" = NULL,
        "quotedToState" = NULL,
        "quotedToPostalCode" = NULL,
        "quotedToCountry" = NULL,
        "quotedToName" = NULL,
        "quotedToPhone" = NULL,
        "trackingCarrier" = NULL,
        "trackingNumber" = NULL,
        "sellerNotes" = NULL,
        "shippoShipmentId" = NULL,
        "shippoRateObjectId" = NULL,
        "shippoTransactionId" = NULL,
        "labelUrl" = NULL,
        "labelCarrier" = NULL,
        "labelTrackingNumber" = NULL,
        "giftNote" = NULL,
        "buyerDataPurgedAt" = NOW()
      WHERE id IN (SELECT id FROM pii_candidates)
    `;
    const count = Number(updated);
    purged += count;
    if (count === 0 || count < batchSize) {
      return { purged, complete: true, cutoff };
    }
  }

  return { purged, complete: false, cutoff };
}
