-- Archive is a permanent retention state, distinct from a seller's reversible
-- HIDDEN state and from staff moderation of private custom listings.
ALTER TABLE public."Listing"
  ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Before this column existed, HIDDEN + private was the only archive marker.
-- Private custom listings could not be hidden through either seller action,
-- while staff removals used REJECTED, so this is the bounded legacy backfill.
UPDATE public."Listing"
   SET "archivedAt" = "updatedAt"
 WHERE status = 'HIDDEN'
   AND "isPrivate" = true
   -- Legacy staff HOLD_LISTING used this same state pair. A current hold is a
   -- moderation state, not a seller deletion, and must remain undoable.
   AND NOT EXISTS (
     SELECT 1
       FROM public."AdminAuditLog" AS audit
      WHERE audit.action = 'HOLD_LISTING'
        AND audit."targetType" = 'Listing'
        AND audit."targetId" = "Listing".id
        AND NOT audit.undone
   );

CREATE INDEX "Listing_sellerId_archivedAt_updatedAt_idx"
  ON public."Listing"("sellerId", "archivedAt", "updatedAt");

-- OrderItem is policyless FORCE RLS and Conversation/Message reads are scoped
-- by caller context, so the application cannot safely classify retained
-- history with direct table reads. Keep that classification behind one narrow,
-- owner-bound database authority.
CREATE FUNCTION public.grainline_listing_delete_reference_state(
  p_actor_user_id text,
  p_listing_id text
)
RETURNS TABLE (
  "hasOrderItems" boolean,
  "hasReviews" boolean,
  "hasConversations" boolean,
  "hasMessages" boolean,
  "hasCheckoutReservations" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_delete_reference_state$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 128
     OR p_actor_user_id IS DISTINCT FROM pg_catalog.btrim(p_actor_user_id)
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]+$'
     OR p_listing_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_listing_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Listing delete reference input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1
        FROM public."OrderItem" AS item
       WHERE item."listingId" = listing.id
    ),
    EXISTS (
      SELECT 1
        FROM public."Review" AS review
       WHERE review."listingId" = listing.id
    ),
    EXISTS (
      SELECT 1
        FROM public."Conversation" AS conversation
       WHERE conversation."contextListingId" = listing.id
    ),
    EXISTS (
      SELECT 1
        FROM public."Message" AS message
       WHERE message."contextListingId" = listing.id
    ),
    EXISTS (
      SELECT 1
        FROM public."CheckoutStockReservation" AS reservation
       WHERE reservation.status IN ('RESERVED', 'SESSION_CREATED')
         AND (
           EXISTS (
             SELECT 1
               FROM pg_catalog.jsonb_array_elements(
                 reservation."reservedItems"
               ) AS reserved_item(value)
              WHERE reserved_item.value->>'listingId' = listing.id
           )
           -- Made-to-order checkouts intentionally reserve no inventory, so
           -- their authoritative listing reference exists only in the durable
           -- single-checkout source snapshot.
           OR reservation."sourceSnapshot"#>>'{item,listing,id}' = listing.id
           -- Cart snapshots retain the same reference for every item. Keep
           -- the JSON type guard inside the lateral input so malformed legacy
           -- data cannot make seller deletion fail open or abort unexpectedly.
           OR EXISTS (
             SELECT 1
               FROM pg_catalog.jsonb_array_elements(
                 CASE
                   WHEN pg_catalog.jsonb_typeof(
                     reservation."sourceSnapshot"->'items'
                   ) = 'array'
                     THEN reservation."sourceSnapshot"->'items'
                   ELSE '[]'::jsonb
                 END
               ) AS source_item(value)
              WHERE source_item.value->>'listingId' = listing.id
                 OR source_item.value#>>'{listing,id}' = listing.id
           )
         )
    )
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND seller."userId" = p_actor_user_id;
END
$grainline_listing_delete_reference_state$;

REVOKE ALL ON FUNCTION
  public.grainline_listing_delete_reference_state(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.grainline_listing_delete_reference_state(text, text)
  TO grainline_app_runtime;
