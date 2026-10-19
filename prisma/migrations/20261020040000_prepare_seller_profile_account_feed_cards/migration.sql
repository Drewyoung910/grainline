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

COMMIT;
