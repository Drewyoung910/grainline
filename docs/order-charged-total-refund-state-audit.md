# Order charged-total and refund-state audit

Date: 2026-09-01  
Merged release: `9d893010359f06741fa76b3c63efc5028cde151c`
Production state: compatible migration and application deployment pending

## Decision

Close this bounded correctness gate before core `Order` Phase A. Do not invent a
`CANCELLED` fulfillment value for a payment outcome, and do not let the work
expand into unrelated checkout grouping, friendly order numbers, or carrier
tracking automation.

The durable payment fact is a nullable `Order.chargedTotalCents` copied from the
retrieved paid Stripe Checkout Session's `amount_total`. Stripe defines
`amount_total` as the total after discounts and taxes. New paid Orders must have
that provider value; legacy Orders remain nullable until separately classified
or provider-backfilled. A locally reconstructed subtotal is useful as a legacy
fallback, but must never be relabeled as signed provider evidence.

## Confirmed current behavior

- Checkout completion already retrieves the authoritative Checkout Session
  before creating an Order and already uses `amount_total` for the blocked-
  checkout automatic-refund amount when available.
- Normal Order creation does not retain `amount_total`; it retains component
  amounts only.
- Seller and staff full-refund claims reconstruct the buyer charge from item,
  shipping, gift-wrap and tax columns. That remains a necessary legacy fallback
  but should not outrank an exact provider total.
- Buyer and seller pages currently combine a logistics status with refund copy.
  A fully refunded, unfulfilled Order can still say `Pending` or “preparing” and
  can continue to render seller fulfillment actions.
- `itemsSubtotalCents = 0` is historically ambiguous because the column's
  default predates complete checkout-subtotal retention. The existing item-row
  fallback must remain until an aggregate legacy classification proves zero is
  a real stored subtotal; this release does not reinterpret old zeroes.
- Existing fulfillment history is independently meaningful. A delivered or
  picked-up Order that is later refunded must remain delivered or picked up.

## Compatibility design

1. Add nullable `chargedTotalCents integer` with a nonnegative database check.
2. Treat a paid retrieved Checkout Session with a missing, negative, noninteger
   or unsafe `amount_total` as invalid; do not create an Order without the exact
   witness after the compatible application release.
3. Write the same exact value in both cart and single-listing Order creation
   paths and include only the amount, not provider payloads, in the existing
   sanitized system audit metadata.
4. Make fixed refund authorities use
   `COALESCE("chargedTotalCents", legacy-derived-total)` for buyer-refund limits
   and full-refund amounts. Keep the seller-transfer portion derived from item,
   shipping and gift-wrap economics; tax is still platform-side and the buyer
   charge total must not be substituted for seller proceeds.
5. Preserve nullable legacy fallback. Production backfill requires a separate
   aggregate inspection and, if needed, exact Stripe-session retrieval; no
   heuristic backfill is authorized by this release.
6. Derive payment presentation separately from fulfillment presentation:
   successful refund amount at least equal to the exact/fallback total means
   fully refunded; a lower successful amount means partially refunded;
   provider-pending/ambiguous states remain visibly nonfinal.
7. For a fully refunded nonterminal Order, replace active “preparing/pending”
   copy and suppress new fulfillment, label and delivery-confirmation actions.
   Continue to show the stored logistics timeline and retain terminal
   `DELIVERED`/`PICKED_UP` history.

## Release order

1. merge and accept the independent shipping-quote/label and Case-correctness
   prerequisites;
2. apply only the additive nullable column and check constraint database-first;
3. deploy the compatible application that writes the witness and renders the
   refund state;
4. after the separate Case correction is accepted, prepare a successor
   fixed-authority migration that prefers
   `COALESCE("chargedTotalCents", legacy-derived-total)` without reviving any
   retired function;
5. run an aggregate-only legacy classification plus authenticated checkout,
   seller refund and staff Case refund proofs;
6. only then resume core `Order` policyless Phase A and its separate FORCE
   release.

The additive `20260901150000_prepare_order_charged_total` migration deliberately
does not contain the fixed-function changes. Keeping that database compatibility
step independent avoids coupling it to the still-separate Case correction and
prevents a forced restack of byte-sealed migration history.

## Explicit limitations

- This change does not prove live-mode carrier availability or purchase a
  Shippo label. The exact buyer quote payload already passed the non-charging
  Shippo test-mode provider proof; full-address live-mode label proof remains a
  separate launch gate.
- This change does not add promotion codes. The exact provider witness makes
  later discount support safer without claiming it exists now.
- This change does not infer exact historical Stripe charges from local
  component sums.
- This change does not erase or rewrite fulfillment history after a refund.
- This change does not activate `Order`, `OrderItem`, or
  `OrderShippingRateQuote` RLS.

## Required proof

- unit tests for exact-total precedence, legacy fallback, full/partial/pending
  refund presentation and terminal-logistics preservation;
- two checkout paths reject invalid provider totals and persist the exact
  retrieved amount;
- this compatibility candidate's disposable PostgreSQL proof covers nullable
  legacy rows, exact zero/positive values, the negative-value check and
  unchanged predecessor RLS/grants;
- the later fixed-authority candidate separately proves exact/fallback refund
  arithmetic without reviving retired runtime functions;
- focused, TypeScript, lint and full repository suites pass;
- guarded production inspection and migration/deployment/postflight remain
  separate later boundaries.
