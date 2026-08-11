# CheckoutStockReservation RLS authority audit

Status: isolated compatible authority draft and application conversion in
progress; production posture is unchanged. This document does not authorize a
migration, deployment, grant change, cleanup, RLS activation or provider
mutation.

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

The four rows below are the predecessor baseline captured at audit start:

| Source | Current access | Required destination |
|---|---|---|
| `src/lib/checkoutStockRestore.ts` | create, bind, complete, restore, defer, stale scan and terminal prune | source-derived create functions, exact bind/complete, generation-fenced repair claim/finalize and database-selected prune |
| `src/lib/accountDeletion.ts` | account-owned active scan, restore and identifier scrub | account-bound repair claim plus dedicated account scrub operation |
| `src/app/api/cart/checkout/resume/route.ts` | recent completed buyer rows | buyer-bound bounded resume projection |
| `src/app/api/account/export/route.ts` | buyer/seller rows and role-specific redaction | actor-bound export projection with seller profile derived in PostgreSQL |

The isolated conversion currently has zero direct
`prisma.checkoutStockReservation`/`tx.checkoutStockReservation` delegates
under `src`. That is not a production claim: main and the deployed application
remain on the predecessor until compatible functions are packaged, promoted
and proven. Semantic-call inventory now pins the checkout, webhook, buyer
rollback, seller/admin expiry, cron, account deletion, resume and export paths
so zero direct delegates cannot hide an omitted capability.

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

### CSR-A10: unpaid completion currently restores still-payable stock

The completion branch retrieves the current Checkout Session and previously
called the unordered restoration path whenever `payment_status` was not
`paid`. That is not valid restoration evidence: a completed session can be in
an intermediate payment state, and the same session may later settle. Even
though the current checkout routes request only cards, reopening the listing
before a signed failure/expiry or provider repair can oversell it.

The isolated compatible checkpoint now retains the reservation on an unpaid
completion and records a bounded warning. Only a signed
`checkout.session.async_payment_failed`/`checkout.session.expired` event or the
generation-fenced repair path may restore it. A separately signed
`checkout.session.async_payment_succeeded` may complete it.

### CSR-A11: the first semantic inventory omitted provider-expiry callers

The initial four-file direct-delegate scan did not enumerate the authenticated
buyer rollback route or the seller/admin/ban/vacation session-expiry helper.
Those callers reach reservation restoration indirectly and cannot safely use
either a signed-webhook function or a generic restore-by-ID function.

The partition therefore has separate buyer-expired and seller-expired
operations. Each verifies the caller-resolved actor relationship against the
stored reservation and exact session, takes the shared session lock, refuses
to restore if an Order exists and derives a fixed terminal reason. PostgreSQL
cannot verify Stripe's external session state, so the signed-in route/provider
retrieve/expire checks remain load-bearing and are documented rather than
misrepresented as database attestation.

### CSR-A12: a webhook lease was not bound to its Stripe object

`StripeWebhookEvent` retained event ID, type and claim generation, but not the
signed event's source object ID. The first draft therefore allowed one valid
active expiry claim to be paired with a different Checkout Session ID. Event
generation fencing prevents stale workers; it does not prevent source-target
substitution.

Compatible preparation now requires nullable bounded
`StripeWebhookEvent.sourceObjectId` plus
an overloaded three-argument `grainline_stripe_webhook_begin(...)`. That single
database statement acquires/reclaims the lease and invokes the private
`grainline_stripe_webhook_bind_source(...)` helper before it can commit, so a
failed binding cannot leave a partially claimed event. The binding is immutable,
and checkout completion/restoration requires the stored object ID to equal the
exact session. The binder is not runtime-callable. Legacy two-argument lease
acquisition remains available only for old-deployment coexistence and is a
later drain/revocation item once all event callers use the bound overload.
Production currently pins exactly six StripeWebhookEvent runtime functions, so
compatible migration packaging must deliberately update the global function
catalog and grant/postflight proofs for the temporary seventh overload while
keeping the binder private. After the predecessor app drain, the old two-
argument begin can be revoked/dropped so the durable surface returns to one
begin capability rather than accumulating both.

