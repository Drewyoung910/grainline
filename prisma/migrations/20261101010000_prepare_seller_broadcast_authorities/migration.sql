BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Additive compatible preparation only. SellerBroadcast RLS and predecessor
-- CRUD grants stay unchanged until every caller and complete-chain proof is
-- accepted.
DO $grainline_seller_broadcast_preflight$
DECLARE
  expected_name text;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'SellerBroadcast'
       AND column_name IN (
         'id', 'sellerProfileId', 'message', 'imageUrl', 'sentAt', 'recipientCount'
       )
  ) <> 6 THEN
    RAISE EXCEPTION 'SellerBroadcast column contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."SellerBroadcast"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast RLS must remain off during compatible preparation';
  END IF;

  FOREACH expected_name IN ARRAY ARRAY[
    'grainline_seller_broadcast_owner_cooldown',
    'grainline_seller_broadcast_owner_create',
    'grainline_seller_broadcast_owner_count',
    'grainline_seller_broadcast_owner_page',
    'grainline_seller_broadcast_owner_export',
    'grainline_seller_broadcast_public_latest',
    'grainline_seller_broadcast_actor_feed_page',
    'grainline_seller_broadcast_owner_delivery_source',
    'grainline_seller_broadcast_owner_record_delivery',
    'grainline_seller_broadcast_staff_count',
    'grainline_seller_broadcast_staff_page',
    'grainline_seller_broadcast_staff_delete',
    'grainline_seller_broadcast_account_deletion_ids',
    'grainline_seller_broadcast_account_deletion_cleanup'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = expected_name
    ) THEN
      RAISE EXCEPTION 'SellerBroadcast preparation function % already exists', expected_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid =
       'public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)'::pg_catalog.regprocedure
       AND pg_catalog.md5(procedure.prosrc) =
         'c1c8e556ba5a5da2c4cf176fc4397060'
  ) THEN
    RAISE EXCEPTION
      'SellerBroadcast email provider-attempt predecessor drifted';
  END IF;
END
$grainline_seller_broadcast_preflight$;

