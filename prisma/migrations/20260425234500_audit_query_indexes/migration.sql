-- Targeted audit indexes for remaining high-traffic read paths.

CREATE INDEX IF NOT EXISTS "SellerProfile_featuredUntil_idx"
  ON "SellerProfile"("featuredUntil");

CREATE INDEX IF NOT EXISTS "SellerProfile_guildLevel_chargesEnabled_vacationMode_idx"
  ON "SellerProfile"("guildLevel", "chargesEnabled", "vacationMode");

CREATE INDEX IF NOT EXISTS "Listing_qualityScore_idx"
  ON "Listing"("qualityScore");

CREATE INDEX IF NOT EXISTS "Listing_sellerId_updatedAt_idx"
  ON "Listing"("sellerId", "updatedAt");

CREATE INDEX IF NOT EXISTS "Order_buyerId_createdAt_idx"
  ON "Order"("buyerId", "createdAt");

CREATE INDEX IF NOT EXISTS "Order_fulfillmentStatus_createdAt_idx"
  ON "Order"("fulfillmentStatus", "createdAt");

CREATE INDEX IF NOT EXISTS "Notification_userId_read_createdAt_idx"
  ON "Notification"("userId", "read", "createdAt");