### CSR-A13: account cleanup is intentionally retry-bounded

Account deletion claims at most 50 active reservation rows per attempt. The
terminal scrub refuses to run while any account-owned active row remains, so a
high-volume seller with more than one batch fails closed and can be retried;
it does not partially anonymize active state. Do not describe this as an
unbounded one-pass cleanup. Before production promotion, prove the retry path
and decide whether an explicit multi-batch operator is warranted by retained
production counts.

### CSR-A14: reservation creation must serialize with account deletion

The first fixed creation draft checked buyer state but did not lock either the
buyer or seller account lifecycle row. Account deletion takes the User row
`FOR UPDATE`, repairs active reservations before its anonymization transaction,
then scrubs reservation identifiers inside that transaction. A reservation
created between those two stages would correctly make scrub fail closed, but
would force an avoidable deletion retry; weaker scrubbing could have missed it.

Both creation functions now resolve the seller account, lock buyer and seller
User rows in sorted ID order `FOR KEY SHARE`, then revalidate buyer state,
seller state, Stripe orderability, vacation/acceptance state and self-purchase
before locking Cart/Listing sources. Creation therefore commits before account
deletion's scrub or waits for deletion and observes terminal account/listing
state. The disposable PostgreSQL proof pins the sorted locks plus banned,
vacation and self-purchase denial.

### CSR-A15: a payload hash is not a Redis lock ownership token

The predecessor preparing lock stored only the checkout payload hash. If a
worker outlived the 32-minute Redis TTL, a newer identical request could acquire
the same key with the same hash; the stale worker could then publish its old
Stripe session into the new lock or unconditionally delete the new worker's
lock during error cleanup. This is an ABA ownership collision even though the
payloads are equal.

Every new preparing lock now carries a cryptographically random acquisition
owner token. The atomic ready transition requires state, payload hash and exact
owner token. Pre-session cleanup deletes only a preparing lock with that token;
post-transition cleanup deletes only a ready lock with the exact Stripe session
ID. Error recovery attempts both exact comparisons only after provider expiry
and database restoration are confirmed. Legacy preparing locks without an
owner token fail closed and expire by TTL. Regression tests pin mismatched,
legacy and stale-owner denial and forbid unconditional route cleanup.

### CSR-A16: validating a webhook generation without locking it is racy

The first source-bound completion/restore draft checked event ID, type, source
object, generation and active state but did not lock that webhook lease row. A
lease could be failed, completed or reclaimed after the check while the stale
reservation operation continued under its earlier statement snapshot.

Both signed completion and signed restoration now lock the exact active
`StripeWebhookEvent` row `FOR UPDATE` before taking the checkout-session
advisory lock or touching a reservation. The lock holds the generation and
source binding stable for the entire statement/transaction and makes a
concurrent reclaim/finalization wait, after which its predicate is rechecked.
Static proof pins this ordering in both functions. This lock must remain first
when the later Order-creation fixed operation absorbs reservation completion.

### CSR-A17: a private function in a CHECK constraint breaks old-runtime coexistence

The first promoted candidate used the private item-validator both from the
normalization trigger and directly from a CHECK constraint. A runtime-role
INSERT after preparation failed with `permission denied for function` because
PostgreSQL evaluates the CHECK expression under the caller while the revoked
validator is intentionally not runtime-executable. Keeping table CRUD grants
therefore did not actually preserve the old application.

The corrected candidate retains the private validator behind the
`SECURITY DEFINER` normalization trigger and removes only the redundant direct
CHECK-function expression. Runtime cannot call the validator or trigger
function directly, but every INSERT/UPDATE still passes through the trigger's
same item-shape validation. Disposable PostgreSQL now proves predecessor
runtime INSERT, diagnostic UPDATE normalization and DELETE after preparation,
along with the exact 20-signature ACL/catalog partition. The failed candidate
was never merged, migrated or deployed.

### CSR-A20: the first promoted preflight trusted stale role and predecessor proofs

