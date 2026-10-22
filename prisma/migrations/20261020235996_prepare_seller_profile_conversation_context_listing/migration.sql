-- Resolve the retained listing card for an existing conversation without
-- granting the runtime role direct Listing -> SellerProfile access. The card
-- remains visible for conversation history, while canViewDetail follows the
-- current listing-detail lifecycle and seller-orderability rules.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_conversation_context_listing(
  p_conversation_id text
)
RETURNS TABLE (
  "listingId" text,
  title text,
  "priceCents" integer,
  currency text,
  "photoUrl" text,
  "canViewDetail" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_conversation_context_listing$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_conversation_id IS NULL
     OR p_conversation_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller conversation-context listing input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing.title::text,
         listing."priceCents"::integer,
         listing.currency::text,
         first_photo.url::text,
         (
           listing."archivedAt" IS NULL
           AND actor_user.banned = false
           AND actor_user."deletedAt" IS NULL
           AND (
            (
              seller."userId" = actor_id
              AND actor_id IN (conversation."userAId", conversation."userBId")
            )
             OR (
               listing.status::text IN ('ACTIVE', 'SOLD')
               AND listing."isPrivate" = true
               AND listing."reservedForUserId" = actor_id
              AND actor_id IN (conversation."userAId", conversation."userBId")
               AND seller."ownerAccountActive" = true
               AND seller."chargesEnabled" = true
               AND seller."stripeAccountSupported" = true
               AND seller."vacationMode" = false
             )
             OR (
               listing.status::text IN ('ACTIVE', 'SOLD_OUT')
               AND listing."isPrivate" = false
               AND seller."ownerAccountActive" = true
               AND seller."chargesEnabled" = true
               AND seller."stripeAccountSupported" = true
               AND seller."vacationMode" = false
             )
           )
         ) AS "canViewDetail"
    FROM public."Conversation" AS conversation
    JOIN public."User" AS actor_user
      ON actor_user.id = actor_id
    JOIN public."Listing" AS listing
      ON listing.id = conversation."contextListingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    LEFT JOIN LATERAL (
      SELECT photo.url
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
       ORDER BY photo."sortOrder" ASC, photo.id ASC
       LIMIT 1
    ) AS first_photo ON true
   WHERE conversation.id = p_conversation_id
     AND (
       conversation."userAId" = actor_id
       OR conversation."userBId" = actor_id
       OR public.grainline_conversation_staff_report_visible(conversation.id)
     )
   LIMIT 1;
END
$grainline_seller_actor_conversation_context_listing$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_conversation_context_listing(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_conversation_context_listing(text)
  TO grainline_app_runtime;

COMMIT;
