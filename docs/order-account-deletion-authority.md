# Order account-deletion authority

Status: isolated local compatibility candidate only. Migration
`20260905020000_prepare_order_account_deletion_authority` is not applied,
merged, deployed or authorized for production. `Order`, `OrderItem` and
`OrderShippingRateQuote` RLS remain unchanged.

## Why this conversion is required

The pre-RLS product and authority audit found three correctness problems in
the predecessor account-deletion path:

1. Seller blockers reconstructed historical ownership through mutable
   `OrderItem -> Listing` relationships instead of the immutable checkout-time
   `Order.sellerProfileId` witness.
2. A recorded full refund was compared only with locally reconstructed order
   components. New orders already retain the exact provider-signed
   `chargedTotalCents`; using a larger reconstructed value could incorrectly
   block deletion after a true full refund.
3. The route checked blockers before the large anonymization transaction but
   did not recheck them after locking the deleting user. An order could
   otherwise become eligible between the first check and destructive work.

The initial SQL draft also contained two defects caught before commit by the
real PostgreSQL proof: it used an invented refund sentinel instead of the
canonical `pending` value, and it schema-qualified the PostgreSQL special form
`COALESCE`. A subsequent authority review removed caller-supplied clock input;
the 30-day boundary and purge timestamp now come from PostgreSQL
`statement_timestamp()` in UTC.

## Selected boundary

Two `SECURITY DEFINER` operations replace direct ordinary-runtime access:

- `grainline_order_account_deletion_blockers(text)` returns only buyer and
  seller blocker counts for the transaction-local `app.user_id` actor. It
  derives seller ownership from `Order.sellerProfileId`, uses the exact
  `pending` refund sentinel and prefers nullable `chargedTotalCents`, falling
  back to components only for legacy orders.
- `grainline_order_account_deletion_scrub(text,text[])` locks the actor's User
  row, repeats the blocker query, fails with a serialization error if any
  obligation exists, derives current User/Seller sensitive values, redacts
  retained review notes, clears buyer and seller fulfillment PII, and deletes
  only shipping quotes attached to that actor's durable buyer/seller orders.

Both functions reject a mismatched or absent transaction-local actor. PUBLIC
has no execute privilege. The ordinary runtime receives only these exact
function grants; the migration changes no base-table grants, RLS posture or
rows. The TypeScript adapter requires the caller's existing transaction client,
validates one-row/count results and has no default database client.

The extra redaction values are the already-filtered historical account email
aliases. They are bounded to 128 entries of 1–2048 characters and cannot
change which rows are selected or whether deletion is allowed.

## Concurrency contract

The anonymization transaction acquires the deleting User row `FOR UPDATE`
before its second blocker check and all Order-family scrubbing. Checkout
reservation creation takes the buyer and seller User rows `FOR SHARE` in a
stable order. Stripe's cart and single-item paid-order paths take the buyer and
seller User rows `FOR UPDATE` before validating actor state and creating the
Order. Therefore a concurrent checkout/order commit must occur either before
the deletion recheck and become a blocker, or after deletion state is visible
and fail the checkout actor-state validation.

The Redis route lock prevents duplicate deletion jobs but is not treated as a
database serialization primitive. The User-row lock is the durable boundary.

## Proof and release gates

Local proof covers:

- PUBLIC denial and exact runtime execute grants;
- forged actor rejection;
- durable buyer and seller ownership without Listing reconstruction;
- signed-total full-refund behavior and legacy fallback;
- blocker recheck atomicity;
- actor-only note/PII/quote scrubbing and other-user preservation; and
- the repository-wide PostgreSQL special-form qualification guard.

Before any production use:

The local release candidate is byte-pinned at SHA-256
`42847973d67ce2fbc5b8ad449403c96cf46ed1b29fae0cff5004e4390fd17a7f`.
It follows the staff-read charged-total correction in every historical Order
release verifier. CI isolates it until that predecessor is restored, applies
it to disposable PostgreSQL, converges the two exact runtime grants, runs the
global grant audit and repeats the focused authority proof. The full local
suite also passes after the two affected historical contracts were advanced.

Remaining production gates:

1. add a dedicated guarded production scope reader/workflow that accepts only
   the exact pre-migration or applied ledger state;
2. apply only the additive migration through that guarded workflow;
3. deploy the compatible application, smoke both user-requested and
   provider-deleted blocked paths, and drain the predecessor; and
4. prove the direct Order inventory has only the separately converted Stripe
   webhook family before considering Order Phase A.

No step here authorizes Order RLS activation or bundles OrderItem/quote RLS.
