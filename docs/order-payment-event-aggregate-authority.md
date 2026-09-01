# OrderPaymentEvent aggregate authority

Status: compatible aggregate authority is live; RLS remains off and predecessor
CRUD remains retained. PR #342 merged its guarded production package at exact
head `5cf72c3b07bc05cd7d59ac01fb52ba58165a394d` as main commit
`298088d55901c7096579766adaf9f35f1ead8085`. Exact-main CI run
`33303933012` passed. Fresh aggregate-only inspection `33304264914` ran in an
engine-enforced repeatable-read/read-only transaction and found two Orders,
three items, zero payment-event rows and zero unexplained payment-integrity
defects. Guarded production run `33304372055` then applied only migration
`20260830010000_prepare_order_payment_event_aggregate_authority`, byte-pinned at
SHA-256
`dfb2120e9c338607b1bfd73a8e095af004b188b9a0baa047987ece07199c0666`.
Migration status, the global grant/RLS audit, all three private function bodies
and ACLs, both trigger bindings and zero projection mismatches passed. No app
was deployed, RLS and provider state did not change, and direct predecessor
runtime CRUD was deliberately preserved. PR #343 exact head
`9db58d87d45799e933e9b343f6d51f629a32e0d8` then merged as exact main
`87d01c692d0134be5b628076551f7d0e05ef2873`; exact-main CI
`33306115759` passed. The distinct actual pooled-runtime postflight passed from
that exact clean commit with sanitized mode-0600 evidence SHA-256
`903e4816c95437000337d870c62b312e7659e4e9a443881360f65194bf2d032f`.
The compatible application was then manually built and deployed from exact
main `4908bc7f377f5950da8de6b3398049d65a5fdfcb`, bound to exact-main CI
`33307107247`, as production deployment
`dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj`. The authenticated Vercel deployment API
reports that exact Git SHA, production target and `READY` state. All four
canonical aliases resolve to the new deployment, both `thegrainline.com` and
`grainline.vercel.app` health checks returned `{"ok":true}`, and prior
compatible deployment `dpl_7UeENeZebXL9yL481DWrXkDpWd4R` remains `READY` as
the undrained predecessor. No migration, RLS, grant, credential or provider
configuration changed during deployment.

The dedicated production package adds a restart-safe, exact-main-only workflow
and an engine-read-only scope verifier. The verifier accepts exactly two states:
the sealed fixed-read predecessor with no candidate ledger row or the exact
applied candidate with one finished one-step ledger row. The applied state must
also have both exact boolean columns, all three byte-matched owner-private
functions, both enabled triggers, zero runtime/PUBLIC helper execution and zero
projection mismatches. Any partial ledger row, catalog drift, unexpected ACL or
data mismatch fails closed. The workflow is not an automatic deploy path: it
requires a successful exact-main CI run and a fresh exact-main aggregate-only
production inspection before applying only this migration.

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
inside the private append-only ledger. No new public endpoint or generic
payment-state oracle is introduced; existing actor-specific response boundaries
remain authoritative.

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

Before altering `Order`, the migration takes `ACCESS EXCLUSIVE` on `Order` and
then `SHARE ROW EXCLUSIVE` on `OrderPaymentEvent`. This follows the existing
fixed refund/signed-webhook parent-then-ledger lock order. Once the parent lock
is held, no current writer can retain or acquire an Order row lock while the
migration installs the ledger trigger. The migration keeps both locks through
backfill and trigger installation; concurrent inserts resume only after the
refresh trigger exists. A real PostgreSQL proof holds the same parent lock as
an in-flight payment writer, observes the migration waiting, appends evidence
without waiting behind a prematurely held ledger lock, commits the writer, and
requires the migration and historical backfill to complete. Outside migration,
a payment insert and an eligibility claim serialize on the same parent `Order
FOR UPDATE` lock. A transaction advisory lock prevents a competing copy of
this preparation, while a 10-second lock timeout and 120-second statement
timeout fail closed instead of leaving a busy deployment hanging indefinitely.

## Latest-dispute semantics

Signed provider time is authoritative. For each non-null `stripeObjectId`, the
canonical calculation finds the maximum `stripeEventCreatedSeconds` and
examines every retained observation at that provider second. A tied set blocks
conversion if any status is outside `won`/`warning_closed` or if its canonical
amount, currency, status, reason, or signed Stripe event type conflicts. It
never lets local arrival time or row ID choose a favorable winner.

The invariant predecessor already requires every dispute to have a durable
Stripe object ID and typed signed-event time. A late-delivered older event
therefore cannot regress the projection. Multiple dispute objects remain
independent: any latest state outside `won`/`warning_closed`, or any conflicting
same-second canonical evidence, blocks conversion. This deliberately differs
from the broader operational "open dispute" set; `lost` is closed operationally
but still disqualifies conversion quality.

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

