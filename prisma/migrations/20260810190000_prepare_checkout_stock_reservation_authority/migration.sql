-- Coexistence-safe CheckoutStockReservation authority preparation.
--
-- This migration adds source-bound Stripe webhook leases and fixed reservation
-- lifecycle operations while preserving predecessor table grants and RLS
-- posture. It is additive compatibility work, not an RLS activation.

BEGIN;


SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.checkout-stock-reservation.authority.preparation',
    0
  )
);

LOCK TABLE public."StripeWebhookEvent", public."CheckoutStockReservation"
  IN ACCESS EXCLUSIVE MODE;

-- This compatible release is intentionally sequenced after the separate
-- StripeWebhookEvent FORCE rollout. Refuse to let a single migration dispatch
-- collapse those two reviewed production boundaries.
DO $grainline_checkout_reservation_preflight$
DECLARE
  event_rls boolean;
  event_force boolean;
  event_policy_count integer;
  event_owner text;
  reservation_rls boolean;
  reservation_force boolean;
  reservation_policy_count integer;
  reservation_owner text;
  runtime_role record;
  runtime_role_oid oid;
  owner_role record;
  owner_session_count integer;
  predecessor_constraint_count integer;
  webhook_begin_count integer;
BEGIN
  SELECT
    class.relrowsecurity,
    class.relforcerowsecurity,
    pg_catalog.count(policy.oid)::integer,
    pg_catalog.pg_get_userbyid(class.relowner)
    INTO STRICT event_rls, event_force, event_policy_count, event_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    LEFT JOIN pg_catalog.pg_policy AS policy ON policy.polrelid = class.oid
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind IN ('r', 'p')
   GROUP BY class.relrowsecurity, class.relforcerowsecurity, class.relowner;

  IF NOT event_rls OR NOT event_force OR event_policy_count <> 0
     OR event_owner IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'Checkout reservation preparation requires the exact FORCE-hardened StripeWebhookEvent predecessor';
  END IF;

  SELECT
    class.relrowsecurity,
    class.relforcerowsecurity,
    pg_catalog.count(policy.oid)::integer,
    pg_catalog.pg_get_userbyid(class.relowner)
    INTO STRICT reservation_rls, reservation_force,
      reservation_policy_count, reservation_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    LEFT JOIN pg_catalog.pg_policy AS policy ON policy.polrelid = class.oid
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
     AND class.relkind IN ('r', 'p')
   GROUP BY class.relrowsecurity, class.relforcerowsecurity, class.relowner;

  IF reservation_rls OR reservation_force OR reservation_policy_count <> 0
     OR reservation_owner IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'Checkout reservation preparation predecessor posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO predecessor_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'CheckoutStockReservation_status_chk',
       'CheckoutStockReservation_reservedItems_array_chk'
     )
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF predecessor_constraint_count <> 2 THEN
    RAISE EXCEPTION
      'Checkout reservation validated predecessor constraints drifted: %',
      predecessor_constraint_count;
  END IF;

  SELECT
    role.oid,
    role.rolsuper,
    role.rolinherit,
    role.rolcanlogin,
    role.rolcreatedb,
    role.rolcreaterole,
    role.rolreplication,
    role.rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls
     OR event_owner = 'grainline_app_runtime'
     OR reservation_owner = 'grainline_app_runtime' THEN
    RAISE EXCEPTION 'grainline_app_runtime role posture is not reservation-authority safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

  -- Retain only Neon's non-effective bootstrap edge: neondb_owner may be a
  -- member of the restricted runtime role when cloud_admin grants ADMIN but
  -- neither INHERIT nor SET. The runtime role must never inherit another role.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor
        ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_app_runtime'
       OR granted_role.rolname = 'grainline_app_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_app_runtime'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) OR EXISTS (
    WITH RECURSIVE restricted_members AS (
      SELECT child.oid, child.rolname
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_app_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership
          ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
    )
    SELECT 1
      FROM restricted_members
     WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION 'Checkout reservation runtime role retains unreviewed membership';
  END IF;

  SELECT
    role.oid,
    role.rolsuper,
    role.rolcanlogin,
    role.rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND
     OR NOT owner_role.rolcanlogin
     OR owner_role.oid = runtime_role_oid THEN
    RAISE EXCEPTION 'Checkout reservation migration owner identity drifted';
  END IF;
  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls THEN
      RAISE EXCEPTION 'neondb_owner posture is not reservation-authority safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION 'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION 'Checkout reservation preparation requires a reviewed migration owner';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO owner_session_count
    FROM pg_catalog.pg_stat_activity AS activity
   WHERE activity.datname = pg_catalog.current_database()
     AND activity.usename = current_user
     AND activity.backend_type = 'client backend'
     AND activity.pid <> pg_catalog.pg_backend_pid();
  IF owner_session_count <> 0 THEN
    RAISE EXCEPTION
      'Checkout reservation owner-session drain is incomplete: % other owner sessions remain',
      owner_session_count;
  END IF;

  IF pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."StripeWebhookEvent"', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."StripeWebhookEvent"', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."StripeWebhookEvent"', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."StripeWebhookEvent"', 'DELETE'
     )
     OR pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', 'public."StripeWebhookEvent"',
       'SELECT,INSERT,UPDATE,REFERENCES'
     ) THEN
    RAISE EXCEPTION 'StripeWebhookEvent runtime table authority must already be revoked';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"',
       'TRUNCATE,REFERENCES,TRIGGER'
     ) THEN
    RAISE EXCEPTION 'CheckoutStockReservation predecessor CRUD grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('StripeWebhookEvent', 'CheckoutStockReservation')
       AND class.relkind IN ('r', 'p')
       AND acl.grantee = 0
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid IN (
       'public."StripeWebhookEvent"'::pg_catalog.regclass,
       'public."CheckoutStockReservation"'::pg_catalog.regclass
     )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee IN (0, runtime_role_oid)
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'Checkout reservation predecessor retains unreviewed PUBLIC or column authority';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO webhook_begin_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'grainline_stripe_webhook_begin'
     AND pg_catalog.oidvectortypes(procedure.proargtypes) = 'text, text'
     AND procedure.proowner = owner_role.oid
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = '76421b45f39a6d8f8888566c7fd0667f'
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (procedure.proowner, runtime_role_oid)
            OR (
              acl.grantee = runtime_role_oid
              AND (acl.grantor <> procedure.proowner OR acl.is_grantable)
            )
          )
     );
  IF webhook_begin_count <> 1 THEN
    RAISE EXCEPTION 'Checkout reservation predecessor webhook begin function drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid IN (
       'public."StripeWebhookEvent"'::pg_catalog.regclass,
       'public."CheckoutStockReservation"'::pg_catalog.regclass
     )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.attname IN (
         'sourceObjectId',
         'repairGeneration',
         'repairClaimedAt',
         'repairClaimKind',
         'lastRepairError',
         'lastRepairAttemptAt'
       )
  ) OR pg_catalog.to_regprocedure(
    'public.grainline_stripe_webhook_begin(text,text,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout reservation preparation is not at the clean predecessor';
  END IF;
END
$grainline_checkout_reservation_preflight$;

-- Checkout reservation transitions must not be able to pair one active,
-- signed Stripe event lease with a different provider object. The existing
-- lease intentionally stores only event identity/type, so compatible
-- preparation adds an immutable source-object binding before any reservation
-- function relies on that lease.
ALTER TABLE public."StripeWebhookEvent"
  ADD COLUMN "sourceObjectId" varchar(255);

ALTER TABLE public."StripeWebhookEvent"
  ADD CONSTRAINT "StripeWebhookEvent_sourceObjectId_check"
  CHECK (
    "sourceObjectId" IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim("sourceObjectId")) BETWEEN 1 AND 255
  ) NOT VALID;
