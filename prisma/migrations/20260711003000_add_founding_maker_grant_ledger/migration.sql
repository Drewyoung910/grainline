-- Durable allocation ledger for Founding Maker numbers.
--
-- SellerProfile keeps denormalized public badge fields, but issued numbers
-- need a retained source of truth so a future hard delete of a seller profile
-- cannot recycle the highest deleted number.

CREATE TABLE "FoundingMakerGrant" (
  "id" TEXT NOT NULL,
  "sellerProfileId" TEXT,
  "foundingMakerNumber" INTEGER NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FoundingMakerGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FoundingMakerGrant_founding_maker_number_range_chk"
    CHECK ("foundingMakerNumber" >= 1 AND "foundingMakerNumber" <= 250)
);

INSERT INTO "FoundingMakerGrant" (
  "id",
  "sellerProfileId",
  "foundingMakerNumber",
  "grantedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'fmg_' || sp."id",
  sp."id",
  sp."foundingMakerNumber",
  COALESCE(sp."foundingMakerAt", sp."createdAt"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "SellerProfile" sp
WHERE sp."isFoundingMaker" = true
  AND sp."foundingMakerNumber" IS NOT NULL;

CREATE UNIQUE INDEX "FoundingMakerGrant_sellerProfileId_key"
  ON "FoundingMakerGrant" ("sellerProfileId");

CREATE UNIQUE INDEX "FoundingMakerGrant_foundingMakerNumber_key"
  ON "FoundingMakerGrant" ("foundingMakerNumber");

CREATE INDEX "FoundingMakerGrant_grantedAt_idx"
  ON "FoundingMakerGrant" ("grantedAt");

ALTER TABLE "FoundingMakerGrant"
  ADD CONSTRAINT "FoundingMakerGrant_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
