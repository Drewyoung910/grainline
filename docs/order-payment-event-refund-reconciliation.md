# Order refund provider reconciliation preparation

Status: the byte-sealed reconciliation checkpoint remains isolated on
`agent/order-payment-event-refund-reconciliation-20260824`; its reviewed
inactive-seller successor is stacked on
`agent/order-payment-event-inactive-seller-recovery-20260824`. Neither branch
is merged, deployed or applied to production. `OrderPaymentEvent` RLS remains
off, predecessor `Order`/`OrderPaymentEvent` grants remain unchanged and no
production workflow is wired for either migration.

Prepared: 2026-08-24. The exact additive migration is
`20260824040000_prepare_order_refund_reconciliation_authority`, SHA-256
`cfd5d2827eb234fb9c1b7f990b63c3e6bcc2db0dd80038cfcfd163c81314d3d7`.
The exact compatible inactive-seller successor is
`20260824050000_prepare_order_refund_inactive_seller_recovery`, SHA-256
`e37d5ea925af5f4b82f90b1f1bcdeb9b14f5a4b34da7c228bdc94f8bfbbb9598`.

## Decision

An ambiguous seller or blocked-checkout refund claim stays blocked until a
current administrator, with a session-bound Admin PIN, asks Grainline to inspect
the exact Stripe PaymentIntent. The administrator supplies only an audit
reason. Application and database code derive the action from the active
database claim, a fresh bounded Stripe scan and closed timing rules; the form
does not accept an outcome, refund ID, payment target, claim generation,
idempotency scope or release timestamp.

The closed outcomes are:

- `CONFIRMED_PROVIDER_EFFECT`: exactly one provider refund has the complete
  Grainline claim metadata and a usable status. Grainline records that existing
  object without another provider create call.
- `RETRY_EXISTING_SCOPE`: the complete scan is absent and the database claim is
  less than 23 hours old. Grainline may retry only the existing Stripe
  idempotency scope.
- wait: from 23 hours through the 25-hour release boundary, an absent or
  terminal provider result remains blocked.
- `CONFIRMED_NO_PROVIDER_EFFECT`: only at or after 25 hours, a complete absent
  scan or the exact terminal `failed`/`canceled` provider object can release the
  claim. A terminal object that still references either Connect transfer-
  reversal family fails closed for manual accounting review.

Stripe documents that an idempotency key can be pruned after it is at least 24
hours old, so Grainline stops automatic same-key retries one hour earlier:
<https://docs.stripe.com/api/idempotent_requests>. Stripe also recommends
reconciling indeterminate network outcomes before retrying:
<https://docs.stripe.com/error-low-level>. Inspection uses the paginated
PaymentIntent refund list and retrieves the exact match with expanded transfer
reversal evidence:
<https://docs.stripe.com/api/refunds/list> and
<https://docs.stripe.com/api/refunds/retrieve>.

## Provider evidence boundary

Every generation-fenced Stripe refund now carries provider-searchable metadata
derived from the database claim:

- `grainline_refund_claim_id`;
- `grainline_refund_claim_generation`;
- `grainline_refund_claim_source`;
- `grainline_refund_idempotency_scope`; and
- `grainline_refund_component`.

Inspection scans at most 20 pages of 100 refunds for the database-derived
PaymentIntent. It fails closed on an incomplete scan, duplicate exact metadata,
payment/amount/currency/component drift, an unknown provider status or a
plausible untagged refund created within the claim window. That untagged check
is the old/new-deployment coexistence fence: older code cannot cause Grainline
to classify a real refund as absent merely because it predates the new metadata.

The SHA-256 evidence digest commits to the claim, inspection time, page/object
counts, every scanned refund's bounded canonical identity and the separately
retrieved exact object's status and transfer-reversal evidence. No raw Stripe
payload is persisted. The database accepts only a recent inspection, compares
it to the UTC claim-authorized second and rechecks the exact active generation.

## Database authority and evidence

`OrderRefundReconciliation` is an append-only private ledger with ENABLE plus
FORCE RLS, zero policies and zero direct runtime/PUBLIC table privileges. A
BEFORE UPDATE/DELETE trigger rejects evidence mutation even by the owner unless
the trigger itself is deliberately removed. Each record has a paired
`AdminAuditLog` row and an exact claim/action/evidence replay key.
Both the server action and database require a trimmed 10-to-1,000-character
reason, so direct function invocation cannot weaken the audit explanation to a
token value.

The runtime receives exactly four fixed entrypoints:

1. `grainline_order_refund_reconciliation_prepare(text,text)` returns one
   active claim only for a current, non-banned, non-deleted `ADMIN`;
2. `grainline_order_refund_claim_mark_ambiguous(text,bigint,text)` accepts one
   of four closed internal reason codes and moves only the exact active claim
   to the reconciliation sentinel; and
3. `grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)`
   records one fresh inspection and applies only the matching closed transition;
   and
4. `grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)`
   derives the failed source event and generation from the exact immutable
   reconciliation row, calls the owner-private record core, and marks that
   event processed in the same transaction.

The four owner-held operations are `SECURITY DEFINER`, `PARALLEL UNSAFE`, pin
`search_path=pg_catalog`, contain no dynamic SQL, are revoked from `PUBLIC` and
grant execute only to `grainline_app_runtime`. The immutable trigger function
and the blocked-checkout record core are not runtime entrypoints. This remains
narrow application-service authority, not a claim that PostgreSQL
cryptographically validates Stripe or Clerk: the database revalidates current
ADMIN state and exact claim shape, while Clerk session and Admin-PIN possession
are enforced by the server action.

## Findings closed in this pass

- Blocked-checkout retries with an existing valid generation claim were
  unreachable because the existing-Order branch rejected every non-null claim
  before calling the resume function. Retry classification now accepts only
  the exact pending `BLOCKED_CHECKOUT` claim for the current signed event ID.
- Direct route updates for the ambiguous sentinel would stop working once
  predecessor `Order` table authority is revoked. All three application paths
  now use the fixed exact-claim ambiguous operation.
- Provider absence evidence originally committed only to object counts. The
  digest now commits to every scanned refund identity and the retrieved match.
- The staged claim/finalizer migrations used session-time-zone casts for
  timestamp-without-time-zone values. All staged safety clocks now write UTC at
  the SQL boundary; their byte seals were refreshed before any merge or
  production application.
- The admin form does not expose claim, PaymentIntent or provider outcome
  controls. It shows only the local pending/ambiguous state and one inspect
  action with a required reason.
- Extra-High review found that a failed webhook clears `processingStartedAt`
  before an administrator can inspect Stripe, while the original
  blocked-checkout finalizer required that lease to remain active. Confirmed
  effects and approved same-scope retries could therefore be classified but
  never finalized. The repaired design keeps the mutation core owner-private,
  preserves the signed-lease wrapper for normal webhook delivery, and adds a
  separate exact-reconciliation wrapper for the failed inactive event. It
  revalidates the immutable reconciliation, current ADMIN, source event type
  and generation, finalizes once, and clears the source event error while
  marking it processed atomically.
- Draft PR CI run `32701936965` failed before this candidate was restored: the
  source-derived grant auditor treated the branch-tip Prisma model as already
  materialized while replaying the historical Case activation prefix. The
  auditor now gates only this named successor table on both its exact migration
  directory and `CREATE TABLE` marker. Missing-table denial remains strict once
  the migration is present, and a regression test proves both prefix states.
- A second end-to-end review found that seller reconciliation could authorize
  the correct provider outcome but still strand the first local record if the
  seller became banned or soft-deleted between provider authorization and the
  atomic database finalizer. Account deletion retains the User and
  SellerProfile identities, so the source relationship remains provable. The
  reviewed successor replaces only the existing seller-record and Case-apply
  bodies. An inactive source is accepted only when the database itself finds
  an immutable reconciliation with the same Order, claim ID, generation,
  seller source, idempotency scope, one of the two effect-preserving actions
  and a still-current ADMIN author. Both the immutable reconciliation row and
  its ADMIN author are held with shared locks through finalization, so a role,
  ban or deletion transition cannot race the authorization decision. The
  caller supplies no reconciliation ID.
  Active sellers and exact committed replays retain their existing behavior.
  No new runtime function, provider call, table privilege or RLS change is
  introduced.

## Residual gates and honest limits

This checkpoint closes ambiguous seller/blocked-checkout provider outcomes; it
does not complete `OrderPaymentEvent` RLS. In particular:

- staff Case refund authority remains its own family and is not bundled here;
- append-only, taxonomy, currency, source and typed-time invariants still need
  their final catalog review;
- buyer/seller/staff projections and aggregate jobs must stop reading the base
  table before direct table authority is revoked;
- the converted deployment needs signed Stripe refund/dispute delivery and
  retry proof, followed by predecessor drain; and
- fresh aggregate-only production classification, policyless ENABLE,
  pooled-runtime proof, FORCE and a second pooled-runtime proof remain separate
  gates.

## Proof retained

