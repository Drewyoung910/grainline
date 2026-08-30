# OrderPaymentEvent transition authority

Status: compatible database preparation and application deployment live;
authenticated smoke accepted; predecessor drain and RLS activation remain
separate.

PR #347 exact head
`83e5bde9c8a9c024991da80464773e07cdf7e951` passed hosted CI
`33312775504` and merged as exact main
`dc4bb0d5b6e96a91db438dd13338c042df158e64`. Exact-main CI
`33313279623`, Notification FORCE regression run `33313279617` and
Conversation/Message FORCE regression run `33313279629` all passed. The PR's
Vercel Preview cloned the exact head, compiled and type-checked successfully,
then stopped at page-data collection solely because Preview intentionally has
no `DATABASE_URL`; production was not deployed or changed.

The isolated production package is restart-safe and accepts only the exact
predecessor or exact applied catalog. It binds an exact successful main CI and
aggregate-only production inspection, verifies the owner connection, refuses
later migrations, temporarily isolates this candidate while re-proving the
sealed aggregate-authority predecessor, applies only this migration, converges
the reviewed private grants, runs the global grant/RLS audit and re-reads the
complete catalog in an engine-attested repeatable-read/read-only transaction.
It does not enable RLS, remove predecessor CRUD or deploy application code.

## Production acceptance

Exact main `720f99522ab273332ee6ba577ecec1c356d86bc3` passed full CI
`33317024869`. Aggregate-only production inspection `33323654599` ran inside
an engine-attested `REPEATABLE READ READ ONLY` transaction, exported no rows or
identifiers and accepted the reservation-authority gate with all seven required
integrity counts at zero. The sanitized mode-`0600` inspection evidence has
SHA-256
`354ee3da9bed4e6b4a0adf65e4a290684f1f044d4e3760bf441e82504c2e6b75`.

Guarded production run `33326252495` applied only migration
`20260830020000_prepare_order_payment_event_transition_authority`, converged
the reviewed private-function grants, verified the complete migration ledger,
passed the global grant/RLS audit and accepted the exact post-application
scope. The independent pooled-runtime postflight then connected through the
actual `grainline_app_runtime` credential and re-proved the read, aggregate and
transition catalogs plus SQLSTATE `42501` denial for every private helper in an
engine-attested read-only transaction. It wrote no rows and retained sanitized
mode-`0600` evidence with SHA-256
`63eadf89f23a6fa729814bc7a39c0ea18a126db241bff8ba2aef725a5f5fb81b`.

Production now has the additive open-dispute projection and its three private
trigger helpers. `OrderPaymentEvent` RLS remains off and predecessor table CRUD
remains available to the currently deployed compatible predecessor. No
application deployment, provider change, cleanup or RLS activation occurred in
this release.

## Compatible application production deployment

Exact main `ce7550dae6c417440230f4d596f2239393075f31`, bound to successful
exact-main CI `33327064035` and accepted transition-authority migration run
`33326252495`, was manually deployed to Vercel Production as
`dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc`. Vercel reports production state `READY`,
exact source commit `ce7550dae6c417440230f4d596f2239393075f31` and deployment URL
`grainline-ees25wgos-drew-youngs-projects.vercel.app`.

All four canonical aliases resolve to the new deployment:

- `thegrainline.com`;
- `www.thegrainline.com`;
- `grainline.vercel.app`; and
- `grainline-drew-youngs-projects.vercel.app`.

`https://thegrainline.com/api/health` returned HTTP 200 with
`{"ok":true}`. The immediately preceding compatible production deployment
`dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj`, source
`4908bc7f377f5950da8de6b3398049d65a5fdfcb`, remains production `READY` at
`grainline-822kbxpu5-drew-youngs-projects.vercel.app` and was not drained.

This deployment changed application source only. It ran no migration, changed
no RLS bit or grant, did not change credentials or provider variables, and did
not mutate predecessor state. `OrderPaymentEvent` RLS remains off and
predecessor table CRUD remains retained. A bounded authenticated compatibility
smoke and later predecessor drain still precede the zero-direct-access gate,
policyless `ENABLE` and separate `FORCE` releases.

## Bounded authenticated compatibility smoke

