-- Repair active account rows that predate or bypassed durable email-history
-- synchronization. Stored identity remains exact-normalized; Gmail-family
-- folding is only a suppression lookup concern and is intentionally not used
-- here.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Synchronization locks User before UserEmailAddress. Keep the same table
-- order and block concurrent identity writes while the repair snapshot and
-- postconditions are evaluated.
LOCK TABLE public."User" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public."UserEmailAddress" IN SHARE ROW EXCLUSIVE MODE;

DO $grainline_user_email_address_repair_preflight$
DECLARE
  duplicate_current_user_groups bigint;
  unmatched_current_rows bigint;
BEGIN
  SELECT pg_catalog.count(*)
    INTO duplicate_current_user_groups
    FROM (
      SELECT address."userId"
        FROM public."UserEmailAddress" AS address
       WHERE address."isCurrent" = true
       GROUP BY address."userId"
      HAVING pg_catalog.count(*) > 1
    ) AS duplicate_groups;

  IF duplicate_current_user_groups <> 0 THEN
    RAISE EXCEPTION
      'UserEmailAddress repair refused duplicate current-row groups: %',
      duplicate_current_user_groups;
  END IF;

  SELECT pg_catalog.count(*)
    INTO unmatched_current_rows
    FROM public."UserEmailAddress" AS address
    LEFT JOIN public."User" AS account_user
      ON account_user.id = address."userId"
     AND account_user."deletedAt" IS NULL
     AND account_user.email = address.email
   WHERE address."isCurrent" = true
     AND account_user.id IS NULL;

  IF unmatched_current_rows <> 0 THEN
    RAISE EXCEPTION
      'UserEmailAddress repair refused unmatched current rows: %',
      unmatched_current_rows;
  END IF;
END
$grainline_user_email_address_repair_preflight$;

WITH repair_clock AS (
  SELECT pg_catalog.clock_timestamp() AT TIME ZONE 'UTC' AS repaired_at
)
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
SELECT
  'user_email_' || pg_catalog.md5(account_user.id || ':' || account_user.email),
  account_user.id,
  account_user.email,
  'current_user_email_repair',
  true,
  account_user."createdAt",
  repair_clock.repaired_at,
  repair_clock.repaired_at
FROM public."User" AS account_user
CROSS JOIN repair_clock
WHERE account_user."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
      FROM public."UserEmailAddress" AS address
     WHERE address."userId" = account_user.id
       AND address."isCurrent" = true
       AND address.email = account_user.email
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

DO $grainline_user_email_address_repair_postflight$
DECLARE
  duplicate_current_user_groups bigint;
  unmatched_current_rows bigint;
  active_users_without_current_row bigint;
BEGIN
  SELECT pg_catalog.count(*)
    INTO duplicate_current_user_groups
    FROM (
      SELECT address."userId"
        FROM public."UserEmailAddress" AS address
       WHERE address."isCurrent" = true
       GROUP BY address."userId"
      HAVING pg_catalog.count(*) > 1
    ) AS duplicate_groups;

  SELECT pg_catalog.count(*)
    INTO unmatched_current_rows
    FROM public."UserEmailAddress" AS address
    LEFT JOIN public."User" AS account_user
      ON account_user.id = address."userId"
     AND account_user."deletedAt" IS NULL
     AND account_user.email = address.email
   WHERE address."isCurrent" = true
     AND account_user.id IS NULL;

  SELECT pg_catalog.count(*)
    INTO active_users_without_current_row
    FROM public."User" AS account_user
   WHERE account_user."deletedAt" IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."UserEmailAddress" AS address
        WHERE address."userId" = account_user.id
          AND address."isCurrent" = true
          AND address.email = account_user.email
     );

  IF duplicate_current_user_groups <> 0
     OR unmatched_current_rows <> 0
     OR active_users_without_current_row <> 0 THEN
    RAISE EXCEPTION
      'UserEmailAddress repair postflight drifted: duplicate=%, unmatched=%, missing=%',
      duplicate_current_user_groups,
      unmatched_current_rows,
      active_users_without_current_row;
  END IF;
END
$grainline_user_email_address_repair_postflight$;

COMMIT;
