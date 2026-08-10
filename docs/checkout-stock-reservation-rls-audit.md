# CheckoutStockReservation RLS authority audit

Status: audited fixed-operation design; implementation and production posture
are unchanged. This document does not authorize a migration, deployment, grant
change, cleanup, RLS activation or provider mutation.

Date: 2026-08-10

## Scope and current posture

`CheckoutStockReservation` is the next service ledger in the Order, payment and
shipping program. It currently has RLS and FORCE off, zero policies and broad
ordinary-runtime table access. The protected 54-count production inspection in
run `30963859119` reported zero structural or integrity inconsistencies, but it
was classification evidence rather than an authority change.

The table is not an owner-CRUD table. It is a stock state machine shared by:

- single-listing and seller-cart checkout creation;
- Stripe session binding and signed checkout completion;
- checkout/session failure restoration;
- the bounded stale-reservation cron and terminal retention job;
- account-deletion restoration and identifier scrubbing;
- buyer checkout resume; and
- buyer/seller account export.

The target is policyless ENABLE and later FORCE RLS, zero direct runtime/PUBLIC
table or column grants, and a fixed operation for every legitimate path.

## Exact direct-access inventory

| Source | Current access | Required destination |
|---|---|---|
| `src/lib/checkoutStockRestore.ts` | create, bind, complete, restore, defer, stale scan and terminal prune | source-derived create functions, exact bind/complete, generation-fenced repair claim/finalize and database-selected prune |
| `src/lib/accountDeletion.ts` | account-owned active scan, restore and identifier scrub | account-bound repair claim plus dedicated account scrub operation |
| `src/app/api/cart/checkout/resume/route.ts` | recent completed buyer rows | buyer-bound bounded resume projection |
| `src/app/api/account/export/route.ts` | buyer/seller rows and role-specific redaction | actor-bound export projection with seller profile derived in PostgreSQL |

Checkout and webhook routes call the shared helper rather than the Prisma
delegate directly. The scanner must continue to inventory both those semantic
call sites and the four direct-access source files until conversion reaches
zero ordinary-runtime base-table access.

## Findings

### CSR-A01: one generic restore function is over-authorized

`restoreCheckoutStockReservationOnce()` accepts a reservation ID, optional
session ID and free-form reason. A compromised ordinary runtime could restore
another buyer's active reservation and make sold stock available again. RLS
cannot make that generic cross-user mutation safe.

Replace it with separately source-bound operations:

1. an authenticated checkout-abort operation restricted to the same buyer,
   replay fingerprint and an unbound reservation;
2. a signed `checkout.session.expired` operation bound to the active exact
   `StripeWebhookEvent` generation and stored session;
3. a database-selected stale-repair claim/finalize protocol; and
4. an account-owned deletion-repair claim/finalize protocol.

No public/runtime function accepts a free-form restore reason. The database
derives the retained reason from the reviewed operation and outcome.

### CSR-A02: provider repair needs a durable generation fence

Stripe retrieval/expiry cannot occur inside the database transaction. A worker
can therefore pause after reading provider state while a payment webhook or a
new repair changes the reservation. ID-only finalization has the same ABA
shape previously fixed on `StripeWebhookEvent`.

Compatible preparation must add a monotonic repair generation and claim clock.
Claim operations select eligible rows in stable database order, increment the
generation under row locks and return only the bounded provider facts required
by the worker. Finalize compares the exact generation, rechecks Order/session
state and either restores, completes, defers or reports superseded. A stale
worker cannot finalize a newer claim.

### CSR-A03: checkout error cleanup can restore before Stripe is safely closed

Both checkout routes keep only the reservation ID outside their main `try`.
Their outer error handler restores that reservation even if a Stripe session
was already created and bound. An unexpected failure after session creation
can therefore return stock while the external session remains payable.

The compatible application change must retain the created session ID, attempt
to expire it before any bound-reservation restore, and leave the reservation
for the stale-repair worker if expiry is not confirmed. The database checkout-
abort operation restores only an unbound reservation; a bound session uses a
source-bound webhook or repair finalizer.

### CSR-A04: repair diagnostics currently violate terminal reason semantics

`deferCheckoutStockReservationRepair()` writes transient failure reasons into
`restoreReason`, while the inspection contract treats `restoreReason` as
RESTORED-only terminal evidence. Preparation must add separate bounded repair
diagnostic/attempt columns. `restoreReason` and `restoredAt` remain null for all
non-RESTORED states.

### CSR-A05: the stored replay fingerprint contract is inconsistent

The application stores a 32-character base64url SHA-256 prefix, the schema
allows 64 characters, and the legacy inspector tested for 64 lowercase hex
characters at the start of this audit. The zero-count production result likely
reflects an empty or fully terminal/pruned table, not agreement among those
contracts.

Do not silently change the Redis fingerprint algorithm during RLS conversion.
Preparation must validate the deployed 32-character base64url form plus the
documented `deleted` account-scrub sentinel. This isolated checkpoint corrects
the aggregate inspector and regression tests to that contract. A later
full-length hash migration, if desired, is a separate Redis/deployment
coexistence change.

### CSR-A06: caller item arrays and lock keys are unnecessary authority inputs

The current helper accepts `checkoutLockKey`, seller IDs and a JSON item array.
The database already has the Cart, CartItem and Listing sources needed to
derive them. Fixed creation is split by source:

- cart creation accepts the authenticated buyer, exact Cart, seller-profile ID,
  checkout-group ID and application-derived replay fingerprint; PostgreSQL
  locks the owned Cart/CartItems/Listings, validates one seller and derives the
  canonical lock key and reservable item array;
