ALTER TABLE "EmailOutbox"
  ADD COLUMN "sourceType" VARCHAR(80),
  ADD COLUMN "sourceId" VARCHAR(191);

ALTER TABLE "Notification"
  ADD COLUMN "sourceType" VARCHAR(80),
  ADD COLUMN "sourceId" VARCHAR(191);

CREATE INDEX "EmailOutbox_sourceType_sourceId_idx" ON "EmailOutbox"("sourceType", "sourceId");
CREATE INDEX "Notification_sourceType_sourceId_idx" ON "Notification"("sourceType", "sourceId");
