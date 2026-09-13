-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "consecutiveMetricFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastMetricCheckAt" TIMESTAMP(3),
ADD COLUMN     "listingsBelowThresholdSince" TIMESTAMP(3),
ADD COLUMN     "metricWarningSentAt" TIMESTAMP(3);
