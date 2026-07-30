-- Durable Case, CaseMessage and CaseMessageAttachment invariants.
-- RLS, policies and table-grant changes remain intentionally absent.
--
-- Durable row-shape and source-binding invariants for the tightly coupled
-- Case, CaseMessage and CaseMessageAttachment group. RLS and grant changes
-- are intentionally absent. The compatible application must populate the
-- Stripe dispute source before this draft can be promoted.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.case.rls.activation', 0)
);

-- Freeze the three protected targets before inspecting legacy rows. Trigger
-- functions enforce only writes that occur after they are installed; without
-- this lock, an old compatible runtime could commit a trigger-only anomaly
-- between the preflight SELECTs and trigger creation.
LOCK TABLE
  public."Case",
  public."CaseMessage",
  public."CaseMessageAttachment"
IN SHARE ROW EXCLUSIVE MODE;

-- The compatible preparation migration already adds the nullable
-- Case.openedByPaymentEventId source and its exact same-Order foreign key.
-- This draft adds only the later strict lifecycle and relationship invariants.

DO $grainline_case_invariant_preflight$
BEGIN
  IF EXISTS (
    WITH order_seller_summary AS (
      SELECT
        orders.id AS order_id,
        orders."buyerId" AS order_buyer_id,
        pg_catalog.count(DISTINCT seller."userId") FILTER (
          WHERE seller."userId" IS NOT NULL
        )::integer AS seller_count,
        pg_catalog.min(seller."userId") AS only_seller_id
        FROM public."Order" AS orders
        LEFT JOIN public."OrderItem" AS item
          ON item."orderId" = orders.id
        LEFT JOIN public."Listing" AS listing
          ON listing.id = item."listingId"
        LEFT JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       GROUP BY orders.id, orders."buyerId"
    )
    SELECT 1
      FROM public."Case" AS case_row
      LEFT JOIN order_seller_summary AS summary
        ON summary.order_id = case_row."orderId"
     WHERE summary.order_id IS NULL
        OR (
          case_row."buyerId" IS NOT NULL
          AND case_row."buyerId"
                IS DISTINCT FROM summary.order_buyer_id
        )
        OR summary.seller_count IS DISTINCT FROM 1
        OR case_row."sellerId"
             IS DISTINCT FROM summary.only_seller_id
  ) THEN
    RAISE EXCEPTION 'Case relationship preflight found incompatible rows';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Case" AS case_row
     WHERE case_row."openedByPaymentEventId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderPaymentEvent" AS event
          WHERE event.id = case_row."openedByPaymentEventId"
            AND event."orderId" = case_row."orderId"
            AND event."eventType" = 'DISPUTE'
            AND event."stripeObjectType" = 'dispute'
            AND event."stripeObjectId" IS NOT NULL
            AND pg_catalog.btrim(event."stripeObjectId") <> ''
            AND event."stripeEventId" IS NOT NULL
            AND pg_catalog.btrim(event."stripeEventId") <> ''
            AND pg_catalog.jsonb_typeof(event.metadata) = 'object'
            AND event.metadata->>'stripeEventType'
                  = 'charge.dispute.created'
            AND event.metadata->>'chargeId' = (
              SELECT orders."stripeChargeId"
                FROM public."Order" AS orders
               WHERE orders.id = case_row."orderId"
            )
            AND event.metadata->>'disputeId'
                  = event."stripeObjectId"
            AND event.metadata->>'stripeEventCreated'
                  ~ '^[0-9]{1,12}$'
            AND pg_catalog.lower(COALESCE(event.status, '')) NOT IN (
              'won',
              'lost',
              'prevented',
              'warning_closed'
            )
            AND event.currency ~ '^[a-z]{3}$'
            AND case_row.reason = 'OTHER'::public."CaseReason"
       )
  ) THEN
    RAISE EXCEPTION 'Case opening-source preflight found incompatible rows';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Case" AS case_row
     WHERE (
       case_row."buyerId" IS NOT NULL
       AND case_row."buyerId" = case_row."sellerId"
     )
     OR case_row."createdAt" > case_row."updatedAt"
     OR case_row."sellerRespondBy" < case_row."createdAt"
     OR (
       (case_row."discussionStartedAt" IS NULL)
       <> (case_row."escalateUnlocksAt" IS NULL)
     )
     OR (
       case_row."discussionStartedAt" IS NOT NULL
       AND (
         case_row."discussionStartedAt" < case_row."createdAt"
         OR case_row."escalateUnlocksAt" <
            case_row."discussionStartedAt"
       )
     )
     OR (
       case_row.status NOT IN (
         'RESOLVED'::public."CaseStatus",
         'CLOSED'::public."CaseStatus"
       )
       AND (
         case_row.resolution IS NOT NULL
         OR case_row."refundAmountCents" IS NOT NULL
         OR case_row."stripeRefundId" IS NOT NULL
         OR case_row."resolvedAt" IS NOT NULL
         OR case_row."resolvedById" IS NOT NULL
       )
     )
     OR (
       case_row.status IN (
         'RESOLVED'::public."CaseStatus",
         'CLOSED'::public."CaseStatus"
       )
       AND (
         case_row.resolution IS NULL
         OR case_row."resolvedAt" IS NULL
       )
     )
     OR (
       case_row.resolution = 'DISMISSED'::public."CaseResolution"
       AND (
         case_row."refundAmountCents" IS NOT NULL
         OR case_row."stripeRefundId" IS NOT NULL
       )
     )
     OR (
       case_row.resolution IN (
         'REFUND_FULL'::public."CaseResolution",
         'REFUND_PARTIAL'::public."CaseResolution"
       )
       AND (
         COALESCE(case_row."refundAmountCents", 0) <= 0
         OR case_row."stripeRefundId" IS NULL
       )
     )
     OR (
       case_row.status = 'PENDING_CLOSE'::public."CaseStatus"
       AND (
         CASE WHEN case_row."buyerMarkedResolved" THEN 1 ELSE 0 END
         + CASE WHEN case_row."sellerMarkedResolved" THEN 1 ELSE 0 END
       ) <> 1
     )
     OR (
       case_row.status IN (
         'OPEN'::public."CaseStatus",
         'IN_DISCUSSION'::public."CaseStatus",
         'UNDER_REVIEW'::public."CaseStatus"
       )
       AND (
         case_row."buyerMarkedResolved"
         OR case_row."sellerMarkedResolved"
       )
     )
  ) THEN
    RAISE EXCEPTION 'Case lifecycle preflight found incompatible rows';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."CaseMessage" AS message
     WHERE message."authorKind" IS NULL
        OR pg_catalog.btrim(message.body) = ''
  ) THEN
    RAISE EXCEPTION 'CaseMessage preflight found incomplete author/body rows';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."CaseMessage" AS message
      JOIN public."Case" AS case_row
        ON case_row.id = message."caseId"
      JOIN public."User" AS author
        ON author.id = message."authorId"
     WHERE (
       message."authorKind" = 'BUYER'::public."CaseMessageAuthorKind"
       AND message."authorId" IS DISTINCT FROM case_row."buyerId"
     )
        OR (
          message."authorKind" = 'SELLER'::public."CaseMessageAuthorKind"
          AND message."authorId" IS DISTINCT FROM case_row."sellerId"
        )
        OR (
          message."authorKind" = 'STAFF'::public."CaseMessageAuthorKind"
          AND (
            message."authorId" IS NOT DISTINCT FROM case_row."buyerId"
            OR message."authorId" IS NOT DISTINCT FROM case_row."sellerId"
            OR author.role NOT IN (
              'EMPLOYEE'::public."Role",
              'ADMIN'::public."Role"
            )
          )
        )
        OR message."createdAt" < case_row."createdAt"
        OR message."createdAt" > case_row."updatedAt"
  ) THEN
    RAISE EXCEPTION
      'CaseMessage relationship preflight found incompatible rows';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."CaseMessageAttachment" AS attachment
      JOIN public."CaseMessage" AS message
        ON message.id = attachment."caseMessageId"
     WHERE attachment."uploaderId"
             IS DISTINCT FROM message."authorId"
        OR attachment."createdAt" < message."createdAt"
  ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment relationship preflight found incompatible rows';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Case" AS case_row
     WHERE case_row."openedByPaymentEventId" IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."CaseMessage" AS message
          WHERE message."caseId" = case_row.id
       )
  ) THEN
    RAISE EXCEPTION 'Case preflight found an unproven empty opening';
  END IF;
