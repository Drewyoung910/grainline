-- CreateEnum
CREATE TYPE "public"."LabelStatus" AS ENUM ('PURCHASED', 'EXPIRED', 'VOIDED');

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "labelCarrier" TEXT,
ADD COLUMN     "labelCostCents" INTEGER,
ADD COLUMN     "labelPurchasedAt" TIMESTAMP(3),
ADD COLUMN     "labelStatus" "public"."LabelStatus",
ADD COLUMN     "labelTrackingNumber" TEXT,
ADD COLUMN     "labelUrl" TEXT,
ADD COLUMN     "shippoRateObjectId" TEXT,
ADD COLUMN     "shippoShipmentId" TEXT,
ADD COLUMN     "shippoTransactionId" TEXT;
