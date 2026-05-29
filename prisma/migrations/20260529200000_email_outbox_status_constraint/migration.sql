UPDATE "EmailOutbox"
SET
  "lastError" = LEFT(
    COALESCE("lastError" || ' ', '') || 'Normalized invalid status before EmailOutbox status constraint.',
    1000
  ),
  "status" = CASE
    WHEN "sentAt" IS NOT NULL THEN 'SENT'
    WHEN "attempts" >= 10 THEN 'DEAD'
    ELSE 'FAILED'
  END
WHERE "status" NOT IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'DEAD');

ALTER TABLE "EmailOutbox"
  DROP CONSTRAINT IF EXISTS "EmailOutbox_status_chk";

ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_status_chk"
  CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'DEAD')) NOT VALID;

ALTER TABLE "EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_status_chk";
