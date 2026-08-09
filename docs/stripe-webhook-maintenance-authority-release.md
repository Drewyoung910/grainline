# Stripe webhook maintenance-authority release

Status: merged and applied as compatible database preparation; the compatible
application source is merged but has not been deployed. StripeWebhookEvent RLS
and table-grant revocation remain off.

## Exact release boundary

- migration: `20260805040000_prepare_stripe_webhook_maintenance_authority`
- migration SHA-256:
  `0c34cc94f6a602e8f686487277b422f3ba4e89a1f2c50b9b3b673cb63d259df5`
- migration-tree SHA-256:
  `551be631510a20c58eae7b1e84f84d23890d5c2e82b0d1332c7f9f266744f22d`
- guarded phase: `stripe-webhook-maintenance-authority-reviewed`
- pull request: `#162`
- final reviewed branch head: `8abaa36fafd989604a06aa2fee9f1a215e5763b1`
- main merge commit: `1fbf17845d72403d8ff28cd038119114583eba04`
- exact release main commit: `423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1`
- exact-main CI: `31284293394`
- guarded production migration run: `31290691183`

This is compatible preparation, not RLS activation. It creates exactly three
fixed `SECURITY DEFINER` functions, revokes `PUBLIC`, grants their exact
signatures to `grainline_app_runtime`, and leaves all StripeWebhookEvent table
grants and RLS posture unchanged. No row data is rewritten by the migration.

## Fixed authority

`grainline_stripe_webhook_prune_batch(integer)` derives a 90-day cutoff from
the PostgreSQL UTC clock, clamps the batch to 1,000 and deletes only processed
rows in stable `(processedAt,id)` order under `FOR UPDATE SKIP LOCKED`. The
caller supplies neither IDs nor a cutoff. It deliberately retains the finite
legacy `checkout.session.stock_restored` claim class indefinitely: deleting
those dedup rows would permit a buyer-held old Checkout Session to replay a
second inventory restoration after the general retention window.

`grainline_stripe_webhook_health_summary()` returns only four aggregate counts
over a fixed two-minute stale-lease window. It cannot expose event IDs, event
types, errors or provider payloads.

`grainline_legacy_stock_restore_claim(text)` accepts only canonical Stripe
Checkout session IDs, derives the `checkout-stock-restore:` identity and fixed
event type inside PostgreSQL, takes the same transaction-scoped checkout lock,
and atomically returns first-claim versus replay. A collision with another type
or an unfinished row fails closed. PostgreSQL validates the identifier shape,
namespace and replay state; it cannot authenticate that the session exists at
Stripe. The signed webhook or authenticated rollback path remains that provider
trust boundary. A stolen runtime credential could mint canonical-shaped claim
rows and cause bounded availability pressure, but cannot select another event
type or directly restore stock through this function alone.

The application routes pruning, ops-health aggregation and the legacy stock
restore dedup operation through these functions. Ordinary application source
no longer performs direct StripeWebhookEvent maintenance reads, inserts or
deletes. Predecessor table grants deliberately remain during mixed-deployment
coexistence and must not be described as revoked until a later activation.

## Verification and remaining gates

The candidate is byte-pinned by its release verifier and deploy guard. Its
loopback-only PostgreSQL proof validates exact function ownership, search path,
grants, pruning boundaries, fixed health counts, canonical replay identity,
invalid collision rejection, advisory-lock waiting and complete rollback with
zero residue. CI runs the verifier, special-form regression test and disposable
PostgreSQL proof.

Earlier reviewed branch checkpoint
`78fb92546362d3744db924b312c27a7e915b279c` passed exact-head CI
`31279844745`. It is retained as proof history; the final merged head and
production release are the later exact identifiers in the release boundary
above.

Initial exact-head CI run `30974931167` stopped before the new proof because the
historical lease proof counted every function whose name began with
`grainline_stripe_webhook_`. The successor migration correctly increased that
prefix count from three to five. The historical proof now identifies only its
three exact lease function signatures with `oidvectortypes(proargtypes)`, so it
continues to prove its own boundary without treating reviewed successor
functions as drift. No production state was involved in the failed run.

Follow-up exact-head CI run `30975112231` passed that historical proof and then
stopped when the new PostgreSQL proof re-ran the complete deployment-tree guard
after CI had intentionally isolated the Case FORCE migration for later rollback
proofs. The release verifier remains the pre-isolation whole-tree gate. The
engine proof now invokes a separately named byte verifier for only its exact
maintenance migration, then proves the promoted functions from PostgreSQL's
catalog. This avoids treating CI's temporary proof workspace as a deployable
tree without weakening either boundary. Production was not involved.

