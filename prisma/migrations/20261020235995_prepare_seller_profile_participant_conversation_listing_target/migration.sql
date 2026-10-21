-- Resolve one optional listing context for a new conversation through the
-- authenticated participant pair. This keeps SellerProfile orderability and
-- private-listing reservation checks inside a bounded database authority.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_participant_conversation_listing_target(
  p_other_user_id text,
  p_listing_id text
)
RETURNS TABLE (
  "listingId" text,
  title text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_participant_conversation_listing_target$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_other_user_id IS NULL
     OR p_other_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_other_user_id = actor_id
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller conversation-listing target is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS other_user
        WHERE other_user.id = p_other_user_id
          AND other_user.banned = false
          AND other_user."deletedAt" IS NULL
     )
     OR EXISTS (
       SELECT 1
         FROM public."Block" AS blocked_pair
        WHERE (blocked_pair."blockerId" = actor_id
               AND blocked_pair."blockedId" = p_other_user_id)
           OR (blocked_pair."blockerId" = p_other_user_id
               AND blocked_pair."blockedId" = actor_id)
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing.title::text
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing.status::text = 'ACTIVE'
     AND seller."userId" IN (actor_id, p_other_user_id)
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND (
       listing."isPrivate" = false
       OR (
         listing."reservedForUserId" IN (actor_id, p_other_user_id)
         AND listing."reservedForUserId" <> seller."userId"
       )
     )
   LIMIT 1;
END
$grainline_seller_participant_conversation_listing_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_participant_conversation_listing_target(text,text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_participant_conversation_listing_target(text,text)
  TO grainline_app_runtime;

COMMIT;