END
$grainline_case_invariant_preflight$;

ALTER TABLE public."Case"
  ADD CONSTRAINT "Case_distinct_participants_check"
    CHECK ("buyerId" IS NULL OR "buyerId" <> "sellerId")
    NOT VALID,
  ADD CONSTRAINT "Case_clock_order_check"
    CHECK (
      "createdAt" <= "updatedAt"
      AND "sellerRespondBy" >= "createdAt"
      AND (
        (
          "discussionStartedAt" IS NULL
          AND "escalateUnlocksAt" IS NULL
        )
        OR
        (
          "discussionStartedAt" >= "createdAt"
          AND "escalateUnlocksAt" >= "discussionStartedAt"
        )
      )
      AND (
        "resolvedAt" IS NULL
        OR "resolvedAt" >= "createdAt"
      )
    )
    NOT VALID,
  ADD CONSTRAINT "Case_lifecycle_evidence_check"
    CHECK (
      (
        status NOT IN (
          'RESOLVED'::public."CaseStatus",
          'CLOSED'::public."CaseStatus"
        )
        AND resolution IS NULL
        AND "refundAmountCents" IS NULL
        AND "stripeRefundId" IS NULL
        AND "resolvedAt" IS NULL
        AND "resolvedById" IS NULL
      )
      OR
      (
        status IN (
          'RESOLVED'::public."CaseStatus",
          'CLOSED'::public."CaseStatus"
        )
        AND resolution IS NOT NULL
        AND "resolvedAt" IS NOT NULL
      )
    )
    NOT VALID,
  ADD CONSTRAINT "Case_resolution_shape_check"
    CHECK (
      resolution IS NULL
      OR (
        resolution = 'DISMISSED'::public."CaseResolution"
        AND "refundAmountCents" IS NULL
        AND "stripeRefundId" IS NULL
      )
      OR (
        resolution IN (
          'REFUND_FULL'::public."CaseResolution",
          'REFUND_PARTIAL'::public."CaseResolution"
        )
        AND "refundAmountCents" > 0
        AND "stripeRefundId" IS NOT NULL
        AND "stripeRefundId" <> ''
      )
    )
    NOT VALID,
  ADD CONSTRAINT "Case_resolution_marks_check"
    CHECK (
      (
        status = 'PENDING_CLOSE'::public."CaseStatus"
        AND (
          CASE WHEN "buyerMarkedResolved" THEN 1 ELSE 0 END
          + CASE WHEN "sellerMarkedResolved" THEN 1 ELSE 0 END
        ) = 1
      )
      OR
      (
        status IN (
          'OPEN'::public."CaseStatus",
          'IN_DISCUSSION'::public."CaseStatus",
          'UNDER_REVIEW'::public."CaseStatus"
        )
        AND NOT "buyerMarkedResolved"
        AND NOT "sellerMarkedResolved"
      )
      OR status IN (
        'RESOLVED'::public."CaseStatus",
        'CLOSED'::public."CaseStatus"
      )
    )
    NOT VALID;

