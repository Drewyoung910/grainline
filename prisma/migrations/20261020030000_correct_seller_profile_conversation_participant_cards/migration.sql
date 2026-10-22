-- Correct the participant-card result projection for the real SellerProfile
-- varchar schema. PostgreSQL requires exact RETURN QUERY column types for
-- PL/pgSQL table functions; the predecessor's uncast varchar values fail with
-- SQLSTATE 42804 even though lightweight text-only fixtures accepted them.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_conversation_cards(
  p_target_user_ids text[]
)
RETURNS TABLE (
  "sellerProfileId" text,
  "userId" text,
  "displayName" text,
  "avatarImageUrl" text,
  "acceptsCustomOrders" boolean,
  "chargesEnabled" boolean,
  "stripeAccountSupported" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_conversation_cards$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller conversation participant context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_user_ids IS NULL
     OR pg_catalog.cardinality(p_target_user_ids) < 1
     OR pg_catalog.cardinality(p_target_user_ids) > 51
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_target_user_ids) AS target("userId")
        WHERE target."userId" IS NULL
           OR target."userId" !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR pg_catalog.cardinality(p_target_user_ids) <> (
       SELECT pg_catalog.count(DISTINCT target."userId")
         FROM pg_catalog.unnest(p_target_user_ids) AS target("userId")
     ) THEN
    RAISE EXCEPTION 'Seller conversation participant target set is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text,
         seller."acceptsCustomOrders",
         seller."chargesEnabled",
         seller."stripeAccountSupported"
    FROM pg_catalog.unnest(p_target_user_ids)
         WITH ORDINALITY AS requested("userId", position)
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = requested."userId"
   WHERE requested."userId" <> request_user_id
     AND EXISTS (
       SELECT 1
         FROM public."Conversation" AS conversation
        WHERE (
          conversation."userAId" = request_user_id
          AND conversation."userBId" = requested."userId"
        ) OR (
          conversation."userBId" = request_user_id
          AND conversation."userAId" = requested."userId"
        )
     )
   ORDER BY requested.position;
END
$grainline_seller_actor_conversation_cards$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_conversation_cards(text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_conversation_cards(text[])
  TO grainline_app_runtime;

COMMIT;
