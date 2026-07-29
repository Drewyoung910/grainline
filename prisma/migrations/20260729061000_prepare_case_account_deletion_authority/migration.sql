-- Compatible fixed authority for the Case-family portions of account
-- deletion. This migration adds functions and exact EXECUTE grants only.
-- It does not enable Case-family RLS or revoke legacy table grants.

BEGIN;

DO $grainline_case_account_deletion_prerequisites$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.grainline_account_deletion_email_key_core(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_account_deletion_redact_text_core(text,text[])'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Case account-deletion authority requires the reviewed Conversation/Message redaction cores';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_case_account_deletion_blockers(text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_case_account_deletion_redact(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'Case account-deletion authority functions already exist';
  END IF;
END
$grainline_case_account_deletion_prerequisites$;

CREATE FUNCTION public.grainline_case_account_deletion_blockers(
  p_actor_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_account_deletion_blockers$
DECLARE
  actor_exists boolean;
  blocker_count bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191 THEN
    RAISE EXCEPTION 'Case account-deletion actor is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT true
    INTO actor_exists
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
     AND actor."deletedAt" IS NULL;
  IF NOT FOUND OR actor_exists IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Case account-deletion actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO blocker_count
    FROM public."Case" AS case_row
   WHERE (
       case_row."buyerId" = p_actor_user_id
       OR case_row."sellerId" = p_actor_user_id
     )
     AND case_row.status IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus",
       'UNDER_REVIEW'::public."CaseStatus"
     );
  RETURN blocker_count;
END
$grainline_case_account_deletion_blockers$;

CREATE FUNCTION public.grainline_case_account_deletion_redact(
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

  -- The earlier account-deletion preflight is advisory. Recheck after the
  -- User lock so a Case opened between preflight and anonymization fails
  -- closed. Case opening also takes a shared lock on both parties.
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
        seller."shipFromName",
        seller."shipFromLine1",
        seller."shipFromLine2",
        seller."shipFromCity",
        seller."shipFromState",
        seller."shipFromPostal",
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

REVOKE ALL ON FUNCTION
  public.grainline_case_account_deletion_blockers(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_account_deletion_blockers(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_account_deletion_redact(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_account_deletion_redact(text)
  TO grainline_app_runtime;

COMMIT;
