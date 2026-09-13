-- CreateEnum
CREATE TYPE "public"."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');

-- AlterEnum
ALTER TYPE "public"."ListingStatus" ADD VALUE 'SOLD_OUT';

-- AlterTable
ALTER TABLE "public"."Listing" ADD COLUMN     "listingType" "public"."ListingType" NOT NULL DEFAULT 'MADE_TO_ORDER',
ADD COLUMN     "stockQuantity" INTEGER;
