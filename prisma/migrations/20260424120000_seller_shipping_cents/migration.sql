ALTER TABLE "SellerProfile" ADD COLUMN "shippingFlatRateCents" INTEGER;
ALTER TABLE "SellerProfile" ADD COLUMN "freeShippingOverCents" INTEGER;

UPDATE "SellerProfile"
SET "shippingFlatRateCents" = ROUND("shippingFlatRate" * 100)::integer
WHERE "shippingFlatRate" IS NOT NULL;

UPDATE "SellerProfile"
SET "freeShippingOverCents" = ROUND("freeShippingOver" * 100)::integer
WHERE "freeShippingOver" IS NOT NULL;

ALTER TABLE "SellerProfile" DROP COLUMN "shippingFlatRate";
ALTER TABLE "SellerProfile" DROP COLUMN "freeShippingOver";
