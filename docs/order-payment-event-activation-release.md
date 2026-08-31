# OrderPaymentEvent policyless activation release

Status: production Phase A is accepted. Exact main
`94dbe98ae5e7fbf95989be690fc20d47e76cdb12` passed CI `33357911021`;
guarded run `33358695448` applied only
`20260830030000_enable_order_payment_event_rls`, converged the reviewed grants,
and passed migration status, the global grant/RLS audit and both final scope
proofs. Production is policyless ENABLE with explicit `NO FORCE`, zero direct
runtime/PUBLIC table or column authority, and the exact 16-runtime / 13-private
function partition. PR #364 merged the distinct postflight as exact main
`aec47e6a104f1fa54b6ee0e894751850d51390ec`; exact-main CI `33361381594`
passed, and the actual pooled-runtime postflight then passed read-only with
sanitized evidence SHA-256
`d4acc792856d0a3260cff9d597a27d6335650b2820536175f4f725185e7c7bfd`.
Nothing in this record authorizes FORCE RLS, provider changes, or activation
of `Order`, `OrderItem` or `OrderShippingRateQuote`.

Prepared: 2026-08-31.

## Exact candidate

- activation migration:
  `20260830030000_enable_order_payment_event_rls`
- guarded phase: `order-payment-event-activation-reviewed`
- activation draft SHA-256:
  `4d7705f8a4d8f0156a05e4f87e6c62ccc42c9e48936dc0beeaf0f333242376c6`
- promoted migration SHA-256:
  `0566632d372524667ad80e5cf6ed76250ca13abc838b8fdce60e3cb909fb83c1`
- migration-tree SHA-256 through activation:
  `389cfab874e29921027e6661f7abd8e8286a46db8505cac589d15823c57b3adf`
- emergency rollback SHA-256:
  `4f85a61d18e0b53faec5b9abdbd3d52f53cf176392b61a0ca908be1abd957568`

The promoted migration is generated mechanically from the reviewed draft by
replacing only the draft header. The release verifier compares the promoted
bytes with that generated candidate and seals the complete migration prefix.
The candidate creates no function or policy, changes no row and does not
enable FORCE.

## Domain and authority decision

`OrderPaymentEvent` is private service evidence, not a participant-authored or
participant-readable table. Phase A therefore follows the policyless service
ledger design already accepted for `StripeWebhookEvent`,
`CheckoutStockReservation`, `SellerPayoutEvent` and
`OrderRefundReconciliation`:

- enable RLS while explicitly retaining `NO FORCE`;
- install exactly zero policies;
- revoke all table and column authority from `PUBLIC` and
  `grainline_app_runtime`;
- retain only source-validating fixed functions whose complete catalog,
  source, owner, configuration and ACL are proven; and
- keep posture-only FORCE as a later independent release with a fresh actual
  pooled-runtime postflight.

The accepted repository-wide zero-direct-access proof scanned all 738 tracked
JavaScript/TypeScript files and found exactly seven fixed-authority consumers,
12 reference files, five fixed database operations and zero direct base-table
access. Retain its sanitized evidence SHA-256
`6298a1dc376bec73f2abcb896d54913815e155717cd004596b622b6439208590`.
The separate credential-epoch drain removed all 11 reviewed superseded READY
deployments and retained only current deployment
`dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc`; retain evidence SHA-256
`1596ad71479f7a9bda51b00c94b3ac27bea6adf6a5454eb34e03c35618764e5d`.

## Final fixed-function inventory

The activation catalog is composed from the latest byte-sealed compatible,
signed-refund, signed-dispute, transfer-binding, invariant, read-authority,
aggregate-authority and transition-authority releases. It contains exactly 29
functions:

- 16 retained ordinary-runtime fixed operations;
- two predecessor entry points whose runtime `EXECUTE` is retired by
  activation; and
- 11 functions that were already runtime-private, yielding 13 private
  functions after activation.

The two retired identities are:

- `grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)`;
- `grainline_case_seller_refund_apply(text,text)`.

Tracked application source calls exactly the 16 retained operations. The two
retired functions remain installed only so the byte-pinned database-first
rollback can restore predecessor compatibility; current application source no
longer calls them. The catalog requires the exact identity, owner, language,
volatility, parallel mode, `SECURITY DEFINER` posture where applicable, pinned
`search_path=pg_catalog`, source MD5, runtime ACL, no `PUBLIC` execution, no
unexpected overload and no dynamic SQL.

