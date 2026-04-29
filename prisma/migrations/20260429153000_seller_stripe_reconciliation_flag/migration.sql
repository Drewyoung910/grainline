ALTER TABLE "SellerProfile"
  ADD COLUMN "manualStripeReconciliationNeeded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manualStripeReconciliationNote" VARCHAR(1000);
