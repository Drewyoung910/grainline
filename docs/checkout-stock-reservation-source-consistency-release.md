# CheckoutStockReservation source-consistency release

Status: additive source-consistency migration live in production and accepted
through the actual pooled-runtime postflight; compatible application deployment
and RLS activation remain separate. This document does not authorize a
deployment, RLS change, predecessor-grant revocation, cleanup or provider
mutation.

Date: 2026-08-14

## Purpose

The compatible `CheckoutStockReservation` authority is live, but its first
application conversion obtained source evidence in several statements before
calling the fixed database operation. That left a source-consistency window:
Cart, CartItem, Listing, variant and photo rows could change between the
application reads and the database mutation.

The accepted candidate moves the source read, validation, locking and mutation
into one PostgreSQL statement for each checkout creation path. The database
derives the authoritative reservation payload from locked source rows. The
application supplies an expected canonical source witness only as a rejection
condition; it cannot choose the written buyer, seller, listing, quantity,
price, item payload or lock identity.

## Candidate bytes

- Draft SQL: `docs/rls-drafts/checkout-stock-reservation-source-consistency.sql`
  - SHA-256: `863a731c1e0651f8a91c38f1b614f2a92fc5edd7eb741929aa5a223a71b75bd2`
- Promoted migration:
  `20260814053000_prepare_checkout_stock_reservation_source_consistency`
  - SHA-256: `69623f2363c6ae4978ff2cc8a22ccc1b8d9f43d378e01678c2fc6ef6f14b9928`
- Complete migration-tree SHA-256:
  `527b93f81e4b74a2cf04218d2d4b53cd8524bbb4fc9b93db6072c387bbb71e54`
- Guarded release phase:
  `checkout-stock-reservation-source-consistency-reviewed`

The migration adds three owner-private helpers and two runtime-executable
wrappers. The resulting reviewed reservation catalog has 25 functions: 18
runtime-executable fixed operations and seven owner-private helpers.

## Production application

The guarded Production Migrations workflow applied only
`20260814053000_prepare_checkout_stock_reservation_source_consistency` on
2026-08-14. The release was bound to exact main commit
`16239fce2956c6dc726c24ccd7a91d1ea35463bd`, exact-main CI run
`31813433933`, and production migration run `31814032227`.

The run passed the byte-sealed release and predecessor checks, the read-only
restart-scope check, the exact migration application, runtime-function grant
convergence, Prisma migration status, the global grant/RLS audit, and the
read-only after-scope proof. Prisma reported 195 migrations and an up-to-date
schema. The global audit passed for 64 tables, 22 enums, 162 `grainline_*`
functions, one extension, four RLS policy tables and zero sequence references.

The final scope proof reported `state: source-consistent`, both reviewed
preparation migrations present, zero reservation activation rows, zero
reservation FORCE rows, and `productionChangedByProof: false`. This boundary
did not deploy application code, enable or FORCE RLS, create policies, revoke
predecessor table authority, clean data or change provider state.
RLS remains off.

## Production pooled-runtime postflight

The actual production postflight passed on 2026-08-14 from exact clean main
commit `ac4c9d2139f5294c5e91edd24acb3dbe71b4976c`, after exact-main CI run
`31819848330`, and was bound to migration-main CI run `31813433933` plus
successful migration run `31814032227`. It authenticated only through the
pooled `grainline_app_runtime` role and PostgreSQL attested `repeatable read`
plus `read only` before any proof query ran.

The proof matched the exact 25-function catalog, compatible table/schema
posture, zero policies, RLS off, FORCE off and retained predecessor CRUD. The
direct aggregate read and fixed export succeeded; the new private helper was
denied; and a fixed write reached SQLSTATE `25006`, proving the engine-level
read-only fence. The table contained zero reservation rows during the aggregate
proof. The transaction rolled back and recorded
`productionChangedByPostflight: false`.

