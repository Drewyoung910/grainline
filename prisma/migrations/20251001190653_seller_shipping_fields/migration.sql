-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "allowLocalPickup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shippingFlatRateCents" INTEGER,
ADD COLUMN     "shippingFreeOverCents" INTEGER;
