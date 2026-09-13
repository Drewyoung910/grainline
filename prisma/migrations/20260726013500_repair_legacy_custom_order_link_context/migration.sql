-- Repair the one pre-context-column custom-order link classified by protected
-- aggregate-only production inspection 30182892742.
--
-- This is intentionally not a general historical-body backfill. A missing
-- Message.contextListingId is repairable only when its valid JSON listingId
-- resolves to the exact private Listing whose seller, reserved buyer, and
-- custom-order Conversation match the Message route. Fresh/empty databases
-- have zero candidates and pass. More than one candidate or any unrepairable
-- candidate fails closed for separate review.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

-- Match the source-before-thread write order used by custom-order-ready. These
-- brief locks allow reads but prevent source or message drift between the
-- aggregate gate, repair, and postcondition checks.
LOCK TABLE
  public."Listing",
  public."SellerProfile",
  public."Conversation",
  public."Message"
IN SHARE ROW EXCLUSIVE MODE;

DO $grainline_repair_legacy_custom_order_link_context$
DECLARE
  missing_count bigint;
  repairable_count bigint;
  updated_count bigint;
  remaining_missing_count bigint;
  remaining_invalid_count bigint;
  duplicate_source_group_count bigint;
BEGIN
  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE message."isSystemMessage" = true
        AND message."senderId" <> message."recipientId"
        AND listing.id IS NOT NULL
        AND listing."isPrivate" = true
        AND listing."customOrderConversationId" = message."conversationId"
        AND listing."reservedForUserId" = message."recipientId"
        AND seller."userId" = message."senderId"
        AND (
          (
            conversation."userAId" = message."senderId"
            AND conversation."userBId" = message."recipientId"
          )
          OR (
            conversation."userBId" = message."senderId"
            AND conversation."userAId" = message."recipientId"
          )
        )
    )
    INTO missing_count, repairable_count
    FROM public."Message" AS message
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN pg_catalog.pg_input_is_valid(message.body::text, 'jsonb')
          THEN (message.body::jsonb)->>'listingId'
        ELSE NULL
      END AS listing_id
    ) AS payload ON true
    LEFT JOIN public."Listing" AS listing
      ON listing.id = payload.listing_id
    LEFT JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    LEFT JOIN public."Conversation" AS conversation
      ON conversation.id = listing."customOrderConversationId"
   WHERE message.kind = 'custom_order_link'
     AND message."contextListingId" IS NULL;

  IF missing_count > 1 OR repairable_count <> missing_count THEN
    RAISE EXCEPTION '%',
      pg_catalog.format(
        'legacy custom-order-link cleanup scope rejected: missing=%s repairable=%s',
        missing_count,
        repairable_count
      )
      USING ERRCODE = 'P0001';
  END IF;

  WITH repairable AS (
    SELECT message.id AS message_id, listing.id AS listing_id
      FROM public."Message" AS message
      JOIN LATERAL (
        SELECT CASE
          WHEN pg_catalog.pg_input_is_valid(message.body::text, 'jsonb')
            THEN (message.body::jsonb)->>'listingId'
          ELSE NULL
        END AS listing_id
      ) AS payload ON true
      JOIN public."Listing" AS listing
        ON listing.id = payload.listing_id
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN public."Conversation" AS conversation
        ON conversation.id = listing."customOrderConversationId"
     WHERE message.kind = 'custom_order_link'
       AND message."contextListingId" IS NULL
       AND message."isSystemMessage" = true
       AND message."senderId" <> message."recipientId"
       AND listing."isPrivate" = true
       AND listing."customOrderConversationId" = message."conversationId"
       AND listing."reservedForUserId" = message."recipientId"
       AND seller."userId" = message."senderId"
       AND (
         (
           conversation."userAId" = message."senderId"
           AND conversation."userBId" = message."recipientId"
         )
         OR (
           conversation."userBId" = message."senderId"
           AND conversation."userAId" = message."recipientId"
         )
       )
  )
  UPDATE public."Message" AS message
     SET "contextListingId" = repairable.listing_id
    FROM repairable
   WHERE message.id = repairable.message_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> repairable_count THEN
    RAISE EXCEPTION '%',
      pg_catalog.format(
        'legacy custom-order-link cleanup update count drifted: expected=%s updated=%s',
        repairable_count,
        updated_count
      )
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.count(*)
    INTO remaining_missing_count
    FROM public."Message"
   WHERE kind = 'custom_order_link'
     AND "contextListingId" IS NULL;

  SELECT pg_catalog.count(*)
    INTO remaining_invalid_count
    FROM public."Message" AS message
    LEFT JOIN public."Listing" AS listing
      ON listing.id = message."contextListingId"
    LEFT JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    LEFT JOIN public."Conversation" AS conversation
      ON conversation.id = message."conversationId"
   WHERE message.kind = 'custom_order_link'
     AND (
       listing.id IS NULL
       OR seller.id IS NULL
       OR conversation.id IS NULL
       OR listing."isPrivate" = false
       OR listing."reservedForUserId" IS NULL
       OR listing."customOrderConversationId"
            IS DISTINCT FROM message."conversationId"
       OR message."senderId" <> seller."userId"
       OR message."recipientId" <> listing."reservedForUserId"
       OR message."isSystemMessage" = false
       OR (
         CASE
           WHEN pg_catalog.pg_input_is_valid(message.body::text, 'jsonb')
             THEN (message.body::jsonb)->>'listingId'
           ELSE NULL
         END
       ) IS DISTINCT FROM listing.id
     );

  SELECT pg_catalog.count(*)
    INTO duplicate_source_group_count
    FROM (
      SELECT "contextListingId"
        FROM public."Message"
       WHERE kind = 'custom_order_link'
         AND "contextListingId" IS NOT NULL
       GROUP BY "contextListingId"
      HAVING pg_catalog.count(*) > 1
    ) AS duplicate_source;

  IF remaining_missing_count <> 0
     OR remaining_invalid_count <> 0
     OR duplicate_source_group_count <> 0 THEN
    RAISE EXCEPTION '%',
      pg_catalog.format(
        'legacy custom-order-link cleanup postcondition failed: missing=%s invalid=%s duplicate_sources=%s',
        remaining_missing_count,
        remaining_invalid_count,
        duplicate_source_group_count
      )
      USING ERRCODE = 'P0001';
  END IF;
END
$grainline_repair_legacy_custom_order_link_context$;

COMMIT;
