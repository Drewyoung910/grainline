# SellerPayoutEvent activation production wiring

Status: accepted production Phase A. The initial guarded dispatch
`32659750056` failed closed before Prisma or mutation on a missing predecessor
isolation edge. The corrected workflow merged at exact main
`bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`; exact-main CI `32663849012`
passed. Guarded run `32667518275` applied only the reviewed activation and
passed grant convergence, migration status, global grant/RLS audit, and exact
activation scope. The separate actual pooled-runtime postflight passed
read-only with sanitized evidence SHA-256
`01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de`.
Nothing in this document authorizes application deployment, FORCE, another
migration, or provider change.

Prepared: 2026-08-22. Corrected after fail-closed dispatch: 2026-08-23.

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
2. verifies and isolates the SellerPayoutEvent activation, verifies its
   compatible-authority predecessor, and isolates that later predecessor from
   every older migration-tree seal;
3. recursively verifies and isolates the sealed CheckoutStockReservation
   FORCE, activation and source-consistency predecessors before checking the
   older authority chain;
4. restores every successor in dependency order: CheckoutStockReservation
   source consistency, activation and FORCE, then SellerPayoutEvent authority,
   with SellerPayoutEvent activation restored last;
5. runs the read-only SellerPayoutEvent activation `restart` scope before
   Prisma can write;
6. runs `prisma migrate deploy`, converges the reviewed global runtime grants,
   checks migration status and runs the global grant/RLS audit; and
7. runs the read-only activation `after` scope, which requires the one exact
   completed activation row.

No workflow input selects a migration. Byte-pinned release verification and
the restart scope fail before Prisma writes if the source tree, migration
ledger, role identity or release order differs from the reviewed state.

## Accepted production result and remaining boundary

The corrected exact main `bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`
and CI `32663849012` retained the failed first dispatch as evidence, added the
missing authority isolation/restoration pair, and proved the exact dependency
order. Restart-safe guarded run `32667518275` accepted the prepared state,
applied only `20260822180000_enable_seller_payout_event_rls`, converged the
reviewed grants, and passed the migration ledger, global grant/RLS audit, and
activated scope. The resulting catalog is `ENABLE`, explicit `NO FORCE`, zero
policies, zero direct runtime/PUBLIC table or column authority, and exactly
three reviewed fixed operations.

The separately executed actual pooled `grainline_app_runtime` postflight bound
to the same main/CI/migration triple passed all nine engine-read-only checks
and wrote sanitized mode-`0600` evidence SHA-256
`01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de`.
It changed no production state. SellerPayoutEvent Phase A is accepted. FORCE
remains a later, posture-only migration with a fresh, distinct pooled-runtime
proof.

This candidate does not deploy application code, change credentials, modify
Stripe or Vercel configuration, enable Case evidence, clean data, or authorize
the later `OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` or `OrderItem`
releases.