The initial compatible preflight rechecked only that the runtime role was not
superuser/BYPASSRLS, that the event table had FORCE, and that reservation CRUD
still existed. That was insufficient at a later production boundary: role
membership, column/PUBLIC ACLs, or the two-argument webhook-begin function
could drift after the earlier StripeWebhookEvent acceptance while still
passing those coarse checks.

The replacement preflight re-attests the full LOGIN/NOINHERIT/non-privileged
runtime posture, permits only Neon's proven non-effective owner-to-runtime
bootstrap membership, rejects every other recursive membership, rejects
PUBLIC and column authority, pins the exact predecessor webhook function body
and ACL, requires the reviewed owner identity and drained owner sessions, and
takes bounded advisory plus table locks before DDL. Production remains
untouched; this was caught during the isolated Extra-High review.

Disposable PostgreSQL tamper proofs now change each load-bearing predecessor
dimension independently and require the migration to abort before adding
`sourceObjectId`: runtime `INHERIT`, an unreviewed role-membership edge, a
missing required CRUD grant, a PUBLIC column grant, and source-only drift in
the sealed two-argument webhook function. These supplement the
byte-level/static release assertions with engine-executed fail-closed evidence.

### CSR-A21: the Prisma repair index did not match the promoted catalog

The compatible migration creates the bounded repair-worker index as
`CheckoutStockReservation_repair_claim_idx(status, expiresAt,
repairClaimedAt, id)`, using `id` as the deterministic final ordering key.
The first packaged Prisma schema instead declared an implicit three-column
index with a generated name. Migration execution and `prisma validate` do not
compare a live catalog to the declarative schema, so both CI checks passed
while a future generated migration could have added a redundant index.

The schema now declares the exact four columns and maps the exact database
name. A release test pins that mapping. No database change is required because
the promoted migration already creates the intended index; this is a
declarative-schema correction caught before merge or production.

### CSR-A22: preparation duplicated the existing status constraint

The original reservation migration already installs and validates
`CheckoutStockReservation_status_chk` for the four lifecycle states. The
first authority candidate added an equivalent
`CheckoutStockReservation_status_check`, which would have duplicated
write-time constraint evaluation and made later catalog reasoning needlessly
ambiguous.

The authority preflight now requires both original validated checks
(`status_chk` and `reservedItems_array_chk`) and executable tamper proof removes
one to prove the migration fails closed. The redundant new status constraint
has been removed; the three genuinely additive checks remain. This was caught
before merge or production.

### CSR-A23: the first activation column-ACL check rejected required table CRUD

The first Phase-A draft used `has_any_column_privilege` to reject explicit
runtime column grants while also requiring the compatible predecessor's direct
table CRUD. PostgreSQL includes table-level authority when evaluating that
helper, so the required table grant made the preflight report forbidden column
authority and abort every valid activation.

The activation and database-first rollback now inspect `pg_attribute.attacl`
directly for PUBLIC/runtime column ACL entries. Disposable PostgreSQL proves a
clean predecessor activates and rolls back, while a real explicit column grant
still aborts without partially changing RLS or grants.

### CSR-A24: PUBLIC is not a role name for privilege inquiry functions

The first activation function audit called
`has_function_privilege('PUBLIC', oid, 'EXECUTE')`. `PUBLIC` is a pseudo-role
accepted by GRANT and REVOKE, not a catalog role resolvable by that inquiry
overload, so PostgreSQL raised `42704 role "PUBLIC" does not exist` before
activation.

The redundant call is removed. The exact function ACL audit already uses
`aclexplode` and rejects grantee OID zero, which is PostgreSQL's canonical
PUBLIC representation. A static class guard prevents the invalid inquiry from
returning.

### CSR-A25: name-only trigger, constraint and index checks were insufficient

The initial activation draft counted the expected trigger and catalog object
names, but did not reject an extra trigger or prove that a same-named CHECK or
index retained its reviewed definition. That could admit a write-intercepting
trigger, a weakened uniqueness predicate, or an operationally breaking extra
constraint.

