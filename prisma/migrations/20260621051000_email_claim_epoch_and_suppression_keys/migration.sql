ALTER TABLE "UserEmailAddress"
  ADD COLUMN "currentSinceAt" TIMESTAMP(3);

UPDATE "UserEmailAddress"
SET "currentSinceAt" = CASE
  WHEN "isCurrent" THEN "firstSeenAt"
  ELSE "lastSeenAt"
END
WHERE "currentSinceAt" IS NULL;

ALTER TABLE "UserEmailAddress"
  ALTER COLUMN "currentSinceAt" SET NOT NULL,
  ALTER COLUMN "currentSinceAt" SET DEFAULT CURRENT_TIMESTAMP;
