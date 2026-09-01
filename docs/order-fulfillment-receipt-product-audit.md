# Order Fulfillment and Receipt Product Audit

Date: 2026-09-01

Status: product corrections implemented on the isolated Order branch; fixed
database authority and production release remain unapplied.

## Scope

This audit precedes the Order RLS conversion for:

- seller manual shipping;
- seller pickup-readiness announcements;
- buyer shipping-delivery confirmation;
- buyer pickup confirmation;
- seller-private Order notes;
- active-Case, refund, dispute and seller-deauthorization conflicts;
- lifecycle locking, audit evidence, notifications and email reliability; and
- the buyer and seller controls that expose those transitions.

The audit reads the route, UI, Case-window, refund, dispute, Notification,
email and Order-lock consumers as one product state machine. Passing existing
authorization tests alone is not treated as proof that the workflow is the
right marketplace behavior.

## Product verdict

The shipping flow is coherent: a seller may move one paid shipping Order from
`PENDING` to `SHIPPED` only with a supported carrier and bounded tracking
number, while the buyer alone confirms `SHIPPED` to `DELIVERED`. Active Cases,
refund evidence, an open Stripe dispute, a purchased Grainline label and the
seller-deauthorization review hold fence incompatible seller transitions.

The pickup flow was not acceptable as written. A seller could move an Order
from `READY_FOR_PICKUP` to `PICKED_UP`, even though that timestamp starts the
buyer's 30-day Case window. That let a seller assert a handoff and start the
buyer's dispute clock without buyer evidence. The corrected product boundary
is:

1. seller: `PENDING -> READY_FOR_PICKUP`;
2. buyer: `READY_FOR_PICKUP -> PICKED_UP`; and
3. the buyer's confirmation timestamp becomes the Case-window reference.

The same buyer receipt route retains historical null-method compatibility for
`SHIPPED -> DELIVERED`, but null never implies pickup.

## Corrections in this checkpoint

- Removed seller `picked_up` and `delivered` actions from the fulfillment input
  schema rather than retaining rejected or dead mutation vocabulary.
- Removed the impossible `READY_FOR_PICKUP -> SHIPPED` declaration. The method
  guard already rejected that transition, so advertising it as valid made the
  state machine misleading.
- Added buyer pickup confirmation to the existing authenticated receipt route
  and buyer Order page.
- Replaced the seller's `Mark picked up` control with an explicit wait for the
  buyer's confirmation.
- Required a retained paid Order for seller fulfillment and buyer receipt
  confirmation. Synthetic or incomplete unpaid rows cannot enter terminal
  fulfillment state.
- Blocked buyer receipt confirmation while the database-maintained Stripe
  open-dispute projection is active.
- Added a strict, transaction-coincident buyer-authored
  `ORDER_FULFILLMENT_TRANSITION` system audit containing only the derived
  action, method and previous/new statuses. A strict seller notification is
  co-committed from that source; the owner function derives recipient,
  counterparty, payload and seller route from the durable Order seller key and
  audit evidence instead of trusting application text.
- Centralized receipt-state derivation in
  `src/lib/orderReceiptConfirmationState.ts` with exhaustive unit coverage.

Historical seller-authored `picked_up` audit and Notification evidence is not
deleted or reinterpreted. This is a forward behavior correction.

## Retained strengths

- Every contended transition takes the shared exact Order-row lock before its
  final state check and database timestamp.
- The buyer and seller routes reject explicit cross-origin browser POSTs,
  require an active local account and apply actor-scoped rate limits.
- Durable `Order.sellerProfileId`, rather than current Listing ownership, is
  the seller authorization key.
- Shipping and pickup terminal timestamps feed the same Case-window, retention
  and review eligibility rules.
- Manual shipping requires carrier and tracking input; sellers cannot confirm
  shipping delivery.
- Non-note seller transitions are fenced by active Case, refund, dispute,
  purchased-label and deauthorized-seller states in the final write predicate,
  not only by a stale pre-read.

## Fixed-authority follow-up

The product correction does not itself make Order ready for RLS. The isolated
compatible authority checkpoint now provides separate source-validating
functions:

- `grainline_order_seller_fulfillment_transition(...)` for only paid, seller-owned
  `PENDING -> SHIPPED` and `PENDING -> READY_FOR_PICKUP` transitions;
- `grainline_order_buyer_receipt_confirm(p_actor_user_id, p_order_id)` for only paid,
  buyer-owned `SHIPPED -> DELIVERED` and
  `READY_FOR_PICKUP -> PICKED_UP`; and
- a separate bounded seller-note operation, because private scratch notes are
  not fulfillment state and must not inherit provider-transition authority.

Each function derives actor, target, method, previous/new state, database
clock and audit payload internally; lock the active actor and Order in the
reviewed global order; reject active Cases/refunds/disputes as applicable; and
grant execute only to the reviewed runtime role.

The fixed application finalizer co-commits the source-validated Notification
and deterministic EmailOutbox reservation with the Order transition. The
immediate email attempt occurs after commit, and the scheduled worker can
recover a process exit or provider failure without replaying the transition.
An inactive or deleted counterparty is not a delivery target and does not block
the paid Order transition. Seller-private notes retain their predecessor
post-refund editability for recordkeeping while remaining unavailable for new
text after buyer-data purge.
This selects the durable branch of the original decision:

- co-commit the source-validated Notification and a deduplicated EmailOutbox
  reservation with the transition; or
- retain an explicit restart-safe side-effect repair operation keyed by the
  immutable transition audit.

Direct best-effort email is no longer the fulfillment reliability boundary.
See `docs/order-fulfillment-authority.md`. The migration remains unapplied and
Order RLS remains unchanged.

## Not changed by this audit

- No migration, RLS posture, grant, deployment or provider state changed.
- The existing 30-day Case window and eligible Case reasons remain unchanged.
- Seller notes remain private mutable scratch notes, not immutable evidence.
- No new notification type is introduced. Historical pickup notifications
  remain valid retained records.

## Verification accepted for this checkpoint

- The focused product, route-contract, notification-authority and release
  suite passed 40/40 checks.
- The disposable PostgreSQL proof passed buyer-confirmed shipping receipt,
  buyer-confirmed pickup, idempotent replay, forged-recipient fail-closed
  behavior and direct private-core denial under the restricted runtime role.
- The complete local suite passed 3,807 tests with 7 intentional skips and
  zero failures across 479 suites (3,814 total tests).
- TypeScript passed. Lint passed with only the pre-existing JSX accessibility
  warning. `git diff --check` passed.
- The successor Notification authority migration is deterministically rebuilt
  from the sealed predecessor and has SHA-256
  `709864eb865a3802aa119f244c7e84a86cf1890df509edff8a1e8087c5b279e2`.
- No production database, deployment, RLS, grant, credential or provider state
  changed during this audit.
