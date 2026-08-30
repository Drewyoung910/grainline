-- Compatible OrderPaymentEvent invariant preparation. RLS and predecessor
-- grants remain unchanged. Fixed source functions remain the only intended
-- long-term writers; these constraints and triggers make malformed or mutable
-- ledger rows impossible even while old and new deployments coexist.

BEGIN;

ALTER TABLE public."OrderPaymentEvent"
  ADD CONSTRAINT "OrderPaymentEvent_eventType_check"
  CHECK ("eventType" IN ('REFUND', 'DISPUTE'))
  NOT VALID,
  ADD CONSTRAINT "OrderPaymentEvent_amountCents_check"
  CHECK ("amountCents" IS NULL OR "amountCents" >= 0)
  NOT VALID,
  ADD CONSTRAINT "OrderPaymentEvent_currency_check"
  CHECK (currency ~ '^[a-z]{3}$')
  NOT VALID,
  ADD CONSTRAINT "OrderPaymentEvent_text_shape_check"
  CHECK (
    "stripeEventId" = pg_catalog.btrim("stripeEventId")
    AND pg_catalog.char_length("stripeEventId") BETWEEN 1 AND 255
    AND "stripeObjectId" IS NOT NULL
    AND "stripeObjectId" = pg_catalog.btrim("stripeObjectId")
    AND pg_catalog.char_length("stripeObjectId") BETWEEN 1 AND 255
    AND "stripeObjectType" IS NOT NULL
    AND "stripeObjectType" = pg_catalog.btrim("stripeObjectType")
    AND pg_catalog.char_length("stripeObjectType") BETWEEN 1 AND 100
    AND (
      status IS NULL
      OR (
        status = pg_catalog.btrim(status)
        AND pg_catalog.char_length(status) BETWEEN 1 AND 100
      )
    )
    AND (
      reason IS NULL
      OR (
        reason = pg_catalog.btrim(reason)
        AND pg_catalog.char_length(reason) BETWEEN 1 AND 255
      )
    )
    AND (
      description IS NULL
      OR (
        description = pg_catalog.btrim(description)
        AND pg_catalog.char_length(description) BETWEEN 1 AND 5000
      )
    )
    AND metadata IS NOT NULL
    AND pg_catalog.jsonb_typeof(metadata) = 'object'
  )
  NOT VALID,
  ADD CONSTRAINT "OrderPaymentEvent_source_shape_check"
  CHECK (
    ((
      "stripeEventId" ~ '^evt_[A-Za-z0-9]+$'
      AND "stripeEventCreatedSeconds" IS NOT NULL
      AND metadata->>'chargeId' ~ '^ch_[A-Za-z0-9]+$'
      AND (
        (
          "eventType" = 'REFUND'
          AND "stripeObjectType" = 'refund'
          AND (
            "stripeObjectId" ~ '^re_[A-Za-z0-9]+$'
            OR "stripeObjectId" = 'external:' || "stripeEventId"
          )
          AND metadata->>'stripeEventType' = 'charge.refunded'
        )
        OR
        (
          "eventType" = 'DISPUTE'
          AND "stripeObjectType" = 'dispute'
          AND "stripeObjectId" ~ '^du_[A-Za-z0-9]+$'
          AND metadata->>'disputeId' = "stripeObjectId"
          AND metadata->>'stripeEventType' IN (
            'charge.dispute.created',
            'charge.dispute.updated',
            'charge.dispute.closed',
            'charge.dispute.funds_withdrawn',
            'charge.dispute.funds_reinstated'
          )
          AND metadata->>'stripeEventCreated' =
            "stripeEventCreatedSeconds"::text
        )
      )
    )
    OR
    (
      "eventType" = 'REFUND'
      AND "stripeObjectType" = 'refund'
      AND "stripeObjectId" ~ '^re_[A-Za-z0-9]+$'
      AND "stripeEventCreatedSeconds" IS NULL
      AND metadata->>'localAction' IN (
        'SELLER_REFUND_RECORDED',
        'CASE_REFUND_RECORDED',
        'BLOCKED_CHECKOUT_REFUND_RECORDED'
      )
      AND "stripeEventId" =
        'local:'
        || pg_catalog.lower(metadata->>'localAction')
        || ':'
        || "stripeObjectId"
    )) IS TRUE
  )
  NOT VALID,
  ADD CONSTRAINT "OrderPaymentEvent_timestamp_immutable_shape_check"
  CHECK ("updatedAt" = "createdAt")
  NOT VALID;

ALTER TABLE public."OrderPaymentEvent"
  VALIDATE CONSTRAINT "OrderPaymentEvent_eventType_check";
ALTER TABLE public."OrderPaymentEvent"
  VALIDATE CONSTRAINT "OrderPaymentEvent_amountCents_check";
ALTER TABLE public."OrderPaymentEvent"
  VALIDATE CONSTRAINT "OrderPaymentEvent_currency_check";
ALTER TABLE public."OrderPaymentEvent"
  VALIDATE CONSTRAINT "OrderPaymentEvent_text_shape_check";
ALTER TABLE public."OrderPaymentEvent"
  VALIDATE CONSTRAINT "OrderPaymentEvent_source_shape_check";
ALTER TABLE public."OrderPaymentEvent"
  VALIDATE CONSTRAINT "OrderPaymentEvent_timestamp_immutable_shape_check";

CREATE FUNCTION public.grainline_order_payment_event_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_event_validate_insert$
DECLARE
  source_currency text;
BEGIN
  SELECT pg_catalog.lower(orders.currency)
    INTO STRICT source_currency
    FROM public."Order" AS orders
   WHERE orders.id = NEW."orderId"
   FOR UPDATE;

  IF source_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'Order payment currency does not match its Order'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'Order payment Order source is invalid'
      USING ERRCODE = 'foreign_key_violation';
END
$grainline_order_payment_event_validate_insert$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_event_validate_insert()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_payment_event_validate_insert
BEFORE INSERT ON public."OrderPaymentEvent"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_payment_event_validate_insert();

CREATE FUNCTION public.grainline_order_payment_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_order_payment_event_immutable$
BEGIN
  RAISE EXCEPTION 'Order payment evidence is immutable'
    USING ERRCODE = 'check_violation';
END
$grainline_order_payment_event_immutable$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_event_immutable()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_payment_event_immutable
BEFORE UPDATE OR DELETE ON public."OrderPaymentEvent"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_payment_event_immutable();

CREATE FUNCTION public.grainline_order_currency_payment_immutable()
RETURNS trigger
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_currency_payment_immutable$
BEGIN
  IF OLD.currency IS DISTINCT FROM NEW.currency
     AND EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS payment
        WHERE payment."orderId" = OLD.id
     ) THEN
    RAISE EXCEPTION 'Order currency is immutable after payment evidence exists'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$grainline_order_currency_payment_immutable$;

REVOKE ALL ON FUNCTION public.grainline_order_currency_payment_immutable()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_currency_payment_immutable
BEFORE UPDATE OF currency ON public."Order"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_currency_payment_immutable();

COMMENT ON FUNCTION public.grainline_order_payment_event_validate_insert() IS
  'Locks the parent Order and rejects cross-currency OrderPaymentEvent inserts.';
COMMENT ON FUNCTION public.grainline_order_payment_event_immutable() IS
  'Rejects every OrderPaymentEvent update and delete.';
COMMENT ON FUNCTION public.grainline_order_currency_payment_immutable() IS
  'Rejects Order currency changes after any retained payment evidence exists.';

COMMIT;
