# OrderPaymentEvent seller refund product correction

Status: compatible application correction merged and database authority
prepared in production; the converted application is not deployed. No action
described by this document alone authorizes a Stripe or RLS state change.

Audited: 2026-08-23 as the first bounded remediation after
`docs/order-payment-event-pre-rls-audit.md`.

## Decision

Seller self-service supports one operation: cancel and fully refund the Order.
The amount is derived from the locked Order; it is never selected by the
seller. Eligible in-stock inventory is restored automatically before handoff.

Seller self-service partial refunds are rejected before any seller lookup,
Order claim or Stripe call. The seller UI exposes no partial-amount or manual
stock-restoration controls and explains that a partial resolution requires
Grainline staff review.

Staff Case resolution continues to support bounded full or partial refunds.
That path has its own reviewed claim/provider-record/finalize authority and
explicit stock-restoration decision. This correction does not remove or
reinterpret historical partial-refund evidence.

## Canonical accounting derivation

Application-side refund provider validation uses `calculateCheckoutAmounts()`
for the expected seller transfer reversal. It must not duplicate the current
platform-fee rate or recompute the transfer inline. Checkout creation, refund
creation and application-side refund validation therefore share one fee-base
and rounding contract: the fee applies to item subtotal only, while shipping
and gift wrap remain seller proceeds. A focused source guard rejects a future
reintroduction of the previous TypeScript-side
`itemsSubtotalCents * 0.05` calculation.

The byte-sealed PostgreSQL refund finalizers independently reproduce the 5%
launch contract from locked Order amounts. That is deliberate database-side
validation, but the Order currently has no durable checkout-time platform-fee
or seller-transfer snapshot. A contract test therefore blocks changing
`PLATFORM_FEE_RATE` while those finalizers retain the 5% contract. Before any
fee change, add a durable checkout-time accounting snapshot, backfill or
explicitly classify historical Orders, and ship successor fixed functions that
validate the stored transaction terms. Never edit the applied migrations.

PR CI run `32797707604` correctly failed before merge because the first version
of that contract test read the final successor migration during an earlier CI
phase that intentionally hides later migrations. The guard now runs with the
inactive-seller successor's own release tests, after CI restores that exact
byte-sealed migration. Both the earlier refund-record isolation gate and the
final successor gate pass in their real workflow order; no production state
changed during the failed run.

## Why

The current Order model has no durable representation for a partially
cancelled line-item quantity, residual item balance, adjusted tax/shipping,
remaining fulfillment obligation or buyer-facing revised receipt. Allowing a
seller to choose a dollar amount and optional stock quantity could therefore
refund part of an Order while every downstream fulfillment, label, review and
analytics path treats the entire Order as terminally refunded.

RLS cannot repair that product ambiguity. Narrowing the launch operation makes
the later fixed seller refund authority deterministic: source Order, amount,
inventory decision and terminal effect are database-derivable.

## Compatibility and rollback

- Existing full-refund clients remain compatible; omitted `type` still means
  `FULL`.
- A stale client that submits `PARTIAL` receives a private 400 response and no
  provider or database side effect.
- Historical seller and Case partial-refund rows remain readable through the
  existing outcome UI.
- Rolling back the application restores the prior UI/API capability and does
  not require a database rollback. That rollback is not recommended without a
  residual-order design.

## Future partial-refund feature gate

Do not restore seller partial refunds until a separate audited feature defines:

1. adjusted OrderItem quantities and retained line-item balance;
2. proportional or explicit tax, shipping and gift-wrap allocation;
3. stock restoration tied to the cancelled quantities;
4. remaining fulfillment, label, delivery and review eligibility;
5. buyer/seller receipt and timeline copy; and
6. generation-fenced provider claims and reconciliation for the exact change.

That future feature is tracked as product architecture, not as unfinished RLS
activation work.