The review caught a stale hand-composed catalog before release: it omitted the
latest `grainline_blocked_checkout_transfer_bind` successor and retained older
signed refund/dispute definitions. The final catalog is now mechanically
composed from the latest sealed sources. This correction changed no production
state.

## Activation transaction

The migration obtains one advisory lock and follows the writers' existing
parent-first relation order: `Order`, then `OrderPaymentEvent`, both with
bounded lock and statement timeouts. Before changing posture it fails closed
unless all of the following are exact:

1. table ownership by the current migration login, accepted only as production
   `neondb_owner` or disposable `ci` in database `grainline_ci`, plus the
   restricted runtime-role posture;
2. RLS off, FORCE off, zero policies and exact predecessor table/column ACLs;
3. all six validated constraints, seven indexes and seven exact enabled,
   non-internal trigger bindings across `OrderPaymentEvent` and `Order`;
4. zero rows violating the accepted taxonomy, source, amount, currency, text,
   metadata and timestamp invariants;
5. the exact 29-function catalog and trusted-name overload surface;
6. exactly 25 signature-bound reviewed functions directly reference
   `OrderPaymentEvent`: 18 members of this release's 29-function catalog plus
   seven already-sealed Case/Notification cross-system functions; and
7. the accepted transition-authority predecessor migration and migration
   ledger state.

Only after those checks does it enable RLS, explicitly retain `NO FORCE`,
revoke all ordinary-runtime/PUBLIC table authority and revoke runtime execution
of the two retired entry points. It performs zero row DML.

## Restart-safe production scope

The production scope verifier runs through the protected owner credential in
an engine-enforced read-only transaction. It accepts only:

1. `transition-authority-prepared`: the exact accepted predecessor is applied,
   the activation row is absent, RLS is off, predecessor CRUD and 18 runtime
   functions are exact; or
2. `activated`: one exact completed activation row exists, policyless ENABLE
   plus `NO FORCE` is present, table CRUD is absent and the final 16-runtime / 13-private
   function partition is exact.

Unknown, duplicate, unfinished, rolled-back, checksum-drifting or partial
states fail closed. The global runtime grant audit and runtime-role provisioning
contract understand both exact states without weakening any previously
activated table.

## Disposable PostgreSQL and rollback proof

CI uses separate loopback logins for the owner (`ci`) and ordinary runtime
(`grainline_app_runtime`). The activation proof requires:

- an engine-attested repeatable-read/read-only catalog transaction;
- exact restricted runtime identity;
- all four direct table operations denied with SQLSTATE `42501`;
- both retired function calls denied with SQLSTATE `42501`;
- all four participant read projections executable with empty foreign input;
- the staff timeline function body reached and its staff authorization denied;
- no production connection and no row mutation.

The byte-pinned emergency rollback is database-first. Before rollback it
requires the exact activated table ACL and all 29 function source/ACL records;
it explicitly rejects unexpected `PUBLIC` table or function grants. It restores
only predecessor CRUD and the two retired runtime entry points, proves that
predecessor boundary through the distinct runtime login, then reapplies and
re-attests the exact activation. It changes no fixture rows. A failed
restoration is surfaced as an aggregate failure.

The hard review strengthened the rollback from posture-only checks to exact
before-and-after ACL and function-catalog checks. It also strengthened trigger
verification from name-only matching to exact relation, trigger name,
function, trigger type and enabled/non-internal state. Both corrections landed
before any persistent database application.

Hosted CI `33339776682` then failed closed at the activation step because the
initial role check required production owner name `neondb_owner` even in the
disposable database, whose exact owner is `ci`. The correction does not accept
an arbitrary owner: the table must be owned by `CURRENT_USER`, and the login
must be either `neondb_owner` or exactly `ci` in database `grainline_ci`.
Protected production workflow identity checks remain unchanged.

Replacement hosted CI `33340360157` reached the activation and then rejected
two exact functions because the preflight used the presence of `FORMAT(` as a
proxy for dynamic SQL. Both sealed bodies use `pg_catalog.format()` only for
human-readable reconciliation text and contain no PL/pgSQL `EXECUTE`. The
corrected catalog retains the actual no-`EXECUTE` check and exact source MD5s
for all 29 functions while permitting those two non-dynamic formatting calls.
Production again remained untouched.

Final PR CI `33341591300` passed the real disposable PostgreSQL activation,
separate-login denial, grant convergence, byte-pinned rollback/restoration,
TypeScript, lint, full test suite, dependency audit and production build. PR
#359 exact head `1b882307b13b251dee6fb0cca2f8ba47b628abd5` merged as exact
main `1827f45b7bcc8038e045b19d2dde027e8d6607f9`; exact-main CI
`33342102223` passed independently.

