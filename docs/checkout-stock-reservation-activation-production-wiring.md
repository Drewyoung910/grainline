# CheckoutStockReservation Phase-A production wiring

Status: isolated, production-inert workflow wiring. The exact activation is
wired only on branch
`agent/checkout-stock-reservation-activation-production-wiring-20260815`.
It is not merged or dispatched. Production still has CheckoutStockReservation
RLS off and the compatible predecessor table grants intact.

Date: 2026-08-15

## Accepted prerequisite

- Activation release PR #218 merged exact reviewed head
  `1dbab12dfe52867f1df5ca8689db2e3f0ae89933` as main
  `5817dea6725f7f2eb7fde3da1f546aa75dd449b1`.
- Exact-main CI run `31892857440` passed, including disposable PostgreSQL
  activation, rollback, grant audit and direct runtime-login proof.
- Migration:
  `20260815060000_enable_checkout_stock_reservation_rls`.
- Migration SHA-256:
  `7940be1969c89c8bbf5818164a56afb7e8bf7925bd8a26231d8ac865fac7c519`.
- Migration-tree SHA-256:
  `b014ea6ccc6ec6107e06897269ed607e6a8930c770fea3914e4b6b8b42b502f3`.
- Guard phase: `checkout-stock-reservation-activation-reviewed`.

No Production deployment followed that merge. The observed newer Vercel
entries were Preview failures; the existing Production deployment was not
replaced.

## Exact guarded workflow order

The isolated Production Migrations workflow now:

1. verifies the exact dispatched main source and owner/runtime role boundary;
2. verifies the activation migration-tree phase and exact release bytes;
3. moves the activation migration outside Prisma discovery;
4. verifies and isolates the source-consistency predecessor;
5. verifies the sealed authority, StripeWebhookEvent FORCE, Case,
   Conversation/Message, Notification and DirectUpload predecessors;
6. restores source consistency, then restores activation;
7. reads the production migration ledger inside an engine-attested
   `READ ONLY` transaction and accepts only the exact source-consistent or
   already-activated restart state;
8. applies the exact discoverable tree, converges the reviewed runtime grants,
   checks migration status and runs the global grant/RLS audit; and
9. re-reads the ledger read-only and requires exactly one completed activation
   row with the byte-pinned checksum.

The activation-specific scope verifier recursively preserves all three known
historical migration-ledger exceptions and rejects missing predecessors,
unknown rows, duplicate activation rows, checksum drift, rolled-back or
partial activation rows, and an activation row in the `before` state. Its
`restart` state accepts only two complete states: source-consistent with no
activation row, or fully activated with one exact applied row. It never
repairs or writes the ledger. Unit tests and a disposable-PostgreSQL ledger
proof cover both accepted restart states and fail closed on a zero-step failed
activation row; that state requires a separate reviewed recovery.

## Security posture produced by the reviewed migration

- exactly one protected table: `public."CheckoutStockReservation"`;
- policyless `ENABLE ROW LEVEL SECURITY`;
- FORCE deliberately remains off;
- zero ordinary-runtime/PUBLIC table or column authority;
- 16 runtime-executable fixed operations and nine owner-private helpers;
- two retired legacy creation functions remain installed for database-first
  rollback but lose runtime execution;
- zero row-data mutation.

## Remaining separate boundaries

1. Complete exact-head CI and review this isolated workflow branch.
2. Merge the wiring without dispatching it.
3. Separately authorize and dispatch the exact main commit after same-commit CI.
4. After a successful guarded migration, run the separate actual pooled-runtime
   read-only/direct-denial postflight and retain sanitized mode-`0600` evidence.
5. Prepare and execute FORCE as a separate posture-only release.

This record does not authorize a merge, workflow dispatch, migration,
deployment, FORCE, cleanup, credential change or provider mutation.
