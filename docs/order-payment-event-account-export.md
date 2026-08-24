# OrderPaymentEvent account-export privacy correction

Status: compatible application correction prepared on an isolated branch; not
merged or deployed. No schema, migration, provider or production state changed.

Audited: 2026-08-23 after the OrderPaymentEvent pre-RLS domain audit.

## Product boundary

The self-service account export is a portability record for the authenticated
account, not an export of Grainline's private Stripe service ledger. Buyers and
sellers retain the refund amount, currency, status and event time associated
with their participant-scoped Orders. Sellers additionally receive the bounded
refund reason used for their accounting record.

Both projections exclude Stripe event/object IDs, object types, internal
descriptions, arbitrary provider/reconciliation metadata and mutable update
timestamps. Dispute records are excluded because participant dispute history is
already exported through the actor-scoped Case projection. A separately
verified privacy/support request remains the route for any additional legally
required record.

The buyer and seller selectors are intentionally separate even where their
fields overlap. A future field must be classified for each actor instead of
silently widening both exports through one raw-ledger selector.

## Compatibility and scale

The current application still obtains these bounded fields as a nested relation
of an already participant-scoped Order query, so this correction can deploy
before the database authority conversion. The eventual RLS release replaces
that predecessor access with distinct actor-bound, keyset-paged database export
functions. This change does not claim the synchronous whole-account export is a
50k-user end state and does not authorize silent truncation of a portability
export; asynchronous streamed or encrypted-object delivery remains the scale
upgrade before large histories exist.

## Proof and rollback

Tests pin the exact buyer and seller selector keys, the refund-only predicate,
the absence of every private ledger field in both route blocks and the existing
POST, same-origin and recent-reverification boundary. Rolling back restores the
unsafe broad export and should not be used as a compatibility fallback.
