# OrderPaymentEvent FORCE RLS release

Status: exact FORCE candidate and restart-safe workflow are merged to `main`;
the first production run failed closed before migration. Production remains at
accepted Phase A with FORCE off.

Date: 2026-08-31

## Exact release unit

- Migration: `20260831010000_force_order_payment_event_rls`
- FORCE draft SHA-256:
  `ede67764c0fa9cde5c694325e6303dd9a88cc10bdc7cfa4825ca69baa50044ab`
- Promoted migration SHA-256:
  `20d590b14f8b2dd5ee22537b18138624292bbfe8de8b3e5f2d407fae02f606cd`
- Rollback SHA-256:
  `a8be315299468c536b7ddcb2452a3515ae7e535ba1ee7bfc63127b2f81b75815`
- Complete migration-tree SHA-256:
  `fdf723b4e3f383f87b27b61667fbf2103fd18a9cd55dcfa0c04343a3bd7dd94e`
- Guard phase: `order-payment-event-force-reviewed`

The candidate changes only `relforcerowsecurity` on
`public."OrderPaymentEvent"`. It changes no row, policy, grant, function,
constraint, index, trigger, application behavior, credential, deployment or
provider state. The rollback changes only FORCE back to NO FORCE while
preserving the accepted policyless Phase-A service boundary.

## Security purpose and limitation

Production Phase A is already accepted: RLS is enabled without policies,
direct runtime and PUBLIC table/column authority is zero, exactly 16 reviewed
fixed functions remain runtime-callable, 13 remain runtime-private, and the
complete 25-function direct-reference surface is classified.

The production migration owner currently has `BYPASSRLS`, so FORCE does not
make that role subject to policies and does not make Phase A begin working.
FORCE is an ownership-drift invariant: if the table is later transferred to a
non-BYPASS owner, ownership cannot silently bypass the policyless service
boundary. With zero policies, such an ownership mistake fails closed. That
integrity benefit carries an availability risk until ownership is repaired.

## Fail-closed predecessor and postflight

The migration shares the accepted activation advisory lock and preserves the
parent-`Order`-first lock order used by every fixed writer. It refuses to
proceed unless all of the following remain exact:

- the session is the table owner and is either the reviewed production owner
  or disposable CI owner, with no other owner client session;
- `grainline_app_runtime` remains LOGIN, NOINHERIT, non-privileged and
  NOBYPASSRLS, with only Neon's proven non-effective administrative bootstrap
  membership edge;
- the table remains policyless ENABLE/NO-FORCE with zero direct runtime or
  PUBLIC table/column authority;
- all six constraints, seven indexes, seven cross-table triggers and four
  table-local triggers remain reviewed and valid;
- legacy rows still satisfy the accepted immutable REFUND/DISPUTE shape; and
- the exact 29-function catalog, trusted-name overload surface and 25-function
  direct-reference surface retain their reviewed identities, owners,
  languages, security modes, volatility, parallel modes, pinned search paths,
  source MD5 values and ACLs without dynamic SQL.

The transactional postflight requires the identical table and function
catalog with FORCE on. Any drift rolls the transaction back.

## Proof design

Disposable CI first byte-verifies FORCE, moves it outside Prisma discovery,
and replays the complete sealed OrderPaymentEvent predecessor chain. After
Phase A and its direct-runtime and rollback proofs pass, CI restores and
applies FORCE. A distinct direct runtime login then proves:

- policyless ENABLE plus FORCE;
- zero direct table/column authority;
- direct SELECT denied by ACL with SQLSTATE `42501`;
- direct INSERT/UPDATE/DELETE fenced by PostgreSQL's mandatory read-only
  transaction with SQLSTATE `25006`;
- two retired entry points denied;
- five retained read boundaries execute without exporting rows; and
- a granted fixed writer reaches the engine's `25006` read-only fence.

The owner rollback proof rejects privilege drift, temporarily restores exact
Phase A, re-proves the runtime boundary, and always restores FORCE before
success. The distinct actual pooled-runtime production postflight is packaged
as the explicit `--post-force` mode of the accepted Phase-A helper. That mode
has separate confirmation variables, evidence filename and operation name; it
requires FORCE, while the default mode continues to require NO FORCE. It runs
inside an engine-attested repeatable-read read-only transaction through only
the pooled `grainline_app_runtime` credential and writes fresh sanitized
mode-`0600` evidence. It remains a separate acceptance gate after any future
production migration.