ALTER TABLE public."StripeWebhookEvent"
  VALIDATE CONSTRAINT "StripeWebhookEvent_sourceObjectId_check";

CREATE FUNCTION public.grainline_stripe_webhook_bind_source(
  p_event_id text,
  p_event_type text,
  p_claim_generation bigint,
  p_source_object_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_webhook_bind_source$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_event_id IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_type IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_event_type)) NOT BETWEEN 1 AND 100
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_source_object_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_source_object_id)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Stripe webhook source binding input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type IS DISTINCT FROM p_event_type
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Stripe webhook source binding claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF source_event."sourceObjectId" IS NOT NULL
     AND source_event."sourceObjectId" IS DISTINCT FROM p_source_object_id THEN
    RAISE EXCEPTION 'Stripe webhook source object is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."StripeWebhookEvent" AS event
     SET "sourceObjectId" = p_source_object_id,
         "updatedAt" = source_now
   WHERE event.id = p_event_id
     AND event."sourceObjectId" IS NULL;
  RETURN true;
END
$grainline_stripe_webhook_bind_source$;

REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_bind_source(text, text, bigint, text)
  FROM PUBLIC, grainline_app_runtime;

-- The runtime calls one statement so lease acquisition and immutable source
-- binding cannot partially commit. The four-argument binder remains private.
CREATE FUNCTION public.grainline_stripe_webhook_begin(
  p_event_id text,
  p_event_type text,
  p_source_object_id text
)
RETURNS TABLE(action text, claim_generation bigint)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_webhook_begin_bound$
DECLARE
  source_action text;
  source_generation bigint;
BEGIN
  IF p_source_object_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_source_object_id)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Stripe webhook source object is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT lease.action, lease.claim_generation
    INTO STRICT source_action, source_generation
    FROM public.grainline_stripe_webhook_begin(p_event_id, p_event_type) AS lease;

  IF source_action = 'process' THEN
    PERFORM public.grainline_stripe_webhook_bind_source(
      p_event_id,
      p_event_type,
      source_generation,
      p_source_object_id
    );
  END IF;

  RETURN QUERY SELECT source_action, source_generation;
END
$grainline_stripe_webhook_begin_bound$;

REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_begin(text, text, text)
  FROM PUBLIC, grainline_app_runtime;

ALTER TABLE public."CheckoutStockReservation"
  ADD COLUMN "repairGeneration" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "repairClaimedAt" timestamp(3) without time zone,
  ADD COLUMN "repairClaimKind" varchar(32),
  ADD COLUMN "lastRepairError" varchar(100),
  ADD COLUMN "lastRepairAttemptAt" timestamp(3) without time zone;

