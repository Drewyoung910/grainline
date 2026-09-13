# CheckoutStockReservation Phase-A production wiring

Status: completed production Phase-A activation. PR #219 merged exact head
`6dec4f84afea9e817a29247f9f57cf5646cc5b8b` as main
`405d6dff327bee76aced17f3876f8f18f29e05db`; exact-main CI
`31894742120` passed. Guarded Production Migrations run `31903152300`
applied only the reviewed activation, and the separate actual pooled-runtime
postflight passed read-only. CheckoutStockReservation now has policyless RLS
enabled, FORCE off, and zero ordinary-runtime/PUBLIC table or column authority.

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

Production-wiring PR #219 then merged exact head
`6dec4f84afea9e817a29247f9f57cf5646cc5b8b` as main
`405d6dff327bee76aced17f3876f8f18f29e05db`; exact-main CI
`31894742120` passed the full database, type, lint, test, dependency and
production-build gates.

## Exact guarded workflow order

The guarded Production Migrations workflow:

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

## Production result and remaining boundary

- Guarded run `31903152300`, bound to exact main
  `405d6dff327bee76aced17f3876f8f18f29e05db` and CI `31894742120`, applied
  only `20260815060000_enable_checkout_stock_reservation_rls`. The read-only
  restart scope, migration status, exact grant convergence, global grant/RLS
  audit and applied activation scope all passed.
- The separate actual pooled-runtime postflight ran from a clean checkout of
  that exact main commit in an engine-attested repeatable-read/read-only
  transaction. It proved the restricted role identity, exact 25-function
  source/mode/owner/ACL catalog, direct table denial, fixed export success,
  private-helper denial and SQLSTATE `25006` fixed-write fence. It persisted no
  database change.
- Sanitized mode-`0600` evidence SHA-256 is
  `899679a14590200880e89d983fff70492632de458649316bd69cde9a0027ece0`;
  it records `productionChangedByPostflight=false` and contains no connection
  string or row data.
- No application deployment or provider change accompanied activation.

The remaining database boundary is the separately designed and reviewed FORCE
posture release. This record does not authorize FORCE, deployment, cleanup,
credential change or provider mutation.
