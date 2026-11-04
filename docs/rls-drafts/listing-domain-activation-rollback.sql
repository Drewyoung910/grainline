-- EMERGENCY DATABASE-FIRST rollback draft for the Listing-family activation.
-- Run only from a direct owner session after separate incident approval. Keep
-- The validated public/reservation invariant returns to the preparation
-- posture (present but NOT VALID). Keep the applied Prisma ledger row intact;
-- any later reactivation must use a new reviewed forward migration name.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.listing-domain.rls.activation', 0)
);

LOCK TABLE public."Listing", public."Photo", public."ListingVariantGroup", public."ListingVariantOption"
  IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public."Listing" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Listing" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Photo" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Photo" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantGroup" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantGroup" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantOption" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantOption" DISABLE ROW LEVEL SECURITY;

DROP POLICY listing_public_select ON public."Listing";
DROP POLICY photo_public_select ON public."Photo";
DROP POLICY listing_variant_group_public_select ON public."ListingVariantGroup";
DROP POLICY listing_variant_option_public_select ON public."ListingVariantOption";

ALTER TABLE public."Listing"
  DROP CONSTRAINT "Listing_public_reservation_routing_chk";

ALTER TABLE public."Listing"
  ADD CONSTRAINT "Listing_public_reservation_routing_chk"
  CHECK (
    "isPrivate" OR (
      "reservedForUserId" IS NULL
      AND "customOrderConversationId" IS NULL
    )
  ) NOT VALID;

REVOKE ALL PRIVILEGES ON TABLE
  public."Listing", public."Photo", public."ListingVariantGroup", public."ListingVariantOption"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

REVOKE SELECT (
  "id", "sellerId", "title", "description", "priceCents", "currency",
  "status", "createdAt", "updatedAt", "archivedAt", "videoUrl", "tags",
  "processingTimeMinDays", "processingTimeMaxDays", "listingType",
  "stockQuantity", "shipsWithinDays", "category", "clickCount", "viewCount",
  "isPrivate", "cityMetroId", "metroId", "qualityScore", "materials",
  "metaDescription", "productHeightIn", "productLengthIn", "productWidthIn",
  "sellerPubliclyOrderable", "sellerDisplayName",
  "sellerDisplayNameNormalized", "sellerAverageRating", "sellerReviewCount",
  "favoriteCount"
) ON TABLE public."Listing" FROM grainline_app_runtime;
REVOKE SELECT ("id", "listingId", "url", "altText", "sortOrder", "createdAt")
  ON TABLE public."Photo" FROM grainline_app_runtime;
REVOKE SELECT ("id", "listingId", "name", "sortOrder")
  ON TABLE public."ListingVariantGroup" FROM grainline_app_runtime;
REVOKE SELECT ("id", "groupId", "label", "priceAdjustCents", "sortOrder", "inStock")
  ON TABLE public."ListingVariantOption" FROM grainline_app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."Listing", public."Photo", public."ListingVariantGroup", public."ListingVariantOption"
  TO grainline_app_runtime;

COMMIT;
