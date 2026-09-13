ALTER TABLE "Order" ADD COLUMN "buyerDataPurgedAt" TIMESTAMP(3);

CREATE INDEX "Order_buyerDataPurgedAt_idx" ON "Order"("buyerDataPurgedAt");
