# CheckoutStockReservation compatible authority release

Status: the compatible migration is applied and the actual pooled-runtime
postflight is accepted. CheckoutStockReservation still has RLS and FORCE off,
zero policies, and predecessor table CRUD for old-application coexistence. The
fixed-operation application is merged but not yet deployed; production still
runs exact source `69c14c0618ea7ab9c74756422273d17d66db7efa`.

This release packages the reviewed CheckoutStockReservation fixed-operation
authority without activating reservation RLS or removing predecessor table
access. It is the database-first half of a deployment-compatible cutover: the
current application can continue using direct reservation CRUD while the later
application release uses the fixed functions.

## Exact candidate

- migration: `20260810190000_prepare_checkout_stock_reservation_authority`
- migration SHA-256:
  `18cea952ad2a3bab121aaa9b505ec442c4fa9ff772042f47d48838bc1a35ce56`
- reviewed draft SHA-256:
  `66a3d711de1cab2eccb4407a3cdd0925f3ce13bdb6ce4a4fd647e74ab3bfa2ec`
- migration-prefix SHA-256:
  `71e05c53f9f5d888eeccdcbd6da1b7da9fe657d4404ac63800c5591d13a23897`
- guarded phase: `checkout-stock-reservation-authority-reviewed`
- fixed runtime surface: 15 reservation operations plus the source-bound
  three-argument Stripe webhook begin overload
- private surface: reservation item validator, normalization trigger,
  stock-restoration helper, and Stripe source binder

## Compatibility boundary

The migration adds `StripeWebhookEvent.sourceObjectId`, five reservation repair
fields, scalar validation constraints, private trigger-enforced item-shape
validation, an active-lock uniqueness index, a repair-claim index, and the
fixed functions. It does not enable or FORCE
CheckoutStockReservation RLS, create reservation policies, revoke predecessor
reservation table/column privileges, deploy application code, clean data, or
change Stripe, Vercel, Neon, Redis, or other provider state.

The migration itself refuses to run until the separate StripeWebhookEvent FORCE
release is already present: the event ledger must have ENABLE plus FORCE, zero
policies, no ordinary-runtime table authority, the reviewed owner, and a
LOGIN/NOINHERIT/NOBYPASSRLS runtime role with only the reviewed non-effective
Neon bootstrap membership. It also pins the predecessor two-argument webhook
begin function body and ACL, rejects PUBLIC/column authority, drains other
owner sessions, and takes bounded advisory/table locks. CheckoutStockReservation
must still be the clean
predecessor with RLS/FORCE off, zero policies, broad runtime CRUD, none of the
new fields, and no three-argument webhook-begin overload. This prevents one
dispatch from silently collapsing two independently reviewed production
boundaries.

CI moves the candidate migration out of the tree while it proves all earlier
compatibility, activation, FORCE, rollback, and grant contracts. Only after the
StripeWebhookEvent FORCE proof succeeds does CI restore and apply this exact
migration, converge the fixed grants, audit the global catalog, and run the
disposable reservation authority proof.

The generic production migration workflow remains intentionally unable to
**apply** this release. The earlier StripeWebhookEvent FORCE runner
may verify this successor's exact bytes and then move it out of the disposable
Actions checkout; it never restores it before Prisma runs, and its read-only
ledger proof requires zero rows for this migration. Consequently, merging or
testing the FORCE runner cannot make the guarded production runner apply the
reservation migration.

The isolated dedicated workflow
`.github/workflows/checkout-stock-reservation-authority-production.yml` is the
only proposed production application path. It binds a successful same-commit
main CI run and corrected aggregate-only inspection, verifies the exact
migration tree and sealed StripeWebhookEvent FORCE predecessor, accepts only a
clean predecessor or the exact already-prepared restart state, applies the
compatible migration only from the predecessor state, then runs migration
status, the global grant/RLS audit and an exact post-application ledger proof.
The restart proof hashes all 194 local migration files and requires every
ordinary predecessor to have exactly one completed matching ledger row. It
permits only three explicitly pinned historical exceptions: the
same-checksum, zero-step, rolled-back listing-variants alias and the exact
zero-step failed plus corrected-applied DirectUpload activation pair, plus the
single completed original-checksum row for
`20260523223000_schema_numeric_guards_and_indexes` described below. Every other
unknown name, rolled-back or incomplete row, duplicate, checksum change, or
local successor migration fails before `prisma migrate deploy`, so that command
cannot silently apply an unrelated pending migration.
It does not deploy, enable reservation RLS, revoke predecessor table grants or
change provider state. The separate pooled-runtime postflight uses the actual
restricted pooled role in an engine-attested repeatable-read/read-only
transaction; it proves predecessor CRUD remains available, all 20 function
bodies/modes/ACLs and the schema/trigger/index catalog are exact, private
helpers are denied and a fixed write reaches PostgreSQL's read-only fence.