Hosted CI run `33409002277` failed closed at the first FORCE-state global
grant audit. The table-specific FORCE proof had passed, but the shared grant
auditor still hard-coded `OrderPaymentEvent` to NO FORCE and correctly refused
the candidate. The branch now derives the expected FORCE posture from the
byte-derived migration inventory, exactly as it already does for the other
policyless service tables. Unit coverage accepts only ENABLE/FORCE/zero-policy
when the sealed FORCE migration is present, retains ENABLE/NO-FORCE/zero-policy
for Phase A, and rejects both mismatch directions. No production state was
involved in the failed run.

The corrected rerun `33410669312` passed that audit and every FORCE runtime
boundary, then failed closed in the rollback proof after the expected direct
SELECT denial. PostgreSQL had correctly put that transaction in the aborted
state, so the following read RPC could not run. The proof now encloses only the
expected ACL denial in a savepoint, rolls back to and releases that savepoint,
then proves the fixed read RPC in the same engine-read-only transaction. Tests
also require the proof to fail when direct SELECT unexpectedly succeeds. The
failure was proof-harness-only and changed no production state.

The future invocation shape is:

```sh
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_CONFIRM=verify-production-order-payment-event-force-runtime-read-only \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_RELEASE_COMMIT=<exact-force-main> \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID=<successful-main-ci> \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_MIGRATION_RUN_ID=<successful-force-migration-run> \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH=order-payment-event-force-production-postflight-<exact-force-main>.json \
npm run ops:order-payment-event-force-postflight
```

The final authority review found one reader-only fail-closed gap after the
first successful hosted proof: the scope assertion rejected unknown successor
migrations, but the database reader selected only ledger rows at or before the
FORCE migration name. A later out-of-band row would therefore never reach the
assertion. The reader now loads the complete `_prisma_migrations` ledger, while
the existing exact predecessor/successor catalog rejects every unknown,
missing, duplicate, rolled-back, zero-step or checksum-drifted row. Regression
coverage proves both the complete-ledger query and rejection of an unreviewed
successor. This correction is isolated and read-only; production remains
Phase A.

The same final review aligned the emergency rollback's disposable-owner
exception with the activation migration: role `ci` is accepted only when the
database is exactly `grainline_ci`; production rollback remains restricted to
the reviewed `neondb_owner` table owner. The rollback byte pin above includes
that correction.

Exact candidate head
`fcb740de84c5d9ff666acc2b12f3d342092b8a9c` passed hosted CI run
`33415414533`. That run passed the complete sealed migration chain, disposable
PostgreSQL FORCE and rollback/restoration proofs, distinct runtime-login and
pooled-runtime boundaries, the global grant/RLS audit, TypeScript, lint, the
full test suite, dependency security audit and production build. PR #366 merged
that exact head as `main` commit
`e32015574732994e3a37dc580d6adb3229fcf0e5`; its push CI
`33428248737` and the two triggered cross-system FORCE proofs passed. The
expected Vercel Preview failure is caused by the intentionally absent Preview
`DATABASE_URL`; it is not a failure of the candidate or main CI. The merge did
not dispatch Production Migrations or change production state.

## Production workflow restart contract

The production wiring is a separate follow-up branch based on the exact proven
candidate. Before any file isolation or migration command it byte-verifies the
complete FORCE release, runs the engine-read-only full-ledger scope proof and
accepts exactly two sanitized restart states:

- `phase-a-accepted`: FORCE is absent and the exact accepted Phase-A posture is
  live. Only this state may isolate/replay the sealed predecessor tree or run
  `prisma migrate deploy`.
- `force-hardened`: the exact byte-pinned FORCE row and FORCE catalog posture
  are already live. Every predecessor replay and migration-deploy step is
  skipped.

Both states reverify the restored complete FORCE tree and release, rerun the
read-only restart scope, converge the reviewed runtime grants, verify Prisma
status, run the global grant/RLS audit and require the exact final FORCE scope.
An unknown state cannot become a workflow output. Static workflow coverage
requires all 68 predecessor steps to carry the Phase-A gate and requires all
final convergence/proof steps to remain unconditional.

The first wiring draft was intentionally not accepted: although its restart
scope recognized an already-FORCE state, it still ran the historical Phase-A
catalog proofs afterward. A legitimate rerun after a partial success would
therefore have failed on the stronger FORCE posture. This was caught during
isolated source review before commit, push, merge or dispatch; the explicit
state gate above is the correction.

Local workflow checkpoint `6dc3c9eb78a7c3b2fab53d0e1b1c402716c93579`
passed the full repository suite with 3,679 passing, zero failing and seven
intentional skips, plus TypeScript, lint, the high-severity dependency audit,
the exact FORCE release verifier and a production build. The first build was
blocked before completion by the local sandbox's loopback-port prohibition;
the next reached page collection and correctly refused the disposable
worktree's absent environment. The accepted build injected the existing local
runtime environment only in memory, explicitly omitted owner/migration URL
variables, used the pooled runtime URL and wrote no secret file.

