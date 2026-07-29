-- Compatible fixed authority for interactive Case escalation and scheduled
-- Case transitions.
--
-- This migration does not enable Case-family RLS or revoke legacy table
-- grants. Old and new application deployments may coexist while the
-- application conversion and PostgreSQL proof are reviewed.

BEGIN;

-- Each fixed family scans only its due-state index. These partial indexes
-- avoid a full Case scan as resolved history grows and do not change table
-- visibility or write authority.
CREATE INDEX "Case_pendingCloseUpdatedAtId_idx"
  ON public."Case" ("updatedAt", id)
  WHERE status = 'PENDING_CLOSE'::public."CaseStatus";
CREATE INDEX "Case_openSellerRespondById_idx"
  ON public."Case" ("sellerRespondBy", id)
  WHERE status = 'OPEN'::public."CaseStatus";
CREATE INDEX "Case_discussionUpdatedAtId_idx"
  ON public."Case" ("updatedAt", id)
  WHERE status = 'IN_DISCUSSION'::public."CaseStatus";

CREATE OR REPLACE FUNCTION public.grainline_case_escalate(
  p_actor_user_id text,
  p_case_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_escalate$
DECLARE
  locked_actor record;
  source_case record;
  locked_order record;
  locked_case record;
  buyer_state record;
  seller_state record;
  existing_audit record;
  actor_is_buyer boolean;
  actor_is_seller boolean;
  actor_is_staff boolean;
  counterparty_unavailable boolean;
  transition_at timestamp(3);
  audit_id text;
  actor_kind text;
  result_action text := 'updated';
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191 THEN
    RAISE EXCEPTION 'Case-escalation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case-escalation actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- This unlocked lookup discovers the canonical lock targets only. Every
  -- authority and lifecycle predicate is repeated after User, Order and Case
  -- locks are held.
  SELECT
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId"
    INTO source_case
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-escalation Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  -- Account deletion and Case lifecycle mutations use the same
  -- User -> Order -> Case ordering. Lock the complete party set in stable
  -- order before either mutable lifecycle row.
  PERFORM 1
    FROM public."User" AS party
   WHERE party.id IN (
     locked_actor.id,
     source_case."buyerId",
     source_case."sellerId"
   )
   ORDER BY party.id
   FOR SHARE;

  SELECT
    orders.id,
    orders."sellerRefundId",
    orders."sellerRefundLockedAt",
    orders."caseResolutionClaimId"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_case."orderId"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-escalation Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."escalateUnlocksAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id
     AND case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_case."buyerId" IS DISTINCT FROM source_case."buyerId"
     OR locked_case."sellerId" IS DISTINCT FROM source_case."sellerId" THEN
    RAISE EXCEPTION 'Case-escalation relationship changed'
      USING ERRCODE = '40001';
  END IF;

  SELECT
    buyer.id,
    buyer.banned,
    buyer."deletedAt"
    INTO buyer_state
    FROM public."User" AS buyer
   WHERE buyer.id = locked_case."buyerId";
  SELECT
    seller.id,
    seller.banned,
    seller."deletedAt"
    INTO seller_state
    FROM public."User" AS seller
   WHERE seller.id = locked_case."sellerId";

  actor_is_buyer := COALESCE(
    locked_actor.id = locked_case."buyerId",
    false
  );
  actor_is_seller := COALESCE(
    locked_actor.id = locked_case."sellerId",
    false
  );
  actor_is_staff :=
    NOT actor_is_buyer
    AND NOT actor_is_seller
    AND locked_actor.role IN (
      'EMPLOYEE'::public."Role",
      'ADMIN'::public."Role"
    );
  IF NOT actor_is_buyer
     AND NOT actor_is_seller
     AND NOT actor_is_staff THEN
    RAISE EXCEPTION 'Case-escalation actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  actor_kind := CASE
    WHEN actor_is_staff THEN 'staff'
    ELSE 'user'
  END;
  audit_id :=
    'case_escalation_'
    || pg_catalog.encode(
         pg_catalog.sha256(
           pg_catalog.convert_to(
             pg_catalog.octet_length(locked_case.id)::text
             || ':' || locked_case.id
             || ':' || pg_catalog.octet_length(locked_actor.id)::text
             || ':' || locked_actor.id,
             'UTF8'
           )
         ),
         'hex'
       );

  -- Network retries after a committed transition return the exact original
  -- audit identity. Another actor cannot claim that replay.
  IF locked_case.status = 'UNDER_REVIEW'::public."CaseStatus" THEN
    IF actor_is_staff THEN
      SELECT
        audit.id,
        audit."actorType",
        audit."actorId",
        audit.action,
        audit."targetType",
        audit."targetId",
        audit.reason,
        audit.metadata
        INTO existing_audit
        FROM public."SystemAuditLog" AS audit
       WHERE audit.id = audit_id
       FOR SHARE;
      IF NOT FOUND
         OR existing_audit."actorType" IS DISTINCT FROM 'staff'
         OR existing_audit."actorId" IS DISTINCT FROM locked_actor.id
         OR existing_audit.action IS DISTINCT FROM 'ESCALATE_CASE'
         OR existing_audit."targetType" IS DISTINCT FROM 'CASE'
         OR existing_audit."targetId" IS DISTINCT FROM locked_case.id
         OR existing_audit.reason
              IS DISTINCT FROM 'Case manually escalated for review'
         OR existing_audit.metadata->>'actorKind'
              IS DISTINCT FROM 'staff'
         OR existing_audit.metadata->>'orderId'
              IS DISTINCT FROM locked_order.id
         OR existing_audit.metadata->>'previousStatus' IS NULL
         OR existing_audit.metadata->>'previousStatus'
              NOT IN ('OPEN', 'IN_DISCUSSION')
         OR existing_audit.metadata->>'newStatus'
              IS DISTINCT FROM 'UNDER_REVIEW' THEN
        RAISE EXCEPTION 'Case-escalation replay is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
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
      IF NOT FOUND
         OR existing_audit."adminId" IS DISTINCT FROM locked_actor.id
         OR existing_audit.action IS DISTINCT FROM 'ESCALATE_CASE'
         OR existing_audit."targetType" IS DISTINCT FROM 'CASE'
         OR existing_audit."targetId" IS DISTINCT FROM locked_case.id
         OR existing_audit.reason
              IS DISTINCT FROM 'Case manually escalated for review'
         OR existing_audit.undone
         OR existing_audit.metadata->>'actorKind'
              IS DISTINCT FROM 'user'
         OR existing_audit.metadata->>'orderId'
              IS DISTINCT FROM locked_order.id
         OR existing_audit.metadata->>'previousStatus' IS NULL
         OR existing_audit.metadata->>'previousStatus'
              NOT IN ('OPEN', 'IN_DISCUSSION')
         OR existing_audit.metadata->>'newStatus'
              IS DISTINCT FROM 'UNDER_REVIEW' THEN
        RAISE EXCEPTION 'Case-escalation replay is invalid'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'actorUserId', locked_actor.id,
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'previousStatus', existing_audit.metadata->>'previousStatus',
      'status', 'UNDER_REVIEW',
      'auditLogId', audit_id,
      'actorKind', actor_kind,
      'action', 'replay'
    );
  END IF;

  IF locked_case.status NOT IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus"
     ) THEN
    RAISE EXCEPTION 'Case is not eligible for escalation'
      USING ERRCODE = '23514';
  END IF;
  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR locked_order."caseResolutionClaimId" IS NOT NULL THEN
    RAISE EXCEPTION 'Case escalation conflicts with a refund or resolution'
      USING ERRCODE = '40001';
  END IF;

  transition_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  );
  IF NOT actor_is_staff THEN
    counterparty_unavailable := CASE
      WHEN actor_is_buyer THEN
        seller_state.id IS NULL
        OR seller_state.banned
        OR seller_state."deletedAt" IS NOT NULL
      ELSE
        buyer_state.id IS NULL
        OR buyer_state.banned
        OR buyer_state."deletedAt" IS NOT NULL
    END;
    IF NOT counterparty_unavailable
       AND (
         locked_case."escalateUnlocksAt" IS NULL
         OR locked_case."escalateUnlocksAt" > transition_at
       ) THEN
      RAISE EXCEPTION 'Case escalation is not yet available'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public."Case" AS case_row
     SET status = 'UNDER_REVIEW'::public."CaseStatus",
         "updatedAt" = transition_at
   WHERE case_row.id = locked_case.id;

  IF actor_is_staff THEN
    INSERT INTO public."SystemAuditLog" (
      id,
      "actorType",
      "actorId",
      action,
      "targetType",
      "targetId",
      reason,
      metadata,
      "createdAt"
    )
    VALUES (
      audit_id,
      'staff',
      locked_actor.id,
      'ESCALATE_CASE',
      'CASE',
      locked_case.id,
      'Case manually escalated for review',
      pg_catalog.jsonb_build_object(
        'actorKind', 'staff',
        'orderId', locked_order.id,
        'route', '/api/cases/[id]/escalate',
        'previousStatus', locked_case.status::text,
        'newStatus', 'UNDER_REVIEW',
        'at', pg_catalog.to_char(
          transition_at,
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      transition_at
    );
  ELSE
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
      'ESCALATE_CASE',
      'CASE',
      locked_case.id,
      'Case manually escalated for review',
      pg_catalog.jsonb_build_object(
        'actorKind', 'user',
        'orderId', locked_order.id,
        'route', '/api/cases/[id]/escalate',
        'previousStatus', locked_case.status::text,
        'newStatus', 'UNDER_REVIEW',
        'at', pg_catalog.to_char(
          transition_at,
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      false,
      transition_at
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'actorUserId', locked_actor.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'previousStatus', locked_case.status::text,
    'status', 'UNDER_REVIEW',
    'auditLogId', audit_id,
    'actorKind', actor_kind,
    'action', result_action
  );
END
$grainline_case_escalate$;

CREATE OR REPLACE FUNCTION public.grainline_case_cron_transition_batch(
  p_transition_family text,
  p_limit integer
)
RETURNS TABLE (
  "caseId" text,
  "orderId" text,
  "buyerUserId" text,
  "sellerUserId" text,
  "auditLogId" text,
  "previousStatus" text,
  "status" text,
  "notificationType" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_cron_transition_batch$
DECLARE
  candidate record;
  locked_order record;
  locked_case record;
  transition_at timestamp(3);
  transition_cutoff timestamp(3);
  target_status public."CaseStatus";
  target_resolution public."CaseResolution";
  target_notification_type public."NotificationType";
  audit_action text;
  audit_reason text;
  target_audit_id text;
BEGIN
  IF p_transition_family IS NULL
     OR p_transition_family NOT IN (
       'PENDING_CLOSE_EXPIRED',
       'OPEN_RESPONSE_DUE',
       'STALE_DISCUSSION'
     )
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'Case cron-transition input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION 'Case cron-transition requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  transition_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  );
  transition_cutoff := CASE p_transition_family
    WHEN 'PENDING_CLOSE_EXPIRED'
      THEN transition_at - INTERVAL '7 days'
    WHEN 'OPEN_RESPONSE_DUE'
      THEN transition_at
    ELSE transition_at - INTERVAL '30 days'
  END;

  FOR candidate IN
    SELECT
      due_case.id,
      due_case."orderId",
      due_case."buyerId",
      due_case."sellerId"
      FROM (
        SELECT
          case_row.id,
          case_row."orderId",
          case_row."buyerId",
          case_row."sellerId",
          case_row."updatedAt" AS due_at
          FROM public."Case" AS case_row
         WHERE p_transition_family = 'PENDING_CLOSE_EXPIRED'
           AND case_row.status = 'PENDING_CLOSE'::public."CaseStatus"
           AND case_row."updatedAt" < transition_cutoff
        UNION ALL
        SELECT
          case_row.id,
          case_row."orderId",
          case_row."buyerId",
          case_row."sellerId",
          case_row."sellerRespondBy" AS due_at
          FROM public."Case" AS case_row
         WHERE p_transition_family = 'OPEN_RESPONSE_DUE'
           AND case_row.status = 'OPEN'::public."CaseStatus"
           AND case_row."sellerRespondBy" < transition_cutoff
        UNION ALL
        SELECT
          case_row.id,
          case_row."orderId",
          case_row."buyerId",
          case_row."sellerId",
          case_row."updatedAt" AS due_at
          FROM public."Case" AS case_row
         WHERE p_transition_family = 'STALE_DISCUSSION'
           AND case_row.status = 'IN_DISCUSSION'::public."CaseStatus"
           AND case_row."updatedAt" < transition_cutoff
      ) AS due_case
     ORDER BY due_case.due_at, due_case.id
     LIMIT p_limit
  LOOP
    -- Lock both recipients before mutable lifecycle rows. These shared locks
    -- participate in account-deletion and Notification block ordering.
    PERFORM 1
      FROM public."User" AS party
     WHERE party.id IN (candidate."buyerId", candidate."sellerId")
     ORDER BY party.id
     FOR SHARE;

    SELECT
      orders.id,
      orders."sellerRefundId",
      orders."sellerRefundLockedAt",
      orders."caseResolutionClaimId"
      INTO locked_order
      FROM public."Order" AS orders
     WHERE orders.id = candidate."orderId"
     FOR UPDATE SKIP LOCKED;
    IF NOT FOUND
       OR locked_order."sellerRefundId" IS NOT NULL
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR locked_order."caseResolutionClaimId" IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT
      case_row.id,
      case_row."orderId",
      case_row."buyerId",
      case_row."sellerId",
      case_row.status,
      case_row."sellerRespondBy",
      case_row."updatedAt"
      INTO locked_case
      FROM public."Case" AS case_row
     WHERE case_row.id = candidate.id
       AND case_row."orderId" = locked_order.id
     FOR UPDATE SKIP LOCKED;
    IF NOT FOUND
       OR locked_case."buyerId" IS DISTINCT FROM candidate."buyerId"
       OR locked_case."sellerId" IS DISTINCT FROM candidate."sellerId" THEN
      CONTINUE;
    END IF;

    IF p_transition_family = 'PENDING_CLOSE_EXPIRED' THEN
      IF locked_case.status
           <> 'PENDING_CLOSE'::public."CaseStatus"
         OR locked_case."updatedAt" >= transition_cutoff THEN
        CONTINUE;
      END IF;
      target_status := 'RESOLVED'::public."CaseStatus";
      target_resolution := 'DISMISSED'::public."CaseResolution";
      target_notification_type :=
        'CASE_RESOLVED'::public."NotificationType";
      audit_action := 'AUTO_CLOSE_CASE';
      audit_reason := 'Resolution window expired';
    ELSIF p_transition_family = 'OPEN_RESPONSE_DUE' THEN
      IF locked_case.status <> 'OPEN'::public."CaseStatus"
         OR locked_case."sellerRespondBy" >= transition_cutoff THEN
        CONTINUE;
      END IF;
      target_status := 'UNDER_REVIEW'::public."CaseStatus";
      target_resolution := NULL;
      target_notification_type := 'CASE_MESSAGE'::public."NotificationType";
      audit_action := 'AUTO_ESCALATE_CASE';
      audit_reason := 'Seller response window expired';
    ELSE
      IF locked_case.status
           <> 'IN_DISCUSSION'::public."CaseStatus"
         OR locked_case."updatedAt" >= transition_cutoff THEN
        CONTINUE;
      END IF;
      target_status := 'UNDER_REVIEW'::public."CaseStatus";
      target_resolution := NULL;
      target_notification_type := 'CASE_MESSAGE'::public."NotificationType";
      audit_action := 'AUTO_ESCALATE_CASE';
      audit_reason := 'Discussion inactivity window expired';
    END IF;

    IF target_status = 'RESOLVED'::public."CaseStatus" THEN
      UPDATE public."Case" AS case_row
         SET status = target_status,
             resolution = target_resolution,
             "resolvedAt" = transition_at,
             "updatedAt" = transition_at
       WHERE case_row.id = locked_case.id;
    ELSE
      UPDATE public."Case" AS case_row
         SET status = target_status,
             "updatedAt" = transition_at
       WHERE case_row.id = locked_case.id;
    END IF;

    target_audit_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."SystemAuditLog" (
      id,
      "actorType",
      "actorId",
      action,
      "targetType",
      "targetId",
      reason,
      metadata,
      "createdAt"
    )
    VALUES (
      target_audit_id,
      'cron',
      'case-auto-close',
      audit_action,
      'CASE',
      locked_case.id,
      audit_reason,
      pg_catalog.jsonb_build_object(
        'jobName', 'case-auto-close',
        'transitionFamily', p_transition_family,
        'previousStatus', locked_case.status::text,
        'newStatus', target_status::text,
        'orderId', locked_order.id,
        'cutoff', pg_catalog.to_char(
          transition_cutoff,
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'transitionedAt', pg_catalog.to_char(
          transition_at,
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      transition_at
    );

    -- Notification creation is part of the same transaction as the Case and
    -- audit transition. The application replays these exact durable sources
    -- after commit for compatibility; the Notification dedup key makes that
    -- replay idempotent.
    IF locked_case."buyerId" IS NOT NULL THEN
      PERFORM public.grainline_notification_create_case_event(
        pg_catalog.gen_random_uuid()::text,
        locked_case."buyerId",
        target_notification_type,
        'case_system_action',
        target_audit_id,
        NULL
      );
    END IF;
    PERFORM public.grainline_notification_create_case_event(
      pg_catalog.gen_random_uuid()::text,
      locked_case."sellerId",
      target_notification_type,
      'case_system_action',
      target_audit_id,
      NULL
    );

    "caseId" := locked_case.id;
    "orderId" := locked_order.id;
    "buyerUserId" := locked_case."buyerId";
    "sellerUserId" := locked_case."sellerId";
    "auditLogId" := target_audit_id;
    "previousStatus" := locked_case.status::text;
    status := target_status::text;
    "notificationType" := target_notification_type::text;
    RETURN NEXT;
  END LOOP;
END
$grainline_case_cron_transition_batch$;

REVOKE ALL ON FUNCTION
  public.grainline_case_escalate(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_escalate(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_cron_transition_batch(text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_cron_transition_batch(text, integer)
  TO grainline_app_runtime;

COMMIT;
