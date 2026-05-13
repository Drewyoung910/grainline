-- Re-do the Founding Maker backfill correctly.
--
-- The previous migration backfilled the first 250 SellerProfile rows by their
-- createdAt. That picked up rows belonging to buyers who never posted a listing
-- (any signed-in user that visited the dashboard gets a SellerProfile row via
-- ensureSeller). The badge should only go to sellers with at least one ACTIVE
-- public listing, ordered by the createdAt of their FIRST active listing.

-- Step 1: clear all prior grants so we have a clean slate.
UPDATE "SellerProfile"
SET "isFoundingMaker"     = false,
    "foundingMakerNumber" = NULL,
    "foundingMakerAt"     = NULL;

-- Step 2: build a deterministic ranking of sellers by their first active
-- listing's createdAt, then promote the first 250 of them.
WITH first_active_per_seller AS (
  SELECT "sellerId" AS seller_id,
         MIN("createdAt") AS first_active_at
  FROM "Listing"
  WHERE "status" = 'ACTIVE'
    AND "isPrivate" = false
  GROUP BY "sellerId"
),
ranked AS (
  SELECT seller_id,
         first_active_at,
         ROW_NUMBER() OVER (ORDER BY first_active_at ASC, seller_id ASC) AS rn
  FROM first_active_per_seller
)
UPDATE "SellerProfile" sp
SET "isFoundingMaker"     = true,
    "foundingMakerNumber" = ranked.rn::int,
    "foundingMakerAt"     = ranked.first_active_at
FROM ranked
WHERE sp."id" = ranked.seller_id
  AND ranked.rn <= 250;
