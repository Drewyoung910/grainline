-- DRAFT ONLY: Order/payment/shipping compatible durable seller key.
-- This is exercised only inside the rollback-only loopback PostgreSQL proof.
-- It is not a production migration or approval to inspect/change production.

BEGIN;

DO $grainline_order_seller_key_preflight$
DECLARE
  order_without_item_count bigint;
  order_multi_seller_count bigint;
BEGIN
  SELECT pg_catalog.count(*)
    INTO order_without_item_count
    FROM public."Order" AS orders
   WHERE NOT EXISTS (
     SELECT 1
       FROM public."OrderItem" AS item
      WHERE item."orderId" = orders.id
   );

  SELECT pg_catalog.count(*)
    INTO order_multi_seller_count
    FROM (
      SELECT item."orderId"
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing
          ON listing.id = item."listingId"
       GROUP BY item."orderId"
      HAVING pg_catalog.count(DISTINCT listing."sellerId") <> 1
    ) AS ambiguous_order;

  IF order_without_item_count <> 0 THEN
    RAISE EXCEPTION
      'Order seller-key preflight found % zero-item order(s)',
      order_without_item_count
      USING ERRCODE = 'check_violation';
  END IF;
  IF order_multi_seller_count <> 0 THEN
    RAISE EXCEPTION
      'Order seller-key preflight found % multi-seller order(s)',
      order_multi_seller_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$grainline_order_seller_key_preflight$;

ALTER TABLE public."Order"
  ADD COLUMN "sellerProfileId" text;
ALTER TABLE public."OrderItem"
  ADD COLUMN "sellerProfileId" text;

UPDATE public."OrderItem" AS item
   SET "sellerProfileId" = listing."sellerId"
  FROM public."Listing" AS listing
 WHERE listing.id = item."listingId";

UPDATE public."Order" AS orders
   SET "sellerProfileId" = derived."sellerProfileId"
  FROM (
    SELECT item."orderId", pg_catalog.min(item."sellerProfileId") AS "sellerProfileId"
      FROM public."OrderItem" AS item
     GROUP BY item."orderId"
  ) AS derived
 WHERE derived."orderId" = orders.id;

DO $grainline_order_seller_key_backfill$
DECLARE
  order_null_count bigint;
  item_null_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO order_null_count
    FROM public."Order"
   WHERE "sellerProfileId" IS NULL;
  SELECT pg_catalog.count(*) INTO item_null_count
    FROM public."OrderItem"
   WHERE "sellerProfileId" IS NULL;
  IF order_null_count <> 0 OR item_null_count <> 0 THEN
    RAISE EXCEPTION
      'Order seller-key backfill left % Order and % OrderItem null key(s)',
      order_null_count,
      item_null_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$grainline_order_seller_key_backfill$;

ALTER TABLE public."Order"
  ADD CONSTRAINT "Order_id_sellerProfileId_key"
  UNIQUE (id, "sellerProfileId");
ALTER TABLE public."Listing"
  ADD CONSTRAINT "Listing_id_sellerId_key"
  UNIQUE (id, "sellerId");

ALTER TABLE public."Order"
  ADD CONSTRAINT "Order_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId")
  REFERENCES public."SellerProfile"(id)
  ON DELETE RESTRICT ON UPDATE RESTRICT
  NOT VALID;
ALTER TABLE public."OrderItem"
  ADD CONSTRAINT "OrderItem_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId")
  REFERENCES public."SellerProfile"(id)
  ON DELETE RESTRICT ON UPDATE RESTRICT
  NOT VALID,
  ADD CONSTRAINT "OrderItem_orderId_sellerProfileId_fkey"
  FOREIGN KEY ("orderId", "sellerProfileId")
  REFERENCES public."Order"(id, "sellerProfileId")
  ON DELETE CASCADE ON UPDATE RESTRICT
  NOT VALID,
  ADD CONSTRAINT "OrderItem_listingId_sellerProfileId_fkey"
  FOREIGN KEY ("listingId", "sellerProfileId")
  REFERENCES public."Listing"(id, "sellerId")
  ON DELETE RESTRICT ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE public."Order"
  VALIDATE CONSTRAINT "Order_sellerProfileId_fkey";
ALTER TABLE public."OrderItem"
  VALIDATE CONSTRAINT "OrderItem_sellerProfileId_fkey";
ALTER TABLE public."OrderItem"
  VALIDATE CONSTRAINT "OrderItem_orderId_sellerProfileId_fkey";
ALTER TABLE public."OrderItem"
  VALIDATE CONSTRAINT "OrderItem_listingId_sellerProfileId_fkey";