The separate workflow branch reached exact head
`a07941a990af69dceaa2eb3f3ead56843508a3e0` and passed ordinary hosted PR CI
`33428508275`: the complete sealed PostgreSQL migration and authority chain,
restart-safe FORCE and rollback/restoration proofs, 3,679 tests, TypeScript,
lint, dependency audit and production build all passed. PR #367 remains the
separate workflow-only release boundary; no production workflow was
dispatched.

PR #367 merged the corrected workflow as `main` commit
`45ad71fb47cf820a133672818e91bbffae398f3e`; main CI `33431178113` passed the
complete repository and PostgreSQL proof chain. Authorized production run
`33433271413` then passed exact source, credential, release-byte, full-ledger
restart-state and predecessor release checks before failing closed at the
historical transition-authority live-scope step. No migration command had run.

A mode-`0600`, engine-read-only local rerun emitted only the sanitized failure
category `OrderPaymentEvent predecessor table posture drifted`. That is the
expected result when a pre-activation verifier—which requires direct table
CRUD and RLS off—is run against accepted Phase A, where RLS is on and direct
CRUD is revoked. The correction preserves the fail-closed boundary: the stale
historical check is replaced by a second full-ledger FORCE restart proof that
must explicitly return `phase-a-accepted` immediately before replay/isolation.
It re-verifies the current table, function, grant, trigger, constraint, index,
owner and role posture rather than accepting a weaker or older state.

PR #368 merged that correction as `main` commit
`dd3a677a480b87460034ca68d07f0b1e6464457a`; main CI `33436863737`
passed. Authorized retry `33441215082` again failed closed before migration,
this time at the replacement proof. The live database proof itself had already
passed at workflow start. The second invocation ran only after the workflow
had intentionally moved the unapplied FORCE directory out of the local
migration tree, so the same full-tree verifier correctly rejected its locally
incomplete byte catalog. Production remained at accepted Phase A with FORCE
off.

The follow-up keeps the second independent live proof at its original
sequencing boundary. It restores the already byte-verified FORCE directory
from the runner's private staging path only for the full-tree proof, requires
the result to be exactly `phase-a-accepted`, and re-isolates the directory
before predecessor replay. An EXIT trap re-isolates it on every proof failure,
and exact before/after directory assertions fail closed on local tree drift.
This changes only disposable runner filesystem state; it does not broaden the
database proof or touch production.

## Production acceptance

PR #369 merged exact head
`5db226fcd7a2f4ebb88e19bf85b4e9c27c2f3fea` as main commit
`6a20981b0af68f8322b6306715fc117e0826e36e`. Exact-main CI
`33443669979` passed all 302 steps, including the corrected restart-safe tree
sequence and the complete disposable PostgreSQL FORCE/rollback chain.

Guarded production run `33445073482` then passed both independent accepted
Phase-A proofs, applied only
`20260831010000_force_order_payment_event_rls`, converged the reviewed grants,
and passed migration status, the global grant/RLS audit, and the exact final
FORCE scope proof. No application deployment or provider change occurred.

The distinct actual pooled-runtime postflight ran from the same exact clean
main commit through only `grainline_app_runtime` inside an engine-attested
repeatable-read/read-only transaction. It passed ten checks, exported no rows,
and recorded `productionChangedByPostflight=false`. Its exact catalog was
policyless ENABLE plus FORCE, zero runtime/PUBLIC table or column authority,
29 fixed functions split into 16 runtime and 13 private functions, four direct
table-operation denials, two retired-entry denials, five retained read
boundaries, and the fixed-writer read-only fence. Retain the sanitized
mode-`0600` evidence with SHA-256
`d63cea7bd6a95232790aef4ecd4b279ae837bada1bad7cb80ef6aa604671eea1`.

## Crash recovery

The laptop crash on 2026-08-31 removed the disposable `/private/tmp`
worktree before its first four files had been committed. The branch pointer
and accepted Phase-A source survived. The draft, rollback, migration and
staging verifier were regenerated from the sealed Phase-A migration and
reproduced the exact pre-crash draft and migration SHA-256 values. Recovery
checkpoint `e8ba4cf0` and verifier checkpoint `01932a0a` were pushed before
work continued. No production state was involved.

## Remaining release gates

All OrderPaymentEvent FORCE release gates are complete. The next RLS work must
start from a separate domain audit and release boundary; this completion does
not authorize bundling `Order`, `OrderItem`, or `OrderShippingRateQuote`.

## Scope boundary

This release does not alter order/refund/dispute business behavior or expand
actor authority. `Order`, `OrderItem`, and `OrderShippingRateQuote` remain
separate pre-RLS domains and must not be bundled into this posture-only step.
