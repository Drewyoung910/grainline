# OrderPaymentEvent Signed Dispute Identity Correction

Status: `COMPATIBLE_PRODUCTION_ACCEPTED`; production has the canonical `du_`
correction and the preserved signed provider proof subsequently passed.
`OrderPaymentEvent` RLS remains off and predecessor runtime CRUD remains live.

## Finding

The 2026-08-28 signed refund/dispute production proof delivered a genuine
Stripe test-mode `charge.dispute.created` event. The event passed signature,
lease and route-shape validation, but PostgreSQL rejected it before any Order
lookup or side effect with SQLSTATE `23514` and `Signed dispute input is
invalid`.

Engine-read-only database diagnosis showed one unprocessed, error-bearing
webhook lease and zero dispute payment rows, Cases, Notifications or audits.
An immutable provider read compared every scalar argument with the database
predicate without printing raw identifiers. All checks passed except the
identifier prefix: the genuine Dispute object used `du_`, while migration
`20260824030000_prepare_order_payment_signed_authority` required `dp_`.
Stripe's current Dispute API examples also use `du_` identifiers:
<https://docs.stripe.com/api/disputes/object>.

This is a database compatibility defect. It is not a malformed fixture, an RLS
failure or a reason to weaken source binding. The preserved production journal
is at `dispute-delivery-resend-pending`; the refund half is complete, dispute
application has no side effects, and success evidence is absent.

## Correction

Migration
`20260828020000_correct_order_payment_signed_dispute_identity` replaces only
`public.grainline_order_payment_signed_dispute_apply` at its existing
signature. It changes the exact identifier predicate from `dp_` to canonical
`du_` and preserves the byte-derived predecessor body, `SECURITY DEFINER`,
`search_path=pg_catalog`, volatility, parallel-safety, runtime-only `EXECUTE`,
table grants and RLS posture.

The generated migration is pinned to:

- signed-authority predecessor SHA-256
  `176ad2c17301dd1d6bd9a1c0e190e8d44b15463ec830f9a67eb43ec3070396f2`;
- migration SHA-256
  `7bd8c9be14e8095f0d4952401a2331abde3149e87a4bce8a9e44235ae2ec2bcd`;
- signed-refund predecessor SHA-256
  `cff392a1d1d4def6b67e63c3e7ed13a035bc6b8908ce0a88ef945cbbe1301261`.

The release is restart-safe. Its read-only scope proof accepts only either the
exact signed-refund-compatible predecessor or the exact applied successor. It
requires one checksum-matching completed Prisma row after application, exact
function source/catalog/ACL posture, and agreement between the independently
read recursive predecessor and candidate catalog views. It substitutes the
sealed predecessor body only while validating the older release chain.

## Proof and release gates

Focused coverage proves:

- canonical `du_` input succeeds through disposable PostgreSQL;
- the prior synthetic `dp_` form fails closed before side effects;
- signed lease, replay, ordering, Case and Notification semantics are
  unchanged;
- runtime-only function authority remains exact and no table grant or RLS DDL
  is introduced;
- migration bytes, latest-successor ordering, production workflow bindings,
  ledger state and recursive catalog reconciliation fail closed.

Before resuming the preserved provider journal:

1. merge the isolated correction only after exact-head and exact-main CI;
2. dispatch only the dedicated guarded migration workflow from that exact main
   commit and CI run;
3. require migration status, global grant/RLS audit and the engine-read-only
   exact-scope proof to pass;
4. resume the same original proof journal under explicit corrected-operator and
   original-preparation bindings; do not create another dispute or refund;
5. require exact dispute delivery, exact replay, bounded cleanup and sanitized
   success evidence before counting this authority family complete.

This correction does not activate `OrderPaymentEvent` RLS. Predecessor drain,
remaining authority/invariant/projection gates, policyless ENABLE and separate
FORCE remain later boundaries.

## Exact-head CI packaging correction (2026-08-28)

Exact-head CI run `33224938302` failed after all release byte checks and the
database migration chain through the signed-authority predecessor passed. The
failure was not PostgreSQL behavior: CI had intentionally moved the new
successor directory out of the migration tree while proving predecessors, but
the strengthened PGlite authority test tried to read that temporarily absent
file directly.

The test now derives the exact successor SQL from the sealed predecessor using
`buildOrderPaymentSignedDisputeIdentityMigration()`. The release verifier still
proves that the committed migration bytes equal that generated SQL before CI
isolates the directory. This preserves predecessor isolation, removes a test
filesystem-order dependency, and keeps the canonical `du_` / rejected `dp_`
behavior proof identical before the candidate is applied to the CI database.

The associated Vercel Preview compiled and passed TypeScript, then failed at
page-data collection solely because Preview intentionally has no
`DATABASE_URL`; that remains the expected fail-closed Preview posture.

## Production acceptance (2026-08-28)

- PR #310 merged exact corrected head
  `d9a8069bf7422f68d01fb7499dcbfc3fe66d3da7` as main
  `72cac67e2b375f065a36821dcdccd76836b515df`.
- Exact-main CI `33225769878` passed the full migration/RLS/PostgreSQL chain,
  3,492 tests, TypeScript, lint, the high-severity dependency audit and the
  production build.
- Guarded production run `33227729046` started from exact state
  `signed-dispute-identity-predecessor`, applied only
  `20260828020000_correct_order_payment_signed_dispute_identity`, then passed
  Prisma migration status and the global runtime grant/RLS audit.
- The audit covered 65 tables, 22 enums, 179 `grainline_*` functions, one
  extension, four RLS policy tables and zero sequence references. The final
  engine-read-only scope was exactly `signed-dispute-identity-compatible` with
  runtime-only function execution, predecessor CRUD retained,
  `OrderPaymentEvent` RLS off and `productionChangedByProof=false`.
- This accepts only database compatibility. The original mode-`0600` journal
  remains at `dispute-delivery-resend-pending`; no new payment, refund or
  dispute may be created when it resumes. Exact signed delivery, replay,
  bounded cleanup and sanitized success evidence remain required before this
  provider authority family is complete.

## Provider-proof completion (2026-08-28)

Exact operator/main `b37246d06e65a37fd163484f07390b9044689379`
with CI `33228466974` resumed only the original journal. The existing genuine
`du_` dispute delivered, its exact retry was idempotent, both signed families
verified, and the bounded application fixtures were removed. Two processed
webhook leases and immutable Stripe test objects remain intentionally. The
restart journal is absent and sanitized mode-`0600` evidence SHA-256 is
`fda2a7570525fbd927498439f527584cf7724b32c075edc0136d8260290cdfaa`.
No live money, provider configuration, deployment, grants or RLS posture
changed. Signed-provider compatibility is accepted; later activation gates
remain separate.
