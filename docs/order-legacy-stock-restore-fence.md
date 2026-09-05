# Order legacy stock-restore fence

Status: locally implemented and PostgreSQL-proven; database-first draft only.
No migration, deployment, RLS posture, table grant or production state changed.

## Finding

The fallback for historical Checkout Sessions without a
`CheckoutStockReservation` row opened a runtime transaction, took the standard
Session advisory lock, directly queried `Order.stripeSessionId`, and then
called `grainline_legacy_stock_restore_claim`. This was correct only while the
runtime retained direct Order SELECT authority and would fail after policyless
Order RLS activation.

Moving the check outside the transaction or trusting Stripe metadata would be
wrong: a paid Order creator and an expiry/restoration worker could otherwise
both observe absence and respectively persist an Order and restore its stock.

## Accepted design

`grainline_legacy_stock_restore_claim(text)` remains the single claim surface,
but its successor body now:

1. validates the exact Checkout Session identifier;
2. takes advisory lock `(913337, hashtext(sessionId))`, the same lock every
   compatible Order creator and legacy restore caller already uses;
3. returns `false` when an Order with that exact `stripeSessionId` exists;
4. otherwise creates or verifies the canonical processed stock-restore event;
5. binds new evidence to `sourceObjectId = sessionId` and fills that witness
   only for the exact predecessor null-source shape; and
6. returns only a boolean, never Order or webhook data.

An existing non-null conflicting source witness fails closed and is never
overwritten. The caller continues restoring stock in the same database transaction, so the
transaction-scoped lock is retained until its stock writes commit or roll back.
The function remains runtime-only `SECURITY DEFINER`, search-path pinned, and
does not widen table grants.

## Release order

1. Extra-High review the replacement body and shared-lock proof.
2. Apply it database-first as an exact byte-pinned compatibility migration and
   update every later StripeWebhookEvent function-catalog verifier.
3. Prove the existing-Order denial, first claim, replay, malformed input, ACL,
   and an actual two-session Order-create-versus-restore lock wait.
4. Deploy the compatible app, exercise reservation-backed and legacy restore
   paths, and drain callable predecessors before Order grant revocation.

Rollback is application-first because the candidate app assumes the database
function performs the Order fence. Restore a compatible predecessor app before
restoring the prior function body.
