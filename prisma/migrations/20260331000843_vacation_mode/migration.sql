-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "vacationMessage" TEXT,
ADD COLUMN     "vacationMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vacationReturnDate" TIMESTAMP(3);
