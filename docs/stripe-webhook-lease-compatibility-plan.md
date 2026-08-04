# Stripe webhook lease compatibility plan

Status: design only on `agent/order-payment-shipping-rls-audit-20260804`.
This is not a Prisma migration, application conversion, production approval or
RLS activation. Production is not inspected or changed by this plan.

## Defect and target

The predecessor lease is keyed only by Stripe event ID. A stale worker can
resume after another worker reclaims that ID and then mark the newer worker's
lease processed or failed. The compatible target adds a database-derived
monotonic `claimGeneration` and requires complete/fail to match it exactly.

Event `type` becomes immutable after the first accepted event ID. PostgreSQL,
not an application clock, decides whether a lease is stale. Stripe signature
verification remains an application authentication boundary; these functions
constrain database targeting, replay and transitions rather than independently
verifying a Stripe signature.

## Additive preparation

The draft candidate in
`docs/rls-drafts/stripe-webhook-lease-compatibility.sql` adds a nonnegative
`BIGINT NOT NULL DEFAULT 0` generation. Existing processed rows may remain at
generation zero. The first fixed claim of an unprocessed legacy row advances
it to generation one; a new row begins at generation one.

Three pinned-search-path, no-dynamic-SQL `SECURITY DEFINER` functions form the
new application contract:

1. `grainline_stripe_webhook_begin(event_id, event_type)` returns an action and
   generation, locks a duplicate row, rejects type drift, and advances the
   generation only for a new or reclaimable lease.
2. `grainline_stripe_webhook_complete(event_id, generation)` completes only the
   exact live generation.
3. `grainline_stripe_webhook_fail(event_id, generation, sanitized_error)`
   clears only the exact live generation and bounds retained error text.

The draft grants ordinary runtime EXECUTE only on those three functions. It
does not enable RLS, revoke predecessor table privileges, change application
code, or remove the old direct path.

## Old/new overlap

Preparation must precede application conversion. New application instances
carry the returned generation through thin-event retrieval, ignored-event
branches, handler success, failure and every early return. Old instances can
continue the predecessor direct table calls while they coexist.

That overlap does not claim to repair an already-running old worker: until old
instances drain, an old ID-only finalizer retains the predecessor race. This is
an explicit bounded compatibility interval, not a reason to break old webhook
delivery during deployment. After the new app is proven and old instances are
drained, a separate activation revokes all direct runtime/PUBLIC table access;
only then does generation binding become the exclusive database write path.

## Proof and later gates

The rollback-only loopback proof must establish:

- first claim, duplicate-in-progress and processed replay results;
- immutable event type;
- bounded, nonblank event identity and type;
- failed-lease retry and database-clock stale reclaim increment generation;
- old-generation complete/fail cannot mutate a newer lease;
- exact-generation completion is idempotent;
- retained error text is bounded; and
- function ownership, pinned search path and exact grants are correct.

The later application conversion needs route-contract tests for both Stripe
webhook versions and a real concurrent lock-wait proof. Production preparation
still waits for the aggregate-only Order/payment/shipping inspection and its
separate result review.

## Engine evidence

The first disposable PostgreSQL run, CI `30959062084` at checkpoint
`4eb1a44571141d56216ebf03d7ad227c8bdffe24`, failed safely in the function
catalog assertion before any lease lifecycle call. The proof had incorrectly
written `pg_catalog.coalesce(...)`; `COALESCE` is parser-resolved syntax and
cannot be schema-qualified as a function. The same review found qualified
`NULLIF` in the draft error-bound expression before execution reached it.
Neither production nor persistent staging was inspected or changed. The fix
uses bare special forms and makes the lease proof run the repository-wide
special-form guard before invoking PostgreSQL.

Corrected checkpoint `b1a6ceaa957e048b981e520297ec151b6f203596`
passed the rollback-only lease lifecycle and every repository gate in exact-SHA
CI run `30959248923`. The subsequent hard review tightened all three event-ID
entry points against whitespace-only identities, also rejects a blank event
type at begin, and makes the catalog proof require migration-owner ownership.
Final checkpoint `d2601ba7f842dca7c544df809751737b62bf5c68`
passed the resulting 10-check rollback-only proof and every repository gate in
CI `30959675486`. No production or persistent staging database was contacted.
