-- CreateEnum
CREATE TYPE "public"."FulfillmentMethod" AS ENUM ('PICKUP', 'SHIPPING');

-- CreateEnum
CREATE TYPE "public"."FulfillmentStatus" AS ENUM ('PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED');

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentMethod" "public"."FulfillmentMethod",
ADD COLUMN     "fulfillmentStatus" "public"."FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "pickupReadyAt" TIMESTAMP(3),
ADD COLUMN     "sellerNotes" TEXT,
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "trackingCarrier" TEXT,
ADD COLUMN     "trackingNumber" TEXT;
