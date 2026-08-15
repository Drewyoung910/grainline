# SellerPayoutEvent pre-RLS domain audit

Status: audit complete; **GO for isolated compatible preparation only** and
**NO-GO for RLS activation** until the gates in this document pass.

Audited: 2026-08-15

Source boundary: production main
`7c033eac8b18f2c7b6837dc8caafa5d3eda47f76` plus documentation-only checkout
reservation completion commit
`74eb0655326b93cfac9c9db22e7946ab348d51cc`. The latter changes no payout
source, schema or provider behavior.

## Why this is the next bounded release

`SellerPayoutEvent` is the smallest unfinished Order/payment/shipping authority
surface. It has three direct application consumers, one signed-provider write
family, one seller banner and one account-export family. It does not share the
Order/OrderItem refund, fulfillment, Shippo or participant state machines.
Activating it separately reduces ordinary-runtime payout authority without
bundling payment events, shipping quotes or Order PII into one release.

This audit does not authorize a migration, application deploy, RLS, FORCE,
grant revocation, provider change or production read. It authorizes preparing
an isolated compatible candidate after the audit checkpoint is saved.

## Current behavior and source inventory

The exact direct-access inventory remains three files:

| Access | Source | Current behavior |
|---|---|---|
| Write | `src/lib/stripePayoutWebhook.ts` | A signature-verified `payout.failed` event maps `event.account` to the unique current `SellerProfile.stripeAccountId`, upserts by payout ID, then creates a source-bound notification. |
| Latest seller read | `src/app/dashboard/seller/page.tsx` | Shows the newest failed row from the last 30 days in Shop Settings. |
| Seller export | `src/app/api/account/export/route.ts` | Exports every payout row belonging to the current seller profile. |

Indirect dependencies are also in scope:

- `src/app/api/stripe/webhook/connect/route.ts` is the canonical separately
  signed connected-account ingress and is subscribed only to `payout.failed`;
- `src/app/api/stripe/webhook/route.ts` retains the same handler only as an
  unsubscribed predecessor/compatibility branch;
- `StripeWebhookEvent` supplies the live generation-bound event lease and
  immutable payout source-object ID;
- the Notification service function reads `SellerPayoutEvent` plus
  `SellerProfile` to derive recipient, copy and canonical route; and
- account deletion intentionally retains the payout row and anonymized
  `SellerProfile`; the retention foreign key is `ON DELETE RESTRICT`.

The August 5 protected aggregate inspection saw zero payout rows. That is a
historical predecessor snapshot, not proof of the current count. A fresh
aggregate-only read is required before constraints or activation.

## Intended product behavior

1. A valid, fresh, correctly signed connected-account `payout.failed` event
   acquires an exact `StripeWebhookEvent` lease.
2. If the connected account maps to a retained seller, Grainline stores one
   bounded current failure row for that Stripe payout and creates one deduped
   seller notification.
3. Exact retries are idempotent. An older provider event cannot overwrite newer
   evidence; an equal-time, different-event conflict fails closed for review.
4. If no current seller mapping exists, the event is acknowledged without
   inventing a payout owner, and bounded operational evidence records the
   ignored result.
5. The seller can see only a minimal recent-failure projection and can export
   only their own bounded, cursor-paged payout history.
6. Ordinary runtime and `PUBLIC` can never select, insert, update or delete the
   base table. No participant receives a generic payout lookup or mutation.
7. Staff has no current Grainline payout-row UI. Support continues through the
   Stripe dashboard until a separately audited staff projection is justified.

## Operation-by-principal authority matrix

| Operation | Seller | Staff | Signed Stripe service | Maintenance | PUBLIC |
|---|---:|---:|---:|---:|---:|
| Apply one failed payout | No | No | Fixed source-validating function only | No | No |
| Read latest failure banner | Own profile, fixed projection | No current operation | No | No | No |
| Export payout history | Own profile, bounded fixed projection | No current operation | No | No | No |
| Read source for payout notification | No direct access | No | Private Notification function only | No | No |
| Update/delete arbitrary rows | No | No | No | No current operation | No |

Clerk-resolved user IDs and signature-verified Stripe payload fields originate
in the application. PostgreSQL cannot independently authenticate Clerk or a
Stripe signature. The database functions bind those accepted inputs to one
active event generation, its immutable payout source ID, the current unique
Stripe-account mapping and a narrow transition. They reduce arbitrary table
authority; they do not claim to withstand arbitrary code execution holding the
ordinary runtime credential.

## State and concurrency contract

`SellerPayoutEvent` is a retained mutable latest-state projection, not an
append-only ledger:

```text
no row
  -> FAILED(provider event T, exact seller)
  -> FAILED(provider event T2 > T, same payout and seller)
```

- The active webhook row is locked and must match event ID, event type,
  source payout ID and claim generation.
- The seller is derived from the unique `SellerProfile.stripeAccountId`; a
  caller cannot select `sellerProfileId` or notification recipient directly.
- The payout row is locked by unique payout ID. Same-event replay returns the
  existing row. An older event is ignored, an equal-time different event is
  ambiguous and rejected, and only a strictly newer event may replace current
  failure details.
- The source event ID, seller, payout ID, status, row ID, database timestamps,
  notification recipient and route are database-derived. Event creation time,
  account ID, amount, currency and bounded failure details remain signed
  provider facts asserted by the application and validated for shape/range.
- A notification failure may make Stripe retry after the payout row commits;
  payout upsert and notification source dedup must therefore remain idempotent.
  In particular, the converted handler must retry notification creation for an
  `already_applied` writer result rather than treating it as complete. It must
  notify for `inserted`, `updated` and `legacy_converged` too, and must not
  notify for `stale_ignored` or `ignored_unknown_account`.