Sanitized mode-0600 evidence:

- file:
  `checkout-stock-reservation-source-consistency-production-postflight-ac4c9d2139f5294c5e91edd24acb3dbe71b4976c.json`
- SHA-256:
  `bec37f40d995e311bee5d80fc63c3485f7d325cdcd846b88656684fe2f592afe`

The artifact contains no connection string or row data. This closes the
source-consistency database postflight only; it does not authorize or imply an
application deployment, predecessor drain, RLS activation, grant revocation,
cleanup or provider change.

## Provider proof

The proof ran only on a disposable Neon child through one exact Vercel Preview
deployment. Production credentials, migrations, data and provider state were
not changed. Exact Preview-enabling commit:
`d0bb3824176ad9e006d9423c771b9a984a09bf16`; exact Preview deployment:
`dpl_CB3uX5qzZESrBMCMh9hYMuDgWbES`.

Both fresh slots used the ordinary `grainline_app_runtime` role from Vercel
`sfo1` to Neon `westus3.azure`. Each target and burst workload completed 80
requests with zero application errors, proof issues or fixture residue.

| Slot | Workload | Baseline p95 | Candidate p95 | Candidate max |
|---|---|---:|---:|---:|
| 1 | target | 163.2 ms | 161.1 ms | 162.6 ms |
| 1 | burst | 163.4 ms | 174.5 ms | 179.5 ms |
| 2 | target | 147.8 ms | 151.4 ms | 158.9 ms |
| 2 | burst | 179.1 ms | 185.4 ms | 187.1 ms |

The observed lock waits were 172.4 ms and 168.7 ms. The existing thresholds
were not weakened: p95 at most 750 ms and maximum at most 3000 ms.

Sanitized evidence hashes:

- setup: `9a06e718734203473921f89791f839b632cbaaa3bf558f53489bf5b42708a0dd`
- local preflight: `2619ddb1b8bce62ad719597875832e85ae32767d2f31f89fc1d914042a2b168f`
- attestation: `630733461776a7328c235036702fd3a15969d5c3966a29592dbd3334ba6751e0`
- slot 1: `60240d493ddb04ab8f8fb88a1d8d1aff0565fb208a893860b02370f989b00610`
- slot 2: `62e91d50083e5f85c32fd77900cd0de1ef02f7fe80c04197ef97647e0e4cbf95`
- teardown: `d3791d20f23bb11b734fcf6c2f449b02c85e91ff1e003e4de8fdd1ffa8e50c2d`
- cleanup: `7a5e9560b2ee89e1cf2a8d15c144a596cd7e8b372cd75a4a8d35d3070faea0aa`

Teardown deleted the child fixtures, 27 branch-scoped variables, Preview,
automation bypass, Neon child and local proof state. The proof branch is
disposable and must never merge.

## Release and rollback boundaries

CI applies the sealed compatible-authority predecessor first, then this exact
successor, converges exact function grants and runs the promoted PostgreSQL
authority proof. The guarded production workflow accepts only the reviewed
compatible predecessor or an exact one-step completed restart state, applies
only this migration, verifies migration status and the global grant/RLS audit,
and runs a fail-closed production-scope verifier before and after application.

This release is additive. It does not enable or FORCE RLS, create policies,
revoke predecessor table authority, rewrite data or delete the older compatible
functions. If the later app deployment is rejected, the old deployed code and
old fixed operations remain compatible. Database rollback, if ever required,
must be separately reviewed; do not delete a successful Prisma ledger row or
drop these functions ad hoc.

## Remaining sequence

1. **Complete:** run the actual pooled-runtime postflight against the applied
   production catalog.
2. Deploy the source-consistent application and smoke both checkout paths.
3. Drain predecessor deployments and prove the legacy creation wrappers are no
   longer called.
4. Prepare policyless ENABLE and direct-grant revocation as a separate release.
5. Prepare FORCE as a final separate posture release.