The isolated next operator is
`scripts/order-payment-event-transition-production-smoke.mjs`. It binds the
exact current deployment, exact deployment-source CI, exact READY predecessor,
all four canonical aliases, canonical health and the accepted transition
migration/evidence identifiers. Before any Clerk session, it requires the exact
mode-`0600` pooled-runtime evidence file, re-hashes its sealed bytes and validates
its source, run bindings, runtime identity, RLS-off posture, retained predecessor
CRUD, read-only boundary and three private-helper denials. Its shared core retains the historical
aggregate-smoke filename so the earlier accepted operator remains traceable in
Git history; the transition launcher is the only current entry point.

The operator creates one 60-second session for the retained operational Clerk
canary, proves unauthenticated review denial, renders the database-backed
authenticated account page and reaches the authoritative locked
review-eligibility denial. It then revokes exactly that session, resets only the
canary's review limiter, removes only the exact account-state cache key and
writes fresh sanitized mode-`0600` evidence. It creates no database, Review,
Order, payment or provider fixture and changes no deployment or configuration.

This is deliberately a deployment/runtime compatibility smoke, not another
transition-authority proof. Its evidence states that transition routes are not
directly exercised and that the authority/concurrency proof remains separate.
The accepted disposable-PostgreSQL, separate-login and actual pooled-runtime
evidence continues to carry those semantic claims. Merely merging the operator
does not execute it or authorize predecessor drain or RLS activation.

### Accepted execution

PR #353 exact head `32814fa7d73171ff79b0d4d26584a054e8b2bb7d`
passed hosted CI `33329293870` and merged as exact main
`df9997795ceb3163247052cabacb6feb095918c8`. Exact-main CI `33329781065`
independently passed the complete PostgreSQL proof chain, TypeScript, lint,
3,619-test suite, high-severity dependency audit and production build. The PR's
Vercel Preview compiled and completed TypeScript, then failed only because the
intentionally isolated Preview environment has no `DATABASE_URL`.

The exact-main smoke re-attested current deployment
`dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc`, preserved READY predecessor
`dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj`, all four aliases, canonical health and the
sealed transition-authority evidence. Its sole 60-second operational-canary
session proved unauthenticated review denial (401), authenticated account
rendering (200) and the authoritative locked review-eligibility denial (403).
It created zero database, Review, Order, payment or provider fixtures.

Cleanup revoked the sole Clerk session and any unused sign-in ticket, reset
only the canary review limiter, deleted only the exact production account-state
cache key and removed the restart journal. Retain sanitized 1,561-byte
mode-`0600` evidence SHA-256
`9d0eacbf1062d8f2b370655d91e1f0e817a4a44edf4456d71a31c578cb07ab11`.
No migration, deployment, database row, RLS bit, grant, credential, provider
configuration or predecessor state changed. The next separate boundary is the
credential-epoch predecessor drain, followed by the zero-direct-access gate, policyless
`ENABLE` and separate `FORCE`; quote, `Order` and `OrderItem` remain separate.

## Credential-epoch inventory correction

A complete read-only Vercel inventory after smoke acceptance found that the
immediate READY predecessor is not the only callable artifact using the
post-recovery runtime credential. The conservative epoch starts at replacement
deployment provider timestamp `1786644755419`, before the 2026-08-13 recovery
operator completed. Twelve READY Production deployments remain after that
timestamp: current `dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc` and 11
superseded deployments. The 100-row page extends below the recovery cutoff, and
exact-ID inspection confirmed every reviewed epoch member READY with maximum
function timeout 300 seconds.

Accordingly, the next deployment boundary is no longer a one-ID removal. The
isolated restart-safe operator in
`docs/order-payment-event-credential-epoch-drain.md` removes the 11 reviewed
IDs oldest-first, refreshing full active Production inventory, current
deployment, all aliases and health around every exact deletion. It is not yet
executed and contains no database/RLS/grant operation. `OrderPaymentEvent` RLS
remains off with predecessor CRUD retained. The zero-direct-access gate remains
separate after the drain; only then may policyless ENABLE be prepared, with
FORCE still a later release.

## Decision

The remaining order-transition callers do not need payment-event rows. They
need two database-maintained facts on the parent `Order`:

- `paymentRefundBlocked`, prepared by the aggregate-authority release; and
- `paymentOpenDisputeBlocked`, prepared by this release.

Migration
`20260830020000_prepare_order_payment_event_transition_authority` adds the
second database-maintained `Order` projection, backfills it from the immutable
ledger and refreshes it after each `OrderPaymentEvent` insert. It changes no
RLS bit and no table or column grant. RLS and predecessor table grants remain
unchanged until the later, separate activation releases.

