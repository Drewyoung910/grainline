CREATE OR REPLACE FUNCTION public.grainline_user_email_recipient(
  p_user_id text,
  p_preference_key text
)
RETURNS TABLE (
  "userId" text,
  name text,
  email text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_recipient$
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (
       p_preference_key IS NOT NULL
       AND p_preference_key <> ALL (ARRAY[
         'EMAIL_NEW_MESSAGE', 'EMAIL_NEW_ORDER',
         'EMAIL_CASE_OPENED', 'EMAIL_CASE_MESSAGE', 'EMAIL_CASE_RESOLVED',
         'EMAIL_REFUND_ISSUED', 'EMAIL_CUSTOM_ORDER',
         'EMAIL_VERIFICATION_APPROVED', 'EMAIL_VERIFICATION_REJECTED',
         'EMAIL_BACK_IN_STOCK', 'EMAIL_NEW_REVIEW',
         'EMAIL_FOLLOWED_MAKER_NEW_LISTING', 'EMAIL_SELLER_BROADCAST'
       ]::text[])
     ) THEN
    RAISE EXCEPTION 'User email recipient input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    account_user.id,
    account_user.name::text,
    pg_catalog.lower(pg_catalog.btrim(account_user.email))
  FROM public."User" AS account_user
  WHERE account_user.id = p_user_id
    AND account_user.banned = false
    AND account_user."deletedAt" IS NULL
    AND pg_catalog.char_length(pg_catalog.btrim(account_user.email)) BETWEEN 3 AND 254
    AND pg_catalog.strpos(account_user.email, '@') > 1
    AND (
      p_preference_key IS NULL
      OR CASE
        WHEN p_preference_key = 'EMAIL_SELLER_BROADCAST'
        THEN account_user."notificationPreferences" -> p_preference_key = 'true'::jsonb
        ELSE account_user."notificationPreferences" -> p_preference_key
             IS DISTINCT FROM 'false'::jsonb
      END
    );
END
$grainline_user_email_recipient$;

CREATE OR REPLACE FUNCTION public.grainline_user_email_recipient_batch(
  p_user_ids text[],
  p_preference_key text
)
RETURNS TABLE (
  "userId" text,
  name text,
  email text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_recipient_batch$
DECLARE
  candidate_id text;
BEGIN
  IF p_user_ids IS NULL
     OR pg_catalog.cardinality(p_user_ids) < 1
     OR pg_catalog.cardinality(p_user_ids) > 500
     OR p_preference_key IS NULL
     OR p_preference_key <> ALL (ARRAY[
       'EMAIL_NEW_MESSAGE', 'EMAIL_NEW_ORDER',
       'EMAIL_CASE_OPENED', 'EMAIL_CASE_MESSAGE', 'EMAIL_CASE_RESOLVED',
       'EMAIL_REFUND_ISSUED', 'EMAIL_CUSTOM_ORDER',
       'EMAIL_VERIFICATION_APPROVED', 'EMAIL_VERIFICATION_REJECTED',
       'EMAIL_BACK_IN_STOCK', 'EMAIL_NEW_REVIEW',
       'EMAIL_FOLLOWED_MAKER_NEW_LISTING', 'EMAIL_SELLER_BROADCAST'
     ]::text[]) THEN
    RAISE EXCEPTION 'User email recipient batch input is invalid'
      USING ERRCODE = '22023';
  END IF;
  FOREACH candidate_id IN ARRAY p_user_ids LOOP
    IF candidate_id IS NULL
       OR candidate_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
      RAISE EXCEPTION 'User email recipient batch input is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN QUERY
  WITH requested AS (
    SELECT requested_id, pg_catalog.min(ordinality) AS first_ordinal
    FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY
      AS input(requested_id, ordinality)
    GROUP BY requested_id
  )
  SELECT
    account_user.id,
    account_user.name::text,
    pg_catalog.lower(pg_catalog.btrim(account_user.email))
  FROM requested
  INNER JOIN public."User" AS account_user
    ON account_user.id = requested.requested_id
  WHERE account_user.banned = false
    AND account_user."deletedAt" IS NULL
    AND pg_catalog.char_length(pg_catalog.btrim(account_user.email)) BETWEEN 3 AND 254
    AND pg_catalog.strpos(account_user.email, '@') > 1
    AND CASE
      WHEN p_preference_key = 'EMAIL_SELLER_BROADCAST'
      THEN account_user."notificationPreferences" -> p_preference_key = 'true'::jsonb
      ELSE account_user."notificationPreferences" -> p_preference_key
           IS DISTINCT FROM 'false'::jsonb
    END
  ORDER BY requested.first_ordinal;
END
$grainline_user_email_recipient_batch$;

CREATE OR REPLACE FUNCTION public.grainline_user_email_account_state_by_id(
  p_user_id text,
  p_expected_email text
)
RETURNS text
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_account_state_by_id$
DECLARE
  account_banned boolean;
  account_deleted_at timestamp(3);
  account_email text;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_email IS NULL
     OR p_expected_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_expected_email))
     OR pg_catalog.char_length(p_expected_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_expected_email, '@') <= 1 THEN
    RAISE EXCEPTION 'User email account-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    account_user.banned,
    account_user."deletedAt",
    pg_catalog.lower(pg_catalog.btrim(account_user.email))
  INTO account_banned, account_deleted_at, account_email
  FROM public."User" AS account_user
  WHERE account_user.id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'missing';
  ELSIF account_banned THEN
    RETURN 'banned';
  ELSIF account_deleted_at IS NOT NULL THEN
    RETURN 'deleted';
  ELSIF account_email IS DISTINCT FROM p_expected_email THEN
    RETURN 'email_changed';
  END IF;
  RETURN 'active';
END
$grainline_user_email_account_state_by_id$;

CREATE OR REPLACE FUNCTION public.grainline_user_email_account_state_by_email(
  p_email text
)
RETURNS text
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_account_state_by_email$
DECLARE
  account_banned boolean;
  account_deleted_at timestamp(3);
BEGIN
  IF p_email IS NULL
     OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_email, '@') <= 1 THEN
    RAISE EXCEPTION 'User email account-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_user.banned, account_user."deletedAt"
  INTO account_banned, account_deleted_at
  FROM public."User" AS account_user
  WHERE account_user.email = p_email;

  IF NOT FOUND THEN
    RETURN 'missing';
  ELSIF account_banned THEN
    RETURN 'banned';
  ELSIF account_deleted_at IS NOT NULL THEN
    RETURN 'deleted';
  END IF;
  RETURN 'active';
END
$grainline_user_email_account_state_by_email$;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_recipient(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_recipient(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_recipient_batch(text[], text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_recipient_batch(text[], text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_account_state_by_id(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_account_state_by_id(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_account_state_by_email(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_account_state_by_email(text)
  TO grainline_app_runtime;
