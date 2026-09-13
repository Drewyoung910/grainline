-- CreateEnum
CREATE TYPE "public"."CaseReason" AS ENUM ('NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'WRONG_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."CaseStatus" AS ENUM ('OPEN', 'AWAITING_SELLER', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."CaseResolution" AS ENUM ('REFUND_FULL', 'REFUND_PARTIAL', 'DISMISSED');

-- AlterTable
ALTER TABLE "public"."Listing" ADD COLUMN     "isReadyToShip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "processingTimeMaxDays" INTEGER,
ADD COLUMN     "processingTimeMinDays" INTEGER;

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "estimatedDeliveryDate" TIMESTAMP(3),
ADD COLUMN     "processingDeadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."Case" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "reason" "public"."CaseReason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."CaseStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "public"."CaseResolution",
    "refundAmountCents" INTEGER,
    "stripeRefundId" TEXT,
    "sellerRespondBy" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CaseMessage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Case_orderId_key" ON "public"."Case"("orderId");

-- AddForeignKey
ALTER TABLE "public"."Case" ADD CONSTRAINT "Case_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Case" ADD CONSTRAINT "Case_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Case" ADD CONSTRAINT "Case_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Case" ADD CONSTRAINT "Case_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaseMessage" ADD CONSTRAINT "CaseMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaseMessage" ADD CONSTRAINT "CaseMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
