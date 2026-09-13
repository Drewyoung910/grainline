# SellerPayoutEvent FORCE RLS release

Status: accepted production FORCE RLS.
Nothing in this document authorizes deployment or provider mutation. The
distinct actual pooled-runtime postflight passed and its sanitized evidence is
retained below.

Date: 2026-08-23

## Exact release unit

- Migration: `20260823220000_force_seller_payout_event_rls`
- FORCE draft SHA-256:
  `12a0bc72942fe322e1b061667e687f46240e18bcdd0ddb459d5b28f57b8134a9`
- Promoted migration SHA-256:
  `d15faee92ed7dcee599cd66a306928d52ce84fab73589db177c39baca871b12f`
- Rollback SHA-256:
  `aaa4724038c54cc58dfd28022277a72b18f875c788da3725f2b6c46a869c70c5`
- Complete migration-tree SHA-256:
  `e83f2289eca349834970b72bdf41ae181a2c6e50394cc3908b944af75a118d38`
- Guard phase: `seller-payout-event-force-reviewed`

The candidate changes only `relforcerowsecurity` on
`public."SellerPayoutEvent"`. It changes no row, policy, grant, function,
constraint, index, trigger, application code, deployment, credential or
provider state. The rollback changes only FORCE back to NO FORCE while
preserving the accepted policyless Phase-A boundary.

## Security purpose and limitation

The current `neondb_owner` migration role has `BYPASSRLS`, so FORCE does not
make that role subject to RLS. The runtime boundary remains zero direct table
or column authority plus exactly three source-bound fixed functions.

FORCE is retained as an ownership-drift invariant. If the table is later
transferred to a non-BYPASS owner, ownership cannot silently bypass the
policyless service boundary. Because the table has zero policies, an ownership
mistake fails closed; that intentional integrity benefit carries an
availability risk until ownership is repaired.

## Fail-closed predecessor

The migration shares the activation advisory lock, takes an ACCESS EXCLUSIVE
table lock, and refuses to proceed unless:

- the session is the exact table owner and accepted production or disposable
  CI migration role, with no other owner client sessions;
- `grainline_app_runtime` remains LOGIN, NOINHERIT, non-privileged and
  NOBYPASSRLS, with only Neon's proven non-effective administrative bootstrap
  edge;
- the table remains policyless ENABLE/NO-FORCE with zero direct runtime or
  PUBLIC table/column authority; and
- the exact three functions retain reviewed identities, owner, language,
  security mode, volatility, parallel mode, pinned search path, source MD5 and
  ACLs, without dynamic SQL.

The postflight requires the identical catalog with FORCE on. Drift rolls the
transaction back.

## Proof and release sequence

CI verifies FORCE first, moves it outside Prisma discovery, and replays the
complete sealed predecessor chain. After applying and proving SellerPayoutEvent
Phase A—including direct runtime denial, fixed operations and database-first
rollback/restoration—it restores and applies FORCE. A separate direct runtime
login then proves the FORCE catalog, direct-table denial, fixed projections and
the fixed writer's read-only fence. The owner rollback proof always restores
and re-verifies FORCE in `finally`.

The guarded production workflow accepts only the exact prepared or already
FORCE-applied restart state, retains all three reviewed historical Prisma
ledger exceptions, applies only the byte-pinned successor, converges grants,
and runs migration status, the global grant/RLS audit and exact after-scope
proof.

Exact main `0eb360b9878698f45288ac3c1649871de9a8a33c` passed CI run
`32672008187`. Guarded Production Migrations run `32672434812` applied only
`20260823220000_force_seller_payout_event_rls`, converged the reviewed grants,
and passed migration status, the global grant/RLS audit and exact FORCE scope.
No application deployment or provider state changed.

The release review then found that the merged package lacked the separately
invokable actual pooled-runtime FORCE postflight. The Phase-A postflight and
its evidence are deliberately not reusable because they require `NO FORCE`.
The distinct package merged at exact main
`fb350c31772938ef52ef796c61bf670d9cf0750e`, whose CI run `32675227286`
passed the complete release chain, 3,253 tests, TypeScript, lint, dependency
audit and production build. The command below then passed through the actual
pooled `grainline_app_runtime` credential:

`SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_CONFIRM=verify-production-seller-payout-event-force-runtime-read-only SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_RELEASE_COMMIT=fb350c31772938ef52ef796c61bf670d9cf0750e SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID=32675227286 SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_MIGRATION_RUN_ID=32672434812 SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH="seller-payout-event-force-production-postflight-fb350c31772938ef52ef796c61bf670d9cf0750e.json" npm run ops:seller-payout-event-force-postflight`

That command is engine-enforced repeatable-read/read-only, rejects owner,
direct and aliased database URLs, binds the exact clean source and migration
run, requires policyless ENABLE plus FORCE, proves direct denial and the exact
three-function catalog, and writes a fresh mode-`0600` artifact. PostgreSQL
attested repeatable-read/read-only; all nine checks passed, including direct
table denial, both fixed projections and the fixed writer's `25006` fence. It
reported `productionChangedByPostflight=false`. Retain evidence SHA-256
`f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
SellerPayoutEvent FORCE is accepted in production.

## Validation

Local validation on 2026-08-23 completed with:

- exact release verifier: passed;
- full test suite: 3,248 tests, 3,241 passed, zero failed and seven intentional
  environment-dependent skips;
- TypeScript `--noEmit`: passed; and
- ESLint: passed.

The full suite included the repository's disposable PostgreSQL proofs. A local
Next production build was deliberately not attempted with approximately 400
MiB of free disk; the isolated pull request's clean CI runner remains the
required build proof. This storage boundary changes no release claim and must
not be represented as a successful local build.

## Scope boundary

This candidate does not alter payout business behavior or expand actor
authority. It does not include `OrderPaymentEvent`,
`OrderShippingRateQuote`, `Order`, or `OrderItem`; each remains a separate
pre-RLS domain audit and independently activated release.