The preflight now requires exactly one non-internal trigger, five exact
validated CHECK definitions, and nine exact index shapes including ordered key
columns, uniqueness/primary flags, no expressions/includes, and the reviewed
active-lock predicate. Disposable PostgreSQL tamper tests add an extra trigger
and replace an index and constraint with same-named lookalikes; every variant
aborts atomically.

### CSR-A26: the global grant audit needed an explicit reservation activation disposition

The first isolated activation proof changed the table to an intentionally
policyless service ledger, but the site-wide live grant audit still derived
compatible predecessor CRUD and classified any enabled zero-policy reservation
table as unexpected. Leaving that consumer unchanged would make the reviewed
activation succeed and the mandatory global audit fail immediately afterward.

The audit now derives the reservation state from the migration inventory. It
expects zero ordinary-runtime table privileges and policyless ENABLE after the
Phase-A migration is present, expects FORCE only after the later FORCE
migration is present, and still rejects every other zero-policy table. Unit
coverage proves the compatible, ENABLE and FORCE dispositions separately.

### CSR-A27: owner-session SET ROLE is not actual pooled-runtime identity proof

Disposable PostgreSQL can execute catalog and authority checks after
`SET LOCAL ROLE grainline_app_runtime`, but `SESSION_USER` remains the owner
that opened the connection. Treating that session as production-runtime proof
would repeat the owner-simulation error avoided elsewhere in the RLS program.

The reusable activated-catalog verifier runs under the disposable runtime role,
while the production postflight separately requires a real pooled runtime
login and asserts `CURRENT_USER = SESSION_USER = grainline_app_runtime`, the
complete restricted-role posture and no owner membership. It also runs inside
an engine-attested repeatable-read read-only transaction and writes only
sanitized mode-0600 evidence.

### CSR-A28: activation packaging must not create a deploy-discoverable migration early

The compatible preparation still has deployment, drain and inspection gates.
Creating the activation directory under `prisma/migrations` now would let a
generic migration deploy discover a security-reviewed but operationally
premature release.

The activation candidate builder therefore has only a read-only `--verify`
mode. It pins activation, rollback and function-source bytes, constructs the
proposed migration in memory, rejects expanded authority or row mutation, and
reports the deterministic hash without creating a migration directory. Actual
promotion remains a separate exact-head release after the predecessor gates.

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
   exact signed-expiry webhook generation whose immutable source object matches
   the stored session.
7. `grainline_checkout_reservation_buyer_expired_restore(...)` restores only a
   session owned by the exact Clerk-resolved buyer after the route confirms
   provider expiry.
8. `grainline_checkout_reservation_seller_expired_restore(...)` restores only a
   session belonging to the exact seller profile after the reviewed seller,
   staff, ban or vacation path confirms provider expiry.
9. `grainline_checkout_reservation_repair_claim_batch(...)` claims only
   database-selected overdue rows in stable order with a hard cap.
10. `grainline_checkout_reservation_account_claim_batch(...)` claims only active
   rows belonging to the exact deleting account or its derived seller profile.
11. `grainline_checkout_reservation_repair_finalize(...)` compares the exact
   repair generation and permits only reviewed provider outcomes.
12. `grainline_checkout_reservation_prune_batch(...)` deletes only terminal
    rows older than the fixed retention window, in stable order, with a cap.
13. `grainline_checkout_reservation_resume(...)` returns only recent COMPLETED
    session/group facts for the exact buyer.
14. `grainline_checkout_reservation_export(...)` derives the seller profile and
    returns the existing buyer/seller-redacted export shape for the exact actor.
15. `grainline_checkout_reservation_account_scrub(...)` derives account-owned
    rows, preserves only canonical listing/quantity evidence and clears actor
    identifiers after active reservations have been handled.

All functions use a pinned `search_path`, no dynamic SQL, bounded inputs and
database UTC clocks. `PUBLIC` receives no EXECUTE. Trigger helpers, if any,
remain owner-private. Ordinary runtime receives EXECUTE only for these exact
operations after disposable PostgreSQL authority/concurrency proof.

## Lock order and race contract

The global orders for contended reservation work are:

1. Creation: buyer/seller User rows in sorted ID order, owned Cart then
   CartItem/Listing rows in sorted ID order, reservation insert and stock
   updates in sorted Listing ID order.
