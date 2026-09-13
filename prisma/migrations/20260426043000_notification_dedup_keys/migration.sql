-- Add a shared, database-enforced notification deduplication key.
-- Existing rows remain NULL and are intentionally not backfilled.
ALTER TABLE "Notification" ADD COLUMN "dedupKey" VARCHAR(64);

CREATE UNIQUE INDEX "Notification_userId_type_dedupKey_key"
ON "Notification"("userId", "type", "dedupKey");
