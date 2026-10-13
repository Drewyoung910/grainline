-- Move the effective account-deletion provider and ship-from reads to the
-- private SellerProfile companion. Public identity and presentation fields remain
-- on SellerProfile. This preserves every function signature and existing grant.

BEGIN;

DO $grainline_account_deletion_seller_private_prerequisites$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.attname IN (
         'sellerProfileId',
         'stripeAccountId',
         'stripeAccountVersion',
         'stripeControllerType',
         'shipFromName',
         'shipFromLine1',
         'shipFromLine2',
         'shipFromCity',
         'shipFromState',
         'shipFromPostal',
         'shipFromPhone'
       )
  ) <> 11 THEN
    RAISE EXCEPTION 'SellerProfilePrivate account-deletion columns are missing';
  END IF;
END
$grainline_account_deletion_seller_private_prerequisites$;

CREATE OR REPLACE FUNCTION public.grainline_user_account_deletion_preflight(
  p_side_effect_id text
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "stripeAccountId" text,
  "stripeAccountVersion" text,
  "stripeControllerType" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_preflight$
DECLARE
  source_effect record;
BEGIN
  IF p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Account-deletion side effect identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT effect.id, effect."userId", effect.kind, effect."dedupKey", effect.payload, effect.status
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id;
  IF NOT FOUND
     OR source_effect.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'
     OR source_effect."dedupKey" IS DISTINCT FROM 'account-delete:local:' || source_effect."userId"
     OR source_effect.payload IS DISTINCT FROM '{}'::jsonb
     OR source_effect.status IS NULL
     OR source_effect.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Account-deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT account_user.id,
         account_user."clerkId"::text,
         account_user."deletedAt",
         seller.id,
         seller_private."stripeAccountId"::text,
         seller_private."stripeAccountVersion"::text,
         seller_private."stripeControllerType"::text
    FROM public."User" AS account_user
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = source_effect."userId";
END
$grainline_user_account_deletion_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_user_account_deletion_snapshot(
  p_side_effect_id text
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  email text,
  name text,
  "deletedAt" timestamp(3),
  "shippingName" text,
  "shippingLine1" text,
  "shippingLine2" text,
  "shippingCity" text,
  "shippingState" text,
  "shippingPostalCode" text,
  "shippingPhone" text,
  "sellerProfileId" text,
  "sellerDisplayName" text,
  "sellerCity" text,
  "sellerState" text,
  "sellerShipFromName" text,
  "sellerShipFromLine1" text,
  "sellerShipFromLine2" text,
  "sellerShipFromCity" text,
  "sellerShipFromState" text,
  "sellerShipFromPostal" text,
  "sellerShipFromPhone" text,
  "sellerTagline" text,
  "sellerBannerImageUrl" text,
  "sellerAvatarImageUrl" text,
  "sellerWorkshopImageUrl" text,
  "sellerInstagramUrl" text,
  "sellerFacebookUrl" text,
  "sellerPinterestUrl" text,
  "sellerTiktokUrl" text,
  "sellerWebsiteUrl" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_snapshot$
DECLARE
  discovered_user_id text;
  locked_user_id text;
  locked_effect record;
BEGIN
  IF p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Account-deletion side effect identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT effect."userId"
    INTO discovered_user_id
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account-deletion source does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT account_user.id
    INTO locked_user_id
    FROM public."User" AS account_user
   WHERE account_user.id = discovered_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account-deletion User is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT effect.id, effect."userId", effect.kind, effect."dedupKey", effect.payload, effect.status
    INTO locked_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_effect."userId" IS DISTINCT FROM locked_user_id
     OR locked_effect.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'
     OR locked_effect."dedupKey" IS DISTINCT FROM 'account-delete:local:' || locked_user_id
     OR locked_effect.payload IS DISTINCT FROM '{}'::jsonb
     OR locked_effect.status IS NULL
     OR locked_effect.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Account-deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT account_user.id,
         account_user."clerkId"::text,
         account_user.email::text,
         account_user.name::text,
         account_user."deletedAt",
         account_user."shippingName"::text,
         account_user."shippingLine1"::text,
         account_user."shippingLine2"::text,
         account_user."shippingCity"::text,
         account_user."shippingState"::text,
         account_user."shippingPostalCode"::text,
         account_user."shippingPhone"::text,
         seller.id,
         seller."displayName"::text,
         seller.city::text,
         seller.state::text,
         seller_private."shipFromName"::text,
         seller_private."shipFromLine1"::text,
         seller_private."shipFromLine2"::text,
         seller_private."shipFromCity"::text,
         seller_private."shipFromState"::text,
         seller_private."shipFromPostal"::text,
         seller_private."shipFromPhone"::text,
         seller.tagline::text,
         seller."bannerImageUrl"::text,
         seller."avatarImageUrl"::text,
         seller."workshopImageUrl"::text,
         seller."instagramUrl"::text,
         seller."facebookUrl"::text,
         seller."pinterestUrl"::text,
         seller."tiktokUrl"::text,
         seller."websiteUrl"::text
    FROM public."User" AS account_user
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = locked_user_id;
END
$grainline_user_account_deletion_snapshot$;

CREATE OR REPLACE FUNCTION public.grainline_message_redact_for_account_deletion(
  p_actor_id text
)
RETURNS TABLE (
  "sentRedacted" integer,
  "receivedRedacted" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_redact_for_account_deletion$
DECLARE
  sensitive_values text[];
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'account deletion redaction requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'account deletion actor is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM account_user.id
    FROM public."User" AS account_user
   WHERE account_user.id = p_actor_id
     AND account_user."deletedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account deletion actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  WITH raw_sensitive_value(value) AS (
    SELECT profile_value.value
      FROM public."User" AS account_user
      LEFT JOIN public."SellerProfile" AS seller
        ON seller."userId" = account_user.id
      LEFT JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
      CROSS JOIN LATERAL pg_catalog.unnest(ARRAY[
        account_user.id,
        account_user."clerkId",
        account_user.email,
        account_user.name,
        account_user."shippingName",
        account_user."shippingLine1",
        account_user."shippingLine2",
        account_user."shippingCity",
        account_user."shippingState",
        account_user."shippingPostalCode",
        account_user."shippingPhone",
        seller.id,
        seller."displayName",
        seller.city,
        seller.state,
        seller_private."shipFromName",
        seller_private."shipFromLine1",
        seller_private."shipFromLine2",
        seller_private."shipFromCity",
        seller_private."shipFromState",
        seller_private."shipFromPostal",
        seller.tagline,
        seller."bannerImageUrl",
        seller."avatarImageUrl",
        seller."workshopImageUrl",
        seller."instagramUrl",
        seller."facebookUrl",
        seller."pinterestUrl",
        seller."tiktokUrl",
        seller."websiteUrl"
      ]::text[]) AS profile_value(value)
     WHERE account_user.id = p_actor_id

    UNION ALL

    SELECT address.email
      FROM public."UserEmailAddress" AS address
     WHERE address."userId" = p_actor_id
       AND NOT EXISTS (
         SELECT 1
           FROM public."User" AS other_user
          WHERE other_user.id <> p_actor_id
            AND other_user."deletedAt" IS NULL
            AND public.grainline_account_deletion_email_key_core(
                  other_user.email
                ) = public.grainline_account_deletion_email_key_core(
                  address.email
                )
       )
  ),
  normalized_sensitive_value AS (
    SELECT DISTINCT pg_catalog.lower(pg_catalog.btrim(value)) AS value
      FROM raw_sensitive_value
     WHERE value IS NOT NULL
       AND pg_catalog.char_length(
             pg_catalog.lower(pg_catalog.btrim(value))
           ) >= 2
  )
  SELECT COALESCE(
           pg_catalog.array_agg(
             value
             ORDER BY pg_catalog.char_length(value) DESC, value
           ),
           ARRAY[]::text[]
         )
    INTO sensitive_values
    FROM normalized_sensitive_value;

  UPDATE public."Message" AS message
     SET body = '[Message deleted]'
   WHERE message."senderId" = p_actor_id
     AND message.body IS DISTINCT FROM '[Message deleted]';
  GET DIAGNOSTICS "sentRedacted" = ROW_COUNT;

  WITH redaction AS (
    SELECT
      message.id,
      public.grainline_account_deletion_redact_text_core(
        message.body,
        sensitive_values
      ) AS redacted_body
      FROM public."Message" AS message
     WHERE message."senderId" <> p_actor_id
       AND message."recipientId" = p_actor_id
  )
  UPDATE public."Message" AS message
     SET body = redaction.redacted_body
    FROM redaction
   WHERE message.id = redaction.id
     AND message.body IS DISTINCT FROM redaction.redacted_body;
  GET DIAGNOSTICS "receivedRedacted" = ROW_COUNT;
  RETURN NEXT;
END;
$grainline_message_redact_for_account_deletion$;

CREATE OR REPLACE FUNCTION public.grainline_case_account_deletion_redact(
  p_account_deletion_side_effect_id text
)
RETURNS TABLE (
  "sideEffectId" text,
  "userId" text,
  "authoredMessagesRedacted" integer,
  "quotedMessagesRedacted" integer,
  "buyerDescriptionsRedacted" integer,
  "participantDescriptionsRedacted" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_account_deletion_redact$
DECLARE
  discovered_effect record;
  locked_user record;
  locked_effect record;
  sensitive_values text[];
  active_case_count bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION
      'Case account-deletion redaction requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_account_deletion_side_effect_id IS NULL
     OR pg_catalog.btrim(p_account_deletion_side_effect_id) = ''
     OR pg_catalog.char_length(p_account_deletion_side_effect_id) > 191 THEN
    RAISE EXCEPTION 'Case account-deletion side effect is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- This unlocked read discovers the canonical User lock target only. The
  -- side effect and every source predicate are re-read after the User lock.
  SELECT
    effect.id,
    effect."userId"
    INTO discovered_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_account_deletion_side_effect_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case account-deletion side effect does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    account_user.id,
    account_user."deletedAt"
    INTO locked_user
    FROM public."User" AS account_user
   WHERE account_user.id = discovered_effect."userId"
   FOR UPDATE;
  IF NOT FOUND OR locked_user."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case account-deletion User is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    effect.id,
    effect."userId",
    effect.kind,
    effect."dedupKey",
    effect.payload,
    effect.status
    INTO locked_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_account_deletion_side_effect_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_effect."userId" IS DISTINCT FROM locked_user.id THEN
    RAISE EXCEPTION 'Case account-deletion source changed'
      USING ERRCODE = '40001';
  END IF;
  IF locked_effect.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'
     OR locked_effect."dedupKey"
          IS DISTINCT FROM 'account-delete:local:' || locked_user.id
     OR locked_effect.payload IS DISTINCT FROM '{}'::jsonb
     OR locked_effect.status IS NULL
     OR locked_effect.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Case account-deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  -- The earlier account-deletion preflight is advisory. Lock every Order
  -- involving this buyer or seller in canonical id order before the final
  -- Case check. Buyer Case-open already blocks on the User lock; seller
  -- Case-open blocks on its Order lock, then observes the completed deletion.
  PERFORM order_row.id
    FROM public."Order" AS order_row
   WHERE order_row."buyerId" = locked_user.id
      OR EXISTS (
        SELECT 1
          FROM public."SellerProfile" AS seller
         WHERE seller.id = order_row."sellerProfileId"
           AND seller."userId" = locked_user.id
      )
   ORDER BY order_row.id
   FOR UPDATE OF order_row;

  -- Use a fresh READ COMMITTED statement snapshot after the Order locks so
  -- a concurrently committed Case is visible before any redaction begins.
  SELECT pg_catalog.count(*)::bigint
    INTO active_case_count
    FROM public."Case" AS case_row
   WHERE (
       case_row."buyerId" = locked_user.id
       OR case_row."sellerId" = locked_user.id
     )
     AND case_row.status IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus",
       'UNDER_REVIEW'::public."CaseStatus"
     );
  IF active_case_count > 0 THEN
    RAISE EXCEPTION
      'Case account-deletion redaction is blocked by an active Case'
      USING ERRCODE = '55000';
  END IF;

  -- This is intentionally byte-equivalent in purpose to the already-live
  -- Conversation/Message deletion derivation. Values come only from the
  -- locked account, its SellerProfile and unclaimed email history; the
  -- runtime cannot provide redaction needles.
  WITH raw_sensitive_value(value) AS (
    SELECT profile_value.value
      FROM public."User" AS account_user
      LEFT JOIN public."SellerProfile" AS seller
        ON seller."userId" = account_user.id
      LEFT JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
      CROSS JOIN LATERAL pg_catalog.unnest(ARRAY[
        account_user.id,
        account_user."clerkId",
        account_user.email,
        account_user.name,
        account_user."shippingName",
        account_user."shippingLine1",
        account_user."shippingLine2",
        account_user."shippingCity",
        account_user."shippingState",
        account_user."shippingPostalCode",
        account_user."shippingPhone",
        seller.id,
        seller."displayName",
        seller.city,
        seller.state,
        seller_private."shipFromName",
        seller_private."shipFromLine1",
        seller_private."shipFromLine2",
        seller_private."shipFromCity",
        seller_private."shipFromState",
        seller_private."shipFromPostal",
        seller.tagline,
        seller."bannerImageUrl",
        seller."avatarImageUrl",
        seller."workshopImageUrl",
        seller."instagramUrl",
        seller."facebookUrl",
        seller."pinterestUrl",
        seller."tiktokUrl",
        seller."websiteUrl"
      ]::text[]) AS profile_value(value)
     WHERE account_user.id = locked_user.id

    UNION ALL

    SELECT address.email
      FROM public."UserEmailAddress" AS address
     WHERE address."userId" = locked_user.id
       AND NOT EXISTS (
         SELECT 1
           FROM public."User" AS other_user
          WHERE other_user.id <> locked_user.id
            AND other_user."deletedAt" IS NULL
            AND public.grainline_account_deletion_email_key_core(
                  other_user.email
                ) = public.grainline_account_deletion_email_key_core(
                  address.email
                )
       )
  ),
  normalized_sensitive_value AS (
    SELECT DISTINCT pg_catalog.lower(pg_catalog.btrim(value)) AS value
      FROM raw_sensitive_value
     WHERE value IS NOT NULL
       AND pg_catalog.char_length(
             pg_catalog.lower(pg_catalog.btrim(value))
           ) >= 2
  )
  SELECT COALESCE(
           pg_catalog.array_agg(
             value
             ORDER BY pg_catalog.char_length(value) DESC, value
           ),
           ARRAY[]::text[]
         )
    INTO sensitive_values
    FROM normalized_sensitive_value;

  UPDATE public."CaseMessage" AS message
     SET body = '[Message deleted]'
   WHERE message."authorId" = locked_user.id
     AND message.body IS DISTINCT FROM '[Message deleted]';
  GET DIAGNOSTICS "authoredMessagesRedacted" = ROW_COUNT;

  WITH redaction AS (
    SELECT
      message.id,
      public.grainline_account_deletion_redact_text_core(
        message.body,
        sensitive_values
      ) AS redacted_body
      FROM public."CaseMessage" AS message
     WHERE message."authorId" IS DISTINCT FROM locked_user.id
       AND EXISTS (
         SELECT 1
           FROM public."Case" AS parent_case
          WHERE parent_case.id = message."caseId"
            AND (
              parent_case."buyerId" = locked_user.id
              OR parent_case."sellerId" = locked_user.id
            )
       )
  )
  UPDATE public."CaseMessage" AS message
     SET body = redaction.redacted_body
    FROM redaction
   WHERE message.id = redaction.id
     AND message.body IS DISTINCT FROM redaction.redacted_body;
  GET DIAGNOSTICS "quotedMessagesRedacted" = ROW_COUNT;

  UPDATE public."Case" AS case_row
     SET description = '[Case description deleted]'
   WHERE case_row."buyerId" = locked_user.id
     AND case_row.description
           IS DISTINCT FROM '[Case description deleted]';
  GET DIAGNOSTICS "buyerDescriptionsRedacted" = ROW_COUNT;

  WITH redaction AS (
    SELECT
      case_row.id,
      public.grainline_account_deletion_redact_text_core(
        case_row.description,
        sensitive_values
      ) AS redacted_description
      FROM public."Case" AS case_row
     WHERE case_row."sellerId" = locked_user.id
       AND case_row."buyerId" IS DISTINCT FROM locked_user.id
       AND case_row.description IS NOT NULL
  )
  UPDATE public."Case" AS case_row
     SET description = redaction.redacted_description
    FROM redaction
   WHERE case_row.id = redaction.id
     AND case_row.description
           IS DISTINCT FROM redaction.redacted_description;
  GET DIAGNOSTICS "participantDescriptionsRedacted" = ROW_COUNT;

  "sideEffectId" := locked_effect.id;
  "userId" := locked_user.id;
  RETURN NEXT;
END
$grainline_case_account_deletion_redact$;

COMMIT;
