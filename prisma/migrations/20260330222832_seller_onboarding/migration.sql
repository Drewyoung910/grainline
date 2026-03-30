-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 0;

-- Backfill: mark all existing sellers as having completed onboarding
UPDATE "public"."SellerProfile" SET "onboardingComplete" = true;