The explicitly authorized guarded production run `33342647139` then failed
closed before migration deployment. The restart scope, activation release and
transition release checks passed, but the workflow moved the transition
successor out of the migration tree before asking the aggregate release
verifier to attest its required transition successor. The aggregate verifier
correctly rejected the now-incomplete tree. The migration deployment step and
every grant, postflight and mutation step were skipped.

The correction preserves every byte-sealed verifier and changes only runner
ordering: verify the complete transition, aggregate, read and invariant
successor chain first, then isolate those four already-applied predecessors
before Prisma migration deployment. A workflow-order regression test requires
all four verifiers to precede the first isolation. A corrected exact-main
commit and a fresh commit-bound production authorization remain required.

PR #360 exact head `a6b9e4621c901db70a886737844591fde90997d1`
merged as exact main `77b8dc77196aac55d4b96dad758383f80b5206b7`;
exact-main CI `33344994209` passed the complete disposable PostgreSQL,
rollback, static, dependency and production-build chain. Explicitly authorized
production run `33346872466` then failed closed before migration deployment at
the standalone blocked-checkout transfer-binding scope check. That historical
scope intentionally expects the pre-signed-refund function body; production
correctly contains the later sealed signed-refund identity body. The outer
transition-authority production verifier performs the exact reviewed successor
normalization before recursively proving that transfer-binding predecessor.

The second correction therefore keeps the exact transfer-binding byte check,
replaces the stale standalone production check with the engine-read-only full
transition-authority predecessor-chain proof, and requires that full proof to
pass before any successor directory is isolated. It removes no byte seal and
does not weaken the dedicated historical transfer-binding workflow. Run
`33346872466` skipped migration deployment and every grant/postflight step;
production remains unchanged.

Initial correction PR CI `33347265516` passed the changed release/workflow
contracts and progressed through the disposable predecessor chain, then failed
in the pre-existing signed-refund real-login proof. The harness generated
`event_created_seconds` independently for the insert and replay calls; when
those calls crossed a wall-clock second, PostgreSQL correctly rejected the
replay as inconsistent. The corrected proof pins one provider event timestamp
per fixture and reuses it for insert, replay and forged-generation checks. No
database function, migration or application byte changed.

Replacement PR CI `33347620093` passed the complete disposable PostgreSQL,
rollback, test, dependency-audit and production-build chain. PR #361 exact
head `8a1cee4b18ef0560d2943fead09d9ded8e8d84c8` merged as exact main
`a23af493b8b45b2626b620f6aa606c17fdcc9998`; exact-main CI
`33348582463` passed independently.

Explicitly authorized guarded production run `33350490387` passed the exact
source, credential, role, activation release, restart scope, all four latest
successor byte checks and the corrected full transition-authority predecessor
scope. It then failed closed at the sealed `SellerPayoutEvent` FORCE
migration-tree guard. The runner had isolated only four late
`OrderPaymentEvent` successor directories; it left the target activation and
nine other reviewed post-`SellerPayoutEvent` migrations in the tree. The
historical guard correctly refused to treat `20260823220000` as the latest
migration. Prisma deployment, grant convergence and every postflight step were
skipped, so production remained unchanged.

The third runner correction verifies the exact activation release and complete
live predecessor scope before any isolation, then walks backward through all
14 reviewed post-`SellerPayoutEvent` migrations from the target
`20260830030000` to `20260824010000`. Each prefix-sensitive release verifier
runs only after newer reviewed directories have been isolated, giving every
sealed historical guard its exact release prefix. Before Prisma, the runner
restores the 14 directories in chronological order and re-runs both the exact
activation migration-tree guard and activation release verifier. A focused
contract requires every directory to occur exactly once in isolation and once
in restoration, with the full production proof before isolation and Prisma
only after restored-tree re-verification. No SQL, migration, application,
grant or provider byte is changed.

PR #362 exact head `31d20c7812e2777ebf7ea96c5916e1f852fb5870`
passed hosted CI `33351711752` and merged as exact main
`9376cfae75ff3bdc4424b8a78ab0a9771b6ab0c0`; exact-main CI
`33352306859` passed independently. Explicitly authorized guarded run
`33352985776` passed the corrected source-tree isolation and restoration, then
failed closed before Prisma at the historical `SellerPayoutEvent` FORCE
restart-scope proof. That verifier still required the production ledger to end
at `20260823220000_force_seller_payout_event_rls`; production correctly also
contains the 13 later applied reviewed migrations, while the target
`20260830030000_enable_order_payment_event_rls` remains absent. Migration,
grant and postflight steps were skipped, so production remained unchanged.

