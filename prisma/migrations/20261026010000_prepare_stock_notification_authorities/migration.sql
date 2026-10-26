BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $grainline_stock_notification_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'grainline_app_runtime is missing';
  END IF;

  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StockNotification'
     AND class.relkind = 'r';
  IF table_oid IS NULL THEN
    RAISE EXCEPTION 'public.StockNotification is missing';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'StockNotification must remain in predecessor RLS posture during preparation';
  END IF;
  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'DELETE'
     ) THEN
    RAISE EXCEPTION 'StockNotification predecessor grants drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY['id', 'listingId', 'userId', 'createdAt']::text[] THEN
    RAISE EXCEPTION 'StockNotification columns drifted';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_user_block_pair_lock(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_notification_claim_back_in_stock(text,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'StockNotification prerequisite authorities are missing';
  END IF;
END
$grainline_stock_notification_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_owner_subscribe(
  p_subscription_id text,
  p_listing_id text
)
RETURNS TABLE (
  "resultStatus" text,
  subscribed boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_owner_subscribe$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  target_user_id text;
  locked_target_user_id text;
  locked_user_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_subscription_id IS NULL
     OR p_subscription_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_listing_id IS NULL
     OR p_listing_id = ''
     OR pg_catalog.char_length(p_listing_id) > 191 THEN
    RAISE EXCEPTION 'StockNotification subscribe context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'StockNotification subscribe requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'StockNotification actor is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller."userId"
    INTO target_user_id
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing.status IN (
       'ACTIVE'::public."ListingStatus",
       'SOLD_OUT'::public."ListingStatus"
     )
     AND listing."listingType" = 'IN_STOCK'::public."ListingType"
     AND COALESCE(listing."stockQuantity", 0) <= 0
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
     AND listing."sellerPubliclyOrderable" = true;
  IF target_user_id IS NULL THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, false;
    RETURN;
  END IF;
  IF target_user_id = request_user_id THEN
    RETURN QUERY SELECT 'SELF'::text, false;
    RETURN;
  END IF;
  locked_target_user_id := target_user_id;

  SELECT pg_catalog.count(*)::integer
    INTO locked_user_count
    FROM public.grainline_user_block_pair_lock(target_user_id) AS locked_user
   WHERE locked_user."deletedAt" IS NULL;
  IF locked_user_count <> 2 THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, false;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'StockNotification actor became inactive'
      USING ERRCODE = '42501';
  END IF;

  target_user_id := NULL;
  SELECT seller."userId"
    INTO target_user_id
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing.status IN (
       'ACTIVE'::public."ListingStatus",
       'SOLD_OUT'::public."ListingStatus"
     )
     AND listing."listingType" = 'IN_STOCK'::public."ListingType"
     AND COALESCE(listing."stockQuantity", 0) <= 0
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
     AND listing."sellerPubliclyOrderable" = true
   FOR SHARE OF listing, seller;
  IF target_user_id IS NULL OR target_user_id <> locked_target_user_id THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, false;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE (
       relationship."blockerId" = request_user_id
       AND relationship."blockedId" = target_user_id
     ) OR (
       relationship."blockerId" = target_user_id
       AND relationship."blockedId" = request_user_id
     )
  ) THEN
    RETURN QUERY SELECT 'BLOCKED'::text, false;
    RETURN;
  END IF;

  INSERT INTO public."StockNotification" (
    id,
    "listingId",
    "userId",
    "createdAt"
  ) VALUES (
    p_subscription_id,
    p_listing_id,
    request_user_id,
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )
  ON CONFLICT ("listingId", "userId") DO NOTHING;

  RETURN QUERY SELECT 'OK'::text, true;
END
$grainline_stock_notification_owner_subscribe$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_seller_counts(
  p_listing_ids text[]
)
RETURNS TABLE (
  "listingId" text,
  value bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_seller_counts$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  actor_seller_id text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) < 1
     OR pg_catalog.cardinality(p_listing_ids) > 100
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id = ''
           OR pg_catalog.char_length(requested.id) > 191
     ) THEN
    RAISE EXCEPTION 'StockNotification seller count input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT seller.id
    INTO actor_seller_id
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS actor ON actor.id = seller."userId"
   WHERE seller."userId" = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF actor_seller_id IS NULL THEN
    RAISE EXCEPTION 'StockNotification seller count actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT requested_id
      FROM pg_catalog.unnest(p_listing_ids) AS input(requested_id)
  )
  SELECT listing.id,
         pg_catalog.count(subscription.id)::bigint
    FROM requested
    JOIN public."Listing" AS listing
      ON listing.id = requested.requested_id
     AND listing."sellerId" = actor_seller_id
    LEFT JOIN public."StockNotification" AS subscription
      ON subscription."listingId" = listing.id
   GROUP BY listing.id
   ORDER BY listing.id;