- single creation accepts the authenticated buyer, Listing, quantity and
  replay fingerprint; PostgreSQL locks the Listing, derives its seller and the
  canonical lock key/item array.

The caller cannot omit an in-stock cart line, substitute a seller, forge a
quantity or provide the retained `reservedItems` payload.

### CSR-A07: the database cannot authenticate Stripe or Clerk by itself

Stripe signature verification and Clerk actor resolution remain application
boundaries. A holder of the ordinary runtime credential can still invent a
function argument. Fixed operations nevertheless remove arbitrary table
enumeration and generic row mutation, derive relationships and targets from
locked rows, fence races and restrict each call to one reviewed transition.
Do not claim they cryptographically attest provider or actor identity.

### CSR-A08: stale repair returns bounded cross-user provider identifiers

The cron must retrieve/expire exact Stripe sessions, so its claim projection
necessarily returns a bounded batch of cross-user session IDs. It may return
only database-selected overdue active rows, under a short generation lease and
hard cap. It may not accept target IDs, arbitrary cutoffs or arbitrary page
cursors. A dedicated cron database role would further reduce request-runtime
blast radius, but is a separate credential/topology decision and is not silently
assumed for this release.

### CSR-A09: account-scrub item shape differs from active item shape

Account deletion deliberately removes `sellerId` from each retained item and
sets the replay fingerprint to `deleted`, but the baseline inspector required a
seller ID in every item. The isolated correction now recognizes exactly two
shapes: normal rows require seller ID, while a `deleted` row must have terminal
status, null buyer/seller columns, a `deleted:<reservation-id>` lock key and no
item seller IDs. This preserves minimal listing/quantity audit evidence without
retaining deleted-account linkage.

## Fixed-operation partition

The reviewed signatures may narrow during disposable PostgreSQL proof, but may
not broaden beyond these capabilities:

1. `grainline_checkout_reservation_create_cart(...)` derives Cart ownership,
   seller, lock key, item set, stock decrements, expiry and retained payload.
2. `grainline_checkout_reservation_create_single(...)` derives Listing seller,
   lock key, item payload and stock decrement.
3. `grainline_checkout_reservation_bind_session(...)` binds once by exact
   reservation, buyer and replay fingerprint; a session cannot move.
4. `grainline_checkout_reservation_complete(...)` requires an active exact
   Stripe webhook generation and matching durable Order/session/buyer/seller.
5. `grainline_checkout_reservation_checkout_abort(...)` restores only an exact
   buyer/replay-bound reservation with no bound Stripe session or Order.
6. `grainline_checkout_reservation_webhook_restore(...)` requires an active
   exact signed-expiry webhook generation and matching stored session.
7. `grainline_checkout_reservation_repair_claim_batch(...)` claims only
   database-selected overdue rows in stable order with a hard cap.
8. `grainline_checkout_reservation_account_claim_batch(...)` claims only active
   rows belonging to the exact deleting account or its derived seller profile.
9. `grainline_checkout_reservation_repair_finalize(...)` compares the exact
   repair generation and permits only reviewed provider outcomes.
10. `grainline_checkout_reservation_prune_batch(...)` deletes only terminal
    rows older than the fixed retention window, in stable order, with a cap.
11. `grainline_checkout_reservation_resume(...)` returns only recent COMPLETED
    session/group facts for the exact buyer.
12. `grainline_checkout_reservation_export(...)` derives the seller profile and
    returns the existing buyer/seller-redacted export shape for the exact actor.
13. `grainline_checkout_reservation_account_scrub(...)` derives account-owned
    rows, preserves only canonical listing/quantity evidence and clears actor
    identifiers after active reservations have been handled.

All functions use a pinned `search_path`, no dynamic SQL, bounded inputs and
database UTC clocks. `PUBLIC` receives no EXECUTE. Trigger helpers, if any,
remain owner-private. Ordinary runtime receives EXECUTE only for these exact
operations after disposable PostgreSQL authority/concurrency proof.

## Lock order and race contract

The global order for contended reservation work is:

1. advisory checkout-session keys in sorted order when a session exists;
2. reservation row `FOR UPDATE`;
3. Cart/CartItem source rows for cart creation or Listing rows in sorted ID
   order;
4. exact Order existence/authority row; and
5. stock updates in sorted Listing ID order.

Creation has no session and begins with its source rows before inserting the
reservation; all paths that can race with paid checkout completion must take
the same session advisory key before checking Order or restoring stock. Proofs
must cover payment-vs-restore, two restore workers, stale generation finalizers,
bind-vs-abort and prune-vs-finalize.

## Release sequence

1. Save this audit and an exact source/capability inventory.
2. Build additive schema/functions and prove them in disposable PostgreSQL;
   keep broad predecessor grants and RLS off.
3. Promote only the byte-pinned compatible preparation migration and run an
   actual pooled-runtime read-only postflight.
4. Deploy a dual-compatible application using the fixed functions; prove
   checkout creation, signed completion, failed-session restoration, cron,
   account deletion, resume and export.
5. Drain predecessor application versions and prove zero direct runtime
   `CheckoutStockReservation` accesses.
6. Apply policyless ENABLE RLS and revoke direct table/column privileges; run
   pooled-runtime/service proofs.
7. Apply FORCE separately and repeat the proofs.

No step here authorizes production mutation. StripeWebhookEvent FORCE remains
its own earlier production boundary; preparing this isolated reservation work
does not reorder or implicitly execute it.