Run `30975260896` then passed the prior exact release/tree verifiers, the historical
lease proof, the new 14-check maintenance catalog/behavior/concurrency proof,
the pooled-runtime compatibility proofs, all global RLS/grant audits,
TypeScript, lint, the full test suite, dependency audit and production build.
That run proves the implementation head above; the release remains a draft
stacked candidate and was not merged, deployed, migrated or applied to any
provider or production state.

The later Extra-High activation review correctly superseded that exact
maintenance migration byte by excluding permanent legacy stock-restore dedup
claims from general 90-day pruning. Deleting one of those rows could permit an
old buyer-held Checkout Session to restore inventory a second time. Fresh
exact-head CI is therefore required before this candidate can move.

The candidate was then synchronized with corrected PR #161 head
`d2ef37b4c86a0ff174016be77113fa1b888131b4`, whose exact-head CI run
`31278958695` passed. The synchronized maintenance candidate requires fresh
focused, full-suite and exact-head CI proof before it can move.

The Extra-High synchronized implementation checkpoint
`4c2dc09a9f832d930b9ab6160e65a545258cfcf3` passed exact-head CI run
`31279623247`. That run passed the byte/tree verifiers, promoted-migration
catalog and behavior proof, concurrency/rollback proof, TypeScript, lint,
2,812 tests (2,805 passed and 7 skipped), dependency audit and production
build. The review also made impossible aggregate health-count combinations
fail closed and documented the canonical-claim provider-auth boundary. The
Vercel Preview guard failed separately as expected because protected runtime
database environment is not exposed to this draft branch; nothing deployed.

Before StripeWebhookEvent RLS or table-grant revocation, use this exact
compatibility sequence:

1. merge PR #161, then merge this PR #162 at its reviewed exact head;
2. from the resulting exact main commit with green exact-main CI, run the
   guarded Production Migrations workflow and apply only
   `20260805040000_prepare_stripe_webhook_maintenance_authority`;
3. verify migration status and the global grant/RLS audit before deploying any
   application commit that contains this PR's maintenance call sites;
4. deploy the exact compatible application, exercise both signed webhook
   destinations plus retry, ops-health, retention and legacy stock restoration,
   and then drain the predecessor deployment; and
5. record the final predecessor pooled-runtime postflight before a separate
   activation release revokes table authority.

The migration is additive and retains predecessor table grants, so applying it
before the compatible deployment preserves old/new coexistence. Reversing
steps 2 and 4 would let the new ops-health, retention or stock-restore code call
functions that do not yet exist. A deploy guard is additional protection, not a
substitute for this ordering contract.

Production webhook destinations and legacy stock restoration must be proven,
and old deployment overlap must drain. Order, OrderItem,
CheckoutStockReservation, payment and shipping functions remain separate later
authority groups; this candidate does not claim their completion.

## Production acceptance (2026-08-08)

PR `#161` merged exact compatible-app head
`d2ef37b4c86a0ff174016be77113fa1b888131b4` as main
`0e2e1cce29089ab1418ff006b461d74b5f9804ca`. PR `#162` then merged exact
maintenance head `8abaa36fafd989604a06aa2fee9f1a215e5763b1` as main
`1fbf17845d72403d8ff28cd038119114583eba04`. The audit-only PR `#163`
merged exact head `73d302b85698d6af1e0a4e17abf0e590a091ef7a` to produce exact release
main `423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1`; exact-main CI
`31284293394` passed.

Guarded Production Migrations run `31290691183` checked out that exact commit,
passed the source, owner-role, phase-tree and byte-pinned release guards, and
applied only
`20260805040000_prepare_stripe_webhook_maintenance_authority`. Prisma then
reported the 191-migration tree up to date. The final global grant/RLS audit
passed for `grainline_app_runtime` across 64 tables, 22 enums, 138
`grainline_*` functions, one extension and zero sequence references.

The applied migration contains only the three reviewed additive fixed
functions. Its verifier attested `rlsChanged=false`,
`predecessorTableGrantsChanged=false` and `rowDataChanged=false`; no RLS,
FORCE, policy, table-grant, cleanup, deployment or provider change was part of
the run. The next boundary is the exact compatible application deployment and
path exercise, followed by predecessor drain and a final pooled-runtime
postflight. Activation remains a separate release.
