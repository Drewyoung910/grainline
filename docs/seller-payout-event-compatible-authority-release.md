# SellerPayoutEvent compatible authority release

Status: isolated candidate only. The migration, schema and proof harness are
not merged, applied, deployed or wired to a production workflow. RLS remains
off and predecessor runtime table CRUD remains intentionally available.

Audited: 2026-08-15

## Exact candidate

- prerequisite audit: `docs/seller-payout-event-pre-rls-audit.md`
- migration: `20260815210000_prepare_seller_payout_event_authority`
- migration SHA-256:
  `9aca2449c229d0c393e41e3b63c938b6ac80c3a3bbfcda5fc68198fbc94ec146`
- schema addition: nullable `stripeEventCreatedSeconds`, unique Stripe event
  identity and seller/provider-time/id keyset index
- public runtime functions: source-bound payout apply, own latest failure and
  own bounded export page
- private functions: none in this preparation

This record pins a review candidate, not a production authorization. If the
migration bytes change, update the hash and repeat the full review and proofs.

## Authority and ordering contract

`grainline_seller_payout_event_apply(...)` accepts no seller ID, payout row ID,
status or notification recipient. It locks and validates the exact active
`payout.failed` `StripeWebhookEvent` generation, checks its immutable source
object against the payout ID, derives the seller from the unique connected
account mapping and writes only the failed-payout projection.

The function takes a transaction-scoped advisory lock derived from the signed
payout ID before looking up the mutable payout row. The lock is required for
the first-write race, where no row exists to lock. Exact replay is idempotent;
older provider events are ignored, equal-time distinct events fail closed as
ambiguous, and only strictly newer provider time replaces the projection.

The database cannot authenticate Stripe signatures or Clerk sessions. The
application remains responsible for those authentication boundaries. These
functions bind already-authenticated facts to narrow database transitions and
remove generic table access at a later activation; they do not claim resistance
to arbitrary application code execution holding the shared runtime credential.

### Application conversion result handling

The later application conversion must pass both the active webhook
`claimGeneration` and Stripe `event.created` to the fixed writer. Its result
actions are not interchangeable:

- `inserted`, `updated`, `legacy_converged` and `already_applied` must all
  attempt the source-bound payout notification;
- `already_applied` must not short-circuit notification work, because the
  payout projection commits before the current best-effort notification call.
  A notification failure therefore leaves an applied payout row for a later
  Stripe retry, while Notification's source identity provides deduplication;
- `stale_ignored` must not emit a notification for stale evidence; and
- `ignored_unknown_account` must not invent a recipient or payout owner, but
  the route must retain bounded non-payload observability for the ignored
  result.

The notification call must use the returned payout row ID as `sourceId`.
Notification's database function independently joins that row to
`SellerProfile` and requires the derived seller user to match the requested
recipient; the payout writer's returned seller ID is therefore convenient
application data, not the notification authority boundary.

## Compatibility boundary

The candidate is deliberately additive:

- it adds a nullable provider-event time so old application instances remain
  compatible;
- it validates existing failed-status, amount, currency and source-event
  invariants before installing the functions;
- it adds no policy, ENABLE or FORCE statement;
- it revokes `PUBLIC` function execution and grants only the three exact
  functions to `grainline_app_runtime`; and
- it leaves existing runtime table and column privileges unchanged until the
  converted application is deployed and its predecessor is drained.

The regular CI migration sequence moves this successor out before every sealed
CheckoutStockReservation verifier. It restores the candidate only after all
CheckoutStockReservation FORCE and rollback proofs, applies it to a real
PostgreSQL 16 database, converges grants, checks migration status and the global
catalog, then runs the dedicated authority/race proof. This preserves every
historical release byte boundary while proving the successor against the full
schema it depends on.

Historical CheckoutStockReservation catalog readers recognize this successor
only after its exact name and SHA-256 pass the dedicated verifier. The deploy
guard itself remains strict: calling the CheckoutStockReservation FORCE release
without the reviewed-successor mode still rejects this later migration. Thus a
historical proof can remain executable without permitting an old production
phase to apply the new migration.

The dedicated real-PostgreSQL proof is loopback-only and requires the `ci`
migration login. It verifies the function owner, pinned search path, exact
runtime/PUBLIC ACLs and compatible RLS-off posture; switches to the restricted
runtime role for calls; rejects a forged webhook relationship; proves unknown
account handling, exact replay and seller-only projections; and holds the
advisory key while two distinct events race so both wait and converge to the
newer provider event. All fixtures are prefix-scoped and removed in `finally`.

PGlite additionally proves the exact migration on a minimal schema. It is a
fast semantic guard, not a substitute for the real PostgreSQL CI proof.

## Remaining gates

1. Pass the full repository suite and exact-head CI, including real PostgreSQL
   migration application and the concurrency proof.
2. Open and review a draft compatible-preparation PR; do not make it ready
   merely because the isolated tests pass.
3. Run a fresh protected aggregate-only production inspection. Stop if any
   payout row, duplicate source, invalid scalar or missing provider time needs
   classification.
4. Prepare a byte-pinned, restart-safe production migration runner only after
   the exact predecessor state is known. Applying this migration is a separate
   production boundary.
5. Convert all three application consumers, deploy with predecessor grants
   intact and prove old/new coexistence.
6. Pass the linked-seller signed Stripe test-mode child/Preview proof, including
   exactly one payout row, one source-bound notification and exact retry.
7. Drain predecessors and prove zero direct application table access.
8. Review and apply policyless ENABLE with table authority revoked, prove the
   owner and actual pooled runtime, then apply posture-only FORCE separately.

`OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem` remain
separate domain audits and activations. Nothing here authorizes their SQL or
combines them with this release.