## Findings and dispositions

### SPE-A01 — broad runtime CRUD remains (`FIX_BEFORE_ACTIVATION`)

The runtime role can still enumerate and mutate the table directly. Compatible
functions must deploy first; activation later uses policyless ENABLE/FORCE,
zero policies and zero ordinary-runtime/PUBLIC table or column authority.

### SPE-A02 — provider event ordering is not durable (`FIX_BEFORE_ACTIVATION`)

The table stores only the latest `stripeEventId` and local timestamps. Two
distinct signed events for one payout can therefore apply in arrival order and
an older event can overwrite newer evidence. Add a nullable compatible
provider-event timestamp, inspect/backfill legacy rows, then require it before
activation. The fixed writer must compare provider time under the payout-row
lock and reject ambiguous equal-time conflicts.

### SPE-A03 — current upsert does not bind the active lease (`FIX_BEFORE_ACTIVATION`)

`processStripePayoutFailedEvent()` receives neither claim generation nor a
database-enforced source binding. Replace the direct upsert with one fixed
function that validates the active `payout.failed` lease and its immutable
source-object ID before deriving the seller and writing the row.

### SPE-A04 — payout invariants are application-only (`FIX_BEFORE_ACTIVATION`)

The database does not yet require failed status, nonnegative amount, lowercase
three-letter currency, a nonblank source event, or one source event per payout
row. Add compatible checks/indexes only after the aggregate inspection proves
legacy safety. Do not add a foreign key to `StripeWebhookEvent`: webhook leases
have bounded retention while payout evidence is retained longer.

### SPE-A05 — the banner uses local row creation time (`FIX_BEFORE_ACTIVATION`)

The latest-failure query orders and filters by `createdAt`. A later valid update
to an existing payout preserves that original time, so a current failure can
be hidden or labeled with a stale date. The fixed projection and UI must use
provider event time, with a documented legacy fallback only during coexistence.

### SPE-A06 — account export is unbounded (`FIX_BEFORE_ACTIVATION`)

The current export reads every seller payout row in one query. Use a fixed
keyset-paged projection with a database-clamped limit and have the export
collector exhaust pages. Do not silently truncate portability data.

### SPE-A07 — unknown account mappings are silent (`FIX_BEFORE_ACTIVATION`)

The current handler returns successfully when `event.account` has no seller.
The fixed writer should return an explicit `ignored_unknown_account` action;
the route should retain bounded observability without logging account or payout
payloads. It must not guess ownership from a caller-supplied seller ID.

### SPE-A08 — a linked-seller signed path is unproved (`FIX_BEFORE_ACTIVATION`)

The retained signed payout proof correctly used an unlinked disposable account
and therefore proved one processed webhook lease with zero seller/payout rows.
Before activation, a disposable child/Preview proof must bind a synthetic
seller to a disposable Stripe test account, deliver and exactly retry one real
failed payout, prove one unchanged payout row plus one notification, and clean
all fixtures/provider state. This is distinct from production live-mode
readiness.

### SPE-A09 — live-mode Stripe proof remains a launch gate (`DEFERRED_PRODUCT_WORK`)

Current retained provider evidence is test mode. The separately signed
live-mode Connect endpoint, secret binding and signed delivery remain mandatory
before live-money launch, but the database authority shape is mode-independent.
Keep this closure criterion in the launch/provider records; do not broaden RLS
functions or delay the compatible database design to simulate live mode.

### SPE-A10 — staff payout tooling is intentionally absent (`DEFERRED_PRODUCT_WORK`)

No Grainline staff route currently reads payout rows. Do not create generic
staff table access during RLS. If support later needs local payout evidence,
add a separately audited minimal projection with durable staff audit logging.

## Privacy, scale and maintainability

- Failure messages are seller-owned provider text capped at 1,000 characters;
  they may appear in the seller banner/export but not logs or sanitized rollout
  evidence.
- Add a seller/event-time/id index for latest and keyset export reads. Cost is
  proportional to one seller's failures, not the platform's 50,000-user total.
- Database-clamped export pages avoid one unbounded allocation while preserving
  full portability through application iteration.
- Keep provider parsing pure and the raw SQL wrapper small. The 2,700-line
  platform webhook must not absorb the database function parser or projection
  logic.
- The fixed writer and projections need pure result-shape tests, disposable
  PostgreSQL authority/concurrency tests, access-completeness tests and the
  global function/grant audit.

## Go/no-go and release sequence

**GO now:** save this audit, then prepare an isolated additive schema/function
candidate with RLS off and predecessor table grants unchanged.

**NO-GO now:** do not activate RLS, revoke table grants, deploy the converted
application, mutate production or change Stripe/Vercel configuration.

Required sequence:

1. Run a fresh aggregate-only production inspection for payout row count,
   missing/duplicate sources, status/currency/amount validity, mutation state
   and per-seller maximum; stop on any legacy row requiring classification.
2. Apply the compatible nullable event-time field, validated safe invariants,
   fixed writer, latest projection and paged export projection with RLS off.
3. Convert the three direct consumers, deploy while predecessor grants remain,
   and prove old/new coexistence.
4. Pass the linked-seller signed test-mode child/Preview proof and exact retry;
   verify the Notification cross-table source path.
5. Drain predecessor deployments and prove zero direct application access.
6. Activate policyless RLS and revoke ordinary-runtime/PUBLIC table and column
   authority; run owner plus actual pooled-runtime proofs.
7. Apply posture-only FORCE separately and repeat the proofs.

`OrderPaymentEvent`, `OrderShippingRateQuote`, `Order`, and `OrderItem` remain
separate audited releases. Completion here does not authorize or imply their
authority shapes.
