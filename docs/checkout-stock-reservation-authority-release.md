# CheckoutStockReservation compatible authority release

Status: compatible migration and application are merged; production runner
and pooled-runtime postflight are prepared on an isolated branch. Production
is unchanged.

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
permits only the two previously proved historical exceptions: the
same-checksum, zero-step, rolled-back listing-variants alias and the exact
zero-step failed plus corrected-applied DirectUpload activation pair. Every
other unknown name, rolled-back or incomplete row, duplicate, checksum change,
or local successor migration fails before `prisma migrate deploy`, so that
command cannot silently apply an unrelated pending migration.
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

## Required pre-production gates

1. Complete exact-head and exact-main CI, including exact-tree verification, real PostgreSQL migration
   application, grant convergence, global catalog audit, and authority proof.
2. Independently review the promoted SQL/function catalog at Extra High.
3. Retain the accepted StripeWebhookEvent FORCE migration and actual
   pooled-runtime postflight from the completed credential recovery.
4. Merge the reviewed dedicated runner, then run the corrected aggregate-only
   inspection from that exact main commit. All reservation-integrity fields
   must be zero.
5. Dispatch only the restart-safe compatible-authority runner bound to that
   exact successful CI and inspection.
6. Run and retain the separate actual pooled-runtime compatible postflight.
7. Deploy and smoke the already-merged fixed-operation application, drain predecessor
   versions, prove zero direct reservation access, then prepare policyless
   ENABLE and later FORCE as distinct releases.

No item in this document authorizes a production mutation.
