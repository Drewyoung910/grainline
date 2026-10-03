CREATE OR REPLACE FUNCTION public.grainline_user_email_address_sync(
  p_user_id text,
  p_current_email text,
  p_source text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_address_sync$
DECLARE
  normalized_current text;
  normalized_source text;
  transition_at timestamp(3) := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User email-address sync actor is invalid'
      USING ERRCODE = '22023';
  END IF;

  normalized_current := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_current_email)), '');
  normalized_source := NULLIF(pg_catalog.left(pg_catalog.btrim(p_source), 80), '');

  IF normalized_current IS NULL
     OR pg_catalog.char_length(normalized_current) > 254
     OR pg_catalog.strpos(normalized_current, '@') <= 1
     OR normalized_current IS DISTINCT FROM p_current_email THEN
    RAISE EXCEPTION 'Current user email-address value is invalid'
      USING ERRCODE = '22023';
  END IF;
  PERFORM account_user.id
    FROM public."User" AS account_user
   WHERE account_user.id = p_user_id
     AND account_user."deletedAt" IS NULL
     AND account_user.email = normalized_current
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User email-address sync source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public."UserEmailAddress" AS address
     SET "isCurrent" = false,
         "lastSeenAt" = transition_at
   WHERE address."userId" = p_user_id
     AND address."isCurrent" = true
     AND address.email <> normalized_current;

  INSERT INTO public."UserEmailAddress" (
    id,
    "userId",
    email,
    source,
    "isCurrent",
    "firstSeenAt",
    "lastSeenAt",
    "currentSinceAt"
  )
  VALUES (
    'user_email_' || pg_catalog.md5(p_user_id || ':' || normalized_current),
    p_user_id,
    normalized_current,
    normalized_source,
    true,
    transition_at,
    transition_at,
    transition_at
  )
  ON CONFLICT ("userId", email) DO UPDATE
    SET source = EXCLUDED.source,
        "isCurrent" = true,
        "lastSeenAt" = EXCLUDED."lastSeenAt",
        "currentSinceAt" = CASE
          WHEN "UserEmailAddress"."isCurrent"
          THEN "UserEmailAddress"."currentSinceAt"
          ELSE EXCLUDED."currentSinceAt"
        END;

  RETURN 1;
END
$grainline_user_email_address_sync$;

CREATE OR REPLACE FUNCTION public.grainline_user_email_address_owner_rows()
RETURNS TABLE (
  email text,
  source text,
  "isCurrent" boolean,
  "firstSeenAt" timestamp(3),
  "lastSeenAt" timestamp(3),
  "currentSinceAt" timestamp(3)
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_address_owner_rows$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User email-address owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS account_user
     WHERE account_user.id = request_user_id
       AND account_user."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User email-address owner is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    address.email::text,
    address.source::text,
    address."isCurrent",
    address."firstSeenAt",
    address."lastSeenAt",
    address."currentSinceAt"
  FROM public."UserEmailAddress" AS address
  WHERE address."userId" = request_user_id
  ORDER BY
    address."isCurrent" DESC,
    address."lastSeenAt" DESC,
    address.email ASC;
END
$grainline_user_email_address_owner_rows$;

CREATE OR REPLACE FUNCTION public.grainline_user_email_address_delete_for_current_user()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_address_delete_for_current_user$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count integer;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User email-address deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM account_user.id
    FROM public."User" AS account_user
   WHERE account_user.id = request_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User email-address deletion owner is unavailable'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."UserEmailAddress" AS address
   WHERE address."userId" = request_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_user_email_address_delete_for_current_user$;

CREATE OR REPLACE FUNCTION public.grainline_user_email_address_newer_current_claim(
  p_suppression_keys text[],
  p_issued_at timestamp(3)
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_address_newer_current_claim$
DECLARE
  candidate_key text;
BEGIN
  IF p_issued_at IS NULL
     OR p_suppression_keys IS NULL
     OR pg_catalog.cardinality(p_suppression_keys) < 1
     OR pg_catalog.cardinality(p_suppression_keys) > 20 THEN
    RAISE EXCEPTION 'User email-address claim input is invalid'
      USING ERRCODE = '22023';
  END IF;
  FOREACH candidate_key IN ARRAY p_suppression_keys LOOP
    IF candidate_key IS NULL
       OR candidate_key = ''
       OR pg_catalog.char_length(candidate_key) > 254
       OR candidate_key IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(candidate_key))
       OR pg_catalog.strpos(candidate_key, '@') <= 1 THEN
      RAISE EXCEPTION 'User email-address claim key is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN EXISTS (
    SELECT 1
      FROM public."UserEmailAddress" AS address
      INNER JOIN public."User" AS account_user
        ON account_user.id = address."userId"
     WHERE address."isCurrent" = true
       AND account_user."deletedAt" IS NULL
       AND address."currentSinceAt" > p_issued_at
       AND CASE
         WHEN pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(address.email), '@', 2))
              IN ('gmail.com', 'googlemail.com')
         THEN pg_catalog.replace(
           pg_catalog.split_part(
             pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(address.email), '@', 1)),
             '+',
             1
           ),
           '.',
           ''
         ) || '@gmail.com'
         ELSE pg_catalog.lower(pg_catalog.btrim(address.email))
       END = ANY(p_suppression_keys)
  );
END
$grainline_user_email_address_newer_current_claim$;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_address_sync(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_address_sync(text, text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_address_owner_rows()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_address_owner_rows()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_address_delete_for_current_user()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_address_delete_for_current_user()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_email_address_newer_current_claim(text[], timestamp)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_email_address_newer_current_claim(text[], timestamp)
  TO grainline_app_runtime;
