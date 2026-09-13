# Order Fulfillment Fixed Authority

Date: 2026-09-01

Status: implemented and proved on an isolated branch; migration unapplied,
application undeployed, Order RLS unchanged.

## Why this release exists

The product audit established that a seller must never assert pickup completion
or start the buyer's Case window. It also found that seller fulfillment
Notifications and email were best-effort post-commit effects. The fixed
authority release makes the corrected product state machine compatible with
future policyless Order RLS without granting a generic Order updater.

## Exact operations

Migration `20260901130000_prepare_order_fulfillment_authority` adds only:

1. `grainline_order_seller_fulfillment_transition(text,text,text,text,text)`;
2. `grainline_order_buyer_receipt_confirm(text,text)`; and
3. `grainline_order_seller_notes_update(text,text,text)`.

All three are `SECURITY DEFINER`, pin `search_path = pg_catalog`, revoke PUBLIC
execution and grant only their exact signatures to `grainline_app_runtime`.
The migration changes no policy, RLS posture or table grant.

## Authority and lock contract

Every operation validates bounded identifiers, locks the active actor `User`
before locking the exact `Order`, and derives ownership from durable Order
columns. Seller operations require `Order.sellerProfileId` to equal the active
seller's profile. Buyer receipt requires `Order.buyerId` to equal the active
buyer. Mutable Listing ownership is never consulted.

Seller fulfillment permits only:

- paid shipping Order: `PENDING -> SHIPPED`, with an allowlisted carrier and a
  bounded tracking number; or
- paid pickup Order: `PENDING -> READY_FOR_PICKUP`, with no tracking evidence.

It rejects active Cases, retained refund evidence, an open Stripe dispute,
the seller-deauthorization review hold, a purchased Grainline label, method
mismatch and stale state.

Buyer receipt permits only:

- shipping/null-method compatibility: `SHIPPED -> DELIVERED`; or
- pickup: `READY_FOR_PICKUP -> PICKED_UP`.

It rejects active Cases, retained refund evidence, open Stripe disputes,
unpaid Orders and stale/mismatched state. Both terminal timestamps therefore
remain buyer-authored Case-window evidence.

Seller notes are a distinct private scratch-note operation. They cannot inherit
fulfillment authority, cannot be set after buyer-data purge and require a paid
Order. They remain editable after a refund for seller recordkeeping, matching
the predecessor product behavior. The audit records only note presence, never
note text.

## Derived evidence and delivery reliability

The transition functions derive their PostgreSQL clock, previous/new state and
unique `SystemAuditLog` identity internally. The application finalizer uses the
returned audit identity to co-commit:

- the source-validated in-app Notification; and
- for seller shipping/readiness, one deterministic `EmailOutbox` reservation.

The direct email attempt occurs only after commit. A process exit or provider
failure leaves the same outbox row for the scheduled worker; retrying the HTTP
request cannot create a second Order transition or a differently keyed email.
Current active buyer email/name are selected for delivery rather than retained
Order snapshot contact fields. A paid-order transition does not depend on an
active Notification recipient: banned or deleted counterparties yield no
Notification/email target while the exact fulfillment or receipt state change
still commits.

## Verification in this checkpoint

- Disposable PostgreSQL proves shipping, delivery, pickup readiness, buyer
  pickup, seller notes, derived audits, forged seller/buyer rejection, active
  Case rejection and direct runtime table-write denial.
- Static release tests pin all migration bytes, three functions, grants,
  search paths, locks and unchanged table/RLS posture.
- Application contract tests prove both routes have no direct Order mutation,
  notification or audit authority.
- The final disposable PostgreSQL proof passes all four authority/state cases,
  including inactive-counterparty progress and post-refund private notes.
- The complete local suite passes 3,817 tests with 7 intentional skips and
  zero failures across 482 suites (3,824 total tests).
- TypeScript passes. Lint passes with only the pre-existing
  `jsx-ast-utils` unresolved-expression warning. `git diff --check` passes.

Migration SHA-256:
`c0d139eebe55bd481116c2a2d66699525e397db72dad8f358d948852264cd5fc`.

## Remaining release gates

This release is not permission to apply the migration. Before production it
still needs full repository gates, CI PostgreSQL proof, exact migration-tree
integration, production-scope verification, compatible application sequencing,
authenticated shipping/pickup/note smoke and predecessor drain. Order Phase A
and FORCE remain later, separate releases after every remaining direct Order
consumer is converted.
