ALTER TABLE "NewsletterSubscriber"
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmationTokenHash" VARCHAR(64),
  ADD COLUMN "confirmationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "confirmationSentAt" TIMESTAMP(3);

UPDATE "NewsletterSubscriber"
SET "confirmedAt" = "subscribedAt"
WHERE "active" = true
  AND "confirmedAt" IS NULL;

ALTER TABLE "NewsletterSubscriber"
  ALTER COLUMN "active" SET DEFAULT false;

CREATE INDEX "NewsletterSubscriber_confirmationTokenHash_idx"
  ON "NewsletterSubscriber"("confirmationTokenHash");

CREATE INDEX "NewsletterSubscriber_active_confirmedAt_idx"
  ON "NewsletterSubscriber"("active", "confirmedAt");
