-- Rename AWAITING_SELLER to IN_DISCUSSION
ALTER TYPE "public"."CaseStatus" RENAME VALUE 'AWAITING_SELLER' TO 'IN_DISCUSSION';

-- Add PENDING_CLOSE after IN_DISCUSSION
ALTER TYPE "public"."CaseStatus" ADD VALUE IF NOT EXISTS 'PENDING_CLOSE' AFTER 'IN_DISCUSSION';

-- AddColumn discussionStartedAt
ALTER TABLE "public"."Case" ADD COLUMN "discussionStartedAt" TIMESTAMP(3);

-- AddColumn escalateUnlocksAt
ALTER TABLE "public"."Case" ADD COLUMN "escalateUnlocksAt" TIMESTAMP(3);

-- AddColumn buyerMarkedResolved
ALTER TABLE "public"."Case" ADD COLUMN "buyerMarkedResolved" BOOLEAN NOT NULL DEFAULT false;

-- AddColumn sellerMarkedResolved
ALTER TABLE "public"."Case" ADD COLUMN "sellerMarkedResolved" BOOLEAN NOT NULL DEFAULT false;
