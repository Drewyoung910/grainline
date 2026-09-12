# Order legacy refund-lock authority

Status: locally implemented and PostgreSQL-proven; database-first draft only.
No migration, deployment, RLS posture, table grant or production state changed.

## Finding

The pre-generation refund-lock repair helper accepted an optional caller-owned
Order ID and otherwise ran an unbounded `Order.updateMany`. Three unrelated
contexts shared it: signed blocked-checkout delivery, staff Case resolution,
and the notification-retention cron. The predicates protected modern Case and
refund claims, but the caller/source authority and work bound were implicit.
The Case route also ran the global cleanup before validating its request body.

## Accepted design

- Blocked checkout proves an active, unprocessed Stripe webhook lease, exact
  claim generation, Checkout Session, and matching Order before one release.
- Case resolution proves an active `EMPLOYEE` or `ADMIN`, resolves the Order
  through the exact nonterminal Case, and then releases only that Order.
- Cron maintenance accepts no identifier and releases at most 100 eligible
  rows, ordered deterministically under `FOR UPDATE SKIP LOCKED`.
- All three operations require `sellerRefundId = 'pending'`, a missing or
  older-than-15-minute timestamp, and null Case and modern refund claims.
- A recent lock, recorded/ambiguous refund, modern refund claim, active Case
  claim, wrong actor, wrong event generation, processed event, wrong Session,
  terminal Case, or raced predicate is never silently cleared.

The operations are `SECURITY DEFINER` with `search_path = pg_catalog`; PUBLIC
and runtime execute are revoked before only the reviewed runtime signatures are
granted. They return only a boolean or bounded count and expose no Order data.

## Release order

1. Keep the SQL in `docs/rls-drafts/order-legacy-refund-lock-authority.sql`
   until an Extra-High authority and lock-order review is accepted.
2. Apply the exact fixed functions and grants in disposable PostgreSQL, then a
   guarded database-first compatibility migration.
3. Prove the functions through the real pooled runtime role while direct Order
   access remains denied.
4. Deploy the compatible application, exercise the three callers, and drain
   every callable predecessor that still uses the direct cleanup helper.
5. Only then count this source as closed for Order policyless activation.

Rollback is application-first: restore a compatible application that calls the
old helper only while direct Order UPDATE remains available, then remove the
new function grants/functions. Never remove the functions ahead of a callable
compatible deployment.