Review found the historical aggregate inspection still expected all seven
tables to be RLS-off broad-CRUD predecessors. That became false after
StripeWebhookEvent FORCE. Waiting run `31734121511` executed zero steps and was
cancelled as obsolete. The corrected inspection requires the mixed live
posture—StripeWebhookEvent policyless FORCE with no direct runtime CRUD, while
CheckoutStockReservation and the other predecessor tables remain RLS-off with
broad CRUD—and fails the workflow when any of the seven reservation-integrity
counts is nonzero. The eventual production runner requires a fresh successful
inspection from its own exact release commit; historical or predecessor-SHA
evidence cannot satisfy it.

### Failed run 31745337593 and immutable-history correction

Guarded production run `31745337593`, bound to exact main
`cfd628da30d7fc44153f423fde28caddbd97b195`, passed its exact-run bindings,
source/owner/role checks, migration byte pins and sealed StripeWebhookEvent
FORCE predecessor. It then failed at the engine-read-only restart-scope step.
Prisma generation, `prisma migrate deploy`, migration status, grant convergence
and every post-application proof were skipped. The run made no production
database change.

A subsequent sanitized, repeatable-read/read-only owner inspection found one
otherwise-unclassified predecessor row:
`20260523223000_schema_numeric_guards_and_indexes` is complete, not rolled back,
has one applied step and retains SHA-256
`faf1ac4063a888e0405981aba57c177c4bbb33b184a8b315ace52152d21dc274`.
That checksum exactly matches the migration as created by
`207c52c80206ff211bb9d552e141ee8885837ffa`. Commit
`374fe421f74e7726379f8dfd305587cd539fc1ad` appended 26 lines to the already
applied file about 3 hours 13 minutes later, producing the repository's current
SHA-256
`0ae1197e6d8fd936e201ac793f810a42c1358bbea70f66cabffb7415f960aad6`.
This is a proved repository-history defect, not evidence of production
tampering.

The production-scope correction does not rewrite the migration, resolve or
modify `_prisma_migrations`, or permit a general checksum bypass. For this one
named migration it requires exactly one completed, non-rolled-back, one-step
row with the exact original checksum and independently requires the repository
file to retain its exact currently reviewed checksum. The current checksum in
the production row, any near match, duplicate,
unfinished, rolled-back or zero-step shape fails closed. Unit tests and a
disposable PostgreSQL ledger proof cover the accepted and rejected shapes.
Future migrations must correct previously applied behavior in a new migration;
an applied migration file is immutable.

Exact branch head `8c561881922143217ae31b1ef4c5f5d9894ff1d1` then ran the
corrected verifier against the production owner connection in its
engine-enforced read-only transaction with scope stage `before`. The sanitized
result was: 194 reviewed migrations, three historical exceptions,
StripeWebhookEvent FORCE present, reservation authority absent, zero
reservation activation/FORCE rows, state `predecessor`, and
`productionChangedByProof: false`. This proves the correction matches the live
predecessor; it does not authorize or perform a migration, ledger resolution,
deployment, grant change or provider mutation.

## Accepted compatible production boundary (2026-08-13)

Exact main `77fc45fe06feb3f4e440afea916728c3d2873315` passed all 100
steps in CI run `31752628832`, including the sealed migration tree, disposable
PostgreSQL authority proof, TypeScript, lint, full tests, dependency audit and
production build. The same-commit engine-read-only inspection run
`31753838550` accepted the mixed predecessor posture and all seven reservation
integrity counts were zero.

