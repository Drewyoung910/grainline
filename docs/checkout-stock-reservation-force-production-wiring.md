# CheckoutStockReservation FORCE production wiring

Status: isolated and production-inert. The exact FORCE release is draft PR
#221 at `a0eadb74707652e3883bde36d9c44be3a430a737`; exact-head GitHub CI run
`31907436947` passed all 133 steps, including the disposable PostgreSQL FORCE,
rollback, runtime-denial, full-suite and production-build gates. Neither the
release nor this wiring has been merged, dispatched or applied. Production
remains at accepted policyless Phase A with FORCE off.

Date: 2026-08-15

## Exact release bound by this wiring

- Migration: `20260815060001_force_checkout_stock_reservation_rls`
- Promoted migration SHA-256:
  `cfa05295bd469903aa967919a0178312dbbc855203c408db2395602589f5178d`
- Complete migration-tree SHA-256:
  `75971d49d54b46759851be1f39353fee5132465ce8da59a8b3251a267216aa86`
- Guard phase: `checkout-stock-reservation-force-reviewed`
- Predecessor: exact applied policyless Phase A migration
  `20260815060000_enable_checkout_stock_reservation_rls`

The migration changes only `relforcerowsecurity` on
`public."CheckoutStockReservation"`. It contains no row, policy, grant,
function, schema, application, deployment or provider change.

## Restart-safe production scope

`scripts/verify-checkout-stock-reservation-force-production-scope.mjs`
recursively seals the complete reviewed migration ledger through Phase A, its
three accepted historical ledger exceptions, and the one exact FORCE
successor. It reads through the production migration-owner connection only
inside the existing engine-attested `READ ONLY` transaction.

The `restart` stage accepts exactly two complete states:

1. `activated`: every reviewed predecessor is applied and no FORCE row exists;
2. `force-hardened`: the same predecessor plus one finished, non-rolled-back,
   one-step FORCE row with the exact promoted checksum.

It rejects unknown migrations, missing or duplicate rows, checksum drift,
unfinished, zero-step or rolled-back FORCE rows, a partial predecessor, a
pooled/runtime credential, non-main source, non-manual execution, and every
unrecognized stage. It does not repair or write the ledger. A failed or
partial row must stop for a separately reviewed recovery.

Unit and disposable-PostgreSQL tests cover both accepted restart states and
the fail-closed zero-step state.

Isolated local validation passed 358 focused workflow/security tests and the
full repository suite with 3,106 passed, seven intentional skips and zero
failures. TypeScript, lint and `git diff --check` also passed; lint emitted only
the repository's existing jsx-ast-utils TypeScript-expression diagnostic.
Exact-head GitHub CI remains mandatory after this wiring is pushed.

## Guarded workflow order

The isolated workflow change:

1. verifies the exact dispatched main commit and protected migration-owner
   identity;
2. verifies and isolates the FORCE migration and then recursively verifies and
   isolates Phase A, source consistency and the authority predecessor;
3. restores source consistency, Phase A and FORCE in dependency order;
4. runs the read-only FORCE `restart` scope before Prisma can write;
5. runs `prisma migrate deploy`, converges the already reviewed runtime grants,
   checks migration status and runs the global grant/RLS audit; and
6. runs the read-only FORCE `after` scope, which requires the exact applied
   FORCE row.

No operator can select a different migration from this workflow. Migration
tree and release verification fail before the production connection reaches
Prisma if any byte or predecessor changes.

## Remaining boundaries

This wiring does not authorize merging PR #221 or its successor, dispatching
Production Migrations, deploying, changing grants or provider variables, or
claiming FORCE is live. After any separately approved production application,
the actual pooled `grainline_app_runtime` postflight must run read-only from
the exact successful main commit and retain sanitized mode-`0600` evidence.
