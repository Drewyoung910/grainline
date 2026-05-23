-- Retention-oriented FK hardening for records that should not disappear via
-- direct database hard deletes. Application account/listing/post removal paths
-- use soft deletion, anonymization, or archival.

-- Listing history: seller/admin listing removal is a soft-delete. Direct hard
-- deletion should fail instead of cascading away listing photos or reviews.
ALTER TABLE "Photo" DROP CONSTRAINT IF EXISTS "Photo_listingId_fkey";
ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_listingId_fkey";
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial and payout ledgers are retained with their parent records.
ALTER TABLE "OrderPaymentEvent" DROP CONSTRAINT IF EXISTS "OrderPaymentEvent_orderId_fkey";
ALTER TABLE "OrderPaymentEvent"
  ADD CONSTRAINT "OrderPaymentEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellerPayoutEvent" DROP CONSTRAINT IF EXISTS "SellerPayoutEvent_sellerProfileId_fkey";
ALTER TABLE "SellerPayoutEvent"
  ADD CONSTRAINT "SellerPayoutEvent_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Blog moderation/community records: dashboard post removal archives posts,
-- and direct hard deletes should not wipe comments or reply trees.
ALTER TABLE "BlogComment" DROP CONSTRAINT IF EXISTS "BlogComment_postId_fkey";
ALTER TABLE "BlogComment"
  ADD CONSTRAINT "BlogComment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "BlogPost"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BlogComment" DROP CONSTRAINT IF EXISTS "BlogComment_authorId_fkey";
ALTER TABLE "BlogComment"
  ADD CONSTRAINT "BlogComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BlogComment" DROP CONSTRAINT IF EXISTS "BlogComment_parentId_fkey";
ALTER TABLE "BlogComment"
  ADD CONSTRAINT "BlogComment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "BlogComment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Commission and moderation evidence should block direct user hard-deletes.
ALTER TABLE "CommissionRequest" DROP CONSTRAINT IF EXISTS "CommissionRequest_buyerId_fkey";
ALTER TABLE "CommissionRequest"
  ADD CONSTRAINT "CommissionRequest_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Block" DROP CONSTRAINT IF EXISTS "Block_blockerId_fkey";
ALTER TABLE "Block"
  ADD CONSTRAINT "Block_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Block" DROP CONSTRAINT IF EXISTS "Block_blockedId_fkey";
ALTER TABLE "Block"
  ADD CONSTRAINT "Block_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserReport" DROP CONSTRAINT IF EXISTS "UserReport_reporterId_fkey";
ALTER TABLE "UserReport"
  ADD CONSTRAINT "UserReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserReport" DROP CONSTRAINT IF EXISTS "UserReport_reportedId_fkey";
ALTER TABLE "UserReport"
  ADD CONSTRAINT "UserReport_reportedId_fkey"
  FOREIGN KEY ("reportedId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Commission interest conversations are optional links to a retained thread.
-- Clear legacy orphan ids before adding the database-level foreign key.
UPDATE "CommissionInterest"
SET "conversationId" = NULL
WHERE "conversationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Conversation"
    WHERE "Conversation"."id" = "CommissionInterest"."conversationId"
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CommissionInterest_conversationId_idx"
ON "CommissionInterest"("conversationId");

ALTER TABLE "CommissionInterest" DROP CONSTRAINT IF EXISTS "CommissionInterest_conversationId_fkey";
ALTER TABLE "CommissionInterest"
  ADD CONSTRAINT "CommissionInterest_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
