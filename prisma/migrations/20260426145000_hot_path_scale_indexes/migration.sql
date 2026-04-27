CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_qualityScore_visible_idx"
  ON "Listing" ("qualityScore" DESC)
  WHERE "status" = 'ACTIVE' AND "isPrivate" = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_buyerId_paidAt_idx"
  ON "Order" ("buyerId", "paidAt" DESC)
  WHERE "paidAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_conversationId_createdAt_desc_idx"
  ON "Message" ("conversationId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_banned_deletedAt_idx"
  ON "User" ("banned", "deletedAt")
  WHERE "banned" = true OR "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderPaymentEvent_orderId_eventType_createdAt_idx"
  ON "OrderPaymentEvent" ("orderId", "eventType", "createdAt" DESC);
