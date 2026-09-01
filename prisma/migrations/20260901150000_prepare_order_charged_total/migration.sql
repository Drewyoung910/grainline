-- Additive compatibility witness for the exact total charged by Stripe.
-- Existing Orders remain NULL until separately classified or provider-backed;
-- local component sums are not rewritten as provider evidence.
ALTER TABLE public."Order"
  ADD COLUMN "chargedTotalCents" integer;

ALTER TABLE public."Order"
  ADD CONSTRAINT "Order_chargedTotalCents_non_negative_chk"
  CHECK (
    "chargedTotalCents" IS NULL
    OR "chargedTotalCents" >= 0
  );

COMMENT ON COLUMN public."Order"."chargedTotalCents" IS
  'Exact paid Stripe Checkout Session amount_total in minor currency units; NULL for unclassified legacy Orders.';
