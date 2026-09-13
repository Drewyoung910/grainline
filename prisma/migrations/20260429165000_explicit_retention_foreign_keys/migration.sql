-- Make retention-sensitive foreign keys explicit and non-destructive.
-- These changes prevent hard-delete/admin mistakes from silently cascading
-- historical conversations, listings, cases, or published content.

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userAId_fkey";
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_userAId_fkey"
  FOREIGN KEY ("userAId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userBId_fkey";
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_userBId_fkey"
  FOREIGN KEY ("userBId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_recipientId_fkey";
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_sellerId_fkey";
ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_buyerId_fkey";
ALTER TABLE "Case" ALTER COLUMN "buyerId" DROP NOT NULL;
ALTER TABLE "Case"
  ADD CONSTRAINT "Case_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_reservedForUserId_fkey";
ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_reservedForUserId_fkey"
  FOREIGN KEY ("reservedForUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlogPost" DROP CONSTRAINT IF EXISTS "BlogPost_authorId_fkey";
ALTER TABLE "BlogPost" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "BlogPost"
  ADD CONSTRAINT "BlogPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlogPost" DROP CONSTRAINT IF EXISTS "BlogPost_sellerProfileId_fkey";
ALTER TABLE "BlogPost"
  ADD CONSTRAINT "BlogPost_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MakerVerification" DROP CONSTRAINT IF EXISTS "MakerVerification_reviewedById_fkey";
ALTER TABLE "MakerVerification"
  ADD CONSTRAINT "MakerVerification_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
