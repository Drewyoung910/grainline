\set ON_ERROR_STOP on

BEGIN;

DELETE FROM public."CheckoutStockReservation" AS reservation
 WHERE reservation."buyerId" LIKE 'checkout-reservation-provider-%'
    OR reservation."sellerId" LIKE 'checkout-reservation-provider-%';

DELETE FROM public."ListingVariantOption" AS variant_option
 WHERE variant_option.id LIKE 'checkout-reservation-provider-%';

DELETE FROM public."ListingVariantGroup" AS variant_group
 WHERE variant_group.id LIKE 'checkout-reservation-provider-%';

DELETE FROM public."Listing" AS listing
 WHERE listing.id LIKE 'checkout-reservation-provider-%';

DELETE FROM public."SellerProfile" AS seller
 WHERE seller.id LIKE 'checkout-reservation-provider-%';

DELETE FROM public."User" AS account_user
 WHERE account_user.id LIKE 'checkout-reservation-provider-%';

DO $grainline_checkout_reservation_provider_fixture_absent$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."User" AS account_user
     WHERE account_user.id LIKE 'checkout-reservation-provider-%'
  ) OR EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
     WHERE seller.id LIKE 'checkout-reservation-provider-%'
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
    RAISE EXCEPTION 'Checkout reservation provider fixtures remained after teardown';
  END IF;
END
$grainline_checkout_reservation_provider_fixture_absent$;

COMMIT;