ALTER TABLE public."Case"
  VALIDATE CONSTRAINT "Case_distinct_participants_check";
ALTER TABLE public."Case"
  VALIDATE CONSTRAINT "Case_clock_order_check";
ALTER TABLE public."Case"
  VALIDATE CONSTRAINT "Case_lifecycle_evidence_check";
ALTER TABLE public."Case"
  VALIDATE CONSTRAINT "Case_resolution_shape_check";
ALTER TABLE public."Case"
  VALIDATE CONSTRAINT "Case_resolution_marks_check";

ALTER TABLE public."CaseMessage"
  ALTER COLUMN "authorKind" SET NOT NULL,
  ADD CONSTRAINT "CaseMessage_body_check"
    CHECK (
      pg_catalog.btrim(body) <> ''
      AND pg_catalog.char_length(body) <= 5000
    )
    NOT VALID;

ALTER TABLE public."CaseMessage"
  VALIDATE CONSTRAINT "CaseMessage_body_check";

CREATE FUNCTION public.grainline_case_relationship_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_relationship_valid$
DECLARE
  order_buyer_id text;
  order_stripe_charge_id text;
  seller_count integer;
  only_seller_user_id text;
  dispute_event record;
BEGIN
  SELECT orders."buyerId", orders."stripeChargeId"
    INTO order_buyer_id, order_stripe_charge_id
    FROM public."Order" AS orders
   WHERE orders.id = NEW."orderId"
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  -- Lock every retained Order/seller relationship in a stable order before
  -- deriving the one exact seller. The outer aggregate cannot carry a row
  -- locking clause, so the non-aggregate inner query owns the locks.
  SELECT
    pg_catalog.count(DISTINCT locked_seller.seller_user_id)::integer,
    pg_catalog.min(locked_seller.seller_user_id)
    INTO seller_count, only_seller_user_id
    FROM (
      SELECT seller."userId" AS seller_user_id
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing ON listing.id = item."listingId"
        JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       WHERE item."orderId" = NEW."orderId"
       ORDER BY item.id, listing.id, seller.id
       FOR SHARE OF item, listing, seller
    ) AS locked_seller;

  IF seller_count <> 1
     OR NEW."sellerId" IS DISTINCT FROM only_seller_user_id
     OR (
       NEW."buyerId" IS NOT NULL
       AND NEW."buyerId" IS DISTINCT FROM order_buyer_id
     )
     OR (
       NEW."buyerId" IS NOT NULL
       AND NEW."buyerId" = NEW."sellerId"
     ) THEN
    RAISE EXCEPTION 'Case parties do not match one exact Order seller'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."openedByPaymentEventId" IS NOT NULL THEN
    SELECT
      event."eventType",
      event."stripeEventId",
      event."stripeObjectType",
      event."stripeObjectId",
      event.status,
      event.currency,
      event.metadata
      INTO dispute_event
      FROM public."OrderPaymentEvent" AS event
     WHERE event.id = NEW."openedByPaymentEventId"
       AND event."orderId" = NEW."orderId"
     FOR SHARE;
    IF NOT FOUND
       OR dispute_event."eventType" <> 'DISPUTE'
       OR dispute_event."stripeEventId" IS NULL
       OR pg_catalog.btrim(dispute_event."stripeEventId") = ''
       OR dispute_event."stripeObjectType" IS DISTINCT FROM 'dispute'
       OR dispute_event."stripeObjectId" IS NULL
       OR pg_catalog.btrim(dispute_event."stripeObjectId") = ''
       OR pg_catalog.jsonb_typeof(dispute_event.metadata) <> 'object'
       OR dispute_event.metadata->>'stripeEventType'
            IS DISTINCT FROM 'charge.dispute.created'
       OR order_stripe_charge_id IS NULL
       OR pg_catalog.btrim(order_stripe_charge_id) = ''
       OR dispute_event.metadata->>'chargeId'
            IS DISTINCT FROM order_stripe_charge_id
       OR dispute_event.metadata->>'disputeId'
            IS DISTINCT FROM dispute_event."stripeObjectId"
       OR dispute_event.metadata->>'stripeEventCreated' IS NULL
       OR dispute_event.metadata->>'stripeEventCreated'
            !~ '^[0-9]{1,12}$'
       OR pg_catalog.lower(COALESCE(dispute_event.status, '')) IN (
            'won',
            'lost',
            'prevented',
            'warning_closed'
          )
       OR dispute_event.currency !~ '^[a-z]{3}$'
       OR NEW.reason <> 'OTHER'::public."CaseReason" THEN
      RAISE EXCEPTION 'Case webhook opening source is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$grainline_case_relationship_valid$;