2. Signed session transitions/restoration: exact active StripeWebhookEvent row
   `FOR UPDATE`, advisory checkout-session key, reservation row `FOR UPDATE`,
   exact Order existence/authority row, then stock updates in sorted Listing ID
   order. Provider-confirmed buyer/seller and repair transitions omit only the
   webhook-event step and otherwise keep the same session order.
3. Unbound abort: reservation advisory key, reservation row `FOR UPDATE`, then
   stock updates in sorted Listing ID order.

All paths that can race with paid checkout completion take the same session
advisory key before checking Order or restoring stock. Proofs must cover
account-deletion-vs-creation, payment-vs-restore, two restore workers, stale
generation finalizers, bind-vs-abort and prune-vs-finalize.

The Redis lock is a separate application-level duplicate-session guard, not
database authority. Its preparing phase is acquisition-owner-token bound and
its ready phase is Stripe-session bound; payload equality alone never conveys
ownership.

## Release sequence

1. Save this audit and an exact source/capability inventory.
2. Build additive schema/functions, including immutable Stripe event source-
   object binding, and prove them in disposable PostgreSQL; keep broad
   predecessor grants and RLS off.
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

## Isolated implementation checkpoint (2026-08-10)

The isolated branch now has zero direct `CheckoutStockReservation` Prisma
delegates under `src`, a 15-operation fixed authority draft, atomic source-bound
Stripe lease acquisition with a runtime-private binder, generation/event locks,
database-derived reservation payloads and owner-token-bound Redis publication.
The disposable PostgreSQL proof passes 13 checks (12 engine-executed authority/
state checks plus one static catalog contract). TypeScript, focused ESLint and
the complete repository suite pass; the final full run was 2,938 passed, zero
failed and seven intentionally skipped.

## Compatible migration packaging checkpoint (2026-08-10)

The reviewed draft is now promoted byte-for-byte as isolated migration
`20260810190000_prepare_checkout_stock_reservation_authority`; Prisma records
the source-binding and repair fields, the migration prefix is sealed, a
signature-level 16-runtime/4-private catalog is shared by grant convergence and
tests, and CI isolates the candidate until the prior StripeWebhookEvent FORCE
proof passes. Exact hashes and remaining gates are retained in
`docs/checkout-stock-reservation-authority-release.md`.

The first promoted disposable proof exposed an invalid
`pg_catalog.current_user` qualification. PostgreSQL rejected the transaction
before schema mutation; the candidate now uses bare `current_user`, and the
repository-wide PostgreSQL special-form guard already covers this class. The
replacement proof passes, including a fail-closed test that proves a non-FORCE
StripeWebhookEvent predecessor cannot acquire any new column.

This remains a production-inert candidate. The production migration workflow
is intentionally not wired, production has not been queried or mutated in this
checkpoint, CheckoutStockReservation RLS remains off, and the separate
StripeWebhookEvent FORCE production release plus a fresh aggregate reservation
inspection remain prerequisites.

Two compatibility defects were found and closed during promotion:

- `CSR-A17`: a CHECK constraint called an owner-private validator, which made
  predecessor direct runtime INSERT/UPDATE fail after EXECUTE was revoked. The
  redundant constraint was removed; the normalization trigger still invokes
  the validator with owner authority, and PostgreSQL now proves predecessor
  runtime SELECT/INSERT/UPDATE/DELETE compatibility.
- `CSR-A18`: the historical StripeWebhookEvent source catalog keyed functions
  only by name, so the new three-argument `grainline_stripe_webhook_begin`
  overload could replace the sealed two-argument source in byte-pin checks.
  Source discovery and both production catalog readers now match exact
  `name + oidvectortypes(proargtypes)` identities. A two-overload regression
  fixture proves the sealed source cannot be shadowed by a later overload.
- `CSR-A19`: the first exact-signature reader qualified PostgreSQL's multi-array
  `unnest` special form. The repository-wide parser-form guard rejected both
  readers before release; they now use bare `unnest` while retaining
  schema-qualified catalog relations and type rendering.