The fourth correction preserves the historical verifier's default exact-prefix
behavior and adds an explicit current-release mode. That mode first verifies
the complete byte-sealed `OrderPaymentEvent` activation release, then validates
all 14 post-`SellerPayoutEvent` ledger identities against their fixed reviewed
SHA-256 constants. Before Prisma it requires the first 13 successors applied
and the target absent; after Prisma it requires all 14 applied. Unknown,
missing, duplicate, rolled-back, zero-step or checksum-drifted successor rows
fail closed. The existing historical listing-variants and DirectUpload ledger
exceptions remain confined to the already-reviewed prefix assertion. Unit and
disposable PostgreSQL tests pin both exact stages and every rejection class.
No SQL, migration, application, grant or provider byte changes.

## Phase-A production application

PR #363 exact head `faea242665beefe146af6d4cea024fbdee900d5c`
passed hosted CI `33354557116` and merged as exact main
`94dbe98ae5e7fbf95989be690fc20d47e76cdb12`; exact-main CI
`33357911021` passed independently. Guarded production run `33358695448`
then passed the exact source and owner-role guards, restored and reverified the
complete byte-sealed migration tree, applied only the activation migration,
converged grants, and passed migration status plus the global and table-specific
catalog audits.

The final protected-owner evidence classified production as `activated` with
RLS enabled, FORCE disabled, zero policies, zero runtime table privileges,
exactly 16 runtime-callable functions and 13 runtime-private functions. The
proof performed no row DML. The run did not deploy application code, enable
FORCE, activate another table, or change provider state.

The distinct pooled-runtime postflight is intentionally a separate tool and
evidence boundary. It rejects owner or aliased database credentials, requires
the exact clean release commit and pooled `grainline_app_runtime` identity,
runs in an engine-attested repeatable-read/read-only transaction, verifies the
complete 29-function and 25-direct-reference catalog without reading the
owner-only migration ledger, denies all four direct table operations and both
retired entry points, executes the five retained read boundaries with
nonexistent markers, and proves a granted fixed writer reaches SQLSTATE
`25006`. It writes only sanitized mode-`0600` evidence and performs no
production mutation.

The first hosted proof attempt at exact head `08a92c6e...` / CI
`33360145389` failed closed with zero production reach: inside the required
engine-read-only transaction PostgreSQL rejected direct `INSERT` with
SQLSTATE `25006` before evaluating the expected table ACL denial. The corrected
contract keeps the exact zero-CRUD catalog proof, requires direct `SELECT` to
fail with `42501`, and separately requires `INSERT`, `UPDATE` and `DELETE` to
hit the stronger engine read-only fence `25006`. No permission was broadened
and no read-only guard was removed.

## Pooled-runtime Phase-A acceptance

PR #364 exact head `9093c4c21a3eb56065c8b1bf5ad9a093486ff17d`
passed CI `33360701852` and merged as exact main
`aec47e6a104f1fa54b6ee0e894751850d51390ec`. Exact-main CI
`33361381594` passed independently, including the same disposable PostgreSQL
runtime-login proof and the production build.

The actual production postflight ran only from that clean exact-main checkout,
through the pooled `grainline_app_runtime` credential, and was bound to guarded
migration run `33358695448`. PostgreSQL attested repeatable-read/read-only mode,
the restricted runtime identity, policyless ENABLE with `NO FORCE`, zero direct
runtime/PUBLIC table or column authority, the exact 29-function / 25-direct
reference catalog, direct SELECT ACL denial, three DML read-only fences, both
retired-entry-point denials, five retained read boundaries, and the granted
writer's SQLSTATE `25006` fence. It exported no rows and reported
`productionChangedByPostflight=false`.

Retain the mode-`0600` evidence file
`order-payment-event-activation-production-postflight-aec47e6a104f1fa54b6ee0e894751850d51390ec.json`;
its SHA-256 is
`d4acc792856d0a3260cff9d597a27d6335650b2820536175f4f725185e7c7bfd`.
Phase A is now complete retained acceptance.

## Remaining release boundaries

1. Prepare and release posture-only FORCE separately; do not alter policies,
   grants, functions or rows in that migration.
2. Repeat the actual pooled-runtime proof from the exact FORCE release and
   retain distinct evidence. Do not reuse the Phase-A artifact.

`Order`, `OrderItem` and `OrderShippingRateQuote` remain later separately
audited and activated tables. This release is not authority to bundle them.
