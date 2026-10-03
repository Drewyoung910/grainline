-- Preserve non-address shipment evidence through a conservative dispute-response
-- window while continuing to minimize buyer address/contact data after 90 days.
-- The function signature, runtime grant, table grants, and RLS posture stay fixed.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.shipping-dispute-evidence-retention',
    0
  )
);

DO $grainline_order_shipping_evidence_preflight$
DECLARE
  function_oid oid;
  actual_hash text;
BEGIN
  function_oid := pg_catalog.to_regprocedure(
    'public.grainline_order_buyer_pii_prune_batch(integer)'
  );
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'Order buyer-PII prune predecessor function is missing';
  END IF;

  SELECT pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(routine.prosrc, 'UTF8')
           ),
           'hex'
         )
    INTO actual_hash
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = function_oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proparallel = 'u'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

  IF actual_hash IS DISTINCT FROM
       '148d3a7041af2b92f159ece8c8be3999bc4906b47f578231990322d8dc456e0b'
     OR pg_catalog.has_function_privilege(
          'grainline_app_runtime', function_oid, 'EXECUTE'
        ) IS DISTINCT FROM true
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(
                COALESCE(
                  routine.proacl,
                  pg_catalog.acldefault('f', routine.proowner)
                )
              ) AS acl
        WHERE routine.oid = function_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Order buyer-PII prune predecessor function drifted';
  END IF;
END
$grainline_order_shipping_evidence_preflight$;

DO $grainline_order_shipping_evidence_related_preflight$
DECLARE
  blocker_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_account_deletion_blockers(text)'
  );
  reviewed_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_staff_mark_reviewed(text,text)'
  );
  blocker_hash text;
  reviewed_hash text;
BEGIN
  SELECT pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
           'hex'
         )
    INTO blocker_hash
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = blocker_oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proparallel = 'u'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];
  SELECT pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
           'hex'
         )
    INTO reviewed_hash
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = reviewed_oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proparallel = 'u'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

  IF blocker_oid IS NULL
     OR blocker_hash IS DISTINCT FROM
       '115fbe5b54f5bc31426ee7925018c6c9d3f9ced9ab300069f37d49d848c63255'
     OR pg_catalog.has_function_privilege(
          'grainline_app_runtime', blocker_oid, 'EXECUTE'
        ) IS DISTINCT FROM true
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(COALESCE(
                routine.proacl,
                pg_catalog.acldefault('f', routine.proowner)
              )) AS acl
        WHERE routine.oid = blocker_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Order account-deletion blocker predecessor drifted';
  END IF;
  IF reviewed_oid IS NULL
     OR reviewed_hash IS DISTINCT FROM
       '86b2fcac89439b5b17789e58bebab33ea5c718bf51fb8be5964d94a2317c2c2f'
     OR pg_catalog.has_function_privilege(
          'grainline_staff_read_runtime', reviewed_oid, 'EXECUTE'
        ) IS DISTINCT FROM true
     OR pg_catalog.has_function_privilege(
          'grainline_app_runtime', reviewed_oid, 'EXECUTE'
        ) IS DISTINCT FROM false
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(COALESCE(
                routine.proacl,
                pg_catalog.acldefault('f', routine.proowner)
              )) AS acl
        WHERE routine.oid = reviewed_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Order staff mark-reviewed predecessor drifted';
  END IF;