REVOKE ALL ON FUNCTION public.grainline_case_relationship_valid()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_relationship_valid
BEFORE INSERT OR UPDATE OF
  "orderId", "buyerId", "sellerId", "openedByPaymentEventId", reason
ON public."Case"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_relationship_valid();

CREATE FUNCTION public.grainline_case_authority_fields_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_case_authority_fields_immutable$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."sellerId" IS DISTINCT FROM OLD."sellerId"
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW."openedByPaymentEventId"
        IS DISTINCT FROM OLD."openedByPaymentEventId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR (
       NEW."buyerId" IS DISTINCT FROM OLD."buyerId"
       AND NOT (
         OLD."buyerId" IS NOT NULL
         AND NEW."buyerId" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Case authority fields are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$grainline_case_authority_fields_immutable$;

REVOKE ALL ON FUNCTION public.grainline_case_authority_fields_immutable()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_authority_fields_immutable
BEFORE UPDATE ON public."Case"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_authority_fields_immutable();

CREATE FUNCTION public.grainline_case_status_transition_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_case_status_transition_valid$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (
      OLD.status = 'OPEN'::public."CaseStatus"
      AND NEW.status IN (
        'IN_DISCUSSION'::public."CaseStatus",
        'PENDING_CLOSE'::public."CaseStatus",
        'UNDER_REVIEW'::public."CaseStatus",
        'RESOLVED'::public."CaseStatus"
      )
    )
    OR
    (
      OLD.status = 'IN_DISCUSSION'::public."CaseStatus"
      AND NEW.status IN (
        'PENDING_CLOSE'::public."CaseStatus",
        'UNDER_REVIEW'::public."CaseStatus",
        'RESOLVED'::public."CaseStatus"
      )
    )
    OR
    (
      OLD.status = 'PENDING_CLOSE'::public."CaseStatus"
      AND NEW.status IN (
        'IN_DISCUSSION'::public."CaseStatus",
        'RESOLVED'::public."CaseStatus"
      )
    )
    OR
    (
      OLD.status = 'UNDER_REVIEW'::public."CaseStatus"
      AND NEW.status = 'RESOLVED'::public."CaseStatus"
    )
    OR
    (
      OLD.status = 'RESOLVED'::public."CaseStatus"
      AND NEW.status = 'CLOSED'::public."CaseStatus"
    )
    OR NEW.status = 'UNDER_REVIEW'::public."CaseStatus"
  ) THEN
    RAISE EXCEPTION 'Invalid Case status transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$grainline_case_status_transition_valid$;

