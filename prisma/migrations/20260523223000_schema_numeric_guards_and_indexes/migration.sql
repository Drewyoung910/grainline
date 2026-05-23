-- Add database-level numeric invariants that Prisma cannot model, plus
-- indexes for verified hot query/cleanup paths.

-- Existing IN_STOCK listings with NULL stock already behave as unavailable in
-- checkout because SQL comparisons against NULL do not reserve stock. Make that
-- implicit state explicit before validating the stricter invariant.
UPDATE "Listing"
SET "stockQuantity" = 0
WHERE "listingType" = 'IN_STOCK'
  AND "stockQuantity" IS NULL;

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_itemsSubtotalCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_itemsSubtotalCents_non_negative_chk"
CHECK ("itemsSubtotalCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_itemsSubtotalCents_non_negative_chk";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_shippingAmountCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_shippingAmountCents_non_negative_chk"
CHECK ("shippingAmountCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_shippingAmountCents_non_negative_chk";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_taxAmountCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_taxAmountCents_non_negative_chk"
CHECK ("taxAmountCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_taxAmountCents_non_negative_chk";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_giftWrappingPriceCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_giftWrappingPriceCents_non_negative_chk"
CHECK ("giftWrappingPriceCents" IS NULL OR "giftWrappingPriceCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_giftWrappingPriceCents_non_negative_chk";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_quotedShippingAmountCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_quotedShippingAmountCents_non_negative_chk"
CHECK ("quotedShippingAmountCents" IS NULL OR "quotedShippingAmountCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_quotedShippingAmountCents_non_negative_chk";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_labelCostCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_labelCostCents_non_negative_chk"
CHECK ("labelCostCents" IS NULL OR "labelCostCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_labelCostCents_non_negative_chk";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_sellerRefundAmountCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_sellerRefundAmountCents_non_negative_chk"
CHECK ("sellerRefundAmountCents" IS NULL OR "sellerRefundAmountCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_sellerRefundAmountCents_non_negative_chk";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_taxReversalAmountCents_non_negative_chk";
ALTER TABLE "Order"
ADD CONSTRAINT "Order_taxReversalAmountCents_non_negative_chk"
CHECK ("taxReversalAmountCents" IS NULL OR "taxReversalAmountCents" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_taxReversalAmountCents_non_negative_chk";

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_refundAmountCents_non_negative_chk";
ALTER TABLE "Case"
ADD CONSTRAINT "Case_refundAmountCents_non_negative_chk"
CHECK ("refundAmountCents" IS NULL OR "refundAmountCents" >= 0) NOT VALID;
ALTER TABLE "Case" VALIDATE CONSTRAINT "Case_refundAmountCents_non_negative_chk";

ALTER TABLE "CommissionRequest" DROP CONSTRAINT IF EXISTS "CommissionRequest_budget_valid_chk";
ALTER TABLE "CommissionRequest"
ADD CONSTRAINT "CommissionRequest_budget_valid_chk"
CHECK (
  ("budgetMinCents" IS NULL OR ("budgetMinCents" >= 0 AND "budgetMinCents" <= 10000000))
  AND ("budgetMaxCents" IS NULL OR ("budgetMaxCents" >= 0 AND "budgetMaxCents" <= 10000000))
  AND ("budgetMinCents" IS NULL OR "budgetMaxCents" IS NULL OR "budgetMinCents" <= "budgetMaxCents")
) NOT VALID;
ALTER TABLE "CommissionRequest" VALIDATE CONSTRAINT "CommissionRequest_budget_valid_chk";

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_processing_days_valid_chk";
ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_processing_days_valid_chk"
CHECK (
  ("processingTimeMinDays" IS NULL OR ("processingTimeMinDays" >= 1 AND "processingTimeMinDays" <= 365))
  AND ("processingTimeMaxDays" IS NULL OR ("processingTimeMaxDays" >= 1 AND "processingTimeMaxDays" <= 365))
  AND ("processingTimeMinDays" IS NULL OR "processingTimeMaxDays" IS NULL OR "processingTimeMinDays" <= "processingTimeMaxDays")
) NOT VALID;
ALTER TABLE "Listing" VALIDATE CONSTRAINT "Listing_processing_days_valid_chk";

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_in_stock_quantity_required_chk";
ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_in_stock_quantity_required_chk"
CHECK ("listingType" <> 'IN_STOCK' OR "stockQuantity" IS NOT NULL) NOT VALID;
ALTER TABLE "Listing" VALIDATE CONSTRAINT "Listing_in_stock_quantity_required_chk";

ALTER TABLE "SellerProfile" DROP CONSTRAINT IF EXISTS "SellerProfile_shipping_money_non_negative_chk";
ALTER TABLE "SellerProfile"
ADD CONSTRAINT "SellerProfile_shipping_money_non_negative_chk"
CHECK (
  ("shippingFlatRateCents" IS NULL OR "shippingFlatRateCents" >= 0)
  AND ("freeShippingOverCents" IS NULL OR "freeShippingOverCents" >= 0)
  AND ("giftWrappingPriceCents" IS NULL OR ("giftWrappingPriceCents" >= 0 AND "giftWrappingPriceCents" <= 10000))
) NOT VALID;
ALTER TABLE "SellerProfile" VALIDATE CONSTRAINT "SellerProfile_shipping_money_non_negative_chk";

ALTER TABLE "SellerProfile" DROP CONSTRAINT IF EXISTS "SellerProfile_default_pkg_non_negative_chk";
ALTER TABLE "SellerProfile"
ADD CONSTRAINT "SellerProfile_default_pkg_non_negative_chk"
CHECK (
  ("defaultPkgWeightGrams" IS NULL OR "defaultPkgWeightGrams" >= 0)
  AND ("defaultPkgLengthCm" IS NULL OR "defaultPkgLengthCm" >= 0)
  AND ("defaultPkgWidthCm" IS NULL OR "defaultPkgWidthCm" >= 0)
  AND ("defaultPkgHeightCm" IS NULL OR "defaultPkgHeightCm" >= 0)
) NOT VALID;
ALTER TABLE "SellerProfile" VALIDATE CONSTRAINT "SellerProfile_default_pkg_non_negative_chk";

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_analytics_non_negative_chk";
ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_analytics_non_negative_chk"
CHECK ("viewCount" >= 0 AND "clickCount" >= 0) NOT VALID;
ALTER TABLE "Listing" VALIDATE CONSTRAINT "Listing_analytics_non_negative_chk";

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_scores_range_chk";
ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_scores_range_chk"
CHECK (
  "qualityScore" >= 0
  AND "qualityScore" <= 1.2
  AND ("aiReviewScore" IS NULL OR ("aiReviewScore" >= 0 AND "aiReviewScore" <= 1))
) NOT VALID;
ALTER TABLE "Listing" VALIDATE CONSTRAINT "Listing_scores_range_chk";

ALTER TABLE "SellerProfile" DROP CONSTRAINT IF EXISTS "SellerProfile_founding_maker_number_range_chk";
ALTER TABLE "SellerProfile"
ADD CONSTRAINT "SellerProfile_founding_maker_number_range_chk"
CHECK ("foundingMakerNumber" IS NULL OR ("foundingMakerNumber" >= 1 AND "foundingMakerNumber" <= 250)) NOT VALID;
ALTER TABLE "SellerProfile" VALIDATE CONSTRAINT "SellerProfile_founding_maker_number_range_chk";

ALTER TABLE "SellerProfile" DROP CONSTRAINT IF EXISTS "SellerProfile_radiusMeters_range_chk";
ALTER TABLE "SellerProfile"
ADD CONSTRAINT "SellerProfile_radiusMeters_range_chk"
CHECK ("radiusMeters" IS NULL OR ("radiusMeters" >= 0 AND "radiusMeters" <= 8047)) NOT VALID;
ALTER TABLE "SellerProfile" VALIDATE CONSTRAINT "SellerProfile_radiusMeters_range_chk";

ALTER TABLE "CommissionRequest" DROP CONSTRAINT IF EXISTS "CommissionRequest_radiusMeters_range_chk";
ALTER TABLE "CommissionRequest"
ADD CONSTRAINT "CommissionRequest_radiusMeters_range_chk"
CHECK ("radiusMeters" IS NULL OR ("radiusMeters" >= 0 AND "radiusMeters" <= 804672)) NOT VALID;
ALTER TABLE "CommissionRequest" VALIDATE CONSTRAINT "CommissionRequest_radiusMeters_range_chk";

ALTER TABLE "Metro" DROP CONSTRAINT IF EXISTS "Metro_radiusMiles_range_chk";
ALTER TABLE "Metro"
ADD CONSTRAINT "Metro_radiusMiles_range_chk"
CHECK ("radiusMiles" >= 1 AND "radiusMiles" <= 500) NOT VALID;
ALTER TABLE "Metro" VALIDATE CONSTRAINT "Metro_radiusMiles_range_chk";

ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_ratingX2_range_chk";
ALTER TABLE "Review"
ADD CONSTRAINT "Review_ratingX2_range_chk"
CHECK ("ratingX2" >= 2 AND "ratingX2" <= 10) NOT VALID;
ALTER TABLE "Review" VALIDATE CONSTRAINT "Review_ratingX2_range_chk";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SellerProfile_metroId_idx"
ON "SellerProfile"("metroId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SellerProfile_cityMetroId_idx"
ON "SellerProfile"("cityMetroId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_metroId_idx"
ON "Listing"("metroId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_cityMetroId_idx"
ON "Listing"("cityMetroId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CommissionRequest_metroId_idx"
ON "CommissionRequest"("metroId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CommissionRequest_cityMetroId_idx"
ON "CommissionRequest"("cityMetroId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Case_sellerId_idx"
ON "Case"("sellerId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_senderId_idx"
ON "Message"("senderId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CaseMessage_authorId_idx"
ON "CaseMessage"("authorId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BlogComment_authorId_idx"
ON "BlogComment"("authorId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Favorite_listingId_idx"
ON "Favorite"("listingId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CartItem_listingId_idx"
ON "CartItem"("listingId");
