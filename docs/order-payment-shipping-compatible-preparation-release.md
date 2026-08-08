# Order, Payment, and Shipping Compatible Preparation Release

Status: compatible database preparation accepted in production; application
conversion and every RLS/grant activation remain pending.

Prepared: 2026-08-04

Accepted in production: 2026-08-08

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

Commit `f07787ca346d0d0b04fe12198495a47e2846e0ef` passed complete CI run
`30971615946`. That run applied the promoted migration, converged the reviewed
grants, passed the new production-postflight code path under the restricted
runtime role, passed all other PostgreSQL authority/concurrency/rollback
proofs and global catalog audits, then completed TypeScript, lint, the full
test suite, dependency audit and production build.

## Accepted production state

PR `#160` merged candidate head
`91f13706f8cb1931c1c9bf8a6c5a627aba20e254` at main merge
`8ac2d9c8ca6e1e6d78d849f2babfddafa35f34ae`. PR `#166` then merged the
exact-main proof correction at head
`24e4534363cd456886799845421e661c76e33839`, producing accepted main commit
`6f1f4c1e99fb21726744ecd1652a37b6be35c294`. Exact-main CI run
`31276366947` passed.

Guarded Production Migrations run `31277540714` applied only
`20260805012000_prepare_order_payment_shipping_compatibility` from that exact
main commit. The applied migration SHA-256 is
`29f56fa82b68c743e0d081324c5caa9795f0dd0d43e8d0ed42acd28311ef03d3`.
No application deployment or provider change accompanied it.

The required separate pooled-runtime postflight then passed in an
engine-attested repeatable-read, read-only transaction. It proved the real
`grainline_app_runtime` identity, the expected columns, keys, indexes,
triggers, four private functions, three runtime functions and private-helper
denial. All six aggregate integrity counts were zero. It also proved the
predecessor boundary is intentionally intact: RLS off, FORCE off, zero
policies and predecessor table CRUD retained. The sanitized mode-`0600`
evidence file is
`order-payment-shipping-compatible-production-postflight-6f1f4c1e99fb21726744ecd1652a37b6be35c294.json`;
its SHA-256 is
`a2348cd61fed8e3bf9f5ffc3cf1906c71cb4c45a0ec2325e90d117893c001809`.

## Required release order

1. **Complete:** merge the exact candidate after full CI and disposable
   PostgreSQL proofs.
2. **Complete:** apply only the committed compatibility migration through the
   guarded Production Migrations workflow from exact green main.
3. **Complete:** run and retain the read-only compatible-preparation production
   postflight.
4. Convert application call sites to the durable seller key and generation-
   bound webhook functions while retaining old/new deployment coexistence.
5. Audit and activate the Order, payment, and shipping RLS groups as separate
   production boundaries. Payment and payout authority must not be bundled
   into an unrelated table activation.

This record does not authorize the compatible application deployment, any RLS
or grant activation, cleanup, or provider mutation. Each remains a separately
reviewed release boundary.
