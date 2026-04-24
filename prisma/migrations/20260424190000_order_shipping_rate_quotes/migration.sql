-- Persist order-bound Shippo re-quote choices so sellers can only purchase
-- labels from the current quote set for that order.
CREATE TABLE "OrderShippingRateQuote" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "rates" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderShippingRateQuote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderShippingRateQuote"
  ADD CONSTRAINT "OrderShippingRateQuote_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "OrderShippingRateQuote_orderId_expiresAt_idx"
  ON "OrderShippingRateQuote"("orderId", "expiresAt");

CREATE INDEX "OrderShippingRateQuote_expiresAt_idx"
  ON "OrderShippingRateQuote"("expiresAt");
