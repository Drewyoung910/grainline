CREATE OR REPLACE FUNCTION public.grainline_user_block_targets()
RETURNS TABLE (
  "userId" text,
  "sellerProfileId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_targets$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User block owner context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
         counterpart.id,
         seller.id
    FROM public."Block" AS relationship
    JOIN public."User" AS actor
      ON actor.id = request_user_id
     AND actor."deletedAt" IS NULL
    JOIN public."User" AS counterpart
      ON counterpart.id = CASE
           WHEN relationship."blockerId" = request_user_id
           THEN relationship."blockedId"
           ELSE relationship."blockerId"
         END
     AND counterpart."deletedAt" IS NULL
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = counterpart.id
   WHERE relationship."blockerId" = request_user_id
      OR relationship."blockedId" = request_user_id
   ORDER BY counterpart.id, seller.id;
END
$grainline_user_block_targets$;

CREATE OR REPLACE FUNCTION public.grainline_user_blocked_account_page()
RETURNS TABLE (
  "blockId" text,
  "blockedId" text,
  name text,
  "imageUrl" text,
  "sellerDisplayName" text,
  "sellerAvatarImageUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_blocked_account_page$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User blocked-account context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT relationship.id,
         relationship."blockedId",
         blocked_user.name::text,
         blocked_user."imageUrl"::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text
    FROM public."Block" AS relationship
    JOIN public."User" AS actor
      ON actor.id = request_user_id
     AND actor."deletedAt" IS NULL
    JOIN public."User" AS blocked_user
      ON blocked_user.id = relationship."blockedId"
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = blocked_user.id
   WHERE relationship."blockerId" = request_user_id
   ORDER BY relationship."createdAt" DESC, relationship.id DESC
   LIMIT 50;
END
$grainline_user_blocked_account_page$;

CREATE OR REPLACE FUNCTION public.grainline_user_block_pair_lock(
  p_target_id text
)
RETURNS TABLE (
  id text,
  "deletedAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_pair_lock$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL
     OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id = request_user_id THEN
    RAISE EXCEPTION 'User block pair input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'User block mutation requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  -- Notification creation takes FOR SHARE on this same sorted pair before its
  -- reciprocal Block absence check. Keep this exact conflicting order so the
  -- first transaction determines whether the notification is admitted.
  RETURN QUERY
  SELECT account_user.id,
         account_user."deletedAt"
    FROM public."User" AS account_user
   WHERE account_user.id IN (request_user_id, p_target_id)
   ORDER BY account_user.id
   FOR UPDATE;
END
$grainline_user_block_pair_lock$;

CREATE OR REPLACE FUNCTION public.grainline_user_email_fallback_addresses()
RETURNS TABLE (email text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_email_fallback_addresses$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User email fallback owner context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH owner_emails AS (
    SELECT DISTINCT lower(pg_catalog.btrim(account_user.email)) AS email
      FROM public."User" AS account_user
     WHERE account_user.id = request_user_id
       AND account_user.email IS NOT NULL
       AND pg_catalog.btrim(account_user.email) <> ''
    UNION
    SELECT DISTINCT lower(pg_catalog.btrim(address.email)) AS email
      FROM public."UserEmailAddress" AS address
     WHERE address."userId" = request_user_id
       AND pg_catalog.btrim(address.email) <> ''
  ),
  owner_email_keys AS (
    SELECT candidate.email,
           ARRAY[
             candidate.email,
             CASE
               WHEN lower(pg_catalog.split_part(candidate.email, '@', 2))
                    IN ('gmail.com', 'googlemail.com')
               THEN pg_catalog.replace(
                 pg_catalog.split_part(
                   lower(pg_catalog.split_part(candidate.email, '@', 1)),
                   '+',
                   1
                 ),
                 '.',
                 ''
               ) || '@gmail.com'
               ELSE candidate.email
             END
           ]::text[] AS suppression_keys
      FROM owner_emails AS candidate
  ),
  all_owner_keys AS (
    SELECT pg_catalog.array_agg(DISTINCT owner_key.key) AS keys
      FROM owner_email_keys AS candidate
      CROSS JOIN LATERAL pg_catalog.unnest(candidate.suppression_keys)
        AS owner_key(key)
  ),
  conflicting_keys AS (
    SELECT DISTINCT
           CASE
             WHEN lower(pg_catalog.split_part(pg_catalog.btrim(other_user.email), '@', 2))
                  IN ('gmail.com', 'googlemail.com')
             THEN pg_catalog.replace(
               pg_catalog.split_part(
                 lower(pg_catalog.split_part(pg_catalog.btrim(other_user.email), '@', 1)),
                 '+',
                 1
               ),
               '.',
               ''
             ) || '@gmail.com'
             ELSE lower(pg_catalog.btrim(other_user.email))
           END AS suppression_key
      FROM public."User" AS other_user
      CROSS JOIN all_owner_keys AS owner_keys
     WHERE other_user.id <> request_user_id
       AND other_user."deletedAt" IS NULL
       AND other_user.email IS NOT NULL
       AND CASE
             WHEN lower(pg_catalog.split_part(pg_catalog.btrim(other_user.email), '@', 2))
                  IN ('gmail.com', 'googlemail.com')
             THEN pg_catalog.replace(
               pg_catalog.split_part(
                 lower(pg_catalog.split_part(pg_catalog.btrim(other_user.email), '@', 1)),
                 '+',
                 1
               ),
               '.',
               ''
             ) || '@gmail.com'
             ELSE lower(pg_catalog.btrim(other_user.email))
           END = ANY(owner_keys.keys)
  )
  SELECT candidate.email
    FROM owner_email_keys AS candidate
   WHERE NOT EXISTS (
     SELECT 1
       FROM conflicting_keys AS claimed
      WHERE claimed.suppression_key = ANY(candidate.suppression_keys)
   )
   ORDER BY candidate.email;
END
$grainline_user_email_fallback_addresses$;

REVOKE ALL ON FUNCTION public.grainline_user_block_targets()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_block_targets()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_blocked_account_page()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_blocked_account_page()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_block_pair_lock(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_block_pair_lock(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_email_fallback_addresses()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_email_fallback_addresses()
  TO grainline_app_runtime;
