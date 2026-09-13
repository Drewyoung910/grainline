-- CreateEnum
CREATE TYPE "public"."CommissionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'FULFILLED', 'CLOSED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "public"."NotificationType" ADD VALUE 'COMMISSION_INTEREST';

-- DropIndex
DROP INDEX "public"."BlogPost_tags_gin_idx";

-- CreateTable
CREATE TABLE "public"."CommissionRequest" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "public"."Category",
    "budgetMinCents" INTEGER,
    "budgetMaxCents" INTEGER,
    "timeline" TEXT,
    "referenceImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "public"."CommissionStatus" NOT NULL DEFAULT 'OPEN',
    "interestedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommissionInterest" (
    "id" TEXT NOT NULL,
    "commissionRequestId" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRequest_buyerId_idx" ON "public"."CommissionRequest"("buyerId");

-- CreateIndex
CREATE INDEX "CommissionRequest_status_createdAt_idx" ON "public"."CommissionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CommissionRequest_category_idx" ON "public"."CommissionRequest"("category");

-- CreateIndex
CREATE INDEX "CommissionInterest_sellerProfileId_idx" ON "public"."CommissionInterest"("sellerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionInterest_commissionRequestId_sellerProfileId_key" ON "public"."CommissionInterest"("commissionRequestId", "sellerProfileId");

-- AddForeignKey
ALTER TABLE "public"."CommissionRequest" ADD CONSTRAINT "CommissionRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommissionInterest" ADD CONSTRAINT "CommissionInterest_commissionRequestId_fkey" FOREIGN KEY ("commissionRequestId") REFERENCES "public"."CommissionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommissionInterest" ADD CONSTRAINT "CommissionInterest_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