This avoids a generic runtime `has_payment_event(order_id)` function and avoids
giving order, label, refund or webhook routes authority to enumerate provider
evidence. Those callers now make their contended state change against the
projection on the same parent row they update.

## Canonical dispute state

The projection groups events by Stripe dispute object, using the immutable
event row ID only when no provider object ID exists. For each object it selects
the greatest provider event second; legacy rows without that field fall back
to their database `createdAt` second. The latest state is considered closed
only for `won`, `lost`, `prevented` or `warning_closed`.

Unknown and null states fail closed. Same-provider-second conflicts fail closed
as well: if any row in the latest provider-time group is open, or the group has
more than one normalized status, the Order remains blocked. Arrival order and
caller-provided sorting can therefore never turn an ambiguous dispute into an
unblocked transition.

## Authority and anti-forgery boundary

Three fixed `SECURITY DEFINER` functions are migration-owned, `VOLATILE`,
`PARALLEL UNSAFE`, and pinned to `search_path = pg_catalog`:

- `grainline_order_payment_open_dispute_state(text)` derives one boolean from
  the exact Order's immutable payment evidence;
- `grainline_order_payment_open_dispute_guard()` rejects direct attempts to
  forge the Order projection; and
- `grainline_order_payment_open_dispute_refresh()` refreshes only the exact
  parent Order after a payment-event insert.

`PUBLIC` and `grainline_app_runtime` execution are revoked from all three.
The ordinary runtime cannot execute or use them as a payment lookup API. Their
only runtime reachability is through the database-owned triggers. The grant
audit classifies all three as runtime-private.

The migration takes the parent `Order` relation lock before the
`OrderPaymentEvent` relation lock. Fixed payment writers already lock the
parent `Order` row before appending evidence, so installation preserves the
same lock order. At request time, an evidence insert refreshes and holds the
parent `Order` row; a competing transition waits, rechecks its projection
predicate after the evidence commits, and affects zero rows. If the transition
locks first, it linearizes before the later evidence. Neither ordering admits
a stale transition after a committed open dispute.

## Application conversion

The compatibility candidate removes direct base-ledger access from exactly the
remaining ordinary-runtime surfaces:

- buyer delivery confirmation;
- seller fulfillment changes;
- shipping-label purchase;
- seller self-service refund preflight;
- Stripe checkout/refund webhook recovery;
- shared transition SQL; and
- the unused generic local-refund evidence writer, which is retired while its
  deterministic event-ID helper remains available to fixed database
  authorities and proof tooling.

The complete 34-file semantic inventory remains broader than this seven-file
direct-access set. It intentionally retains projection and typed semantic
references after base-table access disappears; the inventory test prevents a
new wrapper or indirection from silently escaping the activation audit.

## Proof and release sequence

The candidate is acceptable only when all of these pass:

1. byte-pinned release verification with no later unreviewed migration;
2. class-wide zero-direct-access application checks;
3. PostgreSQL special-form syntax checks;
4. disposable PostgreSQL backfill, ordering, unknown-state, same-second
   conflict, anti-forgery and private-execution checks;
5. separate owner/runtime-login proof of the parent-row transition race;
6. TypeScript, lint, the full repository suite and production build; and
7. hosted CI with the migration applied only after its read and aggregate
   predecessors pass.

After production preparation, a separate pooled-runtime postflight must use
only `DATABASE_URL` as the actual `grainline_app_runtime` login. Inside one
engine-attested `REPEATABLE READ READ ONLY` transaction it re-proves the fixed
read RPC catalog and empty forged-user boundaries, the aggregate projection
catalog and private-helper denial, the exact open-dispute column/functions/
triggers, bounded aggregate visibility, and SQLSTATE `42501` denial for all
three transition helpers. The postflight accepts exact main-CI, aggregate
inspection and migration run bindings, rejects privileged or aliased database
variables, and writes only a fresh sanitized mode-`0600` local evidence file.
It reads no row payloads, exports no rows and cannot mutate production.

Compatible application deployment, bounded authenticated smoke, predecessor
drain, policyless `ENABLE`, runtime grant removal and later `FORCE` remain
separate releases. The next release must deploy and prove the converted
application while preserving the current READY deployment as its predecessor;
it must not activate RLS or remove predecessor table authority.
