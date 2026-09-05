# Order seller-refund preflight authority

Status: **isolated compatible candidate; SQL must release before the stacked
application conversion**.

Prepared: 2026-09-05

## Product and authority decision

The seller refund route used to load an unrestricted `Order`, release a stale
legacy lock through broad runtime `UPDATE`, and independently interpret
payment, dispute, refund and label fields before calling the fixed refund-claim
function. The claim already re-derives the money, currency, payment intent,
durable seller, payment ledger and dispute state under database locks. Keeping
the application copy did not add authority; it added a second, race-prone
interpretation and prevented policyless Order RLS.

`grainline_seller_refund_preflight(text,text)` now has one narrow job before
the existing claim: lock the active User, that User's SellerProfile and the
requested Order in the established order; prove the durable Order seller key;
release only an aged predecessor `pending` lock with no Case or generation-
fenced refund claim; and return one closed decision string. It returns no Order
columns, participant data, money or provider identifier.

The preflight is not provider authority. `grainline_seller_refund_claim` still
revalidates the complete state and creates the provider-authorized claim, and
the existing finalizers remain the only refund-record authority. A race after
preflight therefore fails closed at claim or at the shared label/refund data
constraint.

## Preserved behavior

- inactive actors and actors without a seller profile remain forbidden;
- another seller's Order is indistinguishable from an absent Order;
- an open dispute, active or recorded refund, active or purchased label, and
  absent PaymentIntent retain their existing user-facing outcomes;
- modern refund and Case claims are never released by age; and
- the 15-minute cleanup applies only to the exact seller-owned predecessor
  sentinel that the old application helper could release.

The redundant application-to-database drift comparison is intentionally gone:
the fixed claim result is parsed strictly and is derived from the same locked
Order row. Reloading that row outside the claim transaction was not an
independent trust source.

## Proof and release order

Static tests pin the closed decisions, lock order, cleanup predicates,
function posture, route ordering and zero direct Order access. Disposable
PostgreSQL proves durable-seller isolation, stale predecessor cleanup, modern-
claim retention, label/dispute decisions, runtime function execution and
denial of direct table reads.

Promote and prove the SQL database-first. Only after the function and exact
runtime grant are live may the stacked application conversion deploy. This
candidate changes no RLS posture or table grant and does not authorize Order
Phase A. The executable direct Order inventory falls from 15 to 14.
