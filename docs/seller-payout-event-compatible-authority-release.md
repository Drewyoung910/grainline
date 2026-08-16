# SellerPayoutEvent compatible authority release

Status: compatible preparation accepted in production. The exact additive
migration, schema and three fixed functions are live; the converted application
remains isolated in draft PR #226. RLS remains off and predecessor runtime table
CRUD remains intentionally available for old/new application coexistence.

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

This record pins reviewed migration bytes, not a production authorization. If the
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
  payout projection commits before the converted handler's strict notification
  call. That call must rethrow a transient notification failure so the webhook
  lease remains retryable; a later exact Stripe retry sees the applied payout
  row and retries the notification, while Notification's source identity
  provides deduplication;
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

## Accepted production inspection and runner boundary

The first protected production inspection, run `31918034914` from exact main
`e78c1ef28f88778f86947a8cb501af8dfb916b26`, failed before reading aggregates
because its catalog guard still classified the already-completed
CheckoutStockReservation table as an RLS-off predecessor. The transaction was
engine-enforced read-only, emitted no evidence file and changed nothing. The
bounded root-cause record is
`docs/order-payment-shipping-inspection-force-posture-correction.md`.

PR #227 corrected only that stale posture contract. Exact-head CI
`31918538038` and exact-main CI `31918834834` passed at merge commit
`b0494b1ebe7399c1036ed1894c0c3b42cfeee87f`. The protected aggregate-only
inspection then passed as run `31919078918` from that same exact main commit in
an engine-attested repeatable-read/read-only transaction. The sanitized
artifact SHA-256 is
`2e01606f36d67787622d0a4a5efd725d5b9abdd209a29b52ce85bdb96d0075c7`.

The accepted evidence contains no addresses, credentials, object/provider
IDs, raw rows, snapshots or user IDs. It reports:

- 2 orders and 3 order items;
- 0 SellerPayoutEvent rows, payment-event rows, shipping quotes and active
  checkout reservations;
- 12 retained StripeWebhookEvent rows;
- 0 across every invalid, duplicate, missing-source, mutation, coherence,
  stale-reservation and stale-webhook aggregate; and
- the exact current posture: CheckoutStockReservation and StripeWebhookEvent
  policyless FORCE with no runtime table CRUD, while Order, OrderItem,
  OrderPaymentEvent, OrderShippingRateQuote and SellerPayoutEvent remain RLS-off
  compatible predecessors with runtime CRUD retained.

This clears the legacy-data gate for the additive SellerPayoutEvent authority
migration. It does not apply that migration or authorize application merge,
deployment, RLS activation or provider changes.

The dedicated production runner is deliberately separate from the generic
migration path. It must bind one exact successful main CI run and one successful
same-commit protected inspection, accept only the exact known migration ledger
and the exact predecessor/prepared restart states, and inspect the table,
nullable provider-time column, validated constraints, indexes, function
owners/languages/modes/search paths/source hashes/ACLs and unchanged broad
table CRUD before and after. Its scope probes run in an engine-attested
repeatable-read/read-only transaction. The runner does not invoke the
repository-wide grant reconciler: the byte-sealed migration grants only the
three reviewed functions, while the restart and post-application scopes plus
the global grant audit fail closed on any privilege drift. This keeps the
production mutation limited to the compatible migration.

Draft PR #228 exact-head CI run `31920453611` failed safely in the real
PostgreSQL proof before application fixtures when the new catalog reader used
the reserved word `constraint` as a relation alias. No production workflow ran
and no production state changed. The correction renames only that catalog alias
to `constraint_metadata`; the same real-PostgreSQL step remains mandatory so
the corrected query must execute successfully rather than being accepted by a
static or synthetic parser alone.

The first production preparation dispatch, run `31922754634` from exact main
`a4f7910e322a7d66ad4ec8d9a24c086e0c51143f`, failed safely at the sealed
CheckoutStockReservation FORCE predecessor check. It stopped before the
production-scope reader, Prisma generation, migration deployment, status,
global grant/RLS audit and post-application proof; therefore it made no
database, application or provider change. The underlying FORCE verifier already
byte-verified this exact SellerPayoutEvent successor when called through its
reviewed-successor API, but its CLI always selected strict historical mode.

The correction exposes only the existing `--allow-reviewed-successor` mode and
uses it through a dedicated sealed-prefix package command in this production
runner. The original command remains strict and continues to reject any later
migration. The allowed mode still verifies the exact successor name and bytes
through the SellerPayoutEvent release verifier before omitting it from the
historical latest-migration check; arbitrary or unreviewed successors remain
fail-closed. Actual CLI regression coverage proves strict rejection, exact
reviewed-successor acceptance and unknown-argument rejection.

PR #229 merged the correction at exact main
`6bc89c58d7d83509f73206a2f9b4854e3bed476b`. Exact-main CI run
`31923317475` passed. The required same-commit aggregate inspection then passed
as run `31923608819`; its sanitized artifact SHA-256 is
`ad6e18513ec461e70ad1f59468272f6c40b7a12113e5ddca5cdce5ed200ed8fe`.
It again reported 2 orders, 3 order items, 12 Stripe webhook rows, zero payout
rows and zero across every anomaly count, inside an engine-attested
repeatable-read/read-only transaction with no retained identifiers or raw rows.

Guarded production preparation run `31923767337` then applied only
`20260815210000_prepare_seller_payout_event_authority`. The pre-application
scope was exactly `predecessor`; Prisma reported only the reviewed migration
applied and all 198 migrations current. The global audit passed for 64 tables,
22 enums, 165 `grainline_*` functions and the four existing RLS tables. The
read-only final scope was exactly `prepared`: three runtime functions exist,
SellerPayoutEvent RLS remains disabled and not forced, and predecessor runtime
table CRUD remains retained. No application deploy, data cleanup, provider
change, RLS activation or predecessor-grant revocation occurred.

## Remaining gates

1. Finish review and merge of the isolated three-consumer application
   conversion, then deploy it with predecessor grants intact and prove old/new
   coexistence. Its strict payout-notification helper must keep a transient
   notification failure retryable while existing best-effort callers remain
   unchanged.
2. Pass the linked-seller signed Stripe test-mode child/Preview proof, including
   exactly one payout row, one source-bound notification and exact retry.
3. Drain predecessors and prove zero direct application table access.
4. Review and apply policyless ENABLE with table authority revoked, prove the
   owner and actual pooled runtime, then apply posture-only FORCE separately.

`OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem` remain
separate domain audits and activations. Nothing here authorizes their SQL or
combines them with this release.