CREATE FUNCTION public.grainline_seller_broadcast_owner_cooldown()
RETURNS TABLE (
  "lastSentAt" timestamp(3) without time zone,
  "nextAvailableAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_owner_cooldown$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
BEGIN
  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF seller_id IS NULL THEN
    RAISE EXCEPTION 'SellerBroadcast owner context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT latest."sentAt",
         (latest."sentAt" + INTERVAL '7 days')::timestamp(3)
    FROM (SELECT 1) AS anchor
    LEFT JOIN LATERAL (
      SELECT broadcast."sentAt"
        FROM public."SellerBroadcast" AS broadcast
       WHERE broadcast."sellerProfileId" = seller_id
       ORDER BY broadcast."sentAt" DESC, broadcast.id DESC
       LIMIT 1
    ) AS latest ON true;
END
$grainline_seller_broadcast_owner_cooldown$;

CREATE FUNCTION public.grainline_seller_broadcast_owner_create(
  p_id text,
  p_message text,
  p_image_url text,
  p_recipient_count integer
)
RETURNS TABLE (
  created boolean,
  "broadcastId" text,
  "sentAt" timestamp(3) without time zone,
  "nextAvailableAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_owner_create$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
  latest_sent_at timestamp(3) without time zone;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF p_id IS NULL
     OR p_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_message IS NULL
     OR pg_catalog.char_length(p_message) NOT BETWEEN 1 AND 500
     OR (p_image_url IS NOT NULL AND (
       pg_catalog.char_length(p_image_url) NOT BETWEEN 1 AND 2048
       OR p_image_url !~ '^https://'
     ))
     OR p_recipient_count IS NULL
     OR p_recipient_count < 0
     OR p_recipient_count > 10000 THEN
    RAISE EXCEPTION 'SellerBroadcast create input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
   FOR UPDATE OF actor, seller;
  IF seller_id IS NULL THEN
    RAISE EXCEPTION 'SellerBroadcast active owner context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT broadcast."sentAt"
    INTO latest_sent_at
    FROM public."SellerBroadcast" AS broadcast
   WHERE broadcast."sellerProfileId" = seller_id
   ORDER BY broadcast."sentAt" DESC, broadcast.id DESC
   LIMIT 1;
  IF latest_sent_at IS NOT NULL
     AND latest_sent_at > source_now - INTERVAL '7 days' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::timestamp(3),
      (latest_sent_at + INTERVAL '7 days')::timestamp(3);
    RETURN;
  END IF;

  INSERT INTO public."SellerBroadcast" (
    id, "sellerProfileId", message, "imageUrl", "sentAt", "recipientCount"
  ) VALUES (
    p_id, seller_id, p_message, p_image_url, source_now, p_recipient_count
  );

  RETURN QUERY SELECT true, p_id, source_now, NULL::timestamp(3);
END
$grainline_seller_broadcast_owner_create$;

CREATE FUNCTION public.grainline_seller_broadcast_owner_count()
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_owner_count$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
BEGIN
  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF seller_id IS NULL THEN
    RAISE EXCEPTION 'SellerBroadcast owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT pg_catalog.count(*)::bigint
      FROM public."SellerBroadcast" AS broadcast
     WHERE broadcast."sellerProfileId" = seller_id
  );
END
$grainline_seller_broadcast_owner_count$;

CREATE FUNCTION public.grainline_seller_broadcast_owner_page(
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  id text,
  message text,
  "imageUrl" text,
  "sentAt" timestamp(3) without time zone,
  "recipientCount" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_owner_page$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
BEGIN
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 9990
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'SellerBroadcast owner page input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF seller_id IS NULL THEN
    RAISE EXCEPTION 'SellerBroadcast owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT broadcast.id::text,
         broadcast.message::text,
         broadcast."imageUrl"::text,
         broadcast."sentAt",
         broadcast."recipientCount"
    FROM public."SellerBroadcast" AS broadcast
   WHERE broadcast."sellerProfileId" = seller_id
   ORDER BY broadcast."sentAt" DESC, broadcast.id DESC
   OFFSET p_offset
   LIMIT p_limit;
END
$grainline_seller_broadcast_owner_page$;

CREATE FUNCTION public.grainline_seller_broadcast_owner_export()
RETURNS TABLE (
  id text,
  message text,
  "imageUrl" text,
  "sentAt" timestamp(3) without time zone,
  "recipientCount" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_owner_export$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  seller_id text;
BEGIN
  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF seller_id IS NULL THEN
    RAISE EXCEPTION 'SellerBroadcast owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT broadcast.id::text,
         broadcast.message::text,
         broadcast."imageUrl"::text,
         broadcast."sentAt",
         broadcast."recipientCount"
    FROM public."SellerBroadcast" AS broadcast
   WHERE broadcast."sellerProfileId" = seller_id
   ORDER BY broadcast."sentAt" DESC, broadcast.id DESC;
END
$grainline_seller_broadcast_owner_export$;

CREATE FUNCTION public.grainline_seller_broadcast_public_latest(
  p_seller_profile_id text
)
RETURNS TABLE (
  message text,
  "imageUrl" text,
  "sentAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_public_latest$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (actor_id IS NOT NULL AND (
       actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1 FROM public."User" AS actor
          WHERE actor.id = actor_id
            AND actor.banned = false
            AND actor."deletedAt" IS NULL
       )
     )) THEN
    RAISE EXCEPTION 'SellerBroadcast public latest context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT broadcast.message::text,
         broadcast."imageUrl"::text,
         broadcast."sentAt"
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
    JOIN LATERAL (
      SELECT candidate.message, candidate."imageUrl", candidate."sentAt", candidate.id
        FROM public."SellerBroadcast" AS candidate
       WHERE candidate."sellerProfileId" = seller.id
       ORDER BY candidate."sentAt" DESC, candidate.id DESC
       LIMIT 1
    ) AS broadcast ON true
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
     AND (
       actor_id = seller."userId"
       OR (seller."chargesEnabled" = true AND seller."stripeAccountSupported" = true)
     )
     AND (
       actor_id IS NULL
       OR actor_id = seller."userId"
       OR NOT EXISTS (
         SELECT 1 FROM public."Block" AS blocked_pair
          WHERE (blocked_pair."blockerId" = actor_id
                 AND blocked_pair."blockedId" = seller."userId")
             OR (blocked_pair."blockerId" = seller."userId"
                 AND blocked_pair."blockedId" = actor_id)
       )
     )
   LIMIT 1;
END
$grainline_seller_broadcast_public_latest$;

CREATE FUNCTION public.grainline_seller_broadcast_actor_feed_page(
  p_seller_profile_ids text[],
  p_cutoff timestamp(3) without time zone,
  p_cursor timestamp(3) without time zone,
  p_cursor_id text,
  p_same_timestamp_mode text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  message text,
  "imageUrl" text,
  "sentAt" timestamp(3) without time zone,
  "sellerProfileId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_actor_feed_page$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast feed actor context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_ids IS NULL
     OR pg_catalog.cardinality(p_seller_profile_ids) NOT BETWEEN 1 AND 1000
     OR pg_catalog.cardinality(p_seller_profile_ids) <> (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_seller_profile_ids) AS requested(id)
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_seller_profile_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR p_cutoff IS NULL
     OR (p_cursor IS NULL) <> (p_same_timestamp_mode = 'none')
     OR p_same_timestamp_mode NOT IN ('none', 'all', 'after-id', 'exclude')
     OR (p_same_timestamp_mode = 'after-id' AND (
       p_cursor_id IS NULL OR p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ))
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 51 THEN
    RAISE EXCEPTION 'SellerBroadcast feed input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT broadcast.id::text,
         broadcast.message::text,
         broadcast."imageUrl"::text,
         broadcast."sentAt",
         broadcast."sellerProfileId"::text
    FROM public."SellerBroadcast" AS broadcast
    JOIN public."SellerProfile" AS seller
      ON seller.id = broadcast."sellerProfileId"
    JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
   WHERE broadcast."sellerProfileId" = ANY(p_seller_profile_ids)
     AND EXISTS (
       SELECT 1
         FROM public."Follow" AS relationship
        WHERE relationship."sellerProfileId" = seller.id
          AND relationship."followerId" = actor_id
     )
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public."Block" AS blocked_pair
        WHERE (blocked_pair."blockerId" = actor_id
               AND blocked_pair."blockedId" = seller."userId")
           OR (blocked_pair."blockerId" = seller."userId"
               AND blocked_pair."blockedId" = actor_id)
     )
     AND (
       (p_cursor IS NULL AND broadcast."sentAt" >= p_cutoff)
       OR (p_cursor IS NOT NULL AND (
         broadcast."sentAt" < p_cursor
         OR (p_same_timestamp_mode = 'all' AND broadcast."sentAt" = p_cursor)
         OR (p_same_timestamp_mode = 'after-id'
             AND broadcast."sentAt" = p_cursor
             AND broadcast.id < p_cursor_id)
       ))
     )
   ORDER BY broadcast."sentAt" DESC, broadcast.id DESC
   LIMIT p_limit;
END
$grainline_seller_broadcast_actor_feed_page$;

CREATE FUNCTION public.grainline_seller_broadcast_owner_delivery_source(
  p_broadcast_id text
)
RETURNS TABLE ("sellerProfileId" text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_owner_delivery_source$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_broadcast_id IS NULL OR p_broadcast_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'SellerBroadcast delivery source input is invalid'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT broadcast."sellerProfileId"::text
    FROM public."SellerBroadcast" AS broadcast
    JOIN public."SellerProfile" AS seller
      ON seller.id = broadcast."sellerProfileId"
    JOIN public."User" AS actor ON actor.id = seller."userId"
   WHERE broadcast.id = p_broadcast_id
     AND actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   LIMIT 1;
END
$grainline_seller_broadcast_owner_delivery_source$;

CREATE FUNCTION public.grainline_seller_broadcast_owner_record_delivery(
  p_broadcast_id text,
  p_delivered_count integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_owner_record_delivery$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_broadcast_id IS NULL OR p_broadcast_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_delivered_count IS NULL OR p_delivered_count < 0 OR p_delivered_count > 10000 THEN
    RAISE EXCEPTION 'SellerBroadcast delivery count input is invalid'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public."SellerBroadcast" AS broadcast
     SET "recipientCount" = p_delivered_count
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS actor ON actor.id = seller."userId"
   WHERE broadcast.id = p_broadcast_id
     AND broadcast."sellerProfileId" = seller.id
     AND actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND p_delivered_count <= broadcast."recipientCount";
  RETURN FOUND;
END
$grainline_seller_broadcast_owner_record_delivery$;

CREATE FUNCTION public.grainline_seller_broadcast_staff_count(
  p_actor_id text,
  p_query text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_staff_count$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_query IS NULL OR pg_catalog.char_length(p_query) > 200
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast staff count context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT pg_catalog.count(*)::bigint
      FROM public."SellerBroadcast" AS broadcast
     WHERE p_query = '' OR pg_catalog.strpos(
       pg_catalog.lower(broadcast.message), pg_catalog.lower(p_query)
     ) > 0
  );
END
$grainline_seller_broadcast_staff_count$;

CREATE FUNCTION public.grainline_seller_broadcast_staff_page(
  p_actor_id text,
  p_query text,
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  id text,
  message text,
  "imageUrl" text,
  "sentAt" timestamp(3) without time zone,
  "recipientCount" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_staff_page$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_query IS NULL OR pg_catalog.char_length(p_query) > 200
     OR p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast staff page context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT broadcast.id::text,
         broadcast.message::text,
         broadcast."imageUrl"::text,
         broadcast."sentAt",
         broadcast."recipientCount"
    FROM public."SellerBroadcast" AS broadcast
   WHERE p_query = '' OR pg_catalog.strpos(
     pg_catalog.lower(broadcast.message), pg_catalog.lower(p_query)
   ) > 0
   ORDER BY broadcast."sentAt" DESC, broadcast.id DESC
   OFFSET p_offset
   LIMIT p_limit;
END
$grainline_seller_broadcast_staff_page$;

CREATE FUNCTION public.grainline_seller_broadcast_staff_delete(
  p_actor_id text,
  p_broadcast_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_staff_delete$
DECLARE
  source_row public."SellerBroadcast"%ROWTYPE;
  audit_id text := pg_catalog.gen_random_uuid()::text;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_broadcast_id IS NULL OR p_broadcast_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast staff delete context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT broadcast.*
    INTO source_row
    FROM public."SellerBroadcast" AS broadcast
   WHERE broadcast.id = p_broadcast_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM public."Notification" AS notification
   WHERE notification."sourceType" = 'seller_broadcast'
     AND notification."sourceId" = source_row.id;
  DELETE FROM public."EmailOutbox" AS outbox
   WHERE outbox.status IN ('PENDING', 'FAILED')
     AND (
       (outbox."sourceType" = 'seller_broadcast' AND outbox."sourceId" = source_row.id)
       OR (
        outbox."templateName" = 'seller_broadcast'
        AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST'
        AND outbox."dedupKey" LIKE 'seller-broadcast:' || source_row.id || ':%'
       )
     );
  DELETE FROM public."SellerBroadcast" WHERE id = source_row.id;

  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata, undone, "createdAt"
  ) VALUES (
    audit_id,
    p_actor_id,
    'DELETE_BROADCAST',
    'SELLER_BROADCAST',
    source_row.id,
    pg_catalog.jsonb_build_object(
      'sellerProfileId', source_row."sellerProfileId",
      'recipientCount', source_row."recipientCount"
    ),
    false,
    source_now
  );
  RETURN true;
END
$grainline_seller_broadcast_staff_delete$;

CREATE FUNCTION public.grainline_seller_broadcast_account_deletion_ids(
  p_seller_profile_id text
)
RETURNS TABLE (id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_account_deletion_ids$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."SellerProfile" AS seller
        WHERE seller.id = p_seller_profile_id
          AND seller."userId" = actor_id
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast account deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT broadcast.id::text
    FROM public."SellerBroadcast" AS broadcast
   WHERE broadcast."sellerProfileId" = p_seller_profile_id
   ORDER BY broadcast.id
   FOR UPDATE OF broadcast;
END
$grainline_seller_broadcast_account_deletion_ids$;

CREATE FUNCTION public.grainline_seller_broadcast_account_deletion_cleanup(
  p_seller_profile_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_broadcast_account_deletion_cleanup$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  deleted_count bigint;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."SellerProfile" AS seller
        WHERE seller.id = p_seller_profile_id
          AND seller."userId" = actor_id
     ) THEN
    RAISE EXCEPTION 'SellerBroadcast account deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."SellerBroadcast"
   WHERE "sellerProfileId" = p_seller_profile_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_seller_broadcast_account_deletion_cleanup$;

-- Re-check the live social relationship at the last database boundary before
-- provider delivery. User-pair locks serialize reciprocal Block creation;
-- source and Follow row locks serialize deletion and visibility changes with
-- the later EmailOutbox lock. This keeps queued broadcasts/listing notices
-- from being delivered after an unfollow or reciprocal block.
CREATE OR REPLACE FUNCTION public.grainline_email_outbox_begin_provider_attempt(
  p_job_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_outbox_begin_provider_attempt$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  identity_row record;
  locked_row record;
  initial_source_user_id text;
  locked_source_user_id text;
  source_active boolean;
  source_recipient_eligible boolean := true;
  effective_lane text;
  account_state text;
BEGIN
  SELECT id, "userId", "recipientEmail", "sourceType", "sourceId"
    INTO identity_row
    FROM public."EmailOutbox"
   WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  initial_source_user_id := public.grainline_email_outbox_source_owner(
    identity_row."sourceType"::text,
    identity_row."sourceId"::text
  );
  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[identity_row."userId"::text, initial_source_user_id],
    ARRAY[identity_row."recipientEmail"::text]
  );

  IF identity_row."sourceType" IN (
    'seller_broadcast',
    'followed_maker_new_listing'
  ) THEN
    -- Block writers lock this same sorted pair before changing Block rows.
    PERFORM 1
      FROM public."User" AS pair_user
     WHERE pair_user.id = identity_row."userId"
        OR pair_user.id = initial_source_user_id
     ORDER BY pair_user.id
     FOR SHARE;

    IF identity_row."sourceType" = 'seller_broadcast' THEN
      SELECT true
        INTO source_recipient_eligible
        FROM public."SellerBroadcast" AS source_broadcast
        JOIN public."SellerProfile" AS source_seller
          ON source_seller.id = source_broadcast."sellerProfileId"
        JOIN public."User" AS source_user
          ON source_user.id = source_seller."userId"
        JOIN public."Follow" AS source_follow
          ON source_follow."sellerProfileId" = source_seller.id
         AND source_follow."followerId" = identity_row."userId"
       WHERE source_broadcast.id = identity_row."sourceId"
         AND source_seller."userId" = initial_source_user_id
         AND source_seller."chargesEnabled" = true
         AND source_seller."vacationMode" = false
         AND source_seller."stripeAccountSupported" = true
         AND source_user.banned = false
         AND source_user."deletedAt" IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS source_block
            WHERE (
              source_block."blockerId" = identity_row."userId"
              AND source_block."blockedId" = initial_source_user_id
            ) OR (
              source_block."blockerId" = initial_source_user_id
              AND source_block."blockedId" = identity_row."userId"
            )
         )
       FOR SHARE OF source_broadcast, source_seller, source_user, source_follow;
    ELSE
      SELECT true
        INTO source_recipient_eligible
        FROM public."Listing" AS source_listing
        JOIN public."SellerProfile" AS source_seller
          ON source_seller.id = source_listing."sellerId"
        JOIN public."User" AS source_user
          ON source_user.id = source_seller."userId"
        JOIN public."Follow" AS source_follow
          ON source_follow."sellerProfileId" = source_seller.id
         AND source_follow."followerId" = identity_row."userId"
       WHERE source_listing.id = identity_row."sourceId"
         AND source_listing.status = 'ACTIVE'
         AND source_listing."isPrivate" = false
         AND source_seller."userId" = initial_source_user_id
         AND source_seller."chargesEnabled" = true
         AND source_seller."vacationMode" = false
         AND source_seller."stripeAccountSupported" = true
         AND source_user.banned = false
         AND source_user."deletedAt" IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS source_block
            WHERE (
              source_block."blockerId" = identity_row."userId"
              AND source_block."blockedId" = initial_source_user_id
            ) OR (
              source_block."blockerId" = initial_source_user_id
              AND source_block."blockedId" = identity_row."userId"
            )
         )
       FOR SHARE OF source_listing, source_seller, source_user, source_follow;
    END IF;

    source_recipient_eligible := COALESCE(source_recipient_eligible, false);
  END IF;

  SELECT * INTO locked_row
    FROM public."EmailOutbox"
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF locked_row."userId" IS DISTINCT FROM identity_row."userId"
     OR locked_row."recipientEmail" IS DISTINCT FROM identity_row."recipientEmail"
     OR locked_row."sourceType" IS DISTINCT FROM identity_row."sourceType"
     OR locked_row."sourceId" IS DISTINCT FROM identity_row."sourceId" THEN
    RETURN 'stale_claim';
  END IF;
  IF locked_row.status IN ('SENT','SKIPPED','DEAD') THEN RETURN 'already_terminal'; END IF;
  IF locked_row.status <> 'PROCESSING'
     OR locked_row."claimGeneration" <> p_claim_generation
     OR locked_row."claimToken" IS DISTINCT FROM p_claim_token THEN
    RETURN 'stale_claim';
  END IF;

  locked_source_user_id := public.grainline_email_outbox_source_owner(
    locked_row."sourceType"::text,
    locked_row."sourceId"::text
  );
  IF locked_source_user_id IS DISTINCT FROM initial_source_user_id THEN
    RETURN 'stale_claim';
  END IF;
  IF locked_row."sourceType" IN (
    'seller_broadcast',
    'followed_maker_new_listing'
  )
     AND NOT source_recipient_eligible
     AND locked_row."providerAttemptGeneration" IS DISTINCT FROM p_claim_generation THEN
    UPDATE public."EmailOutbox"
       SET status = 'SKIPPED', "sentAt" = source_now, "nextAttemptAt" = NULL,
           "claimToken" = NULL, "processingStartedAt" = NULL,
           "lastError" =
             'Email source relationship became ineligible before provider attempt',
           "updatedAt" = source_now
     WHERE id = p_job_id;
    RETURN 'ineligible';
  END IF;
  IF locked_row."sourceType" IN ('seller_broadcast', 'followed_maker_new_listing') THEN
    SELECT NOT account_user.banned AND account_user."deletedAt" IS NULL
      INTO source_active
      FROM public."User" AS account_user
     WHERE account_user.id = locked_source_user_id;
    IF locked_source_user_id IS NULL OR COALESCE(source_active, false) = false THEN
      UPDATE public."EmailOutbox"
         SET status = 'SKIPPED', "sentAt" = source_now, "nextAttemptAt" = NULL,
             "claimToken" = NULL, "processingStartedAt" = NULL,
             "lastError" = 'Email source became unavailable before provider attempt',
             "updatedAt" = source_now
       WHERE id = p_job_id;
      RETURN 'ineligible';
    END IF;
  END IF;

  effective_lane := public.grainline_email_outbox_effective_lane(
    locked_row."templateName"::text,
    locked_row.lane::text
  );
  account_state := public.grainline_email_outbox_recipient_state(
    locked_row."userId"::text,
    locked_row."recipientEmail"::text,
    locked_row."preferenceKey"::text,
    effective_lane
  );
  IF account_state <> 'active' THEN
    UPDATE public."EmailOutbox"
       SET status = 'SKIPPED', "sentAt" = source_now, "nextAttemptAt" = NULL,
           "claimToken" = NULL, "processingStartedAt" = NULL,
           "lastError" = public.grainline_email_outbox_safe_error(
             CASE WHEN account_state = 'hard_suppression'
               THEN 'Recipient email is hard-suppressed before provider attempt'
               ELSE 'Recipient became ineligible before provider attempt: ' || account_state
             END
           ),
           "updatedAt" = source_now
     WHERE id = p_job_id;
    RETURN 'ineligible';
  END IF;
  IF locked_row."firstProviderAttemptAt" IS NOT NULL
     AND locked_row."firstProviderAttemptAt" <= source_now - INTERVAL '23 hours' THEN
    UPDATE public."EmailOutbox"
       SET status = 'DEAD', "nextAttemptAt" = NULL, "claimToken" = NULL,
           "processingStartedAt" = NULL,
           "lastError" = 'Provider idempotency window expired; manual review required',
           "updatedAt" = source_now
     WHERE id = p_job_id;
    RETURN 'expired';
  END IF;
  UPDATE public."EmailOutbox"
     SET "firstProviderAttemptAt" = COALESCE("firstProviderAttemptAt", source_now),
         "providerAttemptGeneration" = p_claim_generation,
         "updatedAt" = source_now
   WHERE id = p_job_id;
  RETURN 'ready';
END
$grainline_email_outbox_begin_provider_attempt$;

REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_owner_cooldown()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_owner_create(text,text,text,integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_owner_count()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_owner_page(integer,integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_owner_export()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_public_latest(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_actor_feed_page(text[],timestamp without time zone,timestamp without time zone,text,text,integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_owner_delivery_source(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_owner_record_delivery(text,integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_account_deletion_ids(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_account_deletion_cleanup(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_owner_cooldown()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_owner_create(text,text,text,integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_owner_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_owner_page(integer,integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_public_latest(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_actor_feed_page(text[],timestamp without time zone,timestamp without time zone,text,text,integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_owner_delivery_source(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_owner_record_delivery(text,integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_account_deletion_ids(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_account_deletion_cleanup(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_staff_count(text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_staff_page(text,text,integer,integer)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_broadcast_staff_delete(text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_staff_count(text,text)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_staff_page(text,text,integer,integer)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_broadcast_staff_delete(text,text)
  TO grainline_staff_read_runtime;

COMMIT;