REVOKE ALL ON FUNCTION public.grainline_case_status_transition_valid()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_status_transition_valid
BEFORE UPDATE OF status ON public."Case"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_status_transition_valid();

CREATE FUNCTION public.grainline_case_message_author_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_message_author_valid$
DECLARE
  parent record;
  author record;
BEGIN
  -- Canonical authority order begins with actor User, then Order when the
  -- operation has one, then parent Case. The compatible application and later
  -- fixed functions must acquire that order before this invariant is promoted.
  SELECT actor.role, actor.banned, actor."deletedAt"
    INTO author
    FROM public."User" AS actor
   WHERE actor.id = NEW."authorId"
   FOR SHARE;
  IF NOT FOUND
     OR author.banned
     OR author."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'CaseMessage author relationship is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    case_row."buyerId",
    case_row."sellerId",
    case_row."createdAt"
    INTO parent
    FROM public."Case" AS case_row
   WHERE case_row.id = NEW."caseId"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CaseMessage parent Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF (
       NEW."authorKind" = 'BUYER'::public."CaseMessageAuthorKind"
       AND NEW."authorId" IS DISTINCT FROM parent."buyerId"
     )
     OR (
       NEW."authorKind" = 'SELLER'::public."CaseMessageAuthorKind"
       AND NEW."authorId" IS DISTINCT FROM parent."sellerId"
     )
     OR (
       NEW."authorKind" = 'STAFF'::public."CaseMessageAuthorKind"
       AND (
         NEW."authorId" IS NOT DISTINCT FROM parent."buyerId"
         OR NEW."authorId" IS NOT DISTINCT FROM parent."sellerId"
         OR author.role NOT IN (
           'EMPLOYEE'::public."Role",
           'ADMIN'::public."Role"
         )
       )
     )
     OR NEW."createdAt" < parent."createdAt" THEN
    RAISE EXCEPTION 'CaseMessage author relationship is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$grainline_case_message_author_valid$;

