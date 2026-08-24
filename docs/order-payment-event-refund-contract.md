# OrderPaymentEvent seller refund product correction

Status: compatible application correction prepared on an isolated branch; not
merged or deployed. No database, Stripe, provider or production state changed.

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
