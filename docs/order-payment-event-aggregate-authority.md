# OrderPaymentEvent aggregate authority

Status: isolated compatible candidate. Migration
`20260830010000_prepare_order_payment_event_aggregate_authority` is byte-pinned
at SHA-256
`de0864d1c8fabf875ddfedb4c3037506c305333e7f999d775613fbb808c2a9d1`.
It is wired into disposable CI but deliberately isolated from the generic
Production Migrations workflow. It has not been merged, applied, deployed or
used to change RLS/grants/provider state.

## Decision

The 15 audited eligibility and aggregate consumers do not need payment-event
rows. They need only two fixed Order-scoped facts:

- `Order.paymentRefundBlocked`: a retained `REFUND` row exists whose status is
  not `failed`, `canceled` or `cancelled`, compared case-insensitively;
- `Order.paymentConversionDisputeBlocked`: for at least one distinct Stripe
  dispute object, the latest signed state is not `won` or `warning_closed`.

These are database-maintained projections on `Order`, not caller-maintained
cache columns. This design was selected over per-row aggregate RPCs because it:

- removes broad `OrderPaymentEvent` enumeration from all 15 consumers at once;
- keeps seller analytics, homepage counts and quality scoring set-based;
- does not expose a generic runtime-callable payment-state oracle;
- gives later Order/OrderItem RLS a small Order-level fact to authorize rather
  than making unrelated domains depend on the private provider ledger; and
- preserves the exact existing refund/dispute product semantics while
  normalizing refund status case consistently.

Raw provider IDs, amounts, descriptions, metadata and event histories remain
inside the private append-only ledger. No API automatically serializes the two
projection columns.

## Database exactness and anti-forgery contract

The additive migration adds both booleans as `NOT NULL DEFAULT false`, computes
their exact historical backfill, and installs three owner-private routines:

- `grainline_order_payment_projection_state(text)` is the single canonical
  ledger-to-Order calculation;
- `grainline_order_payment_projection_refresh()` updates the parent Order after
  every immutable payment-event insert;
- `grainline_order_payment_projection_guard()` rejects any Order insert/update
  whose supplied projections differ from the canonical ledger state.

All three are `SECURITY DEFINER`, `VOLATILE`, `PARALLEL UNSAFE`, have
`search_path=pg_catalog`, and revoke execution from `PUBLIC` and
`grainline_app_runtime`. `VOLATILE` is intentional: the after-insert trigger
must see the payment row written by its own statement. Making the canonical
reader `STABLE` could preserve the statement-start snapshot and miss that row.

The guard is required during deployment compatibility. Old application
instances still retain broad Order updates, but they cannot set either boolean
to a forged value. Unrelated Order inserts/updates remain compatible because
their defaults or retained projections equal the ledger-derived state.

The migration takes an `ALTER TABLE "Order"` relation lock before backfill.
The existing payment insert invariant locks the parent Order `FOR UPDATE`.
Consequently, an insert concurrent with migration waits until the refresh
trigger exists; an insert concurrent with an eligibility claim and the claim
itself serialize on the same Order row.

## Latest-dispute semantics

Signed provider time is authoritative. The canonical calculation selects the
latest row independently for each non-null `stripeObjectId`, ordered by:

1. `stripeEventCreatedSeconds DESC`;
2. `createdAt DESC`;
3. `id DESC`.

The invariant predecessor already requires every dispute to have a durable
Stripe object ID and typed signed-event time. A late-delivered older event
therefore cannot regress the projection. Multiple dispute objects remain
independent: any latest state outside `won`/`warning_closed` blocks conversion.
This deliberately differs from the broader operational "open dispute" set;
`lost` is closed operationally but still disqualifies conversion quality.

## Application conversion

The following 15 audited consumers now read only the projections and contain
no direct `OrderPaymentEvent`, `paymentEvents`, refund-ledger helper or raw
ledger join:

- `src/app/account/page.tsx`
- `src/app/admin/verification/page.tsx`
- `src/app/api/reviews/route.ts`
- `src/app/api/seller/analytics/recent-sales/route.ts`
- `src/app/api/seller/analytics/route.ts`
- `src/app/api/verification/apply/route.ts`
- `src/app/dashboard/verification/page.tsx`
- `src/components/ReviewsSection.tsx`
- `src/lib/ban.ts`
- `src/lib/homepageStats.ts`
- `src/lib/listingSoftDelete.ts`
- `src/lib/metrics.ts`
- `src/lib/publicSellerStats.ts`
- `src/lib/quality-score.ts`
- `src/lib/site-metrics-snapshot.ts`

The class-wide semantic inventory remains exactly 33 files: replacing a direct
ledger reference with a projection does not make the consumer disappear from
the audit. A separate test pins the 15-file no-enumeration boundary.

## Product/race review

Verified-review creation previously checked eligible purchase/refund state
before its write transaction. A concurrent refund could win after that check
and still allow a verified review. The POST route now repeats its authoritative
eligibility query inside the Review transaction and locks the qualifying parent
Order `FOR UPDATE`. Payment inserts use the same parent lock. Whichever action
locks first wins; after a committed refund, the review query rechecks the
projection and returns no eligible row.

`ReviewsSection` remains advisory UI only; the POST route is authoritative.
The existing unique `(listingId, reviewerId)` constraint still handles duplicate
review submissions.

The listing-soft-delete and ban consumers are conservatively monotonic. Refund
evidence can change `paymentRefundBlocked` only from false to true because the
ledger is append-only. A stale read can therefore cause an extra block or
review flag, never unsafe deletion or suppressed escalation. Listing soft
delete additionally remains `SERIALIZABLE`. No generic payment lock/RPC was
added for those paths.

## Proof and release boundary

The disposable in-process PostgreSQL proof covers backfill, failed/successful
refunds, out-of-order signed dispute delivery, multiple dispute objects,
unrelated Order compatibility, direct insert/update forgery rejection and all
three private function grants. The real two-login PostgreSQL proof additionally
uses separate `ci` and `grainline_app_runtime` connections, proves direct helper
execution denial, observes the parent Order lock wait, and proves a stale
review-eligibility claim returns zero after the refund transaction commits.

Required sequence:

1. exact candidate review and CI, including real PostgreSQL proof;
2. merge compatible migration/app package without automatic Production deploy;
3. run a fresh aggregate-only production inspection and exact restart-scope
   verifier;
4. apply only the aggregate-authority migration and converge private grants;
5. run an engine-read-only owner catalog proof and a distinct pooled-runtime
   projection postflight;
6. deploy the compatible application and run authenticated aggregate/review
   smoke tests while preserving the predecessor deployment;
7. convert and prove the remaining contended transition/webhook/local-evidence
   consumers;
8. prove zero ordinary runtime base-table access, drain the predecessor, then
   activate policyless `ENABLE` and later `FORCE` RLS as separate releases.

This candidate does not authorize production migration, application deploy,
predecessor drain, grant revocation, RLS activation or provider changes.

