-- Align database text bounds with server/UI limits and add listing write-time
-- invariants that Prisma cannot express in schema.prisma.

UPDATE "SellerProfile" SET "bio" = LEFT("bio", 500) WHERE char_length("bio") > 500;
UPDATE "SellerProfile" SET "storyBody" = LEFT("storyBody", 2000) WHERE char_length("storyBody") > 2000;
UPDATE "SellerProfile" SET "returnPolicy" = LEFT("returnPolicy", 2000) WHERE char_length("returnPolicy") > 2000;
UPDATE "SellerProfile" SET "customOrderPolicy" = LEFT("customOrderPolicy", 2000) WHERE char_length("customOrderPolicy") > 2000;
UPDATE "SellerProfile" SET "shippingPolicy" = LEFT("shippingPolicy", 2000) WHERE char_length("shippingPolicy") > 2000;

ALTER TABLE "SellerProfile" ALTER COLUMN "bio" SET DATA TYPE VARCHAR(500),
ALTER COLUMN "storyBody" SET DATA TYPE VARCHAR(2000),
ALTER COLUMN "returnPolicy" SET DATA TYPE VARCHAR(2000),
ALTER COLUMN "customOrderPolicy" SET DATA TYPE VARCHAR(2000),
ALTER COLUMN "shippingPolicy" SET DATA TYPE VARCHAR(2000);

UPDATE "Listing" SET "description" = LEFT("description", 5000) WHERE char_length("description") > 5000;
ALTER TABLE "Listing" ALTER COLUMN "description" SET DATA TYPE VARCHAR(5000);

UPDATE "Order" SET "sellerNotes" = LEFT("sellerNotes", 2000) WHERE char_length("sellerNotes") > 2000;
UPDATE "Order" SET "reviewNote" = LEFT("reviewNote", 10000) WHERE char_length("reviewNote") > 10000;
ALTER TABLE "Order" ALTER COLUMN "sellerNotes" SET DATA TYPE VARCHAR(2000),
ALTER COLUMN "reviewNote" SET DATA TYPE VARCHAR(10000);

UPDATE "BlogPost" SET "body" = LEFT("body", 50000) WHERE char_length("body") > 50000;
ALTER TABLE "BlogPost" ALTER COLUMN "body" SET DATA TYPE VARCHAR(50000);

ALTER TABLE "MakerVerification"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_priceCents_positive_chk";
ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_priceCents_positive_chk"
CHECK ("priceCents" > 0) NOT VALID;

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_stockQuantity_non_negative_chk";
ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_stockQuantity_non_negative_chk"
CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0) NOT VALID;