END
$grainline_stock_notification_seller_counts$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_seller_range_count(
  p_start_at timestamp without time zone,
  p_end_at timestamp without time zone,
  p_end_exclusive boolean
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_seller_range_count$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  actor_seller_id text;
  result_count bigint := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_start_at IS NULL
     OR p_end_at IS NULL
     OR p_end_exclusive IS NULL
     OR p_start_at > p_end_at THEN
    RAISE EXCEPTION 'StockNotification seller range input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT seller.id
    INTO actor_seller_id
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS actor ON actor.id = seller."userId"
   WHERE seller."userId" = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF actor_seller_id IS NULL THEN
    RAISE EXCEPTION 'StockNotification seller range actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO result_count
    FROM public."StockNotification" AS subscription
    JOIN public."Listing" AS listing
      ON listing.id = subscription."listingId"
   WHERE listing."sellerId" = actor_seller_id
     AND subscription."createdAt" >= p_start_at
     AND (
       (p_end_exclusive AND subscription."createdAt" < p_end_at)
       OR (NOT p_end_exclusive AND subscription."createdAt" <= p_end_at)
     );
  RETURN result_count;
END
$grainline_stock_notification_seller_range_count$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_restock_candidates(
  p_restock_audit_id text,
  p_limit integer
)
RETURNS TABLE ("stockNotificationId" text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_restock_candidates$
BEGIN
  IF p_restock_audit_id IS NULL
     OR p_restock_audit_id = ''
     OR pg_catalog.char_length(p_restock_audit_id) > 191
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 5000 THEN
    RAISE EXCEPTION 'StockNotification restock candidate input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT subscription.id
    FROM public."SystemAuditLog" AS audit
    JOIN public."Listing" AS listing
      ON listing.id = audit."targetId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    JOIN public."StockNotification" AS subscription
      ON subscription."listingId" = listing.id
     AND subscription."createdAt" <= audit."createdAt"
   WHERE audit.id = p_restock_audit_id
     AND audit.action = 'MANUAL_LISTING_RESTOCKED'
     AND audit."actorType" = 'user'
     AND audit."actorId" = seller."userId"
     AND audit."targetType" = 'LISTING'
     AND audit.metadata ->> 'listingId' = listing.id
     AND audit.metadata ->> 'listingTitle' <> ''
     AND audit.metadata ->> 'previousStatus' = 'SOLD_OUT'
     AND audit.metadata ->> 'newStatus' = 'ACTIVE'
     AND audit.metadata ->> 'newQuantity' ~ '^[1-9][0-9]*$'
     AND audit.metadata ->> 'mutationKind' IN ('delta', 'absolute')
   ORDER BY subscription."createdAt", subscription.id
   LIMIT p_limit;
END
$grainline_stock_notification_restock_candidates$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_seller_listing_cleanup(
  p_listing_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_seller_listing_cleanup$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count bigint := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id = ''
     OR pg_catalog.char_length(p_listing_id) > 191 THEN
    RAISE EXCEPTION 'StockNotification seller cleanup input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN public."User" AS actor
        ON actor.id = seller."userId"
     WHERE listing.id = p_listing_id
       AND seller."userId" = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'StockNotification seller cleanup is forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."StockNotification" AS subscription
   WHERE subscription."listingId" = p_listing_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_stock_notification_seller_listing_cleanup$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_admin_listing_cleanup(
  p_listing_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_admin_listing_cleanup$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count bigint := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id = ''
     OR pg_catalog.char_length(p_listing_id) > 191 THEN
    RAISE EXCEPTION 'StockNotification admin cleanup input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.role = 'ADMIN'::public."Role"
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public."Listing" AS listing WHERE listing.id = p_listing_id
  ) THEN
    RAISE EXCEPTION 'StockNotification admin cleanup is forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."StockNotification" AS subscription
   WHERE subscription."listingId" = p_listing_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_stock_notification_admin_listing_cleanup$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_block_cleanup(
  p_target_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_block_cleanup$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  locked_user_count integer := 0;
  deleted_count bigint := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id = request_user_id THEN
    RAISE EXCEPTION 'StockNotification block cleanup input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO locked_user_count
    FROM public.grainline_user_block_pair_lock(p_target_user_id);
  IF locked_user_count <> 2 OR NOT EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE relationship."blockerId" = request_user_id
       AND relationship."blockedId" = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'StockNotification block cleanup requires an active block'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."StockNotification" AS subscription
   USING public."Listing" AS listing,
         public."SellerProfile" AS seller
   WHERE listing.id = subscription."listingId"
     AND seller.id = listing."sellerId"
     AND (
       (
         subscription."userId" = request_user_id
         AND seller."userId" = p_target_user_id
       ) OR (
         subscription."userId" = p_target_user_id
         AND seller."userId" = request_user_id
       )
     );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_stock_notification_block_cleanup$;

CREATE OR REPLACE FUNCTION public.grainline_stock_notification_owner_export()
RETURNS TABLE (
  "listingId" text,
  "createdAt" timestamp with time zone,
  title text,
  status text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stock_notification_owner_export$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor WHERE actor.id = request_user_id
     ) THEN
    RAISE EXCEPTION 'StockNotification export actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT subscription."listingId",
         subscription."createdAt" AT TIME ZONE 'UTC',
         listing.title::text,
         listing.status::text
    FROM public."StockNotification" AS subscription
    JOIN public."Listing" AS listing
      ON listing.id = subscription."listingId"
   WHERE subscription."userId" = request_user_id
   ORDER BY subscription."createdAt" DESC, subscription.id DESC;
END
$grainline_stock_notification_owner_export$;

-- Recreate the one-shot claim with reciprocal-block and self-subscription
-- protection. The sorted pair lock conflicts with Block creation's FOR UPDATE
-- pair lock, so whichever transaction acquires the pair first determines
-- whether an alert is admitted.
CREATE OR REPLACE FUNCTION public.grainline_notification_claim_back_in_stock(
  p_notification_id text,
  p_restock_audit_id text,
  p_stock_notification_id text
)
RETURNS TABLE(claimed boolean, user_id text, notification_id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_claim_back_in_stock$
DECLARE
  source_user_id text;
  source_listing_id text;
  source_seller_user_id text;
  source_listing_title text;
  source_stock_quantity integer;
  source_listing_status text;
  source_listing_type text;
  source_is_private boolean;
  source_charges_enabled boolean;
  source_stripe_account_supported boolean;
  source_vacation_mode boolean;
  source_seller_banned boolean;
  source_seller_deleted_at timestamp(3);
  source_recipient_banned boolean;
  source_recipient_deleted_at timestamp(3);
  source_recipient_preferences jsonb;
  locked_user_count integer := 0;
  derived_title text;
  derived_body text;
  derived_link text;
  replay_material text;
  derived_dedup_key text;
BEGIN
  claimed := false;
  user_id := NULL;
  notification_id := NULL;

  IF p_notification_id IS NULL
     OR p_notification_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'notification id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_stock_notification_id IS NULL
     OR p_stock_notification_id = ''
     OR pg_catalog.char_length(p_stock_notification_id) > 191 THEN
    RAISE EXCEPTION 'stock notification source is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_restock_audit_id IS NULL
     OR p_restock_audit_id = ''
     OR pg_catalog.char_length(p_restock_audit_id) > 191 THEN
    RAISE EXCEPTION 'restock transition source is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT subscription."userId", seller."userId"
    INTO source_user_id, source_seller_user_id
    FROM public."StockNotification" AS subscription
    JOIN public."Listing" AS listing ON listing.id = subscription."listingId"
    JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
   WHERE subscription.id = p_stock_notification_id;
  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF source_user_id <> source_seller_user_id THEN
    SELECT pg_catalog.count(*)::integer
      INTO locked_user_count
      FROM (
        SELECT account_user.id
          FROM public."User" AS account_user
         WHERE account_user.id IN (source_user_id, source_seller_user_id)
         ORDER BY account_user.id
         FOR SHARE
      ) AS locked_users;
    IF locked_user_count <> 2 THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT
    source_subscription."userId",
    source_subscription."listingId",
    source_seller."userId",
    source_listing.title,
    source_listing."stockQuantity",
    source_listing.status::text,
    source_listing."listingType"::text,
    source_listing."isPrivate",
    source_seller."chargesEnabled",
    source_seller."stripeAccountSupported",
    source_seller."vacationMode",
    source_seller_user.banned,
    source_seller_user."deletedAt",
    source_recipient.banned,
    source_recipient."deletedAt",
    source_recipient."notificationPreferences"
  INTO
    source_user_id,
    source_listing_id,
    source_seller_user_id,
    source_listing_title,
    source_stock_quantity,
    source_listing_status,
    source_listing_type,
    source_is_private,
    source_charges_enabled,
    source_stripe_account_supported,
    source_vacation_mode,
    source_seller_banned,
    source_seller_deleted_at,
    source_recipient_banned,
    source_recipient_deleted_at,
    source_recipient_preferences
  FROM public."StockNotification" AS source_subscription
  JOIN public."Listing" AS source_listing
    ON source_listing.id = source_subscription."listingId"
  JOIN public."SellerProfile" AS source_seller
    ON source_seller.id = source_listing."sellerId"
  JOIN public."User" AS source_seller_user
    ON source_seller_user.id = source_seller."userId"
  JOIN public."User" AS source_recipient
    ON source_recipient.id = source_subscription."userId"
  JOIN public."SystemAuditLog" AS source_audit
    ON source_audit.id = p_restock_audit_id
   AND source_audit.action = 'MANUAL_LISTING_RESTOCKED'
   AND source_audit."actorType" = 'user'
   AND source_audit."actorId" = source_seller."userId"
   AND source_audit."targetType" = 'LISTING'
   AND source_audit."targetId" = source_listing.id
   AND source_audit.metadata ->> 'listingId' = source_listing.id
   AND source_audit.metadata ->> 'listingTitle' <> ''
   AND source_audit.metadata ->> 'previousStatus' = 'SOLD_OUT'
   AND source_audit.metadata ->> 'newStatus' = 'ACTIVE'
   AND source_audit.metadata ->> 'newQuantity' ~ '^[1-9][0-9]*$'
   AND source_audit.metadata ->> 'mutationKind' IN ('delta', 'absolute')
   AND source_subscription."createdAt" <= source_audit."createdAt"
  WHERE source_subscription.id = p_stock_notification_id
  FOR UPDATE OF source_subscription
  FOR SHARE OF source_listing, source_seller, source_audit;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF source_user_id = source_seller_user_id OR EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE (
       relationship."blockerId" = source_user_id
       AND relationship."blockedId" = source_seller_user_id
     ) OR (
       relationship."blockerId" = source_seller_user_id
       AND relationship."blockedId" = source_user_id
     )
  ) THEN
    DELETE FROM public."StockNotification" AS source_subscription
     WHERE source_subscription.id = p_stock_notification_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF source_listing_status <> 'ACTIVE'
     OR source_listing_type <> 'IN_STOCK'
     OR source_is_private
     OR COALESCE(source_stock_quantity, 0) <= 0
     OR NOT source_charges_enabled
     OR NOT source_stripe_account_supported
     OR source_vacation_mode
     OR source_seller_banned
     OR source_seller_deleted_at IS NOT NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF source_recipient_banned
     OR source_recipient_deleted_at IS NOT NULL
     OR source_recipient_preferences -> 'BACK_IN_STOCK' = 'false'::jsonb THEN
    DELETE FROM public."StockNotification" AS source_subscription
     WHERE source_subscription.id = p_stock_notification_id;
    claimed := true;
    user_id := source_user_id;
    RETURN NEXT;
    RETURN;
  END IF;

  derived_title := pg_catalog.left(source_listing_title || ' is back in stock!', 200);
  derived_body := 'The piece you saved is available again. Current stock: '
    || source_stock_quantity::text || '.';
  derived_link := '/listing/' || source_listing_id;
  replay_material := pg_catalog.concat_ws(
    pg_catalog.chr(31),
    'grainline-notification-v1',
    source_user_id,
    'BACK_IN_STOCK',
    'manual_restock',
    p_restock_audit_id,
    p_stock_notification_id,
    source_seller_user_id
  );
  derived_dedup_key :=
    pg_catalog.md5(replay_material)
    || pg_catalog.md5('grainline-notification-v1-secondary' || replay_material);

  INSERT INTO public."Notification" (
    id,
    "userId",
    "relatedUserId",
    "type",
    title,
    body,
    link,
    "sourceType",
    "sourceId",
    "dedupKey",
    read,
    "createdAt"
  ) VALUES (
    p_notification_id,
    source_user_id,
    source_seller_user_id,
    'BACK_IN_STOCK'::public."NotificationType",
    derived_title,
    derived_body,
    derived_link,
    'manual_restock',
    p_restock_audit_id,
    derived_dedup_key,
    false,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT ("userId", "type", "dedupKey") DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
      INTO notification_id
      FROM public."Notification" AS notification
     WHERE notification."userId" = source_user_id
       AND notification."type" = 'BACK_IN_STOCK'::public."NotificationType"
       AND notification."dedupKey" = derived_dedup_key;
  END IF;
  IF notification_id IS NULL THEN
    RAISE EXCEPTION 'back-in-stock notification claim did not resolve a row';
  END IF;

  DELETE FROM public."StockNotification" AS source_subscription
   WHERE source_subscription.id = p_stock_notification_id;
  claimed := true;
  user_id := source_user_id;
  RETURN NEXT;
END
$grainline_notification_claim_back_in_stock$;

REVOKE ALL ON FUNCTION public.grainline_stock_notification_owner_subscribe(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stock_notification_seller_counts(text[])
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stock_notification_seller_range_count(
  timestamp without time zone, timestamp without time zone, boolean
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stock_notification_restock_candidates(text, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stock_notification_seller_listing_cleanup(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stock_notification_admin_listing_cleanup(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stock_notification_block_cleanup(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stock_notification_owner_export()
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_owner_subscribe(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_seller_counts(text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_seller_range_count(
  timestamp without time zone, timestamp without time zone, boolean
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_restock_candidates(text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_seller_listing_cleanup(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_admin_listing_cleanup(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_block_cleanup(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stock_notification_owner_export()
  TO grainline_app_runtime;

DO $grainline_stock_notification_postflight$
DECLARE
  reviewed_function text;
BEGIN
  FOREACH reviewed_function IN ARRAY ARRAY[
    'public.grainline_stock_notification_owner_subscribe(text,text)',
    'public.grainline_stock_notification_seller_counts(text[])',
    'public.grainline_stock_notification_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)',
    'public.grainline_stock_notification_restock_candidates(text,integer)',
    'public.grainline_stock_notification_seller_listing_cleanup(text)',
    'public.grainline_stock_notification_admin_listing_cleanup(text)',
    'public.grainline_stock_notification_block_cleanup(text)',
    'public.grainline_stock_notification_owner_export()',
    'public.grainline_notification_claim_back_in_stock(text,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL THEN
      RAISE EXCEPTION 'StockNotification reviewed function is missing: %', reviewed_function;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'StockNotification reviewed function posture drifted: %', reviewed_function;
    END IF;
    IF pg_catalog.has_function_privilege(
         0, pg_catalog.to_regprocedure(reviewed_function), 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'StockNotification reviewed function exposes PUBLIC EXECUTE: %', reviewed_function;
    END IF;
  END LOOP;
END
$grainline_stock_notification_postflight$;

COMMIT;
