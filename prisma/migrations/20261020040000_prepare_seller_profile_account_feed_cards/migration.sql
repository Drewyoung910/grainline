-- Add the actor-bound seller-card projection for the followed-maker feed.
--
-- The operation accepts only a bounded candidate set, verifies that the active
-- actor actually follows each returned seller, applies reciprocal blocks and
-- the existing active-seller predicate, and returns only rendered card fields.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_account_feed_cards(
  p_seller_profile_ids text[]
)
RETURNS TABLE (
  id text,
  "displayName" text,
  "guildLevel" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_account_feed_cards$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Seller account-feed actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_profile_ids IS NULL
     OR pg_catalog.cardinality(p_seller_profile_ids) < 1
     OR pg_catalog.cardinality(p_seller_profile_ids) > 1000
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_seller_profile_ids) AS target(id)
        WHERE target.id IS NULL
           OR target.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR pg_catalog.cardinality(p_seller_profile_ids) <> (
       SELECT pg_catalog.count(DISTINCT target.id)
         FROM pg_catalog.unnest(p_seller_profile_ids) AS target(id)
     ) THEN
    RAISE EXCEPTION 'Seller account-feed target set is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         seller."displayName"::text,
         seller."guildLevel"::text
    FROM pg_catalog.unnest(p_seller_profile_ids)
         WITH ORDINALITY AS requested(id, position)
    JOIN public."SellerProfile" AS seller
      ON seller.id = requested.id
   WHERE seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND EXISTS (
       SELECT 1
         FROM public."Follow" AS relationship
        WHERE relationship."followerId" = request_user_id
          AND relationship."sellerProfileId" = seller.id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS relationship
        WHERE (
          relationship."blockerId" = request_user_id
          AND relationship."blockedId" = seller."userId"
        ) OR (
          relationship."blockerId" = seller."userId"
          AND relationship."blockedId" = request_user_id
        )
     )
   ORDER BY requested.position;
END
$grainline_seller_actor_account_feed_cards$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_account_feed_cards(text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_account_feed_cards(text[])
  TO grainline_app_runtime;

-- Actor-bound saved-listing reads. Favorite ownership, reciprocal blocks, the
-- public listing predicate, and seller orderability all remain inside the
-- authority so callers cannot widen the projection after SellerProfile loses
-- direct runtime access.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_saved_listing_count()
RETURNS TABLE (value bigint)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_saved_listing_count$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Seller saved-listing actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."Favorite" AS favorite
    JOIN public."Listing" AS listing
      ON listing.id = favorite."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE favorite."userId" = request_user_id
     AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS relationship
        WHERE (
          relationship."blockerId" = request_user_id
          AND relationship."blockedId" = seller."userId"
        ) OR (
          relationship."blockerId" = seller."userId"
          AND relationship."blockedId" = request_user_id
        )
     );
END
$grainline_seller_owner_saved_listing_count$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_saved_listing_page(
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  "savedAt" timestamp without time zone,
  "listingId" text,
  title text,
  "priceCents" integer,
  currency text,
  status text,
  "listingType" text,
  "stockQuantity" integer,
  "sellerProfileId" text,
  "displayName" text,
  "avatarImageUrl" text,
  "ownerImageUrl" text,
  "guildLevel" text,
  city text,
  state text,
  "acceptingNewOrders" boolean,
  "photoUrl" text,
  "photoAltText" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_saved_listing_page$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Seller saved-listing actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 24
     OR p_offset IS NULL
     OR p_offset < 0
     OR p_offset > 23976 THEN
    RAISE EXCEPTION 'Seller saved-listing page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT favorite."createdAt"::timestamp without time zone,
         listing.id::text,
         listing.title::text,
         listing."priceCents",
         listing.currency::text,
         listing.status::text,
         listing."listingType"::text,
         listing."stockQuantity",
         seller.id::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text,
         seller."ownerImageUrl"::text,
         seller."guildLevel"::text,
         seller.city::text,
         seller.state::text,
         seller."acceptingNewOrders",
         first_photo.url::text,
         first_photo."altText"::text
    FROM public."Favorite" AS favorite
    JOIN public."Listing" AS listing
      ON listing.id = favorite."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    LEFT JOIN LATERAL (
      SELECT photo.url,
             photo."altText"
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
       ORDER BY photo."sortOrder" ASC, photo.id ASC
       LIMIT 1
    ) AS first_photo ON true
   WHERE favorite."userId" = request_user_id
     AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS relationship
        WHERE (
          relationship."blockerId" = request_user_id
          AND relationship."blockedId" = seller."userId"
        ) OR (
          relationship."blockerId" = seller."userId"
          AND relationship."blockedId" = request_user_id
        )
     )
   ORDER BY favorite."createdAt" DESC, favorite."listingId" DESC
   LIMIT p_limit
  OFFSET p_offset;
END
$grainline_seller_owner_saved_listing_page$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_saved_listing_count()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_saved_listing_count()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_saved_listing_page(integer, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_saved_listing_page(integer, integer)
  TO grainline_app_runtime;

COMMIT;
