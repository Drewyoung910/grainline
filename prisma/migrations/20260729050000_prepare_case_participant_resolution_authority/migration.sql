-- Compatible fixed authority for participant Case resolution marks.
--
-- This migration adds one narrow SECURITY DEFINER operation. It does not
-- enable Case-family RLS, revoke legacy table grants or convert the
-- application, so old and new deployments may coexist during review.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_mark_resolved(
  p_actor_user_id text,
  p_case_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_mark_resolved$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  existing_audit record;
  actor_is_buyer boolean;
  actor_is_seller boolean;
  next_buyer_marked boolean;
  next_seller_marked boolean;
  next_status public."CaseStatus";
  audit_status text;
  audit_id text;
  transition_at timestamp(3);
  result_action text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191 THEN
    RAISE EXCEPTION 'Case resolution-mark input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case resolution-mark actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT case_row."orderId"
    INTO source_order_id
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."sellerRefundId",
    orders."caseResolutionClaimId"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row.resolution,
    case_row."refundAmountCents",
    case_row."stripeRefundId",
    case_row."buyerMarkedResolved",
    case_row."sellerMarkedResolved",
    case_row."resolvedAt",
    case_row."resolvedById"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id
     AND case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark Case changed Order'
      USING ERRCODE = '40001';
  END IF;

  -- buyerId is nullable for retained legacy Cases. Normalize both comparisons
  -- to strict booleans so NULL can never propagate into the persisted marks.
  actor_is_buyer := COALESCE(
    locked_case."buyerId" = locked_actor.id,
    false
  );
  actor_is_seller := COALESCE(
    locked_case."sellerId" = locked_actor.id,
    false
  );
  IF actor_is_buyer = actor_is_seller THEN
    RAISE EXCEPTION 'Case resolution-mark participant authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  audit_id :=
    'case_resolution_mark_'
    || pg_catalog.md5(locked_case.id || ':' || locked_actor.id);

  -- A committed mark may be retried after the response or notification was
  -- lost. Reuse the exact source audit so Notification deduplication remains
  -- stable. During compatible coexistence, recover a legacy committed mark
  -- that predates this deterministic audit identity.
  IF (actor_is_buyer AND locked_case."buyerMarkedResolved")
     OR (actor_is_seller AND locked_case."sellerMarkedResolved") THEN
    SELECT
      audit.id,
      audit."adminId",
      audit.action,
      audit."targetType",
      audit."targetId",
      audit.reason,
      audit.metadata,
      audit.undone
      INTO existing_audit
      FROM public."AdminAuditLog" AS audit
     WHERE audit.id = audit_id
     FOR SHARE;

    IF FOUND THEN
      IF existing_audit."adminId" IS DISTINCT FROM locked_actor.id
         OR existing_audit.action IS DISTINCT FROM 'MARK_CASE_RESOLVED'
         OR existing_audit."targetType" IS DISTINCT FROM 'CASE'
         OR existing_audit."targetId" IS DISTINCT FROM locked_case.id
         OR existing_audit.reason IS NOT NULL
         OR existing_audit.undone
         OR pg_catalog.jsonb_typeof(existing_audit.metadata) <> 'object'
         OR (
           existing_audit.metadata
             - 'actorKind'
             - 'orderId'
             - 'status'
             - 'at'
         ) <> '{}'::jsonb
         OR existing_audit.metadata->>'actorKind' IS DISTINCT FROM 'user'
         OR existing_audit.metadata->>'orderId'
              IS DISTINCT FROM locked_order.id
         OR existing_audit.metadata->>'status' IS NULL
         OR existing_audit.metadata->>'status' NOT IN (
              'PENDING_CLOSE',
              'RESOLVED'
            )
         OR pg_catalog.btrim(
              COALESCE(existing_audit.metadata->>'at', '')
            ) = '' THEN
        RAISE EXCEPTION 'Case resolution-mark replay audit is invalid'
          USING ERRCODE = '23505';
      END IF;
      audit_status := existing_audit.metadata->>'status';
      result_action := 'replay';
    ELSE
      IF locked_case.status = 'PENDING_CLOSE'::public."CaseStatus" THEN
        audit_status := 'PENDING_CLOSE';
      ELSIF locked_case.status = 'RESOLVED'::public."CaseStatus"
            AND locked_case.resolution =
                  'DISMISSED'::public."CaseResolution"
            AND locked_case."buyerMarkedResolved"
            AND locked_case."sellerMarkedResolved"
            AND locked_case."refundAmountCents" IS NULL
            AND locked_case."stripeRefundId" IS NULL
            AND locked_case."resolvedAt" IS NOT NULL THEN
        audit_status := 'RESOLVED';
      ELSE
        RAISE EXCEPTION 'Case resolution-mark replay state is invalid'
          USING ERRCODE = '23514';
      END IF;

      transition_at := pg_catalog.timezone(
        'UTC',
        pg_catalog.clock_timestamp()
      );
      INSERT INTO public."AdminAuditLog" (
        id,
        "adminId",
        action,
        "targetType",
        "targetId",
        reason,
        metadata,
        undone,
        "createdAt"
      )
      VALUES (
        audit_id,
        locked_actor.id,
        'MARK_CASE_RESOLVED',
        'CASE',
        locked_case.id,
        NULL,
        pg_catalog.jsonb_build_object(
          'actorKind', 'user',
          'orderId', locked_order.id,
          'status', audit_status,
          'at', pg_catalog.to_char(
            transition_at,
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        false,
        transition_at
      );
      result_action := 'legacy_recovered';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'actorUserId', locked_actor.id,
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'status', audit_status,
      'buyerMarkedResolved', locked_case."buyerMarkedResolved",
      'sellerMarkedResolved', locked_case."sellerMarkedResolved",
      'auditLogId', audit_id,
      'action', result_action
    );
  END IF;

  IF locked_case.status NOT IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus"
     )
     OR locked_case.resolution IS NOT NULL
     OR locked_case."refundAmountCents" IS NOT NULL
     OR locked_case."stripeRefundId" IS NOT NULL
     OR locked_case."resolvedAt" IS NOT NULL
     OR locked_case."resolvedById" IS NOT NULL THEN
    RAISE EXCEPTION 'Case is not eligible for a resolution mark'
      USING ERRCODE = '23514';
  END IF;

  -- A staff dismissal claim may be active without a refund sentinel, while a
  -- refund claim or seller refund also sets sellerRefundId. Both leases must
  -- fence participant state changes.
  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."caseResolutionClaimId" IS NOT NULL THEN
    RAISE EXCEPTION 'Case resolution-mark conflicts with refund or staff state'
      USING ERRCODE = '23505';
  END IF;

  next_buyer_marked :=
    locked_case."buyerMarkedResolved" OR actor_is_buyer;
  next_seller_marked :=
    locked_case."sellerMarkedResolved" OR actor_is_seller;
  next_status := CASE
    WHEN next_buyer_marked AND next_seller_marked
      THEN 'RESOLVED'::public."CaseStatus"
    ELSE 'PENDING_CLOSE'::public."CaseStatus"
  END;
  transition_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  );

  UPDATE public."Case" AS case_row
     SET "buyerMarkedResolved" = next_buyer_marked,
         "sellerMarkedResolved" = next_seller_marked,
         status = next_status,
         resolution = CASE
           WHEN next_status = 'RESOLVED'::public."CaseStatus"
             THEN 'DISMISSED'::public."CaseResolution"
           ELSE NULL
         END,
         "resolvedAt" = CASE
           WHEN next_status = 'RESOLVED'::public."CaseStatus"
             THEN transition_at
           ELSE NULL
         END,
         "resolvedById" = CASE
           WHEN next_status = 'RESOLVED'::public."CaseStatus"
             THEN locked_actor.id
           ELSE NULL
         END,
         "updatedAt" = transition_at
   WHERE case_row.id = locked_case.id
     AND case_row."orderId" = locked_order.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark update lost its locked target'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public."AdminAuditLog" (
    id,
    "adminId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    undone,
    "createdAt"
  )
  VALUES (
    audit_id,
    locked_actor.id,
    'MARK_CASE_RESOLVED',
    'CASE',
    locked_case.id,
    NULL,
    pg_catalog.jsonb_build_object(
      'actorKind', 'user',
      'orderId', locked_order.id,
      'status', next_status::text,
      'at', pg_catalog.to_char(
        transition_at,
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    false,
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'actorUserId', locked_actor.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'status', next_status::text,
    'buyerMarkedResolved', next_buyer_marked,
    'sellerMarkedResolved', next_seller_marked,
    'auditLogId', audit_id,
    'action', 'updated'
  );
END
$grainline_case_mark_resolved$;

REVOKE ALL ON FUNCTION
  public.grainline_case_mark_resolved(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_mark_resolved(text, text)
  TO grainline_app_runtime;

COMMIT;
