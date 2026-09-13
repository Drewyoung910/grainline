-- AlterTable
ALTER TABLE "public"."Listing" ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "publicMapOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "radiusMeters" INTEGER;
