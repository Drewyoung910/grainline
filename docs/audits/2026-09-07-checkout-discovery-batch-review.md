# Checkout recovery, discovery and batch-delivery audit — 2026-09-07

## Scope, status and preservation

This is another bounded **source-only product/runtime audit**, not a new security
scan, production attestation, capacity benchmark or claim of exhaustive coverage.
Implementation remains paused until Drew explicitly resumes it. Passing 8 PM does
not itself authorize coding. No application edits, executable tests, application
or browser execution, production/provider reads or writes, commits, pushes,
deployments, migrations, cleanup or RLS changes were performed in this pass.

Reviewed candidate: `/private/tmp/grainline-clerk-legal-provenance-20260903`, branch
`agent/order-checkout-retry-clock-20260906`, HEAD
`bc1ff4d151572086f8d8ca6740256728e6da91e8`. Source references below are relative to
that candidate, **not** the old root checkout. Its existing paused changes remain
outside this audit's edits. These records live in the root's durable `docs/audits`
folder, not in a disposable worktree; they are local and not committed/pushed.

Three parallel reviewers covered checkout lifecycle, discovery, and settled-batch
callers. The parent checked the cited causal paths and added the analytics review.
Twelve additional source-backed issues are below. All remain open; deterministic
source reasoning is distinguished from browser/provider reproduction. P2/P3 here
are engineering priorities, not vulnerability severity or measured incident rates.

Related records:

- [Original runtime/financial findings](2026-09-07-runtime-review.md).
- [Shipping, worker health and accessibility](2026-09-07-shipping-operations-accessibility-review.md).
- [Legal/product promises and architecture](2026-09-07-legal-architecture-review.md).
- [Completed bounded security report](2026-09-07-security-artifacts/report.md),
  unchanged by this ordinary-runtime follow-up.

Identifier correction: the shipping follow-up's new findings now use
`SHIP-F01`–`SHIP-F04`, avoiding collision with the original record's `SHIP-01`
(parcel approximation) and `SHIP-02` (label-read limiter). This is a documentation
correction, not remediation, closure or renumbering of the original findings.

## Checkout: recover uncertain and partial outcomes explicitly

### CHECKOUT-F01 — Lost create response strands ordinary cart retry

**P2; source-confirmed recovery gap, no duplicate charge demonstrated.**

Precondition: the server creates and binds an unpaid seller Checkout Session and
marks its lock ready, but the client loses the response before learning the ID.
`src/app/cart/page.tsx:747` generates a new checkout group inside every Proceed
attempt. IDs become rollback targets only after successful response parsing
(`767-786`); the failed attempt cannot cancel the unknown ID (`799-806`).

`src/app/api/cart/checkout-seller/route.ts:463-484` includes that group in the
payload hash. Retrying unchanged checkout details generates another group, so the
ready-lock reuse check fails (`486-503`), even with abundant remaining stock. The
message directs the buyer to a Stripe tab that this attempt never displayed.

Cart resume is only invoked when restoring `?step=payment` (`cart/page.tsx:342-359`),
but that URL is not installed until all seller session creations succeed
(`795-798`). This is distinct from existing `CART-01`, which concerns stock checks
running before exact-session recovery for a last-item reservation.

Counterevidence: manually visiting `/cart?step=payment` can recover a ready lock;
eligible expired reservations have webhook/repair paths. Buy Now already attempts
buyer/listing resume on opening (`BuyNowCheckoutModal.tsx:166-209`). Keeping an
ambiguous create reserved is correct; inventing a new session or blindly restoring
stock is not the remedy.

Proposed regression: lose the response after successful server binding for seller
one and seller two, with plenty of stock. Require recovery or authoritative
cancellation of the original attempt before another group is started. Preserve a
stable attempt identity and expose resume after uncertain create failures.

### CHECKOUT-F02 — Interactive cancellation forgets unresolved sessions

