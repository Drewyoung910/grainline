-- User lifecycle/compliance fields for clickwrap stamps, welcome-email idempotency,
-- and account deletion anonymization.
ALTER TABLE "User"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsVersion" TEXT,
  ADD COLUMN "ageAttestedAt" TIMESTAMP(3),
  ADD COLUMN "welcomeEmailSentAt" TIMESTAMP(3);

CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
