-- Bound seller-defined variant price adjustments. App-level validation also
-- checks the effective final listing price across all selected option groups.

UPDATE "ListingVariantOption"
SET "priceAdjustCents" = GREATEST(-10000000, LEAST(10000000, "priceAdjustCents"))
WHERE "priceAdjustCents" < -10000000 OR "priceAdjustCents" > 10000000;

ALTER TABLE "ListingVariantOption" DROP CONSTRAINT IF EXISTS "ListingVariantOption_price_adjust_range_chk";
ALTER TABLE "ListingVariantOption"
ADD CONSTRAINT "ListingVariantOption_price_adjust_range_chk"
CHECK ("priceAdjustCents" >= -10000000 AND "priceAdjustCents" <= 10000000) NOT VALID;
ALTER TABLE "ListingVariantOption" VALIDATE CONSTRAINT "ListingVariantOption_price_adjust_range_chk";