END
$grainline_order_shipping_evidence_related_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_order_buyer_pii_prune_batch(
  p_batch_size integer
)
RETURNS TABLE (
  purged bigint,
  cutoff timestamp without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_pii_prune_batch$
DECLARE
  fixed_cutoff timestamp(3) without time zone;
  shipping_evidence_cutoff timestamp(3) without time zone;
  purged_count bigint;
BEGIN
  IF p_batch_size IS NULL
     OR p_batch_size < 1
     OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Order buyer-PII prune batch size is invalid'
      USING ERRCODE = '22023';
  END IF;

  fixed_cutoff :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
    - INTERVAL '90 days';
  shipping_evidence_cutoff :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
    - INTERVAL '180 days';

  WITH prune_candidates AS MATERIALIZED (
    SELECT
      order_row.id,
      due.pii_due,
      due.shipping_evidence_due
    FROM public."Order" AS order_row
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(
          order_row."deliveredAt",
          order_row."pickedUpAt"
        ) < fixed_cutoff
        AND (
          order_row."buyerEmail" IS NOT NULL OR
          order_row."buyerName" IS NOT NULL OR
          order_row."shipToLine1" IS NOT NULL OR
          order_row."shipToLine2" IS NOT NULL OR
          order_row."shipToCity" IS NOT NULL OR
          order_row."shipToState" IS NOT NULL OR
          order_row."shipToPostalCode" IS NOT NULL OR
          order_row."shipToCountry" IS NOT NULL OR
          order_row."quotedToLine1" IS NOT NULL OR
          order_row."quotedToLine2" IS NOT NULL OR
          order_row."quotedToCity" IS NOT NULL OR
          order_row."quotedToState" IS NOT NULL OR
          order_row."quotedToPostalCode" IS NOT NULL OR
          order_row."quotedToCountry" IS NOT NULL OR
          order_row."quotedToName" IS NOT NULL OR
          order_row."quotedToPhone" IS NOT NULL OR
          order_row."sellerNotes" IS NOT NULL OR
          order_row."giftNote" IS NOT NULL OR
          EXISTS (
            SELECT 1
              FROM public."OrderShippingRateQuote" AS quote
             WHERE quote."orderId" = order_row.id
          )
        ) AS pii_due,
        GREATEST(
          COALESCE(order_row."deliveredAt", order_row."pickedUpAt"),
          order_row."paidAt",
          order_row."estimatedDeliveryDate"
        ) < shipping_evidence_cutoff
        AND order_row."labelClawbackStatus" IS DISTINCT FROM 'MANUAL_REVIEW'
        AND NOT EXISTS (
          SELECT 1
            FROM public."OrderDisputeRecovery" AS recovery
           WHERE recovery."orderId" = order_row.id
             AND recovery.status IN (
               'REVERSAL_PENDING'::public."OrderDisputeRecoveryStatus",
               'REVERSING'::public."OrderDisputeRecoveryStatus",
               'RESTORE_PENDING'::public."OrderDisputeRecoveryStatus",
               'RESTORING'::public."OrderDisputeRecoveryStatus",
               'MANUAL_REVIEW'::public."OrderDisputeRecoveryStatus"
             )
        )
        AND (
          order_row."trackingCarrier" IS NOT NULL OR
          order_row."trackingNumber" IS NOT NULL OR
          order_row."shippoShipmentId" IS NOT NULL OR
          order_row."shippoRateObjectId" IS NOT NULL OR
          order_row."shippoTransactionId" IS NOT NULL OR
          order_row."labelUrl" IS NOT NULL OR
          order_row."labelCarrier" IS NOT NULL OR
          order_row."labelTrackingNumber" IS NOT NULL
        ) AS shipping_evidence_due
    ) AS due
   WHERE order_row."reviewNeeded" = false
     AND order_row."paymentOpenDisputeBlocked" = false
     AND order_row."fulfillmentStatus" IN (
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     )
     AND COALESCE(
       order_row."deliveredAt",
       order_row."pickedUpAt"
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."Case" AS case_row
        WHERE case_row."orderId" = order_row.id
          AND case_row.status IN (
            'OPEN'::public."CaseStatus",
            'IN_DISCUSSION'::public."CaseStatus",
            'PENDING_CLOSE'::public."CaseStatus",
            'UNDER_REVIEW'::public."CaseStatus"
          )
     )
     AND (due.pii_due OR due.shipping_evidence_due)
   ORDER BY
     COALESCE(order_row."deliveredAt", order_row."pickedUpAt") ASC,
     order_row.id ASC
   FOR UPDATE OF order_row SKIP LOCKED
   LIMIT p_batch_size
  ),
  deleted_quotes AS (
    DELETE FROM public."OrderShippingRateQuote" AS quote
     USING prune_candidates
     WHERE prune_candidates.pii_due
       AND quote."orderId" = prune_candidates.id
     RETURNING quote.id
  ),
  updated_orders AS (
    UPDATE public."Order" AS order_row
       SET
         "buyerEmail" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."buyerEmail"
         END,
         "buyerName" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."buyerName"
         END,
         "shipToLine1" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."shipToLine1"
         END,
         "shipToLine2" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."shipToLine2"
         END,
         "shipToCity" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."shipToCity"
         END,
         "shipToState" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."shipToState"
         END,
         "shipToPostalCode" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."shipToPostalCode"
         END,
         "shipToCountry" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."shipToCountry"
         END,
         "quotedToLine1" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToLine1"
         END,
         "quotedToLine2" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToLine2"
         END,
         "quotedToCity" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToCity"
         END,
         "quotedToState" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToState"
         END,
         "quotedToPostalCode" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToPostalCode"
         END,
         "quotedToCountry" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToCountry"
         END,
         "quotedToName" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToName"
         END,
         "quotedToPhone" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."quotedToPhone"
         END,
         "sellerNotes" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."sellerNotes"
         END,
         "giftNote" = CASE
           WHEN prune_candidates.pii_due THEN NULL
           ELSE order_row."giftNote"
         END,
         "trackingCarrier" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."trackingCarrier"
         END,
         "trackingNumber" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."trackingNumber"
         END,
         "shippoShipmentId" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."shippoShipmentId"
         END,
         "shippoRateObjectId" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."shippoRateObjectId"
         END,
         "shippoTransactionId" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."shippoTransactionId"
         END,
         "labelUrl" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."labelUrl"
         END,
         "labelCarrier" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."labelCarrier"
         END,
         "labelTrackingNumber" = CASE
           WHEN prune_candidates.shipping_evidence_due THEN NULL
           ELSE order_row."labelTrackingNumber"
         END,
         "buyerDataPurgedAt" = CASE
           WHEN prune_candidates.pii_due THEN COALESCE(
             order_row."buyerDataPurgedAt",
             pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
           )
           ELSE order_row."buyerDataPurgedAt"
         END
      FROM prune_candidates
     WHERE order_row.id = prune_candidates.id
     RETURNING order_row.id
  )
  SELECT pg_catalog.count(*)::bigint
    INTO purged_count
    FROM updated_orders;

  RETURN QUERY SELECT purged_count, fixed_cutoff;
