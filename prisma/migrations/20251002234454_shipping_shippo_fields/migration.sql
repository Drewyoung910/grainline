/*
  Warnings:

  - You are about to drop the column `shipsSeparately` on the `Listing` table. All the data in the column will be lost.
  - You are about to drop the column `defaultMaxParcelWeightGrams` on the `SellerProfile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Listing" DROP COLUMN "shipsSeparately";

-- AlterTable
ALTER TABLE "public"."SellerProfile" DROP COLUMN "defaultMaxParcelWeightGrams",
ADD COLUMN     "defaultPkgWeightGrams" INTEGER,
ALTER COLUMN "shipFromCountry" SET DEFAULT 'US';
