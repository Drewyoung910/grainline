-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Private provider-handshake ledger for staff Case resolution. This table is
-- not participant-readable. It is born ENABLE + FORCE with zero policies and
-- zero ordinary-runtime/PUBLIC table privileges. Reviewed fixed
-- SECURITY DEFINER functions are its only intended access path.

BEGIN;

CREATE TYPE public."CaseResolutionClaimStatus" AS ENUM (
  'LOCAL_READY',
  'PROVIDER_PENDING',
  'PROVIDER_RECORDED',
  'RECONCILIATION_REQUIRED',
  'FINALIZED',
  'RELEASED_NO_PROVIDER_EFFECT'
);

-- The redundant pair is the target for the composite claim FK. It makes the
-- claim's Case/Order relationship an engine-enforced fact rather than a
-- function convention.
ALTER TABLE public."Case"
  ADD CONSTRAINT "Case_id_orderId_key" UNIQUE (id, "orderId");

CREATE TABLE public."CaseResolutionClaim" (
  id TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "staffActorId" TEXT NOT NULL,
  resolution public."CaseResolution" NOT NULL,
  "refundAmountCents" INTEGER,
  currency VARCHAR(3) NOT NULL,
  "stockRestorePlan" JSONB NOT NULL DEFAULT '[]'::jsonb,
  status public."CaseResolutionClaimStatus" NOT NULL,
  "idempotencyScope" VARCHAR(191),
  "orderPaymentEventId" TEXT,
  "providerRecordedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  "reconciledById" TEXT,
  "reconciliationAction" VARCHAR(40),
  "reconciliationReason" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CaseResolutionClaim_pkey" PRIMARY KEY (id),
  CONSTRAINT "CaseResolutionClaim_case_order_fkey"
    FOREIGN KEY ("caseId", "orderId")
    REFERENCES public."Case"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseResolutionClaim_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES public."Order"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseResolutionClaim_staffActorId_fkey"
    FOREIGN KEY ("staffActorId") REFERENCES public."User"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseResolutionClaim_orderPaymentEventId_fkey"
    FOREIGN KEY ("orderPaymentEventId", "orderId")
    REFERENCES public."OrderPaymentEvent"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseResolutionClaim_reconciledById_fkey"
    FOREIGN KEY ("reconciledById") REFERENCES public."User"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseResolutionClaim_idempotencyScope_key"
    UNIQUE ("idempotencyScope"),
  CONSTRAINT "CaseResolutionClaim_orderPaymentEventId_key"
    UNIQUE ("orderPaymentEventId"),
  CONSTRAINT "CaseResolutionClaim_identity_bounds_check"
    CHECK (
      id <> ''
      AND pg_catalog.char_length(id) <= 191
      AND "caseId" <> ''
      AND pg_catalog.char_length("caseId") <= 191
      AND "orderId" <> ''
      AND pg_catalog.char_length("orderId") <= 191
      AND "staffActorId" <> ''
      AND pg_catalog.char_length("staffActorId") <= 191
    ),
  CONSTRAINT "CaseResolutionClaim_currency_check"
    CHECK (currency ~ '^[a-z]{3}$'),
  CONSTRAINT "CaseResolutionClaim_stock_plan_check"
    CHECK (
      pg_catalog.jsonb_typeof("stockRestorePlan") = 'array'
      AND pg_catalog.jsonb_array_length("stockRestorePlan") <= 50
      AND pg_catalog.octet_length("stockRestorePlan"::text) <= 32768
    ),
  CONSTRAINT "CaseResolutionClaim_clock_order_check"
    CHECK (
      "updatedAt" >= "createdAt"
      AND (
        "providerRecordedAt" IS NULL
        OR "providerRecordedAt" >= "createdAt"
      )
      AND (
        "finalizedAt" IS NULL
        OR "finalizedAt" >= "createdAt"
      )
      AND (
        "reconciledAt" IS NULL
        OR "reconciledAt" >= "createdAt"
      )
    ),
  CONSTRAINT "CaseResolutionClaim_refund_shape_check"
    CHECK (
      (
        resolution = 'DISMISSED'::public."CaseResolution"
        AND "refundAmountCents" IS NULL
        AND "idempotencyScope" IS NULL
        AND "orderPaymentEventId" IS NULL
        AND "providerRecordedAt" IS NULL
        AND status IN (
          'LOCAL_READY'::public."CaseResolutionClaimStatus",
          'FINALIZED'::public."CaseResolutionClaimStatus"
        )
      )
      OR
      (
        resolution IN (
          'REFUND_FULL'::public."CaseResolution",
          'REFUND_PARTIAL'::public."CaseResolution"
        )
        AND "refundAmountCents" > 0
        AND "idempotencyScope" IS NOT NULL
        AND "idempotencyScope" <> ''
      )
    ),
  CONSTRAINT "CaseResolutionClaim_provider_evidence_pair_check"
    CHECK (
      ("orderPaymentEventId" IS NULL)
      = ("providerRecordedAt" IS NULL)
    ),
  CONSTRAINT "CaseResolutionClaim_status_evidence_check"
    CHECK (
      (
        status IN (
          'LOCAL_READY'::public."CaseResolutionClaimStatus",
          'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
          'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
        )
        AND "finalizedAt" IS NULL
      )
      OR
      (
        status = 'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
        AND "orderPaymentEventId" IS NOT NULL
        AND "providerRecordedAt" IS NOT NULL
        AND "finalizedAt" IS NULL
      )
      OR
      (
        status = 'FINALIZED'::public."CaseResolutionClaimStatus"
        AND "finalizedAt" IS NOT NULL
        AND (
          resolution = 'DISMISSED'::public."CaseResolution"
          OR (
            "orderPaymentEventId" IS NOT NULL
            AND "providerRecordedAt" IS NOT NULL
          )
        )
      )
      OR
      (
        status =
          'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
        AND resolution IN (
          'REFUND_FULL'::public."CaseResolution",
          'REFUND_PARTIAL'::public."CaseResolution"
        )
        AND "orderPaymentEventId" IS NULL
        AND "providerRecordedAt" IS NULL
        AND "finalizedAt" IS NULL
        AND "reconciledAt" IS NOT NULL
        AND "reconciledById" IS NOT NULL
        AND "reconciliationAction" = 'CONFIRMED_NO_PROVIDER_EFFECT'
        AND "reconciliationReason" IS NOT NULL
        AND pg_catalog.btrim("reconciliationReason") <> ''
      )
    ),
  CONSTRAINT "CaseResolutionClaim_reconciliation_shape_check"
    CHECK (
      (
        status =
          'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
        AND "reconciledAt" IS NOT NULL
        AND "reconciledById" IS NOT NULL
        AND "reconciliationAction" = 'CONFIRMED_NO_PROVIDER_EFFECT'
        AND "reconciliationReason" IS NOT NULL
      )
      OR
      (
        status <>
          'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
        AND "reconciledAt" IS NULL
        AND "reconciledById" IS NULL
        AND "reconciliationAction" IS NULL
        AND "reconciliationReason" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "CaseResolutionClaim_caseId_nonterminal_key"
  ON public."CaseResolutionClaim" ("caseId")
  WHERE status NOT IN (
    'FINALIZED'::public."CaseResolutionClaimStatus",
    'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
  );

CREATE UNIQUE INDEX "CaseResolutionClaim_orderId_nonterminal_key"
  ON public."CaseResolutionClaim" ("orderId")
  WHERE status NOT IN (
    'FINALIZED'::public."CaseResolutionClaimStatus",
    'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
  );

CREATE INDEX "CaseResolutionClaim_status_createdAt_idx"
  ON public."CaseResolutionClaim" (status, "createdAt");

ALTER TABLE public."Order"
  ADD COLUMN "caseResolutionClaimId" TEXT,
  ADD CONSTRAINT "Order_caseResolutionClaimId_key"
    UNIQUE ("caseResolutionClaimId"),
  ADD CONSTRAINT "Order_caseResolutionClaimId_fkey"
    FOREIGN KEY ("caseResolutionClaimId")
    REFERENCES public."CaseResolutionClaim"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION
  public.grainline_case_resolution_claim_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_case_resolution_claim_immutable$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."caseId" IS DISTINCT FROM OLD."caseId"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."staffActorId" IS DISTINCT FROM OLD."staffActorId"
     OR NEW.resolution IS DISTINCT FROM OLD.resolution
     OR NEW."refundAmountCents" IS DISTINCT FROM OLD."refundAmountCents"
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW."stockRestorePlan" IS DISTINCT FROM OLD."stockRestorePlan"
     OR NEW."idempotencyScope" IS DISTINCT FROM OLD."idempotencyScope"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CaseResolutionClaim authority fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN (
       'FINALIZED'::public."CaseResolutionClaimStatus",
       'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
     ) THEN
    RAISE EXCEPTION 'Terminal CaseResolutionClaim is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      OLD.status = 'LOCAL_READY'::public."CaseResolutionClaimStatus"
      AND NEW.status = 'FINALIZED'::public."CaseResolutionClaimStatus"
    )
    OR
    (
      OLD.status = 'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"
      AND NEW.status IN (
        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus",
        'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
      )
    )
    OR
    (
      OLD.status =
        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
      AND NEW.status IN (
        'FINALIZED'::public."CaseResolutionClaimStatus",
        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
      )
    )
    OR
    (
      OLD.status =
        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
      AND NEW.status IN (
        'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
        'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
      )
    )
  ) THEN
    RAISE EXCEPTION 'Invalid CaseResolutionClaim status transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$grainline_case_resolution_claim_immutable$;

REVOKE ALL ON FUNCTION
  public.grainline_case_resolution_claim_immutable()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_case_resolution_claim_immutable
BEFORE UPDATE ON public."CaseResolutionClaim"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_resolution_claim_immutable();

CREATE OR REPLACE FUNCTION
  public.grainline_case_resolution_claim_lease_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_resolution_claim_lease_valid$
DECLARE
  target_order_id text;
  order_claim_id text;
  active_claim_id text;
BEGIN
  target_order_id := CASE
    WHEN TG_TABLE_NAME = 'Order' THEN COALESCE(NEW.id, OLD.id)
    ELSE COALESCE(NEW."orderId", OLD."orderId")
  END;

  SELECT orders."caseResolutionClaimId"
    INTO order_claim_id
    FROM public."Order" AS orders
   WHERE orders.id = target_order_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT claim.id
    INTO active_claim_id
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim."orderId" = target_order_id
     AND claim.status NOT IN (
       'FINALIZED'::public."CaseResolutionClaimStatus",
       'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
     );

  IF order_claim_id IS DISTINCT FROM active_claim_id THEN
    RAISE EXCEPTION 'CaseResolutionClaim Order lease is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$grainline_case_resolution_claim_lease_valid$;

REVOKE ALL ON FUNCTION
  public.grainline_case_resolution_claim_lease_valid()
  FROM PUBLIC, grainline_app_runtime;

CREATE CONSTRAINT TRIGGER grainline_case_resolution_claim_lease_valid
AFTER INSERT OR UPDATE OR DELETE ON public."CaseResolutionClaim"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_resolution_claim_lease_valid();

CREATE CONSTRAINT TRIGGER grainline_order_case_resolution_claim_lease_valid
AFTER UPDATE OF "caseResolutionClaimId" ON public."Order"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.grainline_case_resolution_claim_lease_valid();

ALTER TABLE public."CaseResolutionClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CaseResolutionClaim" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."CaseResolutionClaim"
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_case_resolution_claim_private_posture$
DECLARE
  policy_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CaseResolutionClaim';

  IF policy_count <> 0
     OR NOT (
       SELECT class.relrowsecurity AND class.relforcerowsecurity
         FROM pg_catalog.pg_class AS class
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relname = 'CaseResolutionClaim'
          AND class.relkind = 'r'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."CaseResolutionClaim"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'CaseResolutionClaim private FORCE/zero-policy posture is incomplete';
  END IF;
END
$grainline_case_resolution_claim_private_posture$;

COMMIT;
