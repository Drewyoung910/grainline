/*
  Warnings:

  - A unique constraint covering the columns `[stripeAccountId]` on the table `SellerProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "stripeAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_stripeAccountId_key" ON "public"."SellerProfile"("stripeAccountId");