**P2; source-confirmed.** Cart's rollback helper checks neither HTTP status nor
response body (`cart/page.tsx:242-254`). Its API intentionally reports per-session
retrieve/expire/restore failures, including HTTP 200 with `ok: false`
(`api/cart/checkout/rollback/route.ts:85-173`).

Back to shipping awaits that helper and then unconditionally clears payment IDs
and navigates away (`cart/page.tsx:813-832`). Partial-create cleanup repeats the
assumption (`799-805`). Buy Now has the same ignored-outcome helper and starts
rollback while immediately resetting state (`BuyNowCheckoutModal.tsx:48-60,113-129`).

An explicit `expire_failed`, HTTP 429 or HTTP 500 can therefore leave the session
open while the interactive UI behaves as if cancellation finished. Recreating a
session can hit its existing lock or the buyer's own inventory reservation.

Counterevidence: the API correctly refuses to restore paid/complete sessions and
requires confirmed expiration for ordinary restoration (`rollback/route.ts:110-148`).
Buy Now's next-open resume, cart's payment URL and eventual expiry mitigate the
stall. Best-effort unload cancellation is not inherently defective; silently
discarding unresolved state during an interactive Back action is the finding.

Proposed regression: cover HTTP 429/500, HTTP 200 partial failure, and a payment
finishing immediately before cancellation. Return typed per-session outcomes,
retain unresolved IDs, and distinguish cancelled, already paid and still pending.
Do not restore stock merely because the UI left the payment step.

### CHECKOUT-F03 — Expired remainder disappears from partial-checkout recovery

**P2; source-confirmed product-state gap.** Start sellers A and B, pay A, let B's
unpaid session expire, then reload payment within the completed-reservation
recovery window.

All seller sessions are created before payment is displayed (`cart/page.tsx:749-798`)
with 31-minute expiration (`checkout-seller/route.ts:628`). After a payment, Back
is removed in favor of finishing the remainder (`cart/page.tsx:1128-1139`). The
embedded wrapper exposes completion, not an application expiry/recovery state
(`EmbeddedCheckoutPanel.tsx:9-38`).

Resume correctly excludes unusable non-open/non-unpaid sessions
(`api/cart/checkout/resume/route.ts:100`). Its database supplement returns only
COMPLETED reservations in the last two hours, not all original group outcomes
(`prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql:1705-1754`).
No later replacement of that function was found in the candidate migration tree.
With no open secrets but at least one completed ID, cart redirects to success
using only completed IDs (`cart/page.tsx:315-322`). Success derives pending counts
from the supplied IDs, not original group membership
(`app/checkout/success/page.tsx:138-162`).

The receipt is accurate for A, but there is no explicit “A purchased; B expired
and was not purchased” continuation. The buyer can revisit the ordinary cart
after reservation cleanup; no payment for B, duplicate charge, false B receipt or
permanent stock loss has been demonstrated. Separate seller payments need not
become an all-or-nothing refund operation.

Proposed regression: A paid/B expired; A paid/B expired by listing shutdown; and
both sessions still open. Return authoritative paid/open/expired/unresolved group
outcomes, and preserve a partial-completion summary plus remaining-cart action.

## Durable email delivery: capture intent before losing its source

### BATCH-F01 — Listing follower email failure has no durable retry work

**P2; source-confirmed conditional failure.** `src/lib/concurrency.ts:16-25`
converts mapper exceptions into rejected result entries. Listing follower email
fan-out awaits but discards those entries
(`followerListingNotifications.ts:83-105`). A failure before the outbox insert
leaves no email job (`emailOutbox.ts:159-198`), yet processing returns or advances
the follower cursor.

Outer catches in shop listing actions (`seller/[id]/shop/actions.ts:97-123`) and
admin approval (`api/admin/listings/[id]/review/route.ts:55-79`) cannot observe an
exception that was converted into a returned settlement. The existing root
`audit_open_findings.md:61` records earlier hardening of outer catches; this is a
narrower remaining batch-result gap, not a claim those catches are absent.

