-- Durable webhook idempotency + explicit retention/deletion constraints.

CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_type_createdAt_idx" ON "StripeWebhookEvent"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_processedAt_idx" ON "StripeWebhookEvent"("processedAt");

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_DISPUTE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_FAILED';

CREATE UNIQUE INDEX IF NOT EXISTS "Order_stripeChargeId_idx"
  ON "Order"("stripeChargeId")
  WHERE "stripeChargeId" IS NOT NULL;

-- Historical order retention: hard listing deletion must not cascade-delete order items.
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_listingId_fkey";
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Messaging can be deleted with a hard-deleted user/conversation; normal account
-- deletion uses anonymization, so this primarily prevents FK dead-ends in dev/admin
-- cleanup while keeping conversation/message trees internally consistent.
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userAId_fkey";
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_userAId_fkey"
  FOREIGN KEY ("userAId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userBId_fkey";
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_userBId_fkey"
  FOREIGN KEY ("userBId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_conversationId_fkey";
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_recipientId_fkey";
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Cases are part of transaction retention. Keep buyer/seller/order hard-deletes
-- restricted; cascade only the child case messages if a case itself is removed.
ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_orderId_fkey";
ALTER TABLE "Case"
  ADD CONSTRAINT "Case_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_buyerId_fkey";
ALTER TABLE "Case"
  ADD CONSTRAINT "Case_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_sellerId_fkey";
ALTER TABLE "Case"
  ADD CONSTRAINT "Case_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_resolvedById_fkey";
ALTER TABLE "Case"
  ADD CONSTRAINT "Case_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CaseMessage" DROP CONSTRAINT IF EXISTS "CaseMessage_caseId_fkey";
ALTER TABLE "CaseMessage"
  ADD CONSTRAINT "CaseMessage_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "Case"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseMessage" DROP CONSTRAINT IF EXISTS "CaseMessage_authorId_fkey";
ALTER TABLE "CaseMessage"
  ADD CONSTRAINT "CaseMessage_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Blog comments are community content and may be removed with the author/post.
ALTER TABLE "BlogComment" DROP CONSTRAINT IF EXISTS "BlogComment_authorId_fkey";
ALTER TABLE "BlogComment"
  ADD CONSTRAINT "BlogComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BlogComment" DROP CONSTRAINT IF EXISTS "BlogComment_parentId_fkey";
ALTER TABLE "BlogComment"
  ADD CONSTRAINT "BlogComment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "BlogComment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
