# Order, Payment, and Shipping Compatible Preparation Release

Status: compatible database preparation complete in production. Application
conversion, RLS activation, FORCE, cleanup and provider state remain separate.

Date: 2026-08-04

## Boundary

This release candidate promotes the already-reviewed Order seller-key and
Stripe webhook lease drafts into one additive, atomic Prisma migration:

- migration: `20260805012000_prepare_order_payment_shipping_compatibility`
- migration SHA-256:
  `29f56fa82b68c743e0d081324c5caa9795f0dd0d43e8d0ed42acd28311ef03d3`
- complete migration-tree SHA-256:
  `e595971f6129304d5f5a20640ad29d2e486648445d5dbb325bfc904d14ca825a`
- Order seller-key draft SHA-256:
  `809f4d2b556146557354a27ace6671399c85933fb19179acb3d85a8aaa0b6a9a`
- Stripe webhook lease draft SHA-256:
  `e84b16163ac56fbad264197846f426eaa917d0e0f9fa141e0f00d4de099ac057`

The migration adds nullable durable seller keys to `Order` and `OrderItem`,
backfills and validates their relationships, and installs private invariant
triggers. It also adds a generation counter and three generation-bound
`SECURITY DEFINER` lease functions for `StripeWebhookEvent`.

This boundary deliberately does **not** enable or FORCE RLS, create policies,
revoke predecessor table privileges, deploy application changes, clean up
legacy rows, or mutate provider configuration. Existing application versions
remain compatible. The three webhook function grants are additive; exclusive
write authority is deferred until application callers have migrated and the
old direct-write path has been drained and revoked.

## Production evidence prerequisite

The read-only production legacy inspection ran from exact main commit
`8f22ebe326fa67bc3b71b8998b2f6b440ad7f69b` in GitHub Actions run
`30963859119`. PostgreSQL attested `repeatable read` and `read only`; the
sanitized 54-count artifact reported zero structural or integrity
inconsistencies. Production retained the predecessor posture: RLS and FORCE
off, zero policies, and existing broad runtime CRUD grants on the seven scoped
tables.

The durable inspection result was merged separately through PR `#159` at main
commit `3981e151864a9e9cd5631f63b7a8a3a76c75904f`.

## Proof history

- CI run `30964592546` failed before any persistent database mutation because
  the disposable PostgreSQL proof incorrectly qualified the parser special
  form `EXTRACT` as `pg_catalog.extract`.
- Commit `a6ee0393575207d54eaadf05aceabffbc01e817b` corrected the syntax, added a
  class-wide regression guard, and preserved the UTC lease-clock proof.
- CI run `30965587927` then passed all rollback-only PostgreSQL authority and
  lease proofs, TypeScript, lint, the full test suite, dependency audit, and
  production build.
- Candidate CI run `30970644693` applied the promoted migration and passed its
  byte pins, migration, and grant convergence, then correctly exposed a stale
  Case-open fixture: it committed each disposable Order before inserting its
  required OrderItem and still constructed a multi-seller Order that the new
  database invariant deliberately makes impossible. The proof now seeds each
  Order and its item in one transaction and replaces that obsolete Case-layer
  denial with an engine-level assertion that the second-seller item is rejected.
  No production state was involved.
- Replacement CI run `30970850390` passed that corrected Case-open proof and
  then found the same intentional contract change in the Case-aware Order
  fixture, which still committed mixed-seller and empty Orders. Those
  impossible post-migration fixtures are now valid single-seller Orders, with
  savepoint-scoped engine assertions proving that both a cross-seller insert
  and deletion of the last item fail closed. Participant-function denials stay
  focused on states that can still exist after the invariant is installed.
- CI run `30971054410` passed both corrected Case proofs and every intervening
  authority check, then the global grant audit correctly rejected the four new
  owner-private Order trigger helpers because the derived function inventory
  knew they existed but had not yet classified them as runtime-private. The
  inventory now explicitly requires those four functions to remain
  runtime-ungranted, while the three Stripe webhook service operations remain
  the only newly runtime-executable functions.
- Commit `924615e2062adb0e59a5e88c5728bb9c6cfbe1d3` passed the complete CI run
  `30971289032`: promoted migration application, runtime grant convergence,
  every disposable PostgreSQL authority and concurrency proof, the global
  grant/RLS audit, TypeScript, lint, the full test suite, dependency audit and
  production build.

The lease proof sets a non-UTC session timezone and proves that all persisted
timezone-without-time-zone lease clocks are derived in UTC. This prevents the
five-hour offset defect previously caught in rollout evidence.

The production postflight implementation is saved as
`scripts/order-payment-shipping-compatible-production-postflight.mjs`. It
requires the exact clean release commit, main CI run, migration run, explicit
confirmation and fresh evidence path; accepts only the reviewed pooled runtime
identity; rejects privileged or aliased database URLs; and runs inside an
engine-attested repeatable-read read-only transaction. Its evidence is written
once with mode `0600`, contains no connection string or row data, and records
only catalog posture plus aggregate zero-count integrity results. The same
code path is exercised under the restricted runtime role in disposable
PostgreSQL before release.

## Production completion

Exact main `6f1f4c1e99fb21726744ecd1652a37b6be35c294` passed CI
`31276366947`. Guarded Production Migrations run `31277540714` applied only
`20260805012000_prepare_order_payment_shipping_compatibility`. The separate
actual pooled-runtime postflight then passed read-only as
`grainline_app_runtime`: RLS and FORCE remained off, zero policies and
predecessor CRUD remained, the four private plus three runtime functions
matched, and all six aggregate integrity counts were zero. Sanitized postflight
evidence SHA-256 is
`a2348cd61fed8e3bf9f5ffc3cf1906c71cb4c45a0ec2325e90d117893c001809`.
No application deployment was part of this database release.

Commit `f07787ca346d0d0b04fe12198495a47e2846e0ef` passed complete CI run
`30971615946`. That run applied the promoted migration, converged the reviewed
grants, passed the new production-postflight code path under the restricted
runtime role, passed all other PostgreSQL authority/concurrency/rollback
proofs and global catalog audits, then completed TypeScript, lint, the full
test suite, dependency audit and production build.

## Required release order

1. **Complete:** review and merge this exact candidate after its full CI and
   disposable PostgreSQL proofs pass.
2. **Complete:** run the guarded Production Migrations workflow from an exact
   green main commit, applying only the committed compatibility migration.
3. **Complete:** run a read-only compatible-preparation production postflight
   and record the resulting catalog and row-count evidence.
4. Convert application call sites to the durable seller key and generation-
   bound webhook functions while retaining old/new deployment coexistence.
5. Audit and activate the Order, payment, and shipping RLS groups as separate
   production boundaries. Payment and payout authority must not be bundled
   into an unrelated table activation.

The completed preparation does not authorize the remaining application merge,
deployment, RLS activation, grant revocation, cleanup or provider mutation.
