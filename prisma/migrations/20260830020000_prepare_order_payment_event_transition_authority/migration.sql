-- Compatible OrderPaymentEvent transition-authority preparation. The new
-- Order projection exposes only whether the latest state of any retained
-- Stripe dispute blocks an Order transition. It does not expose provider rows.
-- RLS and predecessor table grants remain unchanged until later activation.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order-payment-event.transition-authority.preparation',
    0
  )
);

-- Every fixed payment-event writer locks the parent Order before appending
-- evidence. Preserve that lock order while installing the projection trigger.
LOCK TABLE public."Order" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public."OrderPaymentEvent" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public."Order"
  ADD COLUMN "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.grainline_order_payment_open_dispute_state(
  p_order_id text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_open_dispute_state$
  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT latest_time.dispute_key
          FROM (
            SELECT COALESCE(
                     payment."stripeObjectId",
                     payment.id
                   ) AS dispute_key,
                   pg_catalog.max(
                     COALESCE(
                       payment."stripeEventCreatedSeconds",
                       EXTRACT(epoch FROM payment."createdAt")::bigint
                     )
                   ) AS latest_seconds
              FROM public."OrderPaymentEvent" AS payment
             WHERE payment."orderId" = p_order_id
               AND payment."eventType" = 'DISPUTE'
             GROUP BY COALESCE(
                        payment."stripeObjectId",
                        payment.id
                      )
          ) AS latest_time
          JOIN public."OrderPaymentEvent" AS payment
            ON payment."orderId" = p_order_id
           AND payment."eventType" = 'DISPUTE'
           AND COALESCE(payment."stripeObjectId", payment.id) =
               latest_time.dispute_key
           AND COALESCE(
                 payment."stripeEventCreatedSeconds",
                 EXTRACT(epoch FROM payment."createdAt")::bigint
               ) = latest_time.latest_seconds
         GROUP BY latest_time.dispute_key
        HAVING pg_catalog.bool_or(
                 payment.status IS NULL
                 OR pg_catalog.lower(payment.status) NOT IN (
                   'won', 'lost', 'prevented', 'warning_closed'
                 )
               )
            OR pg_catalog.count(DISTINCT pg_catalog.jsonb_build_array(
                 pg_catalog.lower(payment.status)
               )) > 1
      ) AS blocking_dispute
  )
$grainline_order_payment_open_dispute_state$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_open_dispute_state(text)
  FROM PUBLIC, grainline_app_runtime;

UPDATE public."Order" AS orders
   SET "paymentOpenDisputeBlocked" =
         public.grainline_order_payment_open_dispute_state(orders.id);

CREATE FUNCTION public.grainline_order_payment_open_dispute_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_open_dispute_guard$
DECLARE
  expected_open_dispute_blocked boolean;
BEGIN
  SELECT public.grainline_order_payment_open_dispute_state(NEW.id)
    INTO STRICT expected_open_dispute_blocked;

  IF NEW."paymentOpenDisputeBlocked" IS DISTINCT FROM
       expected_open_dispute_blocked THEN
    RAISE EXCEPTION 'Order open-dispute projection is database-managed'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$grainline_order_payment_open_dispute_guard$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_open_dispute_guard()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_payment_open_dispute_guard
BEFORE INSERT OR UPDATE OF "paymentOpenDisputeBlocked"
ON public."Order"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_payment_open_dispute_guard();

CREATE FUNCTION public.grainline_order_payment_open_dispute_refresh()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_open_dispute_refresh$
DECLARE
  expected_open_dispute_blocked boolean;
BEGIN
  SELECT public.grainline_order_payment_open_dispute_state(NEW."orderId")
    INTO STRICT expected_open_dispute_blocked;

  UPDATE public."Order" AS orders
     SET "paymentOpenDisputeBlocked" = expected_open_dispute_blocked
   WHERE orders.id = NEW."orderId"
     AND orders."paymentOpenDisputeBlocked" IS DISTINCT FROM
         expected_open_dispute_blocked;

  IF NOT FOUND THEN
    PERFORM 1
      FROM public."Order" AS orders
     WHERE orders.id = NEW."orderId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order open-dispute projection Order source is invalid'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$grainline_order_payment_open_dispute_refresh$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_open_dispute_refresh()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_payment_open_dispute_refresh
AFTER INSERT ON public."OrderPaymentEvent"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_payment_open_dispute_refresh();

COMMENT ON COLUMN public."Order"."paymentOpenDisputeBlocked" IS
  'Database-maintained: true when any Stripe dispute latest state remains open.';
COMMENT ON FUNCTION public.grainline_order_payment_open_dispute_state(text) IS
  'Private canonical OrderPaymentEvent-to-Order open-dispute projection.';
COMMENT ON FUNCTION public.grainline_order_payment_open_dispute_guard() IS
  'Rejects forged Order open-dispute projections from predecessor writers.';
COMMENT ON FUNCTION public.grainline_order_payment_open_dispute_refresh() IS
  'Refreshes the exact Order open-dispute projection after immutable evidence insert.';

COMMIT;