Counterevidence: failures outside the mapper are observed; in-app notification
delivery is separate and its helper records errors. Stable email deduplication
could support an explicit replay. The current path does not persist failed-
recipient continuation, and an outbox worker cannot retry a row never inserted.

Proposed regression: one of two eligible follower email inserts rejects before
insertion. Preserve the successful recipient, report the rejected one, and prove
durable continuation eventually queues the missing email exactly once. Record a
resumable fan-out intent before per-recipient enqueue; simply logging is not
equivalent to retryability.

### BATCH-F02 — Back-in-stock claim consumes subscription before email is durable

**P2; source-confirmed, stronger recovery consequence than BATCH-F01.** Restock
fan-out claims subscribers before processing email
(`api/listings/[id]/stock/route.ts:234-304`). The authoritative claim atomically
inserts an allowed in-app notification and deletes the one-shot subscription; it
also consumes subscriptions when in-app notifications are disabled, explicitly
leaving email preference handling to the application
(`prisma/migrations/20260722051500_prepare_notification_rls/migration.sql:2518-2600`).

The subsequent email batch discards rejected settlements (`stock/route.ts:321-338`).
If enqueue fails before insertion, there is neither an outbox row to retry nor a
subscription for the next scan to rediscover. An email-only subscriber can miss
their only enabled channel. The outer catch (`343-349`) cannot see mapper rejection.

Counterevidence: claim-result rejections are explicitly observed (`284-295`), and
enabled in-app notifications are protected by the atomic claim. This is not
universal loss of every notification channel. Successful inventory changes should
remain successful rather than be reversed because email had trouble.

Proposed regression: after a successful claim, reject email insertion for an
in-app-enabled and an email-only subscriber. Require a durable email-dispatch
intent to survive subscription consumption. Co-commit that intent with the claim,
then render/enqueue asynchronously using the existing subscription-derived dedup
key. Also inspect mapper settlements. The inventory-authority tests cover claim
telemetry and in-app atomicity, not this claim-to-email failure window.

## Discovery: keep effective filters and reachable results truthful

### DISC-F01 — Category link and filter selection disagree

**P2; source value mismatch verified; rendered select fallback still needs a browser test.**
Listing detail lowercases category (`listing/[id]/page.tsx:455`) and uses that
value in its ordinary Details link (`750-759`). Browse correctly normalizes the
server query to uppercase (`browse/page.tsx:255-258`). Both filter forms use the
raw URL category as `defaultValue` against uppercase options
(`FilterSidebar.tsx:64,93-103`; `MobileFilterBar.tsx:97,139-149`; `lib/categories.ts`).

Following this link can show correctly filtered results beside a select with no
matching option. Under normal select fallback it shows All categories; applying
another filter then submits an empty category and broadens results. Uppercase
links and manually chosen categories are counterexamples that work.

Proposed regression: follow an ordinary listing category link on desktop/mobile,
then apply another filter without touching Category. Require normalized selected
state and preserved filtering. Normalize at the shared URL/control boundary.

### DISC-F02 — Enter can choose a suggestion from the previous query

**P2; source-confirmed asynchronous selection gap.** Highlight a suggestion, edit
the input to a different query of at least two characters, then press Enter
before the new response arrives. SearchBar updates text and aborts pending work
without clearing existing options/activeIndex (`SearchBar.tsx:145-151`). Immediate
reset exists only in the short-query branch (`153-167`); longer queries reset
after the 300 ms debounce and response (`170-207`). Enter chooses the old active
option rather than current text (`278-285`), potentially navigating to an old
query, category or blog (`328-341`).

Counterevidence: aborted/request-generation checks correctly prevent obsolete
responses being installed; the Search button submits current input. The flaw is
the still-selectable rendered option during the pending interval, not a blanket
absence of request guards.

