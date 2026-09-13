-- CreateEnum
CREATE TYPE "public"."Category" AS ENUM ('FURNITURE', 'KITCHEN', 'DECOR', 'TOOLS', 'TOYS', 'JEWELRY', 'ART', 'OUTDOOR', 'STORAGE', 'OTHER');

-- AlterTable
ALTER TABLE "public"."Listing" ADD COLUMN     "category" "public"."Category",
ADD COLUMN     "clickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT,
    "category" "public"."Category",
    "minPrice" INTEGER,
    "maxPrice" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_category_status_idx" ON "public"."Listing"("category", "status");

-- CreateIndex
CREATE INDEX "Listing_viewCount_idx" ON "public"."Listing"("viewCount");

-- CreateIndex
CREATE INDEX "Listing_clickCount_idx" ON "public"."Listing"("clickCount");

-- AddForeignKey
ALTER TABLE "public"."SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