END
$grainline_order_buyer_pii_prune_batch$;

CREATE OR REPLACE FUNCTION public.grainline_order_account_deletion_blockers(
  p_actor_user_id text
)
RETURNS TABLE(
  buyer_order_count bigint,
  seller_order_count bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_account_deletion_blockers$
DECLARE
  session_actor_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_seller_profile_id text;
  terminal_cutoff timestamp(3) without time zone;
  shipping_evidence_cutoff timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     THEN
    RAISE EXCEPTION 'Order account-deletion blocker input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF session_actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Order account-deletion actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order account-deletion actor is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_actor_user_id;

  terminal_cutoff := (
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone - INTERVAL '30 days';
  shipping_evidence_cutoff := (
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone - INTERVAL '180 days';

  RETURN QUERY
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE source_order."buyerId" = p_actor_user_id
    )::bigint AS buyer_order_count,
    pg_catalog.count(*) FILTER (
      WHERE source_seller_profile_id IS NOT NULL
        AND source_order."sellerProfileId" = source_seller_profile_id
    )::bigint AS seller_order_count
    FROM public."Order" AS source_order
   WHERE (
          source_order."buyerId" = p_actor_user_id
          OR (
            source_seller_profile_id IS NOT NULL
            AND source_order."sellerProfileId" = source_seller_profile_id
          )
        )
     AND (
       (
         (
           source_order."fulfillmentStatus" IN (
             'PENDING'::public."FulfillmentStatus",
             'READY_FOR_PICKUP'::public."FulfillmentStatus",
             'SHIPPED'::public."FulfillmentStatus"
           )
           OR (
             source_order."fulfillmentStatus" = 'DELIVERED'::public."FulfillmentStatus"
             AND (
               source_order."deliveredAt" IS NULL
               OR source_order."deliveredAt" >= terminal_cutoff
             )
           )
           OR (
             source_order."fulfillmentStatus" = 'PICKED_UP'::public."FulfillmentStatus"
             AND (
               source_order."pickedUpAt" IS NULL
               OR source_order."pickedUpAt" >= terminal_cutoff
             )
           )
         )
         AND NOT (
           source_order."sellerRefundId" IS NOT NULL
           AND source_order."sellerRefundId" <> 'pending'
           AND COALESCE(source_order."sellerRefundAmountCents", 0) > 0
           AND COALESCE(source_order."sellerRefundAmountCents", 0) >=
             COALESCE(
               source_order."chargedTotalCents",
               COALESCE(source_order."itemsSubtotalCents", 0)
                 + COALESCE(source_order."shippingAmountCents", 0)
                 + COALESCE(source_order."giftWrappingPriceCents", 0)
                 + COALESCE(source_order."taxAmountCents", 0)
             )
         )
       )
       OR (
         (
           source_order."trackingCarrier" IS NOT NULL OR
           source_order."trackingNumber" IS NOT NULL OR
           source_order."shippoShipmentId" IS NOT NULL OR
           source_order."shippoRateObjectId" IS NOT NULL OR
           source_order."shippoTransactionId" IS NOT NULL OR
           source_order."labelUrl" IS NOT NULL OR
           source_order."labelCarrier" IS NOT NULL OR
           source_order."labelTrackingNumber" IS NOT NULL
         )
         AND (
           GREATEST(
             COALESCE(source_order."deliveredAt", source_order."pickedUpAt"),
             source_order."paidAt",
             source_order."estimatedDeliveryDate"
           ) >= shipping_evidence_cutoff
           OR source_order."paymentOpenDisputeBlocked"
           OR source_order."reviewNeeded"
           OR source_order."labelClawbackStatus" = 'MANUAL_REVIEW'
           OR EXISTS (
             SELECT 1
               FROM public."Case" AS source_case
              WHERE source_case."orderId" = source_order.id
                AND source_case.status IN (
                  'OPEN'::public."CaseStatus",
                  'IN_DISCUSSION'::public."CaseStatus",
                  'PENDING_CLOSE'::public."CaseStatus",
                  'UNDER_REVIEW'::public."CaseStatus"
                )
           )
           OR EXISTS (
             SELECT 1
               FROM public."OrderDisputeRecovery" AS recovery
              WHERE recovery."orderId" = source_order.id
                AND recovery.status IN (
                  'REVERSAL_PENDING'::public."OrderDisputeRecoveryStatus",
                  'REVERSING'::public."OrderDisputeRecoveryStatus",
                  'RESTORE_PENDING'::public."OrderDisputeRecoveryStatus",
                  'RESTORING'::public."OrderDisputeRecoveryStatus",
                  'MANUAL_REVIEW'::public."OrderDisputeRecoveryStatus"
                )
           )
         )
       )
     );
END
$grainline_order_account_deletion_blockers$;

CREATE OR REPLACE FUNCTION public.grainline_order_staff_mark_reviewed(
  p_actor_user_id text,
  p_order_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_mark_reviewed$
DECLARE
  locked_order public."Order"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Staff Order mark-reviewed input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Staff Order mutation requires isolated staff session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_user_id
       AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff Order mutation requires active staff'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT source_order.* INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."reviewNeeded" = false
     OR locked_order."labelClawbackStatus" IN (
       'RETRY_PENDING', 'RETRYING', 'MANUAL_REVIEW'
     ) THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public."Order" SET "reviewNeeded" = false WHERE id = locked_order.id;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata, undone, "createdAt"
  ) VALUES (
    'order-staff-reviewed:' || pg_catalog.gen_random_uuid()::text,
    p_actor_user_id, 'MARK_ORDER_REVIEWED', 'ORDER', locked_order.id,
    '{}'::jsonb, false, source_now
  );
  RETURN 'updated';
END
$grainline_order_staff_mark_reviewed$;

REVOKE ALL ON FUNCTION
  public.grainline_order_buyer_pii_prune_batch(integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_buyer_pii_prune_batch(integer)
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_order_buyer_pii_prune_batch(integer) IS
  'Fixed batch authority: buyer address/contact data at 90 days; non-address shipment evidence at 180 days after the latest payment/delivery reference, with dispute, provider-recovery, Case, review, and manual label-reconciliation holds.';

DO $grainline_order_shipping_evidence_postflight$
DECLARE
  function_oid oid;
  actual_hash text;
BEGIN
  function_oid := pg_catalog.to_regprocedure(
    'public.grainline_order_buyer_pii_prune_batch(integer)'
  );
  SELECT pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(routine.prosrc, 'UTF8')
           ),
           'hex'
         )
    INTO actual_hash
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = function_oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proparallel = 'u'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.strpos(pg_catalog.upper(routine.prosrc), 'EXECUTE') = 0;

  IF function_oid IS NULL
     OR actual_hash IS DISTINCT FROM
       '26fa4de85784ae8b1fb4b509004be06768c879dbd5e3b459dac5a858edd12a08'
     OR pg_catalog.has_function_privilege(
          'grainline_app_runtime', function_oid, 'EXECUTE'
        ) IS DISTINCT FROM true
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(
                COALESCE(
                  routine.proacl,
                  pg_catalog.acldefault('f', routine.proowner)
                )
              ) AS acl
        WHERE routine.oid = function_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Order shipping-evidence retention function drifted';
  END IF;
END
$grainline_order_shipping_evidence_postflight$;

DO $grainline_order_shipping_evidence_related_postflight$
DECLARE
  blocker_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_account_deletion_blockers(text)'
  );
  reviewed_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_staff_mark_reviewed(text,text)'
  );
  blocker_hash text;
  reviewed_hash text;
