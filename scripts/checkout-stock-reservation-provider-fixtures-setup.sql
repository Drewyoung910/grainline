\set ON_ERROR_STOP on

BEGIN;

DO $grainline_checkout_reservation_provider_fixture_clean$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."User" AS account_user
     WHERE account_user.id LIKE 'checkout-reservation-provider-%'
        OR account_user."clerkId" LIKE 'checkout-reservation-provider-%'
        OR account_user.email LIKE 'checkout-reservation-provider-%@example.invalid'
  ) OR EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
     WHERE seller.id LIKE 'checkout-reservation-provider-%'
        OR seller."stripeAccountId" LIKE 'acct_checkout_reservation_provider_%'
  ) OR EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
     WHERE listing.id LIKE 'checkout-reservation-provider-%'
  ) OR EXISTS (
    SELECT 1
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation."buyerId" LIKE 'checkout-reservation-provider-%'
        OR reservation."sellerId" LIKE 'checkout-reservation-provider-%'
  ) THEN
    RAISE EXCEPTION 'Checkout reservation provider fixtures already exist';
  END IF;
END
$grainline_checkout_reservation_provider_fixture_clean$;

WITH slots AS (
  SELECT slot::integer
    FROM pg_catalog.generate_series(1, 2) AS generated(slot)
)
INSERT INTO public."User" (
  id, "clerkId", email, name, role, "createdAt", "updatedAt",
  "notificationPreferences", banned
)
SELECT
  'checkout-reservation-provider-seller-user-' || slot,
  'checkout-reservation-provider-seller-clerk-' || slot,
  'checkout-reservation-provider-seller-' || slot || '@example.invalid',
  'Checkout Provider Seller ' || slot,
  'USER'::public."Role",
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
  '{}'::jsonb,
  false
FROM slots;

WITH buyers AS (
  SELECT slot::integer, fixture_index::integer
    FROM pg_catalog.generate_series(1, 2) AS slot_series(slot)
   CROSS JOIN pg_catalog.generate_series(0, 19) AS fixture_series(fixture_index)
)
INSERT INTO public."User" (
  id, "clerkId", email, name, role, "createdAt", "updatedAt",
  "notificationPreferences", banned
)
SELECT
  'checkout-reservation-provider-buyer-' || slot || '-' || fixture_index,
  'checkout-reservation-provider-buyer-clerk-' || slot || '-' || fixture_index,
  'checkout-reservation-provider-buyer-' || slot || '-' || fixture_index || '@example.invalid',
  'Checkout Provider Buyer',
  'USER'::public."Role",
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
  '{}'::jsonb,
  false
FROM buyers;

WITH slots AS (
  SELECT slot::integer
    FROM pg_catalog.generate_series(1, 2) AS generated(slot)
)
INSERT INTO public."SellerProfile" (
  id, "userId", "displayName", "displayNameNormalized", "createdAt", "updatedAt",
  "stripeAccountId", "stripeAccountVersion", "chargesEnabled", "acceptingNewOrders",
  "vacationMode", "allowLocalPickup", "offersGiftWrapping", "giftWrappingPriceCents",
  "defaultPkgWeightGrams", "defaultPkgLengthCm", "defaultPkgWidthCm", "defaultPkgHeightCm"
)
SELECT
  'checkout-reservation-provider-seller-' || slot,
  'checkout-reservation-provider-seller-user-' || slot,
  'Checkout Provider Seller ' || slot,
  'checkout provider seller ' || slot,
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
  'acct_checkout_reservation_provider_' || slot,
  'v2',
  true,
  true,
  false,
  true,
  true,
  500,
  1000,
  30,
  20,
  10
FROM slots;

WITH fixtures AS (
  SELECT slot::integer, fixture_index::integer
    FROM pg_catalog.generate_series(1, 2) AS slot_series(slot)
   CROSS JOIN pg_catalog.generate_series(0, 19) AS fixture_series(fixture_index)
)
INSERT INTO public."Listing" (
  id, "sellerId", title, description, "priceCents", "priceVersion", currency,
  status, "listingType", "stockQuantity", "shipsWithinDays", "packagedWeightGrams",
  "packagedLengthCm", "packagedWidthCm", "packagedHeightCm", "isPrivate",
  "createdAt", "updatedAt"
)
SELECT
  'checkout-reservation-provider-listing-' || slot || '-' || fixture_index,
  'checkout-reservation-provider-seller-' || slot,
  'Checkout Provider Listing ' || fixture_index,
  'Disposable provider proof fixture',
  10000 + fixture_index,
  1,
  'usd',
  'ACTIVE'::public."ListingStatus",
  'IN_STOCK'::public."ListingType",
  10000,
  2,
  900,
  25,
  15,
  5,
  false,
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
  pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
FROM fixtures;

WITH fixtures AS (
  SELECT slot::integer, fixture_index::integer
    FROM pg_catalog.generate_series(1, 2) AS slot_series(slot)
   CROSS JOIN pg_catalog.generate_series(0, 19) AS fixture_series(fixture_index)
)
INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder")
SELECT
  'checkout-reservation-provider-group-' || slot || '-' || fixture_index,
  'checkout-reservation-provider-listing-' || slot || '-' || fixture_index,
  'Wood',
  0
FROM fixtures;

WITH fixtures AS (
  SELECT slot::integer, fixture_index::integer
    FROM pg_catalog.generate_series(1, 2) AS slot_series(slot)
   CROSS JOIN pg_catalog.generate_series(0, 19) AS fixture_series(fixture_index)
)
INSERT INTO public."ListingVariantOption" (
  id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock"
)
SELECT
  'checkout-reservation-provider-option-' || slot || '-' || fixture_index,
  'checkout-reservation-provider-group-' || slot || '-' || fixture_index,
  'Oak',
  250,
  0,
  true
FROM fixtures;

DO $grainline_checkout_reservation_provider_fixture_count$
DECLARE
  source_users bigint;
  source_sellers bigint;
  source_listings bigint;
  source_groups bigint;
  source_options bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO STRICT source_users
    FROM public."User" AS account_user
   WHERE account_user.id LIKE 'checkout-reservation-provider-%';
  SELECT pg_catalog.count(*) INTO STRICT source_sellers
    FROM public."SellerProfile" AS seller
   WHERE seller.id LIKE 'checkout-reservation-provider-%';
  SELECT pg_catalog.count(*) INTO STRICT source_listings
    FROM public."Listing" AS listing
   WHERE listing.id LIKE 'checkout-reservation-provider-%';
  SELECT pg_catalog.count(*) INTO STRICT source_groups
    FROM public."ListingVariantGroup" AS variant_group
   WHERE variant_group.id LIKE 'checkout-reservation-provider-%';
  SELECT pg_catalog.count(*) INTO STRICT source_options
    FROM public."ListingVariantOption" AS variant_option
   WHERE variant_option.id LIKE 'checkout-reservation-provider-%';
  IF source_users <> 42 OR source_sellers <> 2 OR source_listings <> 40
     OR source_groups <> 40 OR source_options <> 40 THEN
    RAISE EXCEPTION 'Checkout reservation provider fixture counts are invalid';
  END IF;
END
$grainline_checkout_reservation_provider_fixture_count$;

COMMIT;
