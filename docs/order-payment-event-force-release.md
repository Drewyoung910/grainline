# OrderPaymentEvent FORCE RLS release

Status: isolated candidate; not merged or applied to production.

Date: 2026-08-31

## Exact release unit

- Migration: `20260831010000_force_order_payment_event_rls`
- FORCE draft SHA-256:
  `ede67764c0fa9cde5c694325e6303dd9a88cc10bdc7cfa4825ca69baa50044ab`
- Promoted migration SHA-256:
  `20d590b14f8b2dd5ee22537b18138624292bbfe8de8b3e5f2d407fae02f606cd`
- Rollback SHA-256:
  `ba15f92ad10271dea8c22104c330c4602b7fb1e464c2942ecc7265b1bab0190d`
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

The future invocation shape is:

```sh
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_CONFIRM=verify-production-order-payment-event-force-runtime-read-only \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_RELEASE_COMMIT=<exact-force-main> \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID=<successful-main-ci> \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_MIGRATION_RUN_ID=<successful-force-migration-run> \
ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH=order-payment-event-force-production-postflight-<exact-force-main>.json \
npm run ops:order-payment-event-force-postflight
```

## Crash recovery

The laptop crash on 2026-08-31 removed the disposable `/private/tmp`
worktree before its first four files had been committed. The branch pointer
and accepted Phase-A source survived. The draft, rollback, migration and
staging verifier were regenerated from the sealed Phase-A migration and
reproduced the exact pre-crash draft and migration SHA-256 values. Recovery
checkpoint `e8ba4cf0` and verifier checkpoint `01932a0a` were pushed before
work continued. No production state was involved.

## Remaining release gates

1. Pass the disposable PostgreSQL FORCE, pooled-runtime postflight and rollback
   proofs in hosted CI.
2. Pass the focused and full local suites, TypeScript, lint, dependency audit
   and a clean hosted production build.
3. Review and merge the exact proven release commit.
4. Separately authorize and run the guarded production migration workflow.
5. Run the distinct engine-read-only pooled-runtime production postflight.
6. Only then update the coverage matrix from Phase A to accepted FORCE.

## Scope boundary

This release does not alter order/refund/dispute business behavior or expand
actor authority. `Order`, `OrderItem`, and `OrderShippingRateQuote` remain
separate pre-RLS domains and must not be bundled into this posture-only step.
