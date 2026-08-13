BEGIN;

-- Participant resolution marks are repeatable lifecycle events, not a single
-- permanent event per actor and Case. The original authority used one
-- deterministic audit ID for (Case, actor), so a reply could clear the marks
-- but the same participant's next legitimate mark collided with the retained
-- audit row. Keep legacy IDs replayable, but derive a fresh unguessable suffix
-- inside PostgreSQL for every new mark cycle.
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
  audit_id_prefix text;
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

  SELECT actor.id, actor.banned, actor."deletedAt"
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
    case_row."resolvedById",
    case_row."updatedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id
     AND case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark Case changed Order'
      USING ERRCODE = '40001';
  END IF;

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

  audit_id_prefix :=
    'case_resolution_mark_'
    || pg_catalog.md5(locked_case.id || ':' || locked_actor.id);

  -- A committed mark may be retried after its response was lost. Reuse the
  -- newest valid source for the actor's currently active mark. A prior cycle
  -- cannot reach this branch because a participant reply atomically clears
  -- both marks before a new cycle begins.
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
     WHERE audit."adminId" = locked_actor.id
       AND audit.action = 'MARK_CASE_RESOLVED'
       AND audit."targetType" = 'CASE'
       AND audit."targetId" = locked_case.id
       AND (
         audit.id = audit_id_prefix
         OR locked_case.status = 'RESOLVED'::public."CaseStatus"
         OR audit.metadata->>'at' = pg_catalog.to_char(
           locked_case."updatedAt",
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
         )
       )
       AND (
         audit.id = audit_id_prefix
         OR (
           pg_catalog.left(
             audit.id,
             pg_catalog.char_length(audit_id_prefix) + 1
           ) = audit_id_prefix || ':'
           AND pg_catalog.substring(
             audit.id,
             pg_catalog.char_length(audit_id_prefix) + 2
           ) ~ '^[0-9a-f]{32}$'
         )
       )
     ORDER BY audit."createdAt" DESC, audit.id DESC
     LIMIT 1
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
      audit_id := existing_audit.id;
      audit_status := existing_audit.metadata->>'status';
      result_action := 'replay';
    ELSE
      IF locked_case.status <> 'RESOLVED'::public."CaseStatus"
         AND EXISTS (
           SELECT 1
             FROM public."AdminAuditLog" AS prior_audit
            WHERE prior_audit."adminId" = locked_actor.id
              AND prior_audit.action = 'MARK_CASE_RESOLVED'
              AND prior_audit."targetType" = 'CASE'
              AND prior_audit."targetId" = locked_case.id
              AND (
                prior_audit.id = audit_id_prefix
                OR pg_catalog.left(
                  prior_audit.id,
                  pg_catalog.char_length(audit_id_prefix) + 1
                ) = audit_id_prefix || ':'
              )
         ) THEN
        RAISE EXCEPTION 'Case resolution-mark replay audit is invalid'
          USING ERRCODE = '23505';
      END IF;
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
      audit_id := audit_id_prefix || ':' || pg_catalog.to_char(
        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
        'YYYYMMDDHH24MISSUS'
      ) || pg_catalog.left(
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        12
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
  audit_id := audit_id_prefix || ':' || pg_catalog.to_char(
    pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
    'YYYYMMDDHH24MISSUS'
  ) || pg_catalog.left(
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    12
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
