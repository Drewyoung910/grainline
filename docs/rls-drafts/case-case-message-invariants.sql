-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Durable row-shape and source-binding invariants for the tightly coupled
-- Case, CaseMessage and CaseMessageAttachment group. RLS and grant changes
-- are intentionally absent. The compatible application must populate the
-- Stripe dispute source before this draft can be promoted.

BEGIN;

-- The compatible preparation migration already adds the nullable
-- Case.openedByPaymentEventId source and its exact same-Order foreign key.
-- This draft adds only the later strict lifecycle and relationship invariants.

DO $grainline_case_invariant_preflight$
BEGIN
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

CREATE OR REPLACE FUNCTION public.grainline_case_relationship_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_relationship_valid$
DECLARE
  order_buyer_id text;
  seller_count integer;
  only_seller_user_id text;
  dispute_event_type text;
BEGIN
  SELECT orders."buyerId"
    INTO order_buyer_id
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
    SELECT event."eventType"
      INTO dispute_event_type
      FROM public."OrderPaymentEvent" AS event
     WHERE event.id = NEW."openedByPaymentEventId"
       AND event."orderId" = NEW."orderId"
     FOR SHARE;
    IF NOT FOUND
       OR dispute_event_type <> 'charge.dispute.created'
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

CREATE OR REPLACE FUNCTION public.grainline_case_authority_fields_immutable()
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

CREATE OR REPLACE FUNCTION public.grainline_case_status_transition_valid()
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

CREATE OR REPLACE FUNCTION public.grainline_case_message_author_valid()
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
   FOR SHARE;
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

CREATE OR REPLACE FUNCTION
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

CREATE OR REPLACE FUNCTION public.grainline_case_message_maintain_thread()
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

CREATE OR REPLACE FUNCTION public.grainline_case_opening_evidence_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_opening_evidence_valid$
DECLARE
  target_case_id text;
BEGIN
  IF TG_RELID = 'public."Case"'::pg_catalog.regclass THEN
    target_case_id := NEW.id;
  ELSE
    target_case_id := OLD."caseId";
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Case" AS case_row
     WHERE case_row.id = target_case_id
       AND case_row."openedByPaymentEventId" IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."CaseMessage" AS message
          WHERE message."caseId" = case_row.id
       )
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

CREATE OR REPLACE FUNCTION
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
   FOR KEY SHARE;
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
