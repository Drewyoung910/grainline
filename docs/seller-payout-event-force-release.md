# SellerPayoutEvent FORCE RLS release

Status: isolated candidate only. Nothing in this document authorizes merge,
production migration, deployment, provider mutation, or a claim that FORCE is
live. Production remains Phase A.

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
proof. Production execution remains a separate boundary after merge and
exact-main CI.

## Candidate validation

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
