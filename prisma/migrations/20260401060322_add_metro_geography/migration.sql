-- AlterTable
ALTER TABLE "CommissionRequest" ADD COLUMN     "cityMetroId" TEXT,
ADD COLUMN     "metroId" TEXT;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "cityMetroId" TEXT,
ADD COLUMN     "metroId" TEXT;

-- AlterTable
ALTER TABLE "SellerProfile" ADD COLUMN     "cityMetroId" TEXT,
ADD COLUMN     "metroId" TEXT;

-- CreateTable
CREATE TABLE "Metro" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMiles" INTEGER NOT NULL DEFAULT 45,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentMetroId" TEXT,

    CONSTRAINT "Metro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Metro_slug_key" ON "Metro"("slug");

-- CreateIndex
CREATE INDEX "Metro_slug_idx" ON "Metro"("slug");

-- CreateIndex
CREATE INDEX "Metro_parentMetroId_idx" ON "Metro"("parentMetroId");

-- CreateIndex
CREATE INDEX "Metro_state_isActive_idx" ON "Metro"("state", "isActive");

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_metroId_fkey" FOREIGN KEY ("metroId") REFERENCES "Metro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_cityMetroId_fkey" FOREIGN KEY ("cityMetroId") REFERENCES "Metro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_metroId_fkey" FOREIGN KEY ("metroId") REFERENCES "Metro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_cityMetroId_fkey" FOREIGN KEY ("cityMetroId") REFERENCES "Metro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRequest" ADD CONSTRAINT "CommissionRequest_metroId_fkey" FOREIGN KEY ("metroId") REFERENCES "Metro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRequest" ADD CONSTRAINT "CommissionRequest_cityMetroId_fkey" FOREIGN KEY ("cityMetroId") REFERENCES "Metro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metro" ADD CONSTRAINT "Metro_parentMetroId_fkey" FOREIGN KEY ("parentMetroId") REFERENCES "Metro"("id") ON DELETE SET NULL ON UPDATE CASCADE;
