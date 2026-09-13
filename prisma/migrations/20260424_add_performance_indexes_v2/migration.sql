-- Performance indexes for browse, messaging, and order lookups

-- Listing price sort (browse price asc/desc)
CREATE INDEX IF NOT EXISTS "Listing_priceCents_idx" ON "Listing"("priceCents");

-- Message thread loading (conversationId + chronological)
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- Review listing sort
CREATE INDEX IF NOT EXISTS "Review_listingId_createdAt_idx" ON "Review"("listingId", "createdAt");

-- Stripe ID lookups (webhook idempotency, refund lookups)
CREATE UNIQUE INDEX IF NOT EXISTS "Order_stripePaymentIntentId_idx" ON "Order"("stripePaymentIntentId") WHERE "stripePaymentIntentId" IS NOT NULL;

-- Order.buyerId → SetNull (was Cascade — data retention fix)
ALTER TABLE "Order" ALTER COLUMN "buyerId" DROP NOT NULL;
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_buyerId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
