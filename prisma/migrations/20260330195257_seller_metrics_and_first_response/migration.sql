-- AlterTable
ALTER TABLE "public"."Conversation" ADD COLUMN     "firstResponseAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."SellerMetrics" (
    "id" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodMonths" INTEGER NOT NULL DEFAULT 3,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "onTimeShippingRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responseRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSalesCents" INTEGER NOT NULL DEFAULT 0,
    "completedOrderCount" INTEGER NOT NULL DEFAULT 0,
    "activeCaseCount" INTEGER NOT NULL DEFAULT 0,
    "accountAgeDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SellerMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellerMetrics_sellerProfileId_key" ON "public"."SellerMetrics"("sellerProfileId");

-- AddForeignKey
ALTER TABLE "public"."SellerMetrics" ADD CONSTRAINT "SellerMetrics_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
