# SellerPayoutEvent activation production wiring

Status: isolated, production-inert wiring candidate stacked on the exact
SellerPayoutEvent activation package at
`be061901523fb81edf88f59c0c8c86aa06457554`. Nothing in this document
authorizes a merge, workflow dispatch, production migration, application
deployment, FORCE release or provider change.

Date: 2026-08-22

## Exact release bound by this wiring

- Migration: `20260822180000_enable_seller_payout_event_rls`
- Promoted migration SHA-256:
  `0347a8d930631b4fbed793eec4d119d1c56adcaa2802a89c61940ef6b62fb4bc`
- Complete migration-tree SHA-256 through activation:
  `f680540b155b116e8fcba1cb3a33e84b87b59f07b53466956554a5313485b006`
- Guard phase: `seller-payout-event-activation-reviewed`
- Predecessor: exact applied compatible-authority migration
  `20260815210000_prepare_seller_payout_event_authority`

The migration enables policyless RLS, explicitly retains `NO FORCE`, makes
`stripeEventCreatedSeconds` required and revokes direct table authority from
`PUBLIC` and `grainline_app_runtime`. It creates no policy or function and
performs no row DML. The three already-live source-bound fixed functions remain
the only ordinary-runtime access path.

## Restart-safe production scope

`scripts/verify-seller-payout-event-activation-production-scope.mjs` seals the
complete reviewed migration ledger through the compatible authority release
and this one activation successor. It uses the protected migration-owner
reader inside an engine-enforced read-only transaction.

The `restart` stage accepts exactly two complete states:

1. `prepared`: every reviewed predecessor is applied and no activation row
   exists; or
2. `activated`: the same predecessor plus one finished, non-rolled-back,
   one-step activation row with the exact promoted checksum.

Unknown, duplicate, unfinished, rolled-back, zero-step or checksum-drifting
activation rows fail closed. The three already-reviewed historical Prisma
ledger exceptions remain byte- and shape-pinned; this workflow does not repair,
normalize or rewrite them. Any partial migration state requires a separate
inspection and recovery decision.

Unit and disposable-PostgreSQL coverage already exercise prepared, activated
and rejected restart states. The activation package also proves the exact
catalog and runtime behavior through a separate direct restricted-runtime
login, then rehearses database-first rollback and restoration.

## Guarded workflow order

The isolated workflow change:

1. verifies the exact dispatched main commit and protected migration-owner
   identity;
2. verifies and isolates the SellerPayoutEvent activation, then verifies its
   compatible-authority predecessor;
3. recursively verifies and isolates the sealed CheckoutStockReservation
   FORCE, activation and source-consistency predecessors before checking the
   older authority chain;
4. restores every successor in dependency order, with SellerPayoutEvent
   activation restored last;
5. runs the read-only SellerPayoutEvent activation `restart` scope before
   Prisma can write;
6. runs `prisma migrate deploy`, converges the reviewed global runtime grants,
   checks migration status and runs the global grant/RLS audit; and
7. runs the read-only activation `after` scope, which requires the one exact
   completed activation row.

No workflow input selects a migration. Byte-pinned release verification and
the restart scope fail before Prisma writes if the source tree, migration
ledger, role identity or release order differs from the reviewed state.

## Remaining boundaries

This wiring must remain stacked until the predecessor-drain record and
activation package merge in dependency order. It then requires its own exact
head merge and successful exact-main CI before any guarded workflow dispatch
may be considered.

After a separately approved successful migration, run the actual pooled
`grainline_app_runtime` postflight from the same clean main commit and bind it
to that commit's successful CI and migration run. FORCE remains a later,
posture-only migration after policyless activation and pooled-runtime evidence
are accepted.

This candidate does not deploy application code, change credentials, modify
Stripe or Vercel configuration, enable Case evidence, clean data, or authorize
the later `OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` or `OrderItem`
releases.
