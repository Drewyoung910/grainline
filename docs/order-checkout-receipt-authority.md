# Order checkout receipt authority and product audit

Status: isolated compatible candidate. It has not been merged, applied,
deployed, or used in production. `Order` RLS remains off.

Prepared: 2026-09-01

## Product decision

The checkout-success page remains a confirmation and receipt surface; it does
not become a second Order writer. Stripe's primary Checkout Session must be
retrieved as paid and its signed `buyerId` metadata must match the authenticated
Grainline user before any receipt lookup. The Stripe webhook remains the only
Order creator.

A fresh product, privacy and failure-state audit found four defects in the
direct reader:

1. it displayed the buyer's current `User.name` or email rather than the
   checkout-time `Order.buyerName` or `buyerEmail`, so an old receipt could
   change when the account changed;
2. it linked every historical item even when the current Listing was private,
   hidden or otherwise unavailable to that actor;
3. its supposed webhook-race retry immediately repeated the same query without
   waiting, so it did not provide a meaningful race window; and
4. separate single- and multi-order render paths duplicated receipt line and
   total presentation.

The compatible application now uses one shared receipt renderer, checkout-time
buyer identity, actor-specific current Listing link availability, and one
bounded 250 ms retry after the verified Stripe payment. If the webhook has not
committed after that retry, the page honestly reports that processing is still
in progress and links to order history.

The audit did not find a reason to redesign the primary Stripe verification,
one-seller-per-Order receipt structure, money formatting, gift-wrap line, or
Order total calculation in this slice.

## Database boundary

`20260901110000_prepare_order_checkout_receipt_authority` adds only
`grainline_order_buyer_receipts_by_sessions(text, text[])`.

The fixed function:

- requires an active actor and 1-50 unique, bounded `cs_` identifiers;
- binds the actor to `Order.buyerId` inside PostgreSQL;
- returns only paid Orders;
- returns no raw Stripe Checkout Session identifier or other provider ID;
- derives the buyer label from checkout-time Order fields and suppresses it
  after buyer-data purge;
- reuses corrected v3 participant details for bounded snapshot items and
  actor-visible current Listing links; and
- returns rows in deterministic newest-first `(createdAt,id)` order.

The additional session IDs used by multi-seller checkout are not trusted as
authority. Only the primary Stripe Session is provider-verified, while the
fixed database function independently limits every returned row to a paid
Order owned by the authenticated buyer.

## Historical-data gate

The application parser requires the retained item-price sum to equal
`Order.itemsSubtotalCents`. Silently accepting a mismatch would render a
receipt whose line items disagree with its subtotal. Before production
application, run an aggregate-only, engine-read-only inspection for:

- paid Orders with zero items;
- malformed or incomplete retained snapshots; and
- retained item-sum versus `itemsSubtotalCents` mismatches.

Any nonzero result must be classified explicitly. Do not weaken the parser or
silently substitute mutable live Listing data.

## Proof and sequencing

Disposable PostgreSQL proves paid-only actor isolation, inactive-user denial,
bounded input rejection, deterministic order, checkout-time buyer labels,
complete allowlisted snapshots, actor-specific listing links, and exact
runtime/PUBLIC function grants. Application tests prove the page has no direct
Order read or write and performs exactly one real bounded retry.

The v2 snapshot omission was found during this audit. Its bytes remain sealed;
`20260901105000_correct_order_participant_snapshot_projection` adds v3 buyer
and seller details and restores every key required by the strict historical
snapshot contract while excluding unknown JSON keys.

This release pair does not enable RLS, change table privileges, mutate rows,
deploy code, or touch production/provider state. The direct Order source
inventory falls from 22 to 21. Compatible migration application, historical
inspection, pooled-runtime proof, app deployment, predecessor drain and later
Order activation remain separate gates.
