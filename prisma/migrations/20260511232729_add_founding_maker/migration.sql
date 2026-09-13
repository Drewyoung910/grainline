-- Founding Maker badge for the first 250 sellers
ALTER TABLE "SellerProfile"
  ADD COLUMN "isFoundingMaker" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "foundingMakerNumber" INTEGER,
  ADD COLUMN "foundingMakerAt" TIMESTAMP(3);

-- Backfill: grant Founding Maker to the first 250 SellerProfiles (by createdAt)
-- Uses a deterministic row number so any existing sellers get a stable number.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn,
         "createdAt"
  FROM "SellerProfile"
)
UPDATE "SellerProfile" sp
SET "isFoundingMaker" = true,
    "foundingMakerNumber" = ranked.rn::int,
    "foundingMakerAt" = ranked."createdAt"
FROM ranked
WHERE sp."id" = ranked."id"
  AND ranked.rn <= 250;

-- Unique index on the number so we don't accidentally double-issue
CREATE UNIQUE INDEX "SellerProfile_foundingMakerNumber_key"
  ON "SellerProfile" ("foundingMakerNumber");

-- Helpful index for the auto-grant counter check
CREATE INDEX "SellerProfile_isFoundingMaker_idx"
  ON "SellerProfile" ("isFoundingMaker");
