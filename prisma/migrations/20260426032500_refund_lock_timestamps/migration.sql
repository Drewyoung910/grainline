ALTER TABLE "Order" ADD COLUMN "sellerRefundLockedAt" TIMESTAMP(3);

UPDATE "Order"
SET "sellerRefundLockedAt" = CURRENT_TIMESTAMP
WHERE "sellerRefundId" = 'pending'
  AND "sellerRefundLockedAt" IS NULL;

CREATE INDEX "Order_sellerRefundId_sellerRefundLockedAt_idx"
ON "Order"("sellerRefundId", "sellerRefundLockedAt");
