-- Restore the manually-managed blog tag GIN index that an earlier Prisma
-- migration dropped after the original blog search migration.
CREATE INDEX IF NOT EXISTS "BlogPost_tags_gin_idx"
ON "BlogPost"
USING GIN ("tags");

-- The CHECK constraints were originally added NOT VALID so they would protect
-- future writes without taking a validation lock during the text-bound pass.
-- Validate them now so historical rows are covered too.
ALTER TABLE "Listing"
VALIDATE CONSTRAINT "Listing_priceCents_positive_chk";

ALTER TABLE "Listing"
VALIDATE CONSTRAINT "Listing_stockQuantity_non_negative_chk";

-- Align the database default with schema.prisma. Application code supplies
-- explicit dedup keys, but the fallback default should not drift between
-- Prisma's model and the live constraint.
ALTER TABLE "Notification"
ALTER COLUMN "dedupKey" SET DEFAULT md5(random()::text || clock_timestamp()::text);