BEGIN
  SELECT pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
           'hex'
         )
    INTO blocker_hash
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = blocker_oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proparallel = 'u'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.strpos(pg_catalog.upper(routine.prosrc), 'EXECUTE') = 0;
  SELECT pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
           'hex'
         )
    INTO reviewed_hash
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = reviewed_oid
     AND routine.prosecdef
     AND routine.provolatile = 'v'
     AND routine.proparallel = 'u'
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.strpos(pg_catalog.upper(routine.prosrc), 'EXECUTE') = 0;

  IF blocker_oid IS NULL
     OR blocker_hash IS DISTINCT FROM
       '4f91bdb5df181632a3b72766987279fae04319b325f10a0ee332adb1ec05f483'
     OR pg_catalog.has_function_privilege(
          'grainline_app_runtime', blocker_oid, 'EXECUTE'
        ) IS DISTINCT FROM true
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(COALESCE(
                routine.proacl,
                pg_catalog.acldefault('f', routine.proowner)
              )) AS acl
        WHERE routine.oid = blocker_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Order account-deletion blocker successor drifted';
  END IF;
  IF reviewed_oid IS NULL
     OR reviewed_hash IS DISTINCT FROM
       '84195010343f715d2568edcff1c0ccf2ff40a98de0991088089df2269510eda1'
     OR pg_catalog.has_function_privilege(
          'grainline_staff_read_runtime', reviewed_oid, 'EXECUTE'
        ) IS DISTINCT FROM true
     OR pg_catalog.has_function_privilege(
          'grainline_app_runtime', reviewed_oid, 'EXECUTE'
        ) IS DISTINCT FROM false
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(COALESCE(
                routine.proacl,
                pg_catalog.acldefault('f', routine.proowner)
              )) AS acl
        WHERE routine.oid = reviewed_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Order staff mark-reviewed successor drifted';
  END IF;
END
$grainline_order_shipping_evidence_related_postflight$;

COMMIT;
