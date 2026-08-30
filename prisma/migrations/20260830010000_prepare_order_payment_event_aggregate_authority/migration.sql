-- Compatible OrderPaymentEvent aggregate-authority preparation. The two Order
-- projections expose only fixed eligibility facts, not provider event rows.
-- RLS and predecessor table grants remain unchanged until the later activation.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order-payment-event.aggregate-authority.preparation',
    0
  )
);

-- Take the append-ledger write lock before the Order DDL lock. Existing
-- payment inserts lock Order after writing OrderPaymentEvent; reversing that
-- order here could deadlock migration DDL with an in-flight insert.
LOCK TABLE public."OrderPaymentEvent" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public."Order"
  ADD COLUMN "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
  ADD COLUMN "paymentConversionDisputeBlocked" boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.grainline_order_payment_projection_state(
  p_order_id text
)
RETURNS TABLE (
  refund_blocked boolean,
  conversion_dispute_blocked boolean
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_projection_state$
  SELECT
    EXISTS (
      SELECT 1
        FROM public."OrderPaymentEvent" AS payment
       WHERE payment."orderId" = p_order_id
         AND payment."eventType" = 'REFUND'
         AND (
           payment.status IS NULL
           OR pg_catalog.lower(payment.status) NOT IN (
             'failed', 'canceled', 'cancelled'
           )
         )
    ) AS refund_blocked,
    EXISTS (
      SELECT 1
        FROM (
          SELECT latest_time."stripeObjectId"
            FROM (
              SELECT payment."stripeObjectId",
                     pg_catalog.max(
                       payment."stripeEventCreatedSeconds"
                     ) AS latest_seconds
                FROM public."OrderPaymentEvent" AS payment
               WHERE payment."orderId" = p_order_id
                 AND payment."eventType" = 'DISPUTE'
               GROUP BY payment."stripeObjectId"
            ) AS latest_time
            JOIN public."OrderPaymentEvent" AS payment
              ON payment."orderId" = p_order_id
             AND payment."eventType" = 'DISPUTE'
             AND payment."stripeObjectId" = latest_time."stripeObjectId"
             AND payment."stripeEventCreatedSeconds" =
                 latest_time.latest_seconds
           GROUP BY latest_time."stripeObjectId"
          HAVING pg_catalog.bool_or(
                   payment.status IS NULL
                   OR pg_catalog.lower(payment.status) NOT IN (
                     'won', 'warning_closed'
                   )
                 )
              OR pg_catalog.count(DISTINCT pg_catalog.jsonb_build_array(
                   payment."amountCents",
                   payment.currency,
                   payment.status,
                   payment.reason,
                   payment.metadata->>'stripeEventType'
                 )) > 1
        ) AS blocking_dispute
    ) AS conversion_dispute_blocked
$grainline_order_payment_projection_state$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_projection_state(text)
  FROM PUBLIC, grainline_app_runtime;

-- Backfill while the migration owns both relation locks. Concurrent payment
-- inserts resume only after the projection trigger exists at commit.
UPDATE public."Order" AS orders
   SET (
     "paymentRefundBlocked",
     "paymentConversionDisputeBlocked"
   ) = (
     SELECT expected.refund_blocked,
            expected.conversion_dispute_blocked
       FROM public.grainline_order_payment_projection_state(orders.id)
            AS expected
   );

CREATE FUNCTION public.grainline_order_payment_projection_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_projection_guard$
DECLARE
  expected_refund_blocked boolean;
  expected_conversion_dispute_blocked boolean;
BEGIN
  SELECT expected.refund_blocked,
         expected.conversion_dispute_blocked
    INTO STRICT expected_refund_blocked,
                expected_conversion_dispute_blocked
    FROM public.grainline_order_payment_projection_state(NEW.id) AS expected;

  IF NEW."paymentRefundBlocked" IS DISTINCT FROM expected_refund_blocked
     OR NEW."paymentConversionDisputeBlocked" IS DISTINCT FROM
        expected_conversion_dispute_blocked THEN
    RAISE EXCEPTION 'Order payment eligibility projections are database-managed'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$grainline_order_payment_projection_guard$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_projection_guard()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_payment_projection_guard
BEFORE INSERT OR UPDATE OF
  "paymentRefundBlocked", "paymentConversionDisputeBlocked"
ON public."Order"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_payment_projection_guard();

CREATE FUNCTION public.grainline_order_payment_projection_refresh()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_projection_refresh$
DECLARE
  expected_refund_blocked boolean;
  expected_conversion_dispute_blocked boolean;
BEGIN
  SELECT expected.refund_blocked,
         expected.conversion_dispute_blocked
    INTO STRICT expected_refund_blocked,
                expected_conversion_dispute_blocked
    FROM public.grainline_order_payment_projection_state(NEW."orderId")
         AS expected;

  UPDATE public."Order" AS orders
     SET "paymentRefundBlocked" = expected_refund_blocked,
         "paymentConversionDisputeBlocked" =
           expected_conversion_dispute_blocked
   WHERE orders.id = NEW."orderId"
     AND (
       orders."paymentRefundBlocked" IS DISTINCT FROM expected_refund_blocked
       OR orders."paymentConversionDisputeBlocked" IS DISTINCT FROM
          expected_conversion_dispute_blocked
     );

  IF NOT FOUND THEN
    PERFORM 1
      FROM public."Order" AS orders
     WHERE orders.id = NEW."orderId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order payment projection Order source is invalid'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$grainline_order_payment_projection_refresh$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_projection_refresh()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_payment_projection_refresh
AFTER INSERT ON public."OrderPaymentEvent"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_payment_projection_refresh();

COMMENT ON COLUMN public."Order"."paymentRefundBlocked" IS
  'Database-maintained: true when retained payment evidence contains a non-failed refund.';
COMMENT ON COLUMN public."Order"."paymentConversionDisputeBlocked" IS
  'Database-maintained: true when any dispute latest state is not won or warning_closed.';
COMMENT ON FUNCTION public.grainline_order_payment_projection_state(text) IS
  'Private canonical OrderPaymentEvent-to-Order payment eligibility projection.';
COMMENT ON FUNCTION public.grainline_order_payment_projection_guard() IS
  'Rejects forged Order payment eligibility projections from predecessor writers.';
COMMENT ON FUNCTION public.grainline_order_payment_projection_refresh() IS
  'Refreshes exact Order payment eligibility projections after immutable evidence insert.';

COMMIT;
