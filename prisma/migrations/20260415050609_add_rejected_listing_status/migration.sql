-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "rejectionReason" TEXT;
