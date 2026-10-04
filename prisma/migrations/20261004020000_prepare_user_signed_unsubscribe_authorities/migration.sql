CREATE OR REPLACE FUNCTION public.grainline_user_unsubscribe_token_superseded(
  p_suppression_keys text[],
  p_issued_at timestamp(3)
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_unsubscribe_token_superseded$
DECLARE
  candidate_key text;
BEGIN
  IF p_issued_at IS NULL
     OR p_suppression_keys IS NULL
     OR pg_catalog.cardinality(p_suppression_keys) < 1
     OR pg_catalog.cardinality(p_suppression_keys) > 20 THEN
    RAISE EXCEPTION 'User unsubscribe token input is invalid'
      USING ERRCODE = '22023';
  END IF;
  FOREACH candidate_key IN ARRAY p_suppression_keys LOOP
    IF candidate_key IS NULL
       OR candidate_key = ''
       OR pg_catalog.char_length(candidate_key) > 254
       OR candidate_key IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(candidate_key))
       OR pg_catalog.strpos(candidate_key, '@') <= 1 THEN
      RAISE EXCEPTION 'User unsubscribe suppression key is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN EXISTS (
    SELECT 1
      FROM public."User" AS account_user
     WHERE CASE
       WHEN pg_catalog.lower(
              pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 2)
            ) IN ('gmail.com', 'googlemail.com')
       THEN pg_catalog.replace(
         pg_catalog.split_part(
           pg_catalog.lower(
             pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 1)
           ),
           '+',
           1
         ),
         '.',
         ''
       ) || '@gmail.com'
       ELSE pg_catalog.lower(pg_catalog.btrim(account_user.email))
     END = ANY (p_suppression_keys)
       AND (
         (
           account_user."deletedAt" IS NULL
           AND account_user."createdAt" > p_issued_at
         )
         OR account_user."emailPreferenceOptInAt" > p_issued_at
       )
  );
END
$grainline_user_unsubscribe_token_superseded$;

CREATE OR REPLACE FUNCTION public.grainline_user_unsubscribe_preferences_disable(
  p_suppression_keys text[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_unsubscribe_preferences_disable$
DECLARE
  candidate_key text;
  changed_at timestamp(3);
  updated_rows integer := 0;
BEGIN
  IF p_suppression_keys IS NULL
     OR pg_catalog.cardinality(p_suppression_keys) < 1
     OR pg_catalog.cardinality(p_suppression_keys) > 20 THEN
    RAISE EXCEPTION 'User unsubscribe preference input is invalid'
      USING ERRCODE = '22023';
  END IF;
  FOREACH candidate_key IN ARRAY p_suppression_keys LOOP
    IF candidate_key IS NULL
       OR candidate_key = ''
       OR pg_catalog.char_length(candidate_key) > 254
       OR candidate_key IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(candidate_key))
       OR pg_catalog.strpos(candidate_key, '@') <= 1 THEN
      RAISE EXCEPTION 'User unsubscribe suppression key is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."User" AS account_user
     SET "notificationPreferences" =
           COALESCE(account_user."notificationPreferences", '{}'::jsonb)
           || pg_catalog.jsonb_build_object(
             'EMAIL_NEW_MESSAGE', false,
             'EMAIL_NEW_ORDER', false,
             'EMAIL_CASE_OPENED', false,
             'EMAIL_CASE_MESSAGE', false,
             'EMAIL_CASE_RESOLVED', false,
             'EMAIL_REFUND_ISSUED', false,
             'EMAIL_CUSTOM_ORDER', false,
             'EMAIL_VERIFICATION_APPROVED', false,
             'EMAIL_VERIFICATION_REJECTED', false,
             'EMAIL_BACK_IN_STOCK', false,
             'EMAIL_NEW_REVIEW', false,
             'EMAIL_FOLLOWED_MAKER_NEW_LISTING', false,
             'EMAIL_SELLER_BROADCAST', false
           ),
         "updatedAt" = changed_at
   WHERE CASE
     WHEN pg_catalog.lower(
            pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 2)
          ) IN ('gmail.com', 'googlemail.com')
     THEN pg_catalog.replace(
       pg_catalog.split_part(
         pg_catalog.lower(
           pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 1)
         ),
         '+',
         1
       ),
       '.',
       ''
     ) || '@gmail.com'
     ELSE pg_catalog.lower(pg_catalog.btrim(account_user.email))
   END = ANY (p_suppression_keys);

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END
$grainline_user_unsubscribe_preferences_disable$;

REVOKE ALL ON FUNCTION
  public.grainline_user_unsubscribe_token_superseded(text[], timestamp)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_unsubscribe_token_superseded(text[], timestamp)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_unsubscribe_preferences_disable(text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_unsubscribe_preferences_disable(text[])
  TO grainline_app_runtime;