Proposed regression: keyboard-highlight and hover-highlight cases, edit, then
Enter before response. Invalidate selection on every edit and associate selectable
suggestions with the current normalized query. Verify ArrowDown during loading
cannot reactivate old-query options.

### DISC-F03 — Mobile out-of-range radius silently disables geography

**P2; source-confirmed.** Mobile radius accepts numbers above 500 without a max
attribute (`MobileFilterBar.tsx:277-285`). Browse's decimal parser rejects values
above 500 and enables geography only when latitude, longitude and radius all
parse (`browse/page.tsx:264-267`; `queryParams.ts:15-24`). The mobile filter badge
counts location using latitude/longitude alone (`MobileFilterBar.tsx:108-117`).

Thus a buyer entering 600 miles can get geographically unrestricted results while
the UI counts location as active. Desktop has max=500; valid mobile radii work.

Proposed regression: mobile 500/501/600 and malformed radius; require consistent
bounds and explicit validation, not silently dropped intent. Badge state should
reflect effective filters. No geolocation or production result query was run.

### DISC-F04 — Relevant sorting hides matches beyond a quality-only pool of 200

**P2 search-quality/scaling contract; deliberate bound, incomplete disclosure.**
For a query, default relevance fetches only the first 200 quality-ranked matches,
then applies text scoring and sets total to the pool length
(`browse/page.tsx:243,412-421`). The UI calls that the result count (`722-723`).
Other sorts count and paginate the complete matching query (`423-426`).

Above 200 matches, switching sort changes the reachable result set and count; an
exact-title match below the quality-only cutoff never enters text scoring. This
is a documented computational bound, not accidental missing pagination. The
defect is preselection before relevance plus presenting the bounded pool as the
full result set. Alternate sort can reveal the omitted rows.

Proposed regression: 201+ matches with a low-quality exact-title match; verify
query-aware candidate retrieval or explicitly labeled recommended-subset semantics
with a complete-results route and truthful count. Current production match counts
were not inspected; this is not a demand to remove cost bounds indiscriminately.

### DISC-F05 — Pager advertises pages that parsing cannot reach

**P2 at a documented catalog threshold; not a current throughput measurement.**
Browse parses page with maximum 500, page size 24 (`browse/page.tsx:28,252`), but
leaves totalPages uncapped and emits Next from the displayed page (`445-447,581-582`).
Seller shop repeats it with page size 20 (`seller/[id]/shop/page.tsx:26,116,218-225,518-526`).
The shared positive-integer parser clamps rather than rejects excess page numbers
(`queryParams.ts:1-10`).

Above 12,000 browse matches or 10,000 shop matches, page 500's Next requests 501
but renders page 500 again. Below those thresholds, normal total clamping and
deterministic ID tie-breakers work. An intentional offset-cost bound does not
justify advertising unreachable pages.

Proposed regression: boundary counts around 500 pages. Prefer cursor-based
continuation where deep browsing is required, or visibly consistent bounded
pagination. Keep count, labels, metadata and Next aligned with actual reachability.

### DISC-F06 — Metro/category count exceeds its non-paginated 24-item grid

**P2 above 24 matching listings.**
`browse/[metroSlug]/[category]/page.tsx:137-165` takes 24 rows and separately counts
all matches. It advertises that full count (`223-227`) but renders only the grid,
without a pager, limit notice or continuation (`253-295`). Older matches cannot be
reached within the selected metro/category.

Counterevidence: the parent metro page explicitly says Showing 24 of and links to
main browse (`browse/[metroSlug]/page.tsx:349-353`); the category page lacks this.
No current inventory count was inspected.

Proposed regression: 25 matches; require genuine pagination or an explicitly
labeled preview with continuation preserving metro and category. The parent's
50-mile seller-coordinate link is not equivalent to metro membership, so copying
that link without deciding the result contract would not prove exact continuation.

## Analytics: bind displayed data to current intent

### ANALYTICS-F01 — Older response can overwrite the selected reporting period

