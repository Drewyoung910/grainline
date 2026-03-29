-- AddColumn sellerRefundId
ALTER TABLE "public"."Order" ADD COLUMN "sellerRefundId" TEXT;

-- AddColumn sellerRefundAmountCents
ALTER TABLE "public"."Order" ADD COLUMN "sellerRefundAmountCents" INTEGER;