Guarded workflow run `31754431910` then applied only
`20260810190000_prepare_checkout_stock_reservation_authority`. Its restart
scope changed exactly from `predecessor` to `prepared`: StripeWebhookEvent
FORCE remained present, reservation activation/FORCE rows remained zero, and
the global audit reported 64 tables, 22 enums, 157 `grainline_*` functions,
one extension, four RLS-policy tables, zero sequence references and a current
194-migration tree. The post-application scope retained predecessor table CRUD,
reported 16 runtime operations plus four private helpers, and explicitly
reported `rlsChanged:false` and `predecessorTableGrantsChanged:false`.

The separate actual pooled `grainline_app_runtime` postflight then passed from
the same exact clean source in an engine-attested repeatable-read/read-only
transaction. It proved the reviewed endpoint/role identity, RLS/FORCE off,
zero policies, predecessor CRUD retained, zero live reservation rows, exact
columns/constraints/indexes/trigger, the exact 20-function source/mode/owner/ACL
catalog, successful direct aggregate read and fixed export, private-helper
denial, and a fixed write reaching SQLSTATE `25006`. Sanitized mode-`0600`
evidence was retained outside the repository with SHA-256
`1be122b9cd834b5fe1829cab6769d0ff26f73605f3056b5be511a2777648d22f`;
it reports `productionChangedByPostflight:false` and contains no connection
string.

The first local postflight invocation failed before any database connection
because the clean worktree had no installed `pg` package. The accepted rerun
used an existing dependency tree only after proving both worktrees had the
identical package-lock SHA-256
`8408da94eb3ba6a70e6e94eeebe9be4512ff44e0d242fa8045ded84e09cf2203`;
this tooling-only failure did not query or mutate production.

The canonical production deployment remains
`dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6`, exact source
`69c14c0618ea7ab9c74756422273d17d66db7efa`. The fixed-operation conversion
was introduced at `6c788c37db17658ab3e657b089ff45ab40b1cb8b` and is contained
in `77fc45fe`; it is therefore not live yet. Review of the runtime delta found
19 application/schema/package files, zero direct
`CheckoutStockReservation` Prisma delegates under `src`, and all 15 fixed
reservation operations represented at their intended callers. A focused
checkout, webhook, account-deletion, export, lock and payment suite passed
98/98 locally. The exact-main CI remains the authoritative full-tree result.

The final pre-deploy review found that the application priced from its first
cart/listing snapshot while the fixed function returned a later locked source
without an equality check. A concurrent cart or inventory-type change could
therefore reserve a different quantity/set than Stripe charged. Isolated
finding `CSR-A23` (A21 already names the repair-index mismatch) requires exact
Stripe-bound source plus Listing-level inventory comparison while the fixed
function's locks remain held. The corrected successor performs fixed creation
and source re-read in one short database-only transaction; mismatch rolls back
the reservation and stock decrement rather than committing and compensating.
Exact `77fc45fe` must not be deployed; the
next deploy source is the reviewed successor containing this correction after
its complete CI succeeds.

The next boundary is an exact-successor application deployment, health and
fixed-path smoke, followed by predecessor-version drain and a fresh proof of
zero direct reservation access. The known-good rollback source remains
`69c14c0618ea7ab9c74756422273d17d66db7efa`; rollback stays database-compatible
because predecessor table CRUD is intentionally still present. Policyless
ENABLE and FORCE remain later, separate releases.

## Required gates

1. Completed: exact-main CI, Extra-High SQL review, StripeWebhookEvent FORCE,
   immutable-history correction, same-main aggregate inspection, guarded
   compatible migration, global audit, and actual pooled-runtime postflight.
2. Complete CI, disposable PostgreSQL rollback/concurrency coverage and the
   exact-candidate provider pool/latency gate for the isolated `CSR-A23`
   correction; merge it, then deploy
   only that exact successor after a separate deployment boundary; attest
   provider-owned source and canonical alias/health. Do not deploy
   `77fc45fe06feb3f4e440afea916728c3d2873315` because its source-consistency
   check is incomplete.
3. Prove checkout creation, signed completion and failed-session restoration,
   bounded cron repair/prune, account deletion, resume and export without
   bypassing the normal route/provider authority boundaries.
4. Drain predecessor application versions and prove zero direct reservation
   access remains.
5. Prepare policyless ENABLE and later FORCE as distinct reviewed releases.

No item in this document authorizes a production mutation.
