UPDATE "Notification"
SET "dedupKey" = md5(id)
WHERE "dedupKey" IS NULL;

ALTER TABLE "Notification"
ALTER COLUMN "dedupKey" SET NOT NULL;

ALTER TABLE "Notification"
ALTER COLUMN "dedupKey" SET DEFAULT md5(random()::text || clock_timestamp()::text);
