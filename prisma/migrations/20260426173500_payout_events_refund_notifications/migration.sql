ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFUND_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_WARNING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LISTING_FLAGGED_BY_USER';

CREATE TABLE "SellerPayoutEvent" (
  "id" TEXT NOT NULL,
  "sellerProfileId" TEXT NOT NULL,
  "stripePayoutId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "stripeEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SellerPayoutEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerPayoutEvent_stripePayoutId_key" ON "SellerPayoutEvent"("stripePayoutId");
CREATE INDEX "SellerPayoutEvent_sellerProfileId_createdAt_idx" ON "SellerPayoutEvent"("sellerProfileId", "createdAt");
CREATE INDEX "SellerPayoutEvent_status_createdAt_idx" ON "SellerPayoutEvent"("status", "createdAt");
CREATE INDEX "Order_buyer_pii_prune_idx"
  ON "Order"("buyerDataPurgedAt", "fulfillmentStatus", "deliveredAt", "pickedUpAt");

ALTER TABLE "SellerPayoutEvent"
  ADD CONSTRAINT "SellerPayoutEvent_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
