/*
  Warnings:

  - You are about to drop the column `shippingFlatRateCents` on the `SellerProfile` table. All the data in the column will be lost.
  - You are about to drop the column `shippingFreeOverCents` on the `SellerProfile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."SellerProfile" DROP COLUMN "shippingFlatRateCents",
DROP COLUMN "shippingFreeOverCents",
ADD COLUMN     "freeShippingOver" DOUBLE PRECISION,
ADD COLUMN     "shippingFlatRate" DOUBLE PRECISION;
