-- Resolve one exact review-vote target through the authenticated actor context.
-- Listing and seller visibility stay inside the database authority so review
-- voting no longer depends on a nested SellerProfile projection.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_review_vote_target(
  p_review_id text
)
RETURNS TABLE (
  "reviewId" text,
  "reviewerId" text,
  "helpfulCount" integer,
  "listingId" text,
  "sellerUserId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_review_vote_target$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF p_review_id IS NULL
     OR p_review_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller public review-vote target is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Seller public review-vote actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT review.id::text,
         review."reviewerId"::text,
         review."helpfulCount",
         listing.id::text,
         seller."userId"::text
    FROM public."Review" AS review
    JOIN public."Listing" AS listing
      ON listing.id = review."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE review.id = p_review_id
     AND listing."archivedAt" IS NULL
     AND (
       seller."userId" = actor_id
       OR (
         listing."isPrivate" = true
         AND listing.status::text IN ('ACTIVE', 'SOLD')
         AND listing."reservedForUserId" = actor_id
         AND seller."ownerAccountActive" = true
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
       )
       OR (
         listing."isPrivate" = false
         AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
         AND seller."ownerAccountActive" = true
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
       )
     )
   LIMIT 1;
END
$grainline_seller_public_review_vote_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_review_vote_target(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_review_vote_target(text)
  TO grainline_app_runtime;

COMMIT;
