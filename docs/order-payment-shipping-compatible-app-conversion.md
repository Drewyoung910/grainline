# Order, Payment, and Shipping Compatible Application Conversion

Status: merged compatible application source; not deployed to production.

Prepared: 2026-08-05

Production-preparation prerequisite accepted: 2026-08-08

## Exact predecessor and release boundary

The compatible-preparation prerequisite is live from exact main
`6f1f4c1e99fb21726744ecd1652a37b6be35c294`, exact-main CI
`31276366947`, and guarded migration run `31277540714`. That predecessor
contains migration
`20260805012000_prepare_order_payment_shipping_compatibility`, whose SHA-256 is
`29f56fa82b68c743e0d081324c5caa9795f0dd0d43e8d0ed42acd28311ef03d3`.
The separate actual pooled-runtime postflight passed read-only with all six
integrity counts at zero and proved RLS off, FORCE off, zero policies and
predecessor CRUD retained.

PR `#161` merged exact reviewed head
`d2ef37b4c86a0ff174016be77113fa1b888131b4` as main commit
`0e2e1cce29089ab1418ff006b461d74b5f9804ca`. The source was synchronized
with the accepted production-preparation main commit before the
post-production authority review. It has not yet been deployed to production;
the predecessor production application remains active until the separately
reviewed compatible deployment boundary.

The database prerequisite is satisfied, but that does not itself authorize an
application deployment. The preparation intentionally retains the predecessor
table grants and RLS posture so old and new app instances can coexist during a
separately reviewed deployment.

This is the first application checkpoint for the two capabilities installed by
the preparation migration. It is not the complete Order/OrderItem/payment/
shipping authority conversion and does not authorize RLS, grant revocation,
`NOT NULL` convergence, cleanup or a provider mutation.

## Generation-bound Stripe event lifecycle

Both signed Stripe entry points now call the three prepared fixed functions:

- `grainline_stripe_webhook_begin(event_id,event_type)` returns the database-
  issued action and claim generation;
- `grainline_stripe_webhook_complete(event_id,claim_generation)` finalizes only
  the exact current generation; and
- `grainline_stripe_webhook_fail(event_id,claim_generation,sanitized_error)`
  releases only the exact current generation.

The application accepts exactly one typed result row. A `process` result must
have a positive generation. A superseded completion fails closed and therefore
cannot return webhook success from a stale worker. A superseded failure is a
safe terminal result because the stale worker must not clear the newer lease.
Existing processed predecessor rows may legitimately return generation zero;
they never reach a finalizer.

Stripe signature verification remains the ingress trust boundary. The fixed
database functions protect row lifecycle, replay identity, type immutability
and stale-worker finalization; they do not independently authenticate a Stripe
payload.

This source is the predecessor of the separately reviewed StripeWebhookEvent
maintenance-authority release. That successor moves
the legacy `checkout-stock-restore:<session>` dedup path to the dedicated
`grainline_legacy_stock_restore_claim` operation inside its already-held
checkout-session advisory lock and surrounding stock-restore transaction. The
claim and stock update therefore commit or roll back together. Operation 36 is
now merged, and its additive fixed function is live from guarded migration run
`31290691183`. The compatible application call site still has not been
deployed, and this preparation does not represent RLS activation or revoked
predecessor table authority.

## Durable seller-key dual write

The paid checkout webhook now derives exactly one complete seller profile ID
from the resolved paid-checkout source, locks the referenced seller rows during
finalization, and writes the key explicitly to:

- cart-checkout `Order.sellerProfileId`;
- every cart-checkout `OrderItem.sellerProfileId`;
- single-listing `Order.sellerProfileId`; and
- the nested single-listing `OrderItem.sellerProfileId`.

Missing, blank or mixed seller identities fail before Order creation. The
database trigger derives every item key again from the current Listing inside
the transaction, and the composite foreign keys remain the final authority: an
ownership change or caller mismatch is rejected even if the resolved checkout
state was stale. Historical display fields continue to come from
`listingSnapshot`; the durable seller key is an authorization/join key, not
mutable catalog display data.

## Coexistence and rollback

Old app instances may continue their predecessor direct webhook-event writes
while the preparation table grants remain in place. New instances require the
prepared functions and seller columns. Therefore the allowed order is:

1. merge and apply compatible preparation;
2. pass the pooled-runtime preparation postflight;
3. deploy this compatible application candidate;
4. prove both webhook destinations, checkout finalization and stock restore;
5. drain old deployment overlap; and only then
6. prepare the remaining fixed operations, revoke predecessor table authority,
   converge seller keys to `NOT NULL`, and activate RLS in reviewed boundaries.

Rolling back this application candidate is safe while the predecessor grants
and nullable columns remain. Removing the preparation migration underneath a
mixed or converted app deployment is forbidden.

## Verification contract

The candidate must keep all of the following green:

- focused app-conversion, Stripe route, event-state, checkout-finalization and
  stock-reservation tests;
- pure result-parser tests for invalid row count, invalid action/generation,
  generation-zero processing, superseded completion and superseded failure;
- TypeScript and lint;
- the complete local test suite;
- the disposable PostgreSQL preparation/lease/invariant proofs inherited from
  PR `#160`; and
- a production build in exact-head CI.

No test, commit or CI result on this branch changes production state.

## Candidate proof history

- Code checkpoint `7f48f92e723b55cb2b3ae9996128346dc1253bea` passed the focused
  32-test security/checkout set, TypeScript after Prisma regeneration, focused
  lint, and the complete local suite: 2,790 passed, 7 skipped and zero failed.
- Draft PR `#161` initially targeted the preparation branch, which correctly
  preserved the stacked review but could not trigger the repository CI workflow
  because that workflow listens only to pull requests targeting `main`.
- Documentation checkpoint `b64f8018eb8942f7c341f7e5823a88f111233c0e`
  recorded the logical PR `#160` dependency while retargeting the draft to
  `main` for exact combined-head proof.
- Exact-head CI run `30973093698` passed the compatibility migration-tree and
  equivalence gates, disposable PostgreSQL migration/grant/RLS/concurrency
  proofs, restricted-runtime compatible postflight, TypeScript, lint, the full
  test suite, dependency audit and production build. The Vercel Preview guard
  failed as expected because this isolated security branch is not provided the
  protected production database environment; it did not deploy anything.
- Exact-head refresh CI run `31274070492` passed before the production
  preparation release. The expected Vercel Preview environment guard again
  rejected the isolated branch without deploying it.
- The post-preparation Extra-High source review found that the original
  generation conversion cleared a valid event lease before the existing
  duplicate-`stripeSessionId` recovery branch tried to complete it. The fixed
  path recognizes only the reviewed `P2002` target, preserves that lease,
  completes the event and then returns success. The same review made the row
  parser reject negative claim generations for every action and reject blank
  durable seller IDs. Semantic regression tests cover all three cases.
- Corrected exact head `d2ef37b4c86a0ff174016be77113fa1b888131b4`
  passed exact-head CI run `31278958695`: all disposable PostgreSQL proofs,
  TypeScript, lint, 2,799 tests (2,792 passed and 7 skipped), dependency audit
  and the production build succeeded. No deployment or production mutation
  occurred.
- PR `#161` then merged that exact head as main commit
  `0e2e1cce29089ab1418ff006b461d74b5f9804ca`. This merge made the compatible
  source deployable but did not itself deploy it or change production state.