REVOKE ALL ON FUNCTION public.grainline_case_message_author_valid()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_message_author_valid
BEFORE INSERT OR UPDATE OF
  "caseId", "authorId", "authorKind", "createdAt"
ON public."CaseMessage"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_message_author_valid();

CREATE FUNCTION
  public.grainline_case_message_authority_fields_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_case_message_authority_fields_immutable$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."caseId" IS DISTINCT FROM OLD."caseId"
     OR NEW."authorId" IS DISTINCT FROM OLD."authorId"
     OR NEW."authorKind" IS DISTINCT FROM OLD."authorKind"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CaseMessage authority fields are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$grainline_case_message_authority_fields_immutable$;

REVOKE ALL ON FUNCTION
  public.grainline_case_message_authority_fields_immutable()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_message_authority_fields_immutable
BEFORE UPDATE ON public."CaseMessage"
FOR EACH ROW
EXECUTE FUNCTION
  public.grainline_case_message_authority_fields_immutable();

CREATE FUNCTION public.grainline_case_message_maintain_thread()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_message_maintain_thread$
BEGIN
  UPDATE public."Case"
     SET "updatedAt" = GREATEST("updatedAt", NEW."createdAt")
   WHERE id = NEW."caseId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CaseMessage parent Case does not exist'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$grainline_case_message_maintain_thread$;

REVOKE ALL ON FUNCTION public.grainline_case_message_maintain_thread()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_message_maintain_thread
AFTER INSERT ON public."CaseMessage"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_message_maintain_thread();

CREATE FUNCTION public.grainline_case_opening_evidence_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_opening_evidence_valid$
DECLARE
  target_case_id text;
  opening_source_id text;
BEGIN
  IF TG_RELID = 'public."Case"'::pg_catalog.regclass THEN
    target_case_id := NEW.id;
  ELSE
    target_case_id := OLD."caseId";
  END IF;

  -- A message-delete trigger must serialize on the parent before checking the
  -- remaining message set. Otherwise two concurrent deletes could each see
  -- the other's uncommitted row and commit an empty human-opened Case.
  SELECT case_row."openedByPaymentEventId"
    INTO opening_source_id
    FROM public."Case" AS case_row
   WHERE case_row.id = target_case_id
   FOR UPDATE;

  -- Cascading deletion of the parent removes the Case before its deferred
  -- message triggers run; no opening invariant remains to enforce then.
  IF FOUND
     AND opening_source_id IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."CaseMessage" AS message
        WHERE message."caseId" = target_case_id
     ) THEN
    RAISE EXCEPTION 'Case has no human or durable webhook opening evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$grainline_case_opening_evidence_valid$;

REVOKE ALL ON FUNCTION public.grainline_case_opening_evidence_valid()
  FROM PUBLIC, grainline_app_runtime;

CREATE CONSTRAINT TRIGGER grainline_case_opening_evidence_valid
AFTER INSERT OR UPDATE ON public."Case"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_opening_evidence_valid();

CREATE CONSTRAINT TRIGGER grainline_case_message_delete_keeps_opening_evidence
AFTER DELETE ON public."CaseMessage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_opening_evidence_valid();

CREATE FUNCTION
  public.grainline_case_attachment_parent_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_attachment_parent_valid$
DECLARE
  parent record;
BEGIN
  SELECT message."authorId", message."createdAt"
    INTO parent
    FROM public."CaseMessage" AS message
   WHERE message.id = NEW."caseMessageId"
   FOR UPDATE;
  IF NOT FOUND
     OR NEW."uploaderId" IS DISTINCT FROM parent."authorId"
     OR NEW."createdAt" < parent."createdAt" THEN
    RAISE EXCEPTION 'CaseMessageAttachment parent relationship is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$grainline_case_attachment_parent_valid$;

REVOKE ALL ON FUNCTION public.grainline_case_attachment_parent_valid()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_attachment_parent_valid
BEFORE INSERT OR UPDATE OF
  "caseMessageId", "uploaderId", "createdAt"
ON public."CaseMessageAttachment"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_attachment_parent_valid();

COMMIT;