**P2; source-confirmed financial-display issue, no payment mutation.** The range
effect in `dashboard/analytics/page.tsx:615-641` launches fetch without a cleanup,
request generation or response-range check. Every response/error unconditionally
updates page state. Range buttons remain enabled (`655-668`).

Select period A, then B; B resolves first, then A. The highlighted range remains B
while A's sales, paid-order totals, engagement and chart are installed
(`707-741,821-833`). The API includes its actual `range`, but the client does not
compare it with current intent. A late older error can likewise overwrite the
new request's error/loading state.

Counterevidence: server calculations are scoped to each requested period; this
does not establish wrong ledger values or a SQL timezone bug. The chart's
`key={data.range}` remount handles local chart state, not response ordering.

Proposed regression: deferred A/B promises, resolve B then A; require selector,
totals, chart and error/loading state all remain B-bound. Use cancellation plus a
generation/effect-lifetime guard for every completion branch. Existing
`tests/analytics-range-and-chart.test.mjs` covers chart interaction and top-listing
range SQL, not this response-order sequence.

## Capacity/design observations — not additional confirmed runtime incidents

### CAP-F01 — Commission expiry can finish a bounded pass with a backlog

`api/cron/commission-expire/route.ts:16-21,33` permits five 200-row batches with a
60-second invocation limit and daily monitor schedule. It computes `hasMore`
then records completed/HTTP 200 (`133-146`). `cronRunPartialIssues.ts:1-33` tracks
failure collections and counters, not backlog continuation.

With 1,001 due rows, even a successful cap-sized invocation leaves work. OPEN
expired rows remain discoverable later, per-row failures are observed, and
`commissionState.ts:3-8` independently excludes expired records from public-open
eligibility. This is **not** proof of permanently lost records or expired listings
remaining publicly eligible. It is a capacity/SLO and backlog-age monitoring gap.

Proposed test/decision: 1,001 due rows, eventual bounded continuation, oldest-age
and backlog telemetry. Distinguish expected continuation from failure; decide an
expiry-notification SLO instead of merely removing the cap. No production backlog
or maximum sustainable throughput was measured.

### ANALYTICS-N01 — Intraday views are estimates, not measured hourly traffic

`api/seller/analytics/route.ts:332-353` spreads daily view/click totals evenly over
elapsed hours for today, or 24 hours for yesterday. The chart presents Views under
Performance Over Time (`dashboard/analytics/page.tsx:180-184,320-339`), with numeric
hour-point tooltips (`232-243`); the reviewed UI does not label that redistribution
as an hourly estimate. Daily totals can be correct while the hourly shape is not
an observed traffic pattern. Orders/revenue buckets are separately sourced and
are **not** shown to be distributed this way.

Product decision: display daily views at their actual granularity, label the
estimate explicitly, or add real hourly aggregates if their value warrants it.
Do not collect raw fine-grained visitor history just to draw a smoother chart.
Test daily total conservation and truthful granularity. This is an existing
modeling/disclosure limitation, not a claim of inflated total views.

Other bounded observations retained from discovery: partial tag matching only
searches cached popular tags (top 200, then up to 20 matching tags), while exact
tags remain directly queried. Parent-city continuation changes from metro
membership to a 50-mile seller-coordinate query. Treat these as explicit search
product decisions, not generic assertions that all caching or limits are wrong.

## Counterevidence and architecture direction

- Stripe reconciliation, anonymous cart merge, Clerk session revocation, Resend
  webhook tasks and seller broadcasts inspect rejected settled results. The
  concurrency helper is not universally misused.
- Ordinary createNotification has internal error telemetry. Ignoring a settlement
  alone does not prove silent loss. Case auto-close's extra notification call
  replays effects already committed by its authoritative transition, unlike the
  missing email intent above.