Disposable PGlite proves each sealed migration stage without reading a later
migration hidden by CI: the record proof executes only claim plus record, while
the reconciliation proof executes claim plus reconciliation and covers current-
ADMIN denial, exact 23/25-hour transitions, same-whole-second clock handling,
closed ambiguous reasons and owner-resistant update/delete rejection. CI also
applies the complete migration prefix to its loopback PostgreSQL 16 service and
runs a separate rollback-only proof through
`SET LOCAL ROLE grainline_app_runtime`. That real-engine proof covers the
failed-lease recovery end to end: the ordinary wrapper cannot bypass the
inactive lease, a forged reconciliation cannot recover it, the exact row can
finalize once, and event completion/error clearing co-commit with the refund
record. It also verifies the exact catalog, zero policies/table grants,
current-ADMIN boundary, exact retry/replay behavior, owner-resistant evidence
immutability and zero fixture residue. The proof refuses any non-loopback host,
database other than `grainline_ci`, or login other than `ci`. Provider tests
prove metadata binding, complete
pagination, retrieved-object validation, scan-snapshot digests, legacy untagged
fail-close, duplicate/drift denial and exact retry behavior. Static contracts
pin the session-bound Admin-PIN action, source callsites and unchanged
production/RLS wiring.

The inactive-seller successor adds a separate loopback-only PostgreSQL 16
rollback proof. It first shows that a banned seller cannot make the first local
record without reconciliation, then commits the exact ADMIN provider-effect
classification, finalizes through `grainline_app_runtime`, reaches the
source-validated Case boundary, restores stock once, proves exact replay and
rolls back every fixture. Its catalog check requires the original two function
signatures, runtime-only execute, pinned search path and the database-derived
reconciliation clauses, including the shared reconciliation/ADMIN locks. This
proof is wired for CI; it has not yet produced exact-head CI evidence for the
stacked branch.

Draft PR CI run `32702325266` passed the migration-aware grant inventory at
the former failure point, then failed closed while replaying the historical
CheckoutStockReservation activation because its runtime postflight claimed the
isolated `20260824020000_prepare_order_refund_record_authority` successor was
present. The postflight now derives reviewed-successor flags from the exact
staged migration tree, requires the claim -> record -> signed chain in order,
and still delegates every present successor to the byte-sealed release reader.
The replacement run `32703083948` proved that correction through the complete
CheckoutStockReservation and SellerPayoutEvent replay, then found a separate
ambient-filesystem dependency in the refund-record release unit test: the test
assumed its later signed-authority migration was still visible even though CI
had intentionally isolated it. Release tests now construct an exact migration
prefix through `20260824020000_prepare_order_refund_record_authority`; the
unreviewed-successor case adds and removes one synthetic later directory, so
its result no longer depends on CI staging order.

Replacement CI run `32707048056` reached the isolated record-authority proof
and failed before PostgreSQL execution because that historical proof
unconditionally read the later reconciliation migration, which CI had
intentionally hidden. This was a test-packaging regression, not a SQL or
runtime-authority failure. The record proof is self-contained again, its
release contract now rejects forward migration references, and the full-stack
failed-lease recovery remains exercised at the reconciliation stage by the
loopback PostgreSQL runtime-role proof.

Local validation on 2026-08-24 passed the final 45-test focused record and
reconciliation cluster, the full 3,349-test suite (3,342 passed, seven
intentional skips),
TypeScript, lint, Prisma schema validation and `git diff --check`. The normal
Turbopack build cannot infer this nested symlinked-worktree root; the webpack
fallback compiled and completed TypeScript, then correctly stopped at page
collection because this isolated worktree has no local PostgreSQL build data.
No production credential was introduced merely to make a local build pass.
Exact-main CI/Vercel remains the authoritative full-build gate, and the real
PostgreSQL 16 runtime-role proof remains CI-only because neither PostgreSQL nor
Docker is available locally.

## Next sequence

1. Complete Extra-High authority/release review and merge only the byte-sealed
   reconciliation and inactive-seller-compatible stack after exact-head CI.
2. Wire and run a separate aggregate-only production inspection and guarded
   compatible preparation; do not activate RLS in that run.
3. Deploy the converted application and prove seller, blocked-checkout, signed
   refund/dispute and exact retry behavior while predecessor authority coexists.
4. Close the distinct staff Case refund family, remaining invariants and
   actor-safe projections/aggregates.
5. Drain predecessor deployments and revoke direct base-table authority.
6. Release policyless ENABLE and FORCE with distinct pooled-runtime proofs.
