# Verified cross-domain findings before core Order RLS

Status: **current-source review; production unchanged**  
Reviewed: 2026-09-01  
Source base: shipping candidate branch
`agent/order-label-product-authority-audit-20260901`; Case correction candidate
`6d5690511057a1dceccfd28892c28ddc6c0d2b7a` remains separate in draft PR
[#383](https://github.com/Drewyoung910/grainline/pull/383)

## Decision

Do not proceed directly from the Order/label compatibility candidate into
Order Phase A. Fix the confirmed Case money-path defects and the buyer quote
correctness defects first, then finish the remaining core-Order durability
decisions while ordinary compatibility grants still exist. This is a bounded
prerequisite correction, not a restart of the site-wide RLS program.

The review below independently classifies the nineteen claims supplied by the
read-only reviewer. A function signature or text search is not by itself an
authorization finding: each claim is classified against its caller, source
binding, threat model and current candidate state.

## Shipping quote verification

The buyer quote and the later seller label re-quote are separate operations.
The seller label candidate retains a bounded quote set, requires unique
provider rate identities, binds the chosen amount/currency under the locked
Order and re-quotes quote-only checkout identities with the full retained
recipient address. The buyer quote path was weaker and had four confirmed
product defects:

1. a free pickup option was included in the generic cheapest-rate reduction,
   so checkout silently selected pickup whenever the seller offered it;
2. a provider rate without a valid `object_id` could be displayed with a
   client-invented identity and then fail at checkout token validation;
3. malformed or duplicate provider identities and unbounded delivery-day
   estimates crossed the quote boundary; and
4. a transient quote failure had no retry action, and the provider-failure
   fallback dropped an otherwise valid pickup option.

The isolated correction validates complete city/state/postal/country quote
inputs, drops malformed or duplicate provider rates before signing, shares the
same 60-day estimate ceiling across quote/checkout/webhook boundaries, defaults
to the cheapest shipping rate when shipping exists, retains pickup as an
explicit choice and adds a bounded retry action. The correction does not claim
that city/state/postal quoting is exact street-level carrier validation. Label
purchase still performs the full-address re-quote before buying a label.

Source-only tests are not provider acceptance evidence. This branch therefore
also makes the minimized shipment payload a shared pure builder used by both
the runtime route and `audit:shippo-quote-test-mode`. The operator:

- refuses any key other than an explicit `shippo_test_...` credential;
- makes exactly one `POST /shipments/` request and no `/transactions/` request;
- requires the Shipment and every returned rate to say `test=true`;
- requires at least one checkout-usable, provider-identified USD rate; and
- retains only aggregate mode-0600 evidence outside the repository.

Shippo documents that a Shipment with `async=false` generates rates, that the
rate object uses `estimated_days`, and that test-mode rate and label operations
do not incur charges. The smoke proves the exact Grainline account/request
combination; it does not prove live-mode carrier availability or the final
street-address label re-quote.

### Accepted provider evidence

The exact clean/pushed commit
`c4a6ff8c1adb8ff7141332bdc46412fc56170be2` passed the test-mode smoke on
2026-09-01. Shippo accepted the shared minimized payload and returned eleven
checkout-usable USD rates across two carriers. No Transaction was created, no
label was purchased, and no application database was accessed. The sanitized
mode-0600 artifact is retained outside the repository as
`shippo-quote-test-mode-c4a6ff8c1adb8ff7141332bdc46412fc56170be2.json`,
SHA-256
`96e55d3d601ab8df7442d42fa2fc8dec4218300c239ba10540a7bdada39c1959`.

## Reviewer-claim verdicts

| # | Verdict | Current classification | Required action |
| --- | --- | --- | --- |
| 1 | **Live P1 false; dormant defense confirmed** | The accepted Case-message invariant rejects null `authorKind` and the live column is `NOT NULL`. An impossible restored/drifted row could still reach the defensive fallback. | Draft PR #383 projects that impossible legacy nonparticipant/null-kind row as `STAFF` and proves the behavior without editing applied history. |
| 2 | **Confirmed; corrected in isolated candidate** | Six Case money-path clocks cast `clock_timestamp()` directly to timestamp and therefore depend on the session `TimeZone`. This can fail Case clock constraints outside UTC. | Draft PR #383 redefines the six functions with `AT TIME ZONE 'UTC'` and includes non-UTC proof. Merge and migrate separately after its authority gate. |
| 3 | **Confirmed, high priority; corrected in isolated candidate** | `grainline_case_staff_resolution_prepare` returns a replayable provider-pending claim before rechecking current refund/dispute/label/payment eligibility. Unlike a completed replay, this result can authorize a new Stripe refund. | Draft PR #383 performs state-specific revalidation under the locked Order and fails conflicting provider-pending replays to reconciliation. |
| 4 | **Confirmed, defense in depth; corrected in isolated candidate** | staff finalization applies the stored stock plan without a final fulfillment-state recheck. Existing pending refund locks block normal fulfillment, reducing exploitability. | Draft PR #383 rechecks the locked fulfillment state before applying a nonempty stock-restoration plan. |
| 5 | **Signature confirmed; not an actor-bypass defect** | the bounded cron function has no actor parameter, but it is a service-principal operation: targets, due times, transitions and audit identities are database-derived, while `CRON_SECRET` authenticates the HTTP scheduler. A caller cannot select a Case or accelerate a not-due row. | Record this as explicit runtime-service authority. A dedicated database cron role is future hardening, not a Case or Order activation blocker. |
| 6 | **Race confirmed; robust correction prepared** | Account deletion did not lock seller-side historical Orders before its final Case check. Locking User from Case-open would create an unnecessary User/Order lock inversion, and rejecting post-deletion buyer recourse would be the wrong product tradeoff. | Draft PR #383 locks every Order involving the target buyer or durable `Order.sellerProfileId` in canonical order, then performs a fresh Case check. It never re-derives historical ownership through mutable Listings. |
| 7 | **Narrower defect confirmed; alleged wait-snapshot race overstated** | `FOR UPDATE SKIP LOCKED` already serializes the canonical Case/dispute writers. The actual retention defect was that the prune authority did not check the trigger-maintained `paymentOpenDisputeBlocked` projection. | Draft PR #383 adds that durable predicate while preserving the existing lock discipline and retained evidence. |
| 8 | **Signatures confirmed; impact overstated** | two seller aggregate functions accept only a seller ID. Their current callers are fixed metrics/cron service paths and return counts, not Case rows. They are not self-service participant reads. | Pin all callsites and preserve purpose-specific result shapes. A dedicated service role or actor binding is hardening, not a current data-exposure blocker absent a caller-controlled route. |
| 9 | **UI defect confirmed; proposed enum rejected** | a fully refunded unfulfilled Order can still render preparing/pending copy. `CANCELLED` is not a correct fulfillment state: a delivered Order can later be refunded and must remain `DELIVERED`. | Derive and render payment/refund status separately, suppress impossible fulfillment actions/copy after a full refund, and keep logistics history intact. |
| 10 | **Confirmed durability gap** | `Order` does not persist Stripe's exact charged total. Current item-subtotal derivation already avoids the historical gift-wrap double count, so that old defect is not still present, but refund arithmetic lacks a durable charged-total witness. | Add nullable `chargedTotalCents`, write it from the signed Checkout Session, inspect/backfill legacy rows and make exact provider totals authoritative when present. |
| 11 | **Confirmed; already a tracked design** | `checkoutGroupId` is retained by reservations, not Orders. This limits future consolidated receipt/group semantics but does not break current one-Order-per-seller checkout. | Keep the existing `Durable checkout-group semantics` decision in the deferred backlog; add the column only when its product semantics and retention are defined. |
| 12 | **Outdated for the current candidate** | the current Order candidate uses durable `Order.sellerProfileId` and `OrderItem.sellerProfileId`, adds database constraints, and has tests rejecting mutable Listing ownership as participant authority. | Preserve the seller-key release gate; do not reopen the already-corrected three-path model. |
| 13a | **Product enhancement** | the UI already displays a short stable suffix rather than the full CUID, though there is no separate support-friendly order number. | Defer a unique human order-number design; not an RLS blocker. |
| 13b | **Confirmed dead schema** | `taxReversalId` and `taxReversalAmountCents` have no source writers. | Classify production values before removal; use a separate cleanup migration, not the RLS activation migration. |
| 13c | **Outdated for the current candidate** | the fixed fulfillment authority requires `SHIPPING` for shipped and `PICKUP` for ready-for-pickup; the old pickup-to-shipped route ambiguity is closed in the candidate. | Preserve PostgreSQL and application regression coverage. |
| 14 | **Confirmed observability gap** | continuous ops health has a SavedSearch RLS canary only. Acceptance postflights prove other tables at release time but do not continuously detect later posture/grant drift. | Add a sanitized aggregate posture canary covering every live RLS table. This is a launch/operations gate, but it need not be bundled into an Order migration. |
| 15 | **Confirmed guardrail gap** | no recursive static guard bans broad `SellerProfile` selection even though the model mixes public profile fields with exact ship-from/provider/private fields. Current public helpers use projections, so no active leak was found. | Add a recursive source guard and explicit allowlisted projections before SellerProfile RLS or launch. |
| 16 | **Not a defect** | the generic schema-drift follow-up test does not enumerate the Case family, but dedicated Case catalog, migration, PostgreSQL and release tests do. Centralization is not itself a security property. | No change unless the generic test is explicitly redefined as exhaustive. |
| 17 | **Confirmed process gap, closed** | these allegations previously lacked a durable current-source classification. | This record plus the Case correction record and linked backlog rows are the source of truth; future fixes must update their status and evidence. |
| 18 | **Confirmed narrow documentation drift; corrected in isolated candidate** | the historical SavedSearch section still says production builds run `prisma migrate deploy`; current runtime builds do not. The current manual-migration rule elsewhere is correct. | Draft PR #383 adds an explicit current-state override without rewriting the sealed historical rollout account or weakening the guarded Production Migrations workflow. |
| 19 | **False** | the matrix contains exactly fourteen live table rows. A raw grep counted status labels in the legend and narrative as if they were table rows. The parsed matrix test pins the exact fourteen models. | Preserve the parsed row assertion; do not change accurate prose to twenty-one. |

## Sequencing boundary

Before core `Order` Phase A:

1. finish the buyer quote correction with focused/full proof and the exact
   non-charging Shippo test-mode quote smoke;
2. complete the separate additive Case correction in draft PR #383, including
   its real PostgreSQL 16 authority and lock proofs;
3. design and ship the compatible `chargedTotalCents` witness plus fully-
   refunded UI state;
4. complete the existing label/fulfillment compatibility release, inspection,
   application smoke and predecessor drain; and
5. resume `Order` policyless Phase A, then FORCE, followed separately by
   `OrderItem` and `OrderShippingRateQuote`.

Findings 5, 6, 8, 11, 13a, 13b, 14 and 15 remain durably tracked but must not
be disguised as reasons to keep the Order program in perpetual preparation.