CREATE FUNCTION public.grainline_checkout_reservation_items_valid(
  p_items jsonb,
  p_payload_hash text,
  p_seller_id text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_items_valid$
DECLARE
  source_item jsonb;
BEGIN
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' THEN
    RETURN false;
  END IF;

  FOR source_item IN
    SELECT item.value
      FROM pg_catalog.jsonb_array_elements(p_items) AS item(value)
  LOOP
    IF pg_catalog.jsonb_typeof(source_item) <> 'object'
       OR pg_catalog.jsonb_typeof(source_item->'listingId') <> 'string'
       OR pg_catalog.char_length(source_item->>'listingId') = 0
       OR pg_catalog.jsonb_typeof(source_item->'quantity') <> 'number'
       OR (source_item->>'quantity') !~ '^[1-9][0-9]*$'
       OR (source_item->>'quantity')::numeric > 2147483647 THEN
      RETURN false;
    END IF;

    IF p_payload_hash = 'deleted' THEN
      IF source_item ? 'sellerId' THEN
        RETURN false;
      END IF;
    ELSIF pg_catalog.jsonb_typeof(source_item->'sellerId') <> 'string'
       OR source_item->>'sellerId' IS DISTINCT FROM p_seller_id THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION
  WHEN data_exception OR numeric_value_out_of_range THEN
    RETURN false;
END
$grainline_checkout_reservation_items_valid$;

REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_items_valid(jsonb, text, text)
  FROM PUBLIC, grainline_app_runtime;

CREATE FUNCTION public.grainline_checkout_reservation_normalize_write()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_normalize_write$
DECLARE
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
BEGIN
  -- During old/new coexistence the predecessor repair worker writes transient
  -- diagnostics into restoreReason. Preserve the diagnostic but keep terminal
  -- restoration evidence semantically exact.
  IF NEW.status IN ('RESERVED', 'SESSION_CREATED', 'COMPLETED')
     AND NEW."restoreReason" IS NOT NULL THEN
    NEW."lastRepairError" := pg_catalog.left(NEW."restoreReason", 100);
    NEW."lastRepairAttemptAt" := source_now;
    NEW."restoreReason" := NULL;
    NEW."restoredAt" := NULL;
  END IF;

  IF NEW.status NOT IN ('RESERVED', 'SESSION_CREATED', 'COMPLETED', 'RESTORED') THEN
    RAISE EXCEPTION 'Checkout reservation status is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."payloadHash" = 'deleted' THEN
    IF NEW.status NOT IN ('COMPLETED', 'RESTORED')
       OR NEW."checkoutLockKey" IS DISTINCT FROM 'deleted:' || NEW.id
       OR NEW."buyerId" IS NOT NULL
       OR NEW."sellerId" IS NOT NULL THEN
      RAISE EXCEPTION 'Deleted checkout reservation shape is invalid'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."payloadHash" !~ '^[A-Za-z0-9_-]{32}$'
     OR NEW."buyerId" IS NULL
     OR NEW."sellerId" IS NULL
     OR NEW."checkoutLockKey" LIKE 'deleted:%' THEN
    RAISE EXCEPTION 'Checkout reservation authority shape is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.grainline_checkout_reservation_items_valid(
    NEW."reservedItems",
    NEW."payloadHash",
    NEW."sellerId"
  ) THEN
    RAISE EXCEPTION 'Checkout reservation items are invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW.status = 'RESERVED' AND NEW."stripeSessionId" IS NOT NULL)
     OR (NEW.status IN ('SESSION_CREATED', 'COMPLETED') AND NEW."stripeSessionId" IS NULL)
     OR (NEW.status = 'RESTORED' AND (NEW."restoredAt" IS NULL OR NEW."restoreReason" IS NULL))
     OR (NEW.status <> 'RESTORED' AND (NEW."restoredAt" IS NOT NULL OR NEW."restoreReason" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Checkout reservation state is incoherent'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."repairGeneration" < 0
     OR (NEW."repairClaimedAt" IS NULL) <> (NEW."repairClaimKind" IS NULL)
     OR (NEW."repairClaimKind" IS NOT NULL AND NEW."repairClaimKind" NOT IN ('CRON', 'ACCOUNT'))
     OR (NEW."repairClaimedAt" IS NOT NULL AND NEW.status NOT IN ('RESERVED', 'SESSION_CREATED')) THEN
    RAISE EXCEPTION 'Checkout reservation repair claim is incoherent'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$grainline_checkout_reservation_normalize_write$;

REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_normalize_write()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER "CheckoutStockReservation_normalize_write"
BEFORE INSERT OR UPDATE ON public."CheckoutStockReservation"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_checkout_reservation_normalize_write();

ALTER TABLE public."CheckoutStockReservation"
  ADD CONSTRAINT "CheckoutStockReservation_repairGeneration_check"
  CHECK ("repairGeneration" >= 0) NOT VALID,
  ADD CONSTRAINT "CheckoutStockReservation_payloadHash_check"
  CHECK ("payloadHash" = 'deleted' OR "payloadHash" ~ '^[A-Za-z0-9_-]{32}$') NOT VALID,
  ADD CONSTRAINT "CheckoutStockReservation_repairClaim_check"
  CHECK (
    ("repairClaimedAt" IS NULL) = ("repairClaimKind" IS NULL)
    AND ("repairClaimKind" IS NULL OR "repairClaimKind" IN ('CRON', 'ACCOUNT'))
  ) NOT VALID;

ALTER TABLE public."CheckoutStockReservation"
  VALIDATE CONSTRAINT "CheckoutStockReservation_repairGeneration_check";
ALTER TABLE public."CheckoutStockReservation"
  VALIDATE CONSTRAINT "CheckoutStockReservation_payloadHash_check";
ALTER TABLE public."CheckoutStockReservation"
  VALIDATE CONSTRAINT "CheckoutStockReservation_repairClaim_check";

CREATE UNIQUE INDEX "CheckoutStockReservation_active_lock_key"
  ON public."CheckoutStockReservation" ("checkoutLockKey")
  WHERE status IN ('RESERVED', 'SESSION_CREATED');

CREATE INDEX "CheckoutStockReservation_repair_claim_idx"
  ON public."CheckoutStockReservation" (status, "expiresAt", "repairClaimedAt", id);

CREATE FUNCTION public.grainline_checkout_reservation_restore_items(
  p_reserved_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_restore_items$
DECLARE
  source_item record;
  updated_count integer;
  visibility_count integer := 0;
BEGIN
  FOR source_item IN
    SELECT
      item.value->>'listingId' AS listing_id,
      pg_catalog.sum((item.value->>'quantity')::integer)::integer AS quantity
      FROM pg_catalog.jsonb_array_elements(p_reserved_items) AS item(value)
     GROUP BY item.value->>'listingId'
     ORDER BY item.value->>'listingId'
  LOOP
    UPDATE public."Listing" AS listing
       SET "stockQuantity" = listing."stockQuantity" + source_item.quantity
     WHERE listing.id = source_item.listing_id
       AND listing."listingType" = 'IN_STOCK';
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> 1 THEN
      RAISE EXCEPTION 'Reserved listing could not be restored'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public."Listing" AS listing
       SET status = 'ACTIVE'
     WHERE listing.id = source_item.listing_id
       AND listing.status = 'SOLD_OUT'
       AND listing."stockQuantity" > 0;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    visibility_count := visibility_count + updated_count;
  END LOOP;

  RETURN visibility_count;
END
$grainline_checkout_reservation_restore_items$;

REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_restore_items(jsonb)
  FROM PUBLIC, grainline_app_runtime;

CREATE FUNCTION public.grainline_checkout_reservation_create_cart(
  p_buyer_id text,
  p_cart_id text,
  p_seller_profile_id text,
  p_checkout_group_id text,
  p_payload_hash text
)
RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_create_cart$
DECLARE
  source_id text := pg_catalog.gen_random_uuid()::text;
  source_items jsonb := '[]'::jsonb;
  source_seller_user_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_expires timestamp(3) without time zone;
  source_item record;
  source_count bigint;
  updated_count integer;
BEGIN
  IF p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR p_cart_id IS NULL OR pg_catalog.char_length(p_cart_id) NOT BETWEEN 1 AND 191
     OR p_seller_profile_id IS NULL OR pg_catalog.char_length(p_seller_profile_id) NOT BETWEEN 1 AND 191
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[A-Za-z0-9_-]{32}$'
     OR (p_checkout_group_id IS NOT NULL AND pg_catalog.char_length(p_checkout_group_id) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Cart checkout reservation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller."userId"
    INTO source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Account deletion takes User FOR UPDATE before scrubbing reservations and
  -- hiding listings. Lock buyer and seller in stable order first so creation
  -- either commits before that scrub or waits and observes terminal state.
  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (p_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR KEY SHARE;

  PERFORM 1 FROM public."User" AS buyer
   WHERE buyer.id = p_buyer_id
     AND buyer."deletedAt" IS NULL
     AND buyer.banned = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout buyer is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = source_seller_user_id
     AND seller."userId" <> p_buyer_id
     AND seller_user."deletedAt" IS NULL
     AND seller_user.banned = false
     AND seller."stripeAccountId" IS NOT NULL
     AND seller."chargesEnabled" = true
     AND seller."vacationMode" = false
     AND seller."acceptingNewOrders" = true
     AND (seller."stripeAccountVersion" IS NULL OR seller."stripeAccountVersion" = 'v2');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."Cart" AS cart
   WHERE cart.id = p_cart_id
     AND cart."userId" = p_buyer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout source is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."CartItem" AS cart_item
    JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
   ORDER BY listing.id, cart_item.id
   FOR UPDATE OF cart_item, listing;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout has no items for seller'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.count(*)
    INTO STRICT source_count
    FROM public."CartItem" AS cart_item
    JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
     AND (
       cart_item.quantity < 1
       OR cart_item.quantity > 200
       OR listing.status <> 'ACTIVE'
       OR (listing."isPrivate" AND listing."reservedForUserId" IS DISTINCT FROM p_buyer_id)
     );
  IF source_count <> 0 THEN
    RAISE EXCEPTION 'Cart checkout contains an unavailable item'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'listingId', source.listing_id,
        'sellerId', p_seller_profile_id,
        'quantity', source.quantity
      ) ORDER BY source.listing_id
    ),
    '[]'::jsonb
  )
    INTO STRICT source_items
    FROM (
      SELECT listing.id AS listing_id, pg_catalog.sum(cart_item.quantity)::integer AS quantity
        FROM public."CartItem" AS cart_item
        JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
       WHERE cart_item."cartId" = p_cart_id
         AND listing."sellerId" = p_seller_profile_id
         AND listing."listingType" = 'IN_STOCK'
       GROUP BY listing.id
    ) AS source;

  source_expires := source_now + interval '31 minutes';
  INSERT INTO public."CheckoutStockReservation" (
    id, "checkoutLockKey", "checkoutGroupId", "payloadHash", "buyerId",
    "sellerId", status, "reservedItems", "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    source_id,
    'checkout:cart:' || p_cart_id || ':seller:' || p_seller_profile_id,
    p_checkout_group_id,
    p_payload_hash,
    p_buyer_id,
    p_seller_profile_id,
    'RESERVED',
    source_items,
    source_expires,
    source_now,
    source_now
  );

  FOR source_item IN
    SELECT item.value->>'listingId' AS listing_id,
           (item.value->>'quantity')::integer AS quantity
      FROM pg_catalog.jsonb_array_elements(source_items) AS item(value)
     ORDER BY item.value->>'listingId'
  LOOP
    UPDATE public."Listing" AS listing
       SET "stockQuantity" = listing."stockQuantity" - source_item.quantity
     WHERE listing.id = source_item.listing_id
       AND listing."sellerId" = p_seller_profile_id
       AND listing.status = 'ACTIVE'
       AND listing."listingType" = 'IN_STOCK'
       AND listing."stockQuantity" >= source_item.quantity;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> 1 THEN
      RAISE EXCEPTION 'Checkout stock is unavailable'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN QUERY SELECT source_id, source_items, source_expires;
END
$grainline_checkout_reservation_create_cart$;

CREATE FUNCTION public.grainline_checkout_reservation_create_single(
  p_buyer_id text,
  p_listing_id text,
  p_quantity integer,
  p_payload_hash text
)
RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_create_single$
DECLARE
  source_listing public."Listing"%ROWTYPE;
  source_seller_id text;
  source_seller_user_id text;
  source_id text := pg_catalog.gen_random_uuid()::text;
  source_items jsonb;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_expires timestamp(3) without time zone;
  updated_count integer;
BEGIN
  IF p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR p_listing_id IS NULL OR pg_catalog.char_length(p_listing_id) NOT BETWEEN 1 AND 191
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 99
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[A-Za-z0-9_-]{32}$' THEN
    RAISE EXCEPTION 'Single checkout reservation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT listing."sellerId"
    INTO source_seller_id
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout listing is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT seller."userId"
    INTO source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_seller_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (p_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR KEY SHARE;

  PERFORM 1 FROM public."User" AS buyer
   WHERE buyer.id = p_buyer_id AND buyer."deletedAt" IS NULL AND buyer.banned = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout buyer is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = source_seller_id
     AND seller."userId" = source_seller_user_id
     AND seller."userId" <> p_buyer_id
     AND seller_user."deletedAt" IS NULL
     AND seller_user.banned = false
     AND seller."stripeAccountId" IS NOT NULL
     AND seller."chargesEnabled" = true
     AND seller."vacationMode" = false
     AND seller."acceptingNewOrders" = true
     AND (seller."stripeAccountVersion" IS NULL OR seller."stripeAccountVersion" = 'v2');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT listing.*
    INTO STRICT source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
   FOR UPDATE;

  IF source_listing."sellerId" IS DISTINCT FROM source_seller_id
     OR source_listing.status <> 'ACTIVE'
     OR (source_listing."isPrivate" AND source_listing."reservedForUserId" IS DISTINCT FROM p_buyer_id) THEN
    RAISE EXCEPTION 'Single checkout listing is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF source_listing."listingType" <> 'IN_STOCK' THEN
    RETURN;
  END IF;

  source_items := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'listingId', source_listing.id,
    'sellerId', source_listing."sellerId",
    'quantity', p_quantity
  ));
  source_expires := source_now + interval '31 minutes';

  INSERT INTO public."CheckoutStockReservation" (
    id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId", status,
    "reservedItems", "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    source_id,
    'checkout:single:' || p_buyer_id || ':listing:' || p_listing_id,
    p_payload_hash,
    p_buyer_id,
    source_listing."sellerId",
    'RESERVED',
    source_items,
    source_expires,
    source_now,
    source_now
  );

  UPDATE public."Listing" AS listing
     SET "stockQuantity" = listing."stockQuantity" - p_quantity
   WHERE listing.id = p_listing_id
     AND listing.status = 'ACTIVE'
     AND listing."listingType" = 'IN_STOCK'
     AND listing."stockQuantity" >= p_quantity;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Checkout stock is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY SELECT source_id, source_items, source_expires;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'Single checkout listing is unavailable'
      USING ERRCODE = 'check_violation';
END
$grainline_checkout_reservation_create_single$;

CREATE FUNCTION public.grainline_checkout_reservation_bind_session(
  p_reservation_id text,
  p_buyer_id text,
  p_payload_hash text,
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_bind_session$
DECLARE
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  updated_count integer;
BEGIN
  IF p_reservation_id IS NULL OR pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191
     OR p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[A-Za-z0-9_-]{32}$'
     OR p_session_id IS NULL OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_session_id) > 255 THEN
    RAISE EXCEPTION 'Checkout reservation session input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'SESSION_CREATED',
         "stripeSessionId" = p_session_id,
         "updatedAt" = source_now
   WHERE reservation.id = p_reservation_id
     AND reservation."buyerId" = p_buyer_id
     AND reservation."payloadHash" = p_payload_hash
     AND reservation.status = 'RESERVED'
     AND reservation."stripeSessionId" IS NULL
     AND reservation."repairClaimedAt" IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END
$grainline_checkout_reservation_bind_session$;

CREATE FUNCTION public.grainline_checkout_reservation_complete(
  p_event_id text,
  p_claim_generation bigint,
  p_reservation_id text,
  p_session_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_complete$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_event_id IS NULL OR pg_catalog.char_length(p_event_id) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_session_id IS NULL OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_session_id) > 255
     OR (p_reservation_id IS NOT NULL AND pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191) THEN
    RAISE EXCEPTION 'Checkout reservation completion input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
     AND event.type IN ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
     AND event."sourceObjectId" = p_session_id
     AND event."claimGeneration" = p_claim_generation
     AND event."processingStartedAt" IS NOT NULL
     AND event."processedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout completion webhook claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_session_id));

  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation."stripeSessionId" = p_session_id
      OR (p_reservation_id IS NOT NULL AND reservation.id = p_reservation_id)
   ORDER BY (reservation."stripeSessionId" = p_session_id) DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF source_reservation."stripeSessionId" IS DISTINCT FROM p_session_id
     OR (p_reservation_id IS NOT NULL AND source_reservation.id IS DISTINCT FROM p_reservation_id) THEN
    RAISE EXCEPTION 'Checkout completion reservation does not match session'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."Order" AS source_order
   WHERE source_order."stripeSessionId" = p_session_id
     AND source_order."buyerId" IS NOT DISTINCT FROM source_reservation."buyerId"
     AND source_order."sellerProfileId" IS NOT DISTINCT FROM source_reservation."sellerId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout completion is missing its durable order'
      USING ERRCODE = 'check_violation';
  END IF;

  IF source_reservation.status = 'COMPLETED' THEN
    RETURN 'already_completed';
  END IF;
  IF source_reservation.status = 'RESTORED' THEN
    RAISE EXCEPTION 'A restored checkout reservation cannot complete'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'COMPLETED',
         "repairClaimedAt" = NULL,
         "repairClaimKind" = NULL,
         "lastRepairError" = NULL,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;
  RETURN 'completed';
END
$grainline_checkout_reservation_complete$;

CREATE FUNCTION public.grainline_checkout_reservation_checkout_abort(
  p_reservation_id text,
  p_buyer_id text,
  p_payload_hash text
)
RETURNS TABLE(result text, checkout_lock_key text, stock_visibility_changed integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_checkout_abort$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_visibility integer;
BEGIN
  IF p_reservation_id IS NULL OR pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191
     OR p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[A-Za-z0-9_-]{32}$' THEN
    RAISE EXCEPTION 'Checkout abort input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913338, pg_catalog.hashtext(p_reservation_id));
  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.id = p_reservation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absent'::text, NULL::text, 0;
    RETURN;
  END IF;
  IF source_reservation."buyerId" IS DISTINCT FROM p_buyer_id
     OR source_reservation."payloadHash" IS DISTINCT FROM p_payload_hash THEN
    RAISE EXCEPTION 'Checkout abort authority does not match reservation'
      USING ERRCODE = 'check_violation';
  END IF;
  IF source_reservation.status IN ('COMPLETED', 'RESTORED') THEN
    RETURN QUERY SELECT 'terminal'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;
  IF source_reservation.status <> 'RESERVED'
     OR source_reservation."stripeSessionId" IS NOT NULL
     OR source_reservation."repairClaimedAt" IS NOT NULL THEN
    RETURN QUERY SELECT 'retained'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;

  source_visibility := public.grainline_checkout_reservation_restore_items(
    source_reservation."reservedItems"
  );
  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'RESTORED',
         "restoredAt" = source_now,
         "restoreReason" = 'checkout_aborted',
         "lastRepairError" = NULL,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;

  RETURN QUERY
    SELECT 'restored'::text, source_reservation."checkoutLockKey"::text, source_visibility;
END
$grainline_checkout_reservation_checkout_abort$;

CREATE FUNCTION public.grainline_checkout_reservation_webhook_restore(
  p_event_id text,
  p_claim_generation bigint,
  p_session_id text
)
RETURNS TABLE(result text, checkout_lock_key text, stock_visibility_changed integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_webhook_restore$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_event_type text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_visibility integer;
BEGIN
  IF p_event_id IS NULL OR pg_catalog.char_length(p_event_id) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_session_id IS NULL OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_session_id) > 255 THEN
    RAISE EXCEPTION 'Checkout webhook restore input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.type
    INTO source_event_type
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
     AND event.type IN ('checkout.session.expired', 'checkout.session.async_payment_failed')
     AND event."sourceObjectId" = p_session_id
     AND event."claimGeneration" = p_claim_generation
     AND event."processingStartedAt" IS NOT NULL
     AND event."processedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout restore webhook claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_session_id));
  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation."stripeSessionId" = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absent'::text, NULL::text, 0;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public."Order" AS source_order WHERE source_order."stripeSessionId" = p_session_id) THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET status = 'COMPLETED',
           "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = NULL,
           "updatedAt" = source_now
     WHERE reservation.id = source_reservation.id
       AND reservation.status IN ('RESERVED', 'SESSION_CREATED');
    RETURN QUERY SELECT 'completed'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;
  IF source_reservation.status IN ('COMPLETED', 'RESTORED') THEN
    RETURN QUERY SELECT 'terminal'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;

  source_visibility := public.grainline_checkout_reservation_restore_items(
    source_reservation."reservedItems"
  );
  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'RESTORED',
         "restoredAt" = source_now,
         "restoreReason" = CASE source_event_type
           WHEN 'checkout.session.expired' THEN 'stripe_session_expired'
           ELSE 'stripe_async_payment_failed'
         END,
         "repairClaimedAt" = NULL,
         "repairClaimKind" = NULL,
         "lastRepairError" = NULL,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;
  RETURN QUERY SELECT 'restored'::text, source_reservation."checkoutLockKey"::text, source_visibility;
END
$grainline_checkout_reservation_webhook_restore$;

CREATE FUNCTION public.grainline_checkout_reservation_buyer_expired_restore(
  p_buyer_id text,
  p_session_id text
)
RETURNS TABLE(result text, checkout_lock_key text, stock_visibility_changed integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_buyer_expired_restore$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_visibility integer;
BEGIN
  IF p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR p_session_id IS NULL OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_session_id) > 255 THEN
    RAISE EXCEPTION 'Buyer-expired checkout restore input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_session_id));
  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation."stripeSessionId" = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absent'::text, NULL::text, 0;
    RETURN;
  END IF;
  IF source_reservation."buyerId" IS DISTINCT FROM p_buyer_id THEN
    RAISE EXCEPTION 'Buyer-expired checkout authority does not match reservation'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public."Order" AS source_order WHERE source_order."stripeSessionId" = p_session_id) THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET status = 'COMPLETED',
           "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = NULL,
           "updatedAt" = source_now
     WHERE reservation.id = source_reservation.id
       AND reservation.status IN ('RESERVED', 'SESSION_CREATED');
    RETURN QUERY SELECT 'completed'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;
  IF source_reservation.status IN ('COMPLETED', 'RESTORED') THEN
    RETURN QUERY SELECT 'terminal'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;

  source_visibility := public.grainline_checkout_reservation_restore_items(
    source_reservation."reservedItems"
  );
  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'RESTORED',
         "restoredAt" = source_now,
         "restoreReason" = 'buyer_confirmed_session_expired',
         "repairClaimedAt" = NULL,
         "repairClaimKind" = NULL,
         "lastRepairError" = NULL,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;
  RETURN QUERY SELECT 'restored'::text, source_reservation."checkoutLockKey"::text, source_visibility;
END
$grainline_checkout_reservation_buyer_expired_restore$;

CREATE FUNCTION public.grainline_checkout_reservation_seller_expired_restore(
  p_seller_profile_id text,
  p_session_id text
)
RETURNS TABLE(result text, checkout_lock_key text, stock_visibility_changed integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_seller_expired_restore$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_visibility integer;
BEGIN
  IF p_seller_profile_id IS NULL OR pg_catalog.char_length(p_seller_profile_id) NOT BETWEEN 1 AND 191
     OR p_session_id IS NULL OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_session_id) > 255 THEN
    RAISE EXCEPTION 'Seller-expired checkout restore input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_session_id));
  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation."stripeSessionId" = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absent'::text, NULL::text, 0;
    RETURN;
  END IF;
  IF source_reservation."sellerId" IS DISTINCT FROM p_seller_profile_id THEN
    RAISE EXCEPTION 'Seller-expired checkout authority does not match reservation'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public."Order" AS source_order WHERE source_order."stripeSessionId" = p_session_id) THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET status = 'COMPLETED',
           "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = NULL,
           "updatedAt" = source_now
     WHERE reservation.id = source_reservation.id
       AND reservation.status IN ('RESERVED', 'SESSION_CREATED');
    RETURN QUERY SELECT 'completed'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;
  IF source_reservation.status IN ('COMPLETED', 'RESTORED') THEN
    RETURN QUERY SELECT 'terminal'::text, source_reservation."checkoutLockKey"::text, 0;
    RETURN;
  END IF;

  source_visibility := public.grainline_checkout_reservation_restore_items(
    source_reservation."reservedItems"
  );
  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'RESTORED',
         "restoredAt" = source_now,
         "restoreReason" = 'seller_confirmed_session_expired',
         "repairClaimedAt" = NULL,
         "repairClaimKind" = NULL,
         "lastRepairError" = NULL,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;
  RETURN QUERY SELECT 'restored'::text, source_reservation."checkoutLockKey"::text, source_visibility;
