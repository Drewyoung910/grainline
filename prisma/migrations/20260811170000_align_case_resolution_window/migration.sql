BEGIN;

-- A seller may propose that a Case is resolved, but seller silence cannot close
-- the buyer's dispute. Only a buyer-initiated PENDING_CLOSE window is eligible
-- for the seven-day automatic DISMISSED transition. Seller-initiated rows stay
-- visible to the buyer and staff until the buyer confirms or sends a reply.
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
           AND case_row."buyerMarkedResolved" = true
           AND case_row."sellerMarkedResolved" = false
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
      case_row."buyerMarkedResolved",
      case_row."sellerMarkedResolved",
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
         OR locked_case."buyerMarkedResolved" IS DISTINCT FROM true
         OR locked_case."sellerMarkedResolved" IS DISTINCT FROM false
         OR locked_case."updatedAt" >= transition_cutoff THEN
        CONTINUE;
      END IF;
      target_status := 'RESOLVED'::public."CaseStatus";
      target_resolution := 'DISMISSED'::public."CaseResolution";
      target_notification_type :=
        'CASE_RESOLVED'::public."NotificationType";
      audit_action := 'AUTO_CLOSE_CASE';
      audit_reason := 'Buyer resolution window expired';
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
        'resolutionInitiator', CASE
          WHEN p_transition_family = 'PENDING_CLOSE_EXPIRED'
            THEN 'buyer'
          ELSE NULL
        END,
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
  public.grainline_case_cron_transition_batch(text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_cron_transition_batch(text, integer)
  TO grainline_app_runtime;

COMMIT;
