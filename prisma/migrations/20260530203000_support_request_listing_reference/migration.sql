ALTER TABLE "SupportRequest"
  ADD COLUMN "listingId" VARCHAR(80);

CREATE INDEX "SupportRequest_orderId_idx" ON "SupportRequest"("orderId");
CREATE INDEX "SupportRequest_listingId_idx" ON "SupportRequest"("listingId");