The release-time class-wide semantic inventory was exactly 33 files: replacing
a direct ledger reference with a projection did not make the consumer
disappear from that audit. The later Guild Order-facts conversion moved
`src/lib/metrics.ts` payment predicates into the byte-pinned
`20260901070000_prepare_order_seller_metrics_authority` migration, so the
current `src` inventory is 32 while the historical 33-file release record and
15-file no-enumeration boundary remain retained.

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
uses separate `ci` and `grainline_app_runtime` connections, proves the
parent-first migration/writer lock order, proves direct helper execution
denial, observes the eligibility parent Order lock wait, and proves a stale
review-eligibility claim returns zero after the refund transaction commits.
CI also runs the same production catalog reader against the fully migrated
disposable PostgreSQL database inside an engine-attested repeatable-read,
read-only transaction. That catches PostgreSQL-rendered default, function-body,
ACL, trigger-definition and projection-consistency drift before the production
workflow can be merged or dispatched.

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

The distinct pooled-runtime postflight, compatible deployment and bounded
authenticated aggregate/review smoke are accepted. The postflight used only the pooled
`grainline_app_runtime` credential, refused privileged or aliased database
URLs, ran in an engine-attested repeatable-read/read-only transaction,
re-proved the sealed five-function read authority, verified both Order
projection columns and both triggers, proved all three aggregate helpers remain
runtime-inaccessible and exported no rows or counts. The postflight changed no
production state. PR #345 exact head
`a111e4b30609b60db99765f3a41bd255f333c2f0` merged as exact main
`6a74f1dd385035f2ff376d79a482ca989cf4ab02`; exact-main CI
`33309431664` passed the full PostgreSQL, TypeScript, lint, test, audit and
production-build gates. The operator re-attested exact deployment
`dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj`, its source and four canonical aliases,
then used one short-lived retained operational-canary Clerk session. It proved
unauthenticated review denial, rendered `/account` with status 200 and posted a
fresh nonexistent listing ID to `/api/reviews`. The exact 403 delivered-order
denial can occur only after the converted route reaches its authoritative
locked eligibility query with `Order.paymentRefundBlocked = false`.

Cleanup revoked the exact session, reset only that canary's transient
review-rate-limit state and deleted only its production account-cache key. The
restart journal is absent. The smoke created zero Review, Order, Listing,
database, payment or provider fixtures and changed no migration, RLS, grant,
credential or provider configuration. Retain sanitized mode-`0600` evidence
SHA-256
`5ec5518ccc3b0cdfd6c3e8542d9f57f722029d7dfdda5db9f4e50d22ddb633ee`.
The current gate is conversion and proof of the remaining contended
transition, webhook and local-evidence consumers. This acceptance does not
authorize predecessor drain, grant revocation, RLS activation or provider
changes.

## Failed hosted proof evidence

- PR #343 CI run `33305149303` reached the new real-PostgreSQL runtime-login
  postflight and failed closed before any production action because the shared
  catalog assertion expected production owner `neondb_owner` in disposable CI,
  where migration functions are deliberately owned by `ci`. The correction
  keeps `neondb_owner` as the production default and requires the CI proof to
  pass the explicit expected owner `ci` for both function and trigger catalog
  rows; runtime/PUBLIC ACL assertions and function body pins are unchanged.
- The first corrected attempt of CI run `33305370435` failed earlier in the
  existing disposable migration chain on a transient SavedSearch owner-session
  drain and was rerun unchanged. Attempt 2 passed that point and then exposed
  the same explicit-owner requirement in the trigger catalog, before the new
  proof made any production connection. Trigger structure and bytes were
  correct; only the environment-specific expected owner needed the same bound.

- Pull-request CI run `33302295449` reached the new production-catalog reader
  after every sealed predecessor check passed, then failed closed at the exact
  aggregate-authority scope step. The first runner intentionally emitted only
  `UNCLASSIFIED`, which concealed whether the rejection came from the ledger,
  columns, functions, triggers or projections. No later CI step ran and no
  production state changed.
- The runner now maps only internally defined assertion families and five-byte
  PostgreSQL SQLSTATE values to safe diagnostic codes. It never prints an
  exception message, SQL text, catalog rows, URLs or credentials. A fresh full
  CI run remains mandatory; the failed run is not acceptance evidence.
- Replacement run `33302658584` safely classified the rejection as
  `TRIGGER_CATALOG`. The verifier had coupled semantic acceptance to
  `pg_get_triggerdef`'s cosmetic schema rendering. The corrected reader no
  longer accepts reconstructed SQL text: it verifies the relation and function
  namespaces, function identity/owner, enabled state, exact `tgtype` event and
  row timing bits, zero arguments, non-constraint/non-deferrable posture, and
  the exact ordered UPDATE-OF column vector directly from `pg_trigger` and
  `pg_attribute`. Run `33302934572` showed that at least one structural trigger
  expectation still differed, but the single `TRIGGER_CATALOG` category was
  not narrow enough to locate it. The proof now splits its fixed diagnostic
  vocabulary into inventory, relation, event-shape and function-binding groups
  for each trigger. Migration bytes and trigger behavior are unchanged.
- Run `33303206508` narrowed the remaining mismatch to the guard trigger's
  structural shape. `pg_attribute.attname` is PostgreSQL type `name`, so the
  reader's `ARRAY(...)` was returned as `name[]`; node-postgres does not
  guarantee array decoding for that catalog-specific type. The query now casts
  the ordered attribute vector to `text[]` at the SQL boundary, matching the
  established rule that catalog values must cross the driver in explicitly
  supported types. A regression test pins the cast.
