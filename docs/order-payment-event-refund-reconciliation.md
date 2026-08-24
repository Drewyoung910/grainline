# Order refund provider reconciliation preparation

Status: isolated compatible preparation on
`agent/order-payment-event-refund-reconciliation-20260824`; not merged,
deployed or applied to production. `OrderPaymentEvent` RLS remains off,
predecessor `Order`/`OrderPaymentEvent` grants remain unchanged and the guarded
Production Migrations workflow is intentionally not wired.

Prepared: 2026-08-24. The exact additive migration is
`20260824040000_prepare_order_refund_reconciliation_authority`, SHA-256
`09578b9848e3ded056c96b8d46d2aefbc066be2c0a924bdd2661e671dd7fd8ca`.

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

The runtime receives exactly three fixed entrypoints:

1. `grainline_order_refund_reconciliation_prepare(text,text)` returns one
   active claim only for a current, non-banned, non-deleted `ADMIN`;
2. `grainline_order_refund_claim_mark_ambiguous(text,bigint,text)` accepts one
   of four closed internal reason codes and moves only the exact active claim
   to the reconciliation sentinel; and
3. `grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)`
   records one fresh inspection and applies only the matching closed transition.

The three owner-held operations are `SECURITY DEFINER`, `PARALLEL UNSAFE`, pin
`search_path=pg_catalog`, contain no dynamic SQL, are revoked from `PUBLIC` and
grant execute only to `grainline_app_runtime`. The immutable trigger function
is not a runtime entrypoint. This remains narrow application-service authority,
not a claim that PostgreSQL cryptographically validates Stripe or Clerk: the
database revalidates current ADMIN state and exact claim shape, while Clerk
session and Admin-PIN possession are enforced by the server action.

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
- Draft PR CI run `32701936965` failed before this candidate was restored: the
  source-derived grant auditor treated the branch-tip Prisma model as already
  materialized while replaying the historical Case activation prefix. The
  auditor now gates only this named successor table on both its exact migration
  directory and `CREATE TABLE` marker. Missing-table denial remains strict once
  the migration is present, and a regression test proves both prefix states.

## Residual gates and honest limits

This checkpoint closes ambiguous seller/blocked-checkout provider outcomes; it
does not complete `OrderPaymentEvent` RLS. In particular:

- a seller who becomes banned/deleted after Stripe effect but before the first
  local record can fail the existing seller-family finalizer. The claim stays
  ambiguous and the provider effect is not duplicated, but activation still
  needs a separately reviewed staff recovery family or an explicitly proven
  source-history exception. Do not widen the seller finalizer casually;
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

Disposable PGlite executes the real claim and reconciliation migrations and
proves current-ADMIN denial, exact 23/25-hour transitions, same-whole-second
clock handling, exact generation/source binding, closed ambiguous reasons and
owner-resistant update/delete rejection. CI also applies the migration to its
loopback PostgreSQL 16 service and runs a separate rollback-only proof through
`SET LOCAL ROLE grainline_app_runtime`: it verifies the exact catalog, zero
policies/table grants, current-ADMIN boundary, exact retry/replay behavior,
owner-resistant evidence immutability and zero fixture residue. The real-engine
proof refuses any non-loopback host, database other than `grainline_ci`, or
login other than `ci`. Provider tests prove metadata binding, complete
pagination, retrieved-object validation, scan-snapshot digests, legacy untagged
fail-close, duplicate/drift denial and exact retry behavior. Static contracts
pin the session-bound Admin-PIN action, source callsites and unchanged
production/RLS wiring.

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

Local validation on 2026-08-24 passed the final 30-test focused reconciliation
cluster, the full 3,348-test suite (3,341 passed, seven intentional skips),
TypeScript, lint, Prisma schema validation and `git diff --check`. The normal
Turbopack build cannot infer this nested symlinked-worktree root; the webpack
fallback compiled and completed TypeScript, then correctly stopped at page
collection because this isolated worktree has no local PostgreSQL build data.
No production credential was introduced merely to make a local build pass.
Exact-main CI/Vercel remains the authoritative full-build gate, and the real
PostgreSQL 16 runtime-role proof remains CI-only because neither PostgreSQL nor
Docker is available locally.

## Next sequence

1. Complete Extra-High authority/release review and merge only this isolated
   compatible stack after exact-main CI.
2. Wire and run a separate aggregate-only production inspection and guarded
   compatible preparation; do not activate RLS in that run.
3. Deploy the converted application and prove seller, blocked-checkout, signed
   refund/dispute and exact retry behavior while predecessor authority coexists.
4. Close the inactive-seller staff-recovery edge, remaining staff family,
   invariants and actor-safe projections/aggregates.
5. Drain predecessor deployments and revoke direct base-table authority.
6. Release policyless ENABLE and FORCE with distinct pooled-runtime proofs.