- Support/privacy intake creates a durable SupportRequest before notification
  email and reports an accepted receipt even if mail fails. Closed requests are
  terminal and preserve closure timing. No new “email failure loses the privacy
  request” allegation is justified by these paths. Automatic email retry/SLA and
  jurisdiction decisions remain separate operational/legal obligations.
- Analytics API uses explicit UTC handling in the reviewed range/bucket labels.
  No new naked-timezone-cast or off-by-day bug is asserted in this pass.
- Standard discovery sorts have deterministic ID tie-breakers and preserve
  filters. No full listing-result cache staleness was inferred from a tag cache.

Continue with the modular monolith, fixed database authorities, idempotency and
durable outbox approach; there is no evidence here that a microservice rewrite
would help. The recurring weaknesses are **incomplete recovery states**, **lost
asynchronous intent**, and **UI contracts that diverge from effective backend
state**. Protect these with state-transition tests, not only textual source
assertions. Retryability starts before work enters an outbox, and a success code
does not by itself attest that every item in a batch succeeded.

On implementation resume, keep the prior financial/security/SHIP-F01 blockers
first. Group CHECKOUT-F01–F03 with checkout-state work; BATCH-F01–F02 with durable
delivery/worker-health work; then correct discovery and analytics contracts in
bounded releases. Address deep-pagination/backlog limits before their documented
thresholds. Do not block every unrelated RLS step on minor UI work, but do not
declare Order launch-ready while payment-intent/recovery defects are unresolved.

## Coverage and explicit limits

Complete reads by the assigned reviewers in this packet:

- Checkout: cart resume/rollback, single-checkout resume, checkoutSessionLock,
  checkoutLockState, singleCheckoutResume, checkoutStockRestore,
  checkoutStockReservationAuthority, checkoutSuccessState, checkout success page,
  EmbeddedCheckoutPanel; checkout-completion-state, checkout-success-state,
  single-checkout-last-stock-recovery and checkout-session-expiry tests.
- Discovery: main browse, metro, metro/category, seller shop and its SortSelect;
  search suggestions route; FilterSidebar, MobileFilterBar, SearchBar; categories,
  queryParams, popularTags, searchCache, listingVisibility, qualityScoreFormula,
  quality-score.
- Batch delivery: concurrency, notifications, emailOutbox, followerListingNotifications,
  followerBlogNotifications, stock route, stripeConnectReconcile and its cron,
  anonymousCartMerge, clerkUserLifecycle, Resend webhook, seller broadcast, ban,
  commission detail route, commission expiry cron, case-auto-close and guild-member
  crons; commissionExpiry, commissionState, cronBatchState, cronRunPartialIssues,
  cronMonitorState; follower-listing-notifications and notification-inventory-
  authority tests.
- Parent: supportRequest, supportRequestState, supportRequestAccount,
  SupportRequestForm, support/legal intake routes and public form pages, money,
  SellerRefundPanel, orderRefundFinalization, recent-sales analytics route,
  analytics-range-and-chart tests; targeted analytics API/chart/page sections and
  independent source checks of the findings above.

Cart/Buy Now and checkout-create routes were complete-read in earlier bounded
passes and selectively rechecked here. Listing detail was checked at the category
caller, not reread entirely. The cited reservation-resume and back-in-stock claim
functions were read completely by the reviewers; their entire migrations are not
counted as new complete reads. No claim of exhaustive new Order SQL coverage.

Unfinished checks: browser timing/navigation reproductions; real shipping quotes
and package/carrier representativeness; queue recovery and measured load tests;
maker-directory/seller-profile discovery; full mutation-to-cache-invalidation
coverage; remaining product surfaces; counsel resolution of the prior legal
register. Current deployed source, live catalog counts and RLS posture were not
queried. All suggested regression tests are proposals, **not executed passes**.

Snapshot preservation check for the paused candidate: the same four tracked
modified paths (CI plus three Order docs) and three untracked input-correction
proof/doc/test paths remain; do not fold them into audit-only edits or overwrite
them while reconciling the old root. No worktree cleanup is authorized here.
