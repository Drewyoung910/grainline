-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Listing_status_isPrivate_qualityScore_idx" ON "Listing"("status", "isPrivate", "qualityScore");