CREATE INDEX "Order_sellerProfileId_createdAt_id_idx"
  ON public."Order"("sellerProfileId", "createdAt", id);
CREATE INDEX "Order_sellerProfileId_fulfillmentStatus_createdAt_id_idx"
  ON public."Order"(
    "sellerProfileId", "fulfillmentStatus", "createdAt", id
  );
CREATE INDEX "OrderItem_sellerProfileId_createdAt_id_idx"
  ON public."OrderItem"("sellerProfileId", "createdAt", id);

CREATE FUNCTION public.grainline_order_item_seller_key_bind()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_item_seller_key_bind$
DECLARE
  source_seller_profile_id text;
  order_seller_profile_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."listingId" IS DISTINCT FROM OLD."listingId"
    OR NEW."sellerProfileId" IS DISTINCT FROM OLD."sellerProfileId"
  ) THEN
    RAISE EXCEPTION 'OrderItem authority keys are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT listing."sellerId"
    INTO source_seller_profile_id
    FROM public."Listing" AS listing
   WHERE listing.id = NEW."listingId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OrderItem Listing source does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW."sellerProfileId" IS NOT NULL
     AND NEW."sellerProfileId" IS DISTINCT FROM source_seller_profile_id THEN
    RAISE EXCEPTION 'OrderItem seller key does not match Listing seller'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW."sellerProfileId" := source_seller_profile_id;

  SELECT orders."sellerProfileId"
    INTO order_seller_profile_id
    FROM public."Order" AS orders
   WHERE orders.id = NEW."orderId"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OrderItem Order source does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF order_seller_profile_id IS NULL THEN
    UPDATE public."Order" AS orders
       SET "sellerProfileId" = source_seller_profile_id
     WHERE orders.id = NEW."orderId";
  ELSIF order_seller_profile_id IS DISTINCT FROM source_seller_profile_id THEN
    RAISE EXCEPTION 'Order cannot contain items from multiple sellers'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$grainline_order_item_seller_key_bind$;

CREATE FUNCTION public.grainline_order_seller_key_assert(p_order_id text)
RETURNS void
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_key_assert$
DECLARE
  source_order_seller_profile_id text;
  item_count bigint;
  distinct_item_seller_count bigint;
  matching_item_count bigint;
BEGIN
  SELECT
    orders."sellerProfileId",
    pg_catalog.count(item.id),
    pg_catalog.count(DISTINCT item."sellerProfileId"),
    pg_catalog.count(item.id) FILTER (
      WHERE item."sellerProfileId" = orders."sellerProfileId"
    )
    INTO
      source_order_seller_profile_id,
      item_count,
      distinct_item_seller_count,
      matching_item_count
    FROM public."Order" AS orders
    LEFT JOIN public."OrderItem" AS item
      ON item."orderId" = orders.id
   WHERE orders.id = p_order_id
   GROUP BY orders.id, orders."sellerProfileId";

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF source_order_seller_profile_id IS NULL
     OR item_count = 0
     OR distinct_item_seller_count <> 1
     OR matching_item_count <> item_count THEN
    RAISE EXCEPTION 'Order durable seller key is incomplete or inconsistent'
      USING ERRCODE = 'check_violation';
  END IF;
END
$grainline_order_seller_key_assert$;

CREATE FUNCTION public.grainline_order_seller_key_complete()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_key_complete$
BEGIN
  PERFORM public.grainline_order_seller_key_assert(NEW.id);
  RETURN NULL;
END
$grainline_order_seller_key_complete$;

CREATE FUNCTION public.grainline_order_item_seller_key_complete()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_item_seller_key_complete$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.grainline_order_seller_key_assert(OLD."orderId");
  ELSE
    PERFORM public.grainline_order_seller_key_assert(NEW."orderId");
  END IF;
  RETURN NULL;
END
$grainline_order_item_seller_key_complete$;

REVOKE ALL ON FUNCTION public.grainline_order_item_seller_key_bind()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_key_assert(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_key_complete()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_item_seller_key_complete()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_order_item_seller_key_bind
BEFORE INSERT OR UPDATE OF "orderId", "listingId", "sellerProfileId"
ON public."OrderItem"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_item_seller_key_bind();

CREATE CONSTRAINT TRIGGER grainline_order_seller_key_complete
AFTER INSERT OR UPDATE OF "sellerProfileId"
ON public."Order"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_seller_key_complete();

CREATE CONSTRAINT TRIGGER grainline_order_item_seller_key_complete
AFTER INSERT OR DELETE OR UPDATE OF "orderId", "sellerProfileId"
ON public."OrderItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_item_seller_key_complete();

COMMIT;
