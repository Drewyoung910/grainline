ALTER TABLE "EmailOutbox"
  ADD COLUMN "templateName" VARCHAR(80) NOT NULL DEFAULT 'unknown',
  ADD COLUMN "templateVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_templateVersion_positive_chk"
  CHECK ("templateVersion" >= 1) NOT VALID;

ALTER TABLE "EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_templateVersion_positive_chk";

CREATE INDEX "EmailOutbox_templateName_createdAt_idx"
  ON "EmailOutbox"("templateName", "createdAt");
