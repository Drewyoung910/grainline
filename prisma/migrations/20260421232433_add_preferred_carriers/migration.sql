-- AlterTable
ALTER TABLE "SellerProfile" ADD COLUMN     "preferredCarriers" TEXT[] DEFAULT ARRAY[]::TEXT[];
