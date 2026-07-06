ALTER TABLE "CheckoutStockReservation"
  ADD COLUMN "checkoutGroupId" VARCHAR(100);

CREATE INDEX "CheckoutStockReservation_buyerId_checkoutGroupId_idx"
  ON "CheckoutStockReservation"("buyerId", "checkoutGroupId");
