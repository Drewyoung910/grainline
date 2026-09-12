# Order correction composition proof — September 8, 2026

## Scope and decision

This closes a candidate-verification gap, not a new application defect or
production release. Six existing SQL drafts had separate proofs but no single
acceptance of their simultaneous catalog and shared behavior. Their nine target
functions do not overlap; their SQL bytes and historical migrations are unchanged.

The saved predecessor is `58e8a2adc6fcaf6151aa7ff0eccf77c7f3948bee`, draft PR #432,
accepted by full CI `34198555971` and account-deletion `34198556006`, staff-bootstrap
`34198556021`, and paid-repair `34198556051` proofs. That independently closes the
reservation proof's prior SIGKILL/diagnostic checkpoint. Do not rerun it as pending.

This follow-up remains isolated and solo: no merge/readify, production workflow,
migration staging/execution, deployment, provider or credential change. No new
RLS table is activated. Order compatibility, Case reader-first compatibility and
reservation integrity retain distinct release boundaries.

## Reproducible proof manifest

`scripts/order-correction-composition-manifest.mjs` checks the unchanged exact
17-member September 5 compatible prefix and six fixed SHA-256 draft pins against
their generators. It records all nine signatures, before/after body SHA-256s,
runtime EXECUTE disposition, and release order. Generate a read-only JSON view:

```sh
node scripts/order-correction-composition-manifest.mjs
```

| Draft | Bodies | Release boundary |
| --- | ---: | --- |
| Order label outcome | 2 | Compatible Order SQL |
| Order refund reconciliation inputs | 2 | Compatible Order SQL |
| Order receipt notification type | 1 | Compatible Order SQL; core stays runtime-private |
| Order label clawback clock | 1 | SQL before automatic-retry acceptance |
| Case lifecycle | 2 | Compatible application readers before SQL |
| Checkout reservation repair outcome | 1 | Separate integrity successor; no activation replay |

This is a **proof manifest**, not a production scope verifier. Production release
packaging still needs the full exact ledger, owners/role identities, candidate
application binding, restart states and guarded workflow acceptance. The existing
historical readers remain strict; no arbitrary successor-body allowlist is added.

## Engine boundary and tests

`scripts/order-correction-composition-postgres-proof.mjs` accepts only its named
loopback `grainline_ci` URL with the `ci` role and no connection overrides. It
attests PostgreSQL 16, current and session identity, approved local/CI server
address, and the restricted runtime's flags/membership/password-null state.
It runs after the independent proofs in ordinary CI, not a production workflow.

Inside one outer READ COMMITTED transaction it:

1. Applies the six exact attested payloads sequentially and compares the complete
   observed catalog after **each** package. Only that cumulative reviewed subset
   of function bodies may change. Signatures, owners, ACLs, roles/memberships,
   table/column posture, policies, constraints/triggers/indexes, namespaces,
   defaults and the observed migration ledger must remain identical.
2. Runs the existing input matrix (25 denials including negative controls and
   five valid-domain absence/stale controls), all 17 Case lifecycle scenarios,
   and the complete reservation matrix (20 invalids, 12 legitimate outcomes,
   session mismatch, paid-order protection, retry and six direct denials).
3. Exercises two corrected label functions together: claim the immutable purchase
   clock under a non-UTC session, reject NULL finalization without mutation,
   finalize the exact synthetic claim and prove its exact retry has no new effect.
   This fabricates no provider evidence and makes no Stripe/Shippo request.
4. Rejects replay of each already-corrected draft at its predecessor attestation.
   A mixed/corrected state cannot be silently accepted as a fresh predecessor.
5. Rolls back on success or failure; compares the catalog and sorted per-table
   count/content fingerprints after rollback; then re-runs the original strict
   prefix proof. No success result survives failed rollback or verification.

The combined scenarios use an explicitly labeled disposable `SET LOCAL ROLE`
adapter with per-call savepoints. They **do not prove a separate runtime login**,
staff credential, authenticated route or provider flow. Existing independent
actual-login proofs remain separate evidence; final composed runtime/deployment
acceptance is still required. The only CI SQL mapping remains the reservation
draft's four exact owner-attestation literals; production SQL on disk is untouched.

Component fixtures that normally commit inside disposable clones are translated
to owned savepoints, never outer commits. Tests prove commit/rollback containment
and reject nested, unbalanced or unreviewed transaction commands. Large catalog
rejections keep complete strict equality but bounded boolean diagnostics.

Local tests use the offline Prisma schema and selected actual historical function
bodies, row checks and normalizer. They are not a substitute for all migrated
constraints/triggers and the real ledger in native CI. They exercise rollback
after injected errors at package 1, 4, 5 and 6, the full scenario composition,
eleven unrelated catalog-drift classes, and an accidental PUBLIC grant on the
private notification core. Row fingerprints include every public ordinary or
partitioned table, not sequences or external side effects; neither is modified
by this proof. No credentials or row contents are printed.

## Verification checkpoint

First focused run: three tests passed; one adapter test failed because its table
creation and BEGIN shared a simple-protocol batch, placing the table in the
transaction being rolled back. Splitting fixture-table creation from BEGIN fixed
the test. The all-nine-body engine test passed even in that first run. This was
a harness fixture issue, not a production/application defect.

After correction, 44 focused tests passed, zero skipped/failed, including the
Case, label, input and reservation suites. Syntax/import checks and manifest
verification passed. Full local `npm test`: 4,463 total, 4,450 passed, 13 skipped,
zero failed/cancelled, 445.120 seconds. `npm run lint` and `npx tsc --noEmit`
passed; lint retained its existing TSNonNullExpression dependency warning.
The 1-GiB headroom guard passed with 5.4 GiB free. Focused command:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test --test-concurrency=1 tests/order-correction-composition.test.mjs tests/checkout-repair-outcome-runtime-proof.test.mjs tests/order-input-correction-drafts-postgres-proof.test.mjs tests/order-input-correction-runtime-postgres-proof.test.mjs tests/order-label-clawback-clock-proof.test.mjs tests/case-lifecycle-correction.test.mjs
```

Exact-head native CI results must be recorded on PR #432 and the current
checkpoint before acceptance of this new proof. A
pre-push document cannot certify a later run; update source in the next cohesive
commit, not a separate docs-only CI chain.

## Next gates

Post-push acceptance: exact `99f6e8cb` passed full/native CI `34203109385`,
4,454 tests passed/nine skipped/zero failed or cancelled, plus build and all
companion workflows. Draft PR #432 and the durable acceptance checkpoint retain
the result. The next cohesive source-only package is
`order-correction-release-package.md`; do not rerun this accepted proof as an
unimplemented prerequisite.

Follow `order-release-readiness-20260908.md`: precise production compatibility
packaging and the separate reservation integrity successor; umbrella credential
incident and actual runtime/staff boundary acceptance; matching application and
fresh authenticated checkout/shipping-rate/label/refund/retry proofs; reviewed
predecessor overlap; Order ENABLE; then separate FORCE. Do not restore the known
unsafe NULL-accepting repair body as a routine production rollback. Transaction
rollback here is strictly for an isolated disposable proof.

This proof does not certify provider rates, legal readiness, throughput at 50,000
users or Order activation. Those remain their documented acceptance gates.