END
$grainline_checkout_reservation_seller_expired_restore$;

CREATE FUNCTION public.grainline_checkout_reservation_repair_claim_batch(
  p_limit integer
)
RETURNS TABLE(reservation_id text, repair_generation bigint, stripe_session_id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_repair_claim_batch$
DECLARE
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  safe_limit integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Checkout repair claim limit is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  safe_limit := LEAST(p_limit, 50);

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT reservation.id
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation.status IN ('RESERVED', 'SESSION_CREATED')
       AND reservation."expiresAt" < source_now - interval '2 hours'
       AND (
         reservation."repairClaimedAt" IS NULL
         OR reservation."repairClaimedAt" < source_now - interval '5 minutes'
       )
     ORDER BY reservation."expiresAt" ASC, reservation.id ASC
     LIMIT safe_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public."CheckoutStockReservation" AS reservation
     SET "repairGeneration" = reservation."repairGeneration" + 1,
         "repairClaimedAt" = source_now,
         "repairClaimKind" = 'CRON',
         "lastRepairError" = NULL,
         "lastRepairAttemptAt" = source_now,
         "updatedAt" = source_now
    FROM candidates
   WHERE reservation.id = candidates.id
  RETURNING reservation.id, reservation."repairGeneration", reservation."stripeSessionId"::text;
END
$grainline_checkout_reservation_repair_claim_batch$;

CREATE FUNCTION public.grainline_checkout_reservation_account_claim_batch(
  p_user_id text,
  p_limit integer
)
RETURNS TABLE(reservation_id text, repair_generation bigint, stripe_session_id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_account_claim_batch$
DECLARE
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_seller_id text;
  safe_limit integer;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.char_length(p_user_id) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Checkout account repair claim input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  safe_limit := LEAST(p_limit, 50);
  SELECT seller.id INTO source_seller_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_user_id;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT reservation.id
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation.status IN ('RESERVED', 'SESSION_CREATED')
       AND (
         reservation."buyerId" = p_user_id
         OR (source_seller_id IS NOT NULL AND reservation."sellerId" = source_seller_id)
       )
       AND (
         reservation."repairClaimedAt" IS NULL
         OR reservation."repairClaimedAt" < source_now - interval '5 minutes'
       )
     ORDER BY reservation."createdAt" ASC, reservation.id ASC
     LIMIT safe_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public."CheckoutStockReservation" AS reservation
     SET "repairGeneration" = reservation."repairGeneration" + 1,
         "repairClaimedAt" = source_now,
         "repairClaimKind" = 'ACCOUNT',
         "lastRepairError" = NULL,
         "lastRepairAttemptAt" = source_now,
         "updatedAt" = source_now
    FROM candidates
   WHERE reservation.id = candidates.id
  RETURNING reservation.id, reservation."repairGeneration", reservation."stripeSessionId"::text;
END
$grainline_checkout_reservation_account_claim_batch$;

CREATE FUNCTION public.grainline_checkout_reservation_repair_finalize(
  p_reservation_id text,
  p_repair_generation bigint,
  p_outcome text
)
RETURNS TABLE(result text, checkout_lock_key text, stripe_session_id text, stock_visibility_changed integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_repair_finalize$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_session_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_visibility integer := 0;
  source_reason text;
BEGIN
  IF p_reservation_id IS NULL OR pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191
     OR p_repair_generation IS NULL OR p_repair_generation < 1
     OR p_outcome NOT IN (
       'NO_SESSION_RESTORE', 'SESSION_EXPIRED_RESTORE', 'PAID_OR_COMPLETE',
       'RETRIEVE_FAILED', 'UNRECOGNIZED', 'EXPIRE_FAILED'
     ) THEN
    RAISE EXCEPTION 'Checkout repair finalizer input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT reservation."stripeSessionId"
    INTO source_session_id
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absent'::text, NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  IF source_session_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(source_session_id));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(913338, pg_catalog.hashtext(p_reservation_id));
  END IF;

  SELECT reservation.*
    INTO STRICT source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.id = p_reservation_id
   FOR UPDATE;
  IF source_reservation."repairGeneration" <> p_repair_generation
     OR source_reservation."repairClaimedAt" IS NULL
     OR source_reservation."repairClaimKind" IS NULL
     OR source_reservation."stripeSessionId" IS DISTINCT FROM source_session_id THEN
    RETURN QUERY
      SELECT 'superseded'::text, source_reservation."checkoutLockKey"::text,
             source_reservation."stripeSessionId"::text, 0;
    RETURN;
  END IF;

  IF source_session_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."Order" AS source_order WHERE source_order."stripeSessionId" = source_session_id) THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET status = 'COMPLETED',
           "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = NULL,
           "updatedAt" = source_now
     WHERE reservation.id = source_reservation.id;
    RETURN QUERY SELECT 'completed'::text, source_reservation."checkoutLockKey"::text, source_session_id, 0;
    RETURN;
  END IF;

  IF source_reservation.status IN ('COMPLETED', 'RESTORED') THEN
    RETURN QUERY
      SELECT 'terminal'::text, source_reservation."checkoutLockKey"::text, source_session_id, 0;
    RETURN;
  END IF;

  IF p_outcome IN ('PAID_OR_COMPLETE', 'RETRIEVE_FAILED', 'UNRECOGNIZED', 'EXPIRE_FAILED') THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = CASE p_outcome
             WHEN 'PAID_OR_COMPLETE' THEN 'paid_missing_local_order'
             WHEN 'RETRIEVE_FAILED' THEN 'session_retrieve_failed'
             WHEN 'UNRECOGNIZED' THEN 'unrecognized_session_state'
             ELSE 'session_expire_failed'
           END,
           "lastRepairAttemptAt" = source_now,
           "expiresAt" = source_now,
           "updatedAt" = source_now
     WHERE reservation.id = source_reservation.id;
    RETURN QUERY SELECT 'deferred'::text, source_reservation."checkoutLockKey"::text, source_session_id, 0;
    RETURN;
  END IF;

  IF (p_outcome = 'NO_SESSION_RESTORE' AND source_session_id IS NOT NULL)
     OR (p_outcome = 'SESSION_EXPIRED_RESTORE' AND source_session_id IS NULL) THEN
    RAISE EXCEPTION 'Checkout repair outcome does not match reservation session state'
      USING ERRCODE = 'check_violation';
  END IF;

  source_visibility := public.grainline_checkout_reservation_restore_items(
    source_reservation."reservedItems"
  );
  source_reason := CASE
    WHEN source_reservation."repairClaimKind" = 'ACCOUNT' AND source_session_id IS NULL
      THEN 'account_deletion_no_session'
    WHEN source_reservation."repairClaimKind" = 'ACCOUNT'
      THEN 'account_deletion_stripe_session_unpaid'
    WHEN source_session_id IS NULL THEN 'stale_no_session'
    ELSE 'stale_stripe_session_unpaid'
  END;

  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'RESTORED',
         "restoredAt" = source_now,
         "restoreReason" = source_reason,
         "repairClaimedAt" = NULL,
         "repairClaimKind" = NULL,
         "lastRepairError" = NULL,
         "lastRepairAttemptAt" = source_now,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;
  RETURN QUERY SELECT 'restored'::text, source_reservation."checkoutLockKey"::text, source_session_id, source_visibility;
END
$grainline_checkout_reservation_repair_finalize$;

CREATE FUNCTION public.grainline_checkout_reservation_prune_batch(
  p_limit integer
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_prune_batch$
DECLARE
  safe_limit integer;
  deleted_count bigint;
  source_cutoff timestamp(3) without time zone :=
    (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC') - interval '30 days';
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Checkout reservation prune limit is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  safe_limit := LEAST(p_limit, 100);

  WITH candidates AS MATERIALIZED (
    SELECT reservation.id
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation.status IN ('COMPLETED', 'RESTORED')
       AND reservation."updatedAt" < source_cutoff
     ORDER BY reservation."updatedAt" ASC, reservation.id ASC
     LIMIT safe_limit
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."CheckoutStockReservation" AS reservation
     USING candidates
     WHERE reservation.id = candidates.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*) INTO STRICT deleted_count FROM deleted;
  RETURN deleted_count;
END
$grainline_checkout_reservation_prune_batch$;

CREATE FUNCTION public.grainline_checkout_reservation_resume(
  p_buyer_id text,
  p_checkout_group_id text
)
RETURNS TABLE(stripe_session_id text, checkout_group_id text, created_at timestamp(3) without time zone)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_resume$
DECLARE
  source_group_id text := p_checkout_group_id;
  source_cutoff timestamp(3) without time zone :=
    (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC') - interval '2 hours';
BEGIN
  IF p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR (p_checkout_group_id IS NOT NULL AND pg_catalog.char_length(p_checkout_group_id) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Checkout resume input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF source_group_id IS NULL THEN
    SELECT reservation."checkoutGroupId"
      INTO source_group_id
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation."buyerId" = p_buyer_id
       AND reservation.status = 'COMPLETED'
       AND reservation."stripeSessionId" IS NOT NULL
       AND reservation."checkoutGroupId" IS NOT NULL
       AND reservation."createdAt" >= source_cutoff
     ORDER BY reservation."createdAt" DESC, reservation.id DESC
     LIMIT 1;
  END IF;
  IF source_group_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT reservation."stripeSessionId"::text, reservation."checkoutGroupId"::text, reservation."createdAt"
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation."buyerId" = p_buyer_id
       AND reservation.status = 'COMPLETED'
       AND reservation."stripeSessionId" IS NOT NULL
       AND reservation."checkoutGroupId" = source_group_id
       AND reservation."createdAt" >= source_cutoff
     ORDER BY reservation."createdAt" ASC, reservation.id ASC
     LIMIT 20;
END
$grainline_checkout_reservation_resume$;

CREATE FUNCTION public.grainline_checkout_reservation_export(
  p_user_id text
)
RETURNS TABLE(
  id text,
  exported_as_buyer boolean,
  exported_as_seller boolean,
  buyer_id text,
  seller_id text,
  stripe_session_id text,
  status text,
  reserved_items jsonb,
  expires_at timestamp(3) without time zone,
  restored_at timestamp(3) without time zone,
  restore_reason text,
  created_at timestamp(3) without time zone,
  updated_at timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_export$
DECLARE
  source_seller_id text;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.char_length(p_user_id) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Checkout reservation export user is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT seller.id INTO source_seller_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_user_id;

  RETURN QUERY
    SELECT
      reservation.id,
      reservation."buyerId" = p_user_id,
      source_seller_id IS NOT NULL AND reservation."sellerId" = source_seller_id,
      CASE WHEN reservation."buyerId" = p_user_id THEN reservation."buyerId"::text END,
      CASE WHEN source_seller_id IS NOT NULL AND reservation."sellerId" = source_seller_id
        THEN reservation."sellerId"::text END,
      CASE WHEN reservation."buyerId" = p_user_id THEN reservation."stripeSessionId"::text END,
      reservation.status::text,
      COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'listingId', item.value->>'listingId',
            'quantity', (item.value->>'quantity')::integer
          ) ORDER BY item.value->>'listingId'
        )
          FROM pg_catalog.jsonb_array_elements(reservation."reservedItems") AS item(value)
      ), '[]'::jsonb),
      reservation."expiresAt",
      reservation."restoredAt",
      reservation."restoreReason"::text,
      reservation."createdAt",
      reservation."updatedAt"
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation."buyerId" = p_user_id
        OR (source_seller_id IS NOT NULL AND reservation."sellerId" = source_seller_id)
     ORDER BY reservation."createdAt" DESC, reservation.id DESC;
END
$grainline_checkout_reservation_export$;

CREATE FUNCTION public.grainline_checkout_reservation_account_scrub(
  p_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_account_scrub$
DECLARE
  source_seller_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  updated_count bigint;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.char_length(p_user_id) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Checkout reservation scrub user is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT seller.id INTO source_seller_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_user_id;

  IF EXISTS (
    SELECT 1 FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation.status IN ('RESERVED', 'SESSION_CREATED')
       AND (
         reservation."buyerId" = p_user_id
         OR (source_seller_id IS NOT NULL AND reservation."sellerId" = source_seller_id)
       )
  ) THEN
    RAISE EXCEPTION 'Active checkout reservations must be repaired before account scrub'
      USING ERRCODE = 'check_violation';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT reservation.id
      FROM public."CheckoutStockReservation" AS reservation
     WHERE reservation."buyerId" = p_user_id
        OR (source_seller_id IS NOT NULL AND reservation."sellerId" = source_seller_id)
     ORDER BY reservation.id
     FOR UPDATE
  ), scrubbed AS (
    UPDATE public."CheckoutStockReservation" AS reservation
       SET "checkoutLockKey" = 'deleted:' || reservation.id,
           "payloadHash" = 'deleted',
           "buyerId" = NULL,
           "sellerId" = NULL,
           "reservedItems" = COALESCE((
             SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'listingId', item.value->>'listingId',
                 'quantity', (item.value->>'quantity')::integer
               ) ORDER BY item.value->>'listingId'
             )
               FROM pg_catalog.jsonb_array_elements(reservation."reservedItems") AS item(value)
           ), '[]'::jsonb),
           "repairClaimedAt" = NULL,
           "repairClaimKind" = NULL,
           "lastRepairError" = NULL,
           "updatedAt" = source_now
      FROM candidates
     WHERE reservation.id = candidates.id
    RETURNING 1
  )
  SELECT pg_catalog.count(*) INTO STRICT updated_count FROM scrubbed;
  RETURN updated_count;
END
$grainline_checkout_reservation_account_scrub$;

REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_create_cart(text, text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_create_single(text, text, integer, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_bind_session(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_complete(text, bigint, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_checkout_abort(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_webhook_restore(text, bigint, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_buyer_expired_restore(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_seller_expired_restore(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_repair_claim_batch(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_account_claim_batch(text, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text, bigint, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_prune_batch(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_resume(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_export(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_account_scrub(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_cart(text, text, text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_single(text, text, integer, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_bind_session(text, text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_complete(text, bigint, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_checkout_abort(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_webhook_restore(text, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_buyer_expired_restore(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_seller_expired_restore(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_repair_claim_batch(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_account_claim_batch(text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_prune_batch(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_resume(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_export(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_account_scrub(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_webhook_begin(text, text, text)
  TO grainline_app_runtime;


COMMIT;
