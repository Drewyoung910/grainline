# Listing, inventory, commissions and account audit — 2026-09-07

## Scope and preservation

This is a bounded **source-only product/runtime review**, not a new security scan,
production attestation, load test or statement that the entire repository is
audited. Implementation remains paused until Drew explicitly resumes it. The
clock passing 8 PM is not authorization to implement changes.

Reviewed candidate: `/private/tmp/grainline-clerk-legal-provenance-20260903`, branch
`agent/order-checkout-retry-clock-20260906`, HEAD
`bc1ff4d151572086f8d8ca6740256728e6da91e8`. All source paths and line references
below refer to that candidate, not the older root checkout. This document and the
audit index are durable local records under the root's `docs/audits`; neither is
committed or pushed by this pass.

Three read-only reviewers examined standard listing/inventory, commissions/custom
requests, and seller settings/discovery. The parent independently checked the
reported causal paths and reviewed account settings, shipping address entry and
the account feed. No source/test edits, executable tests, application/browser
execution, production/provider access, commits, pushes, migrations, deployments,
RLS changes or worktree cleanup were performed. Proposed regressions below have
**not** been executed.

P1 means prioritize before paid launch; P2 means a material correctness or
usability fix; P3 means lower-priority contract/presentation correction. These are
engineering priorities, not vulnerability severities or measured incident rates.
Findings remain open. Related occurrences are identified rather than counted as
independent new root causes.

Related records:

- [Runtime and financial register](2026-09-07-runtime-review.md).
- [Shipping, operations and accessibility](2026-09-07-shipping-operations-accessibility-review.md).
- [Checkout recovery, discovery and batch delivery](2026-09-07-checkout-discovery-batch-review.md).
- [Legal/product contracts and architecture](2026-09-07-legal-architecture-review.md).
- [Completed bounded security report](2026-09-07-security-artifacts/report.md), unchanged.

## Inventory and prices: prioritize before paid launch

### LISTING-F01 — Variant price drafts follow array positions, not options

**P2; source-confirmed wrong-price association.** `VariantEditor.tsx:29-31,89-94`
keeps draft prices under `groupIndex:optionIndex` and lets a draft override the
stored option price. Removing a group (`43-45`) or option (`63-69`) changes those
positions without remapping or deleting draft keys. Editing option A's adjustment
to $25, then removing A, can make the next option inherit A's adjustment.

There is also a serialization-only variant: hidden form serialization filters
incomplete groups **before** enumerating group indexes (`238-254`). A later valid
group can therefore submit a preceding group's draft, even while the valid group's
visible input still uses its original index and displays its own price.

The shared editor is persisted by standard create (`dashboard/listings/new/page.tsx:
193-211,283-301`) and edit (`dashboard/listings/[id]/edit/page.tsx:246-260,394-412`).
Buyer-side variant selection consumes those adjustments. Valid numeric bounds do
not detect a price attached to the wrong option.

Counterevidence: server validation and transactional persistence protect other
properties. This is not an arbitrary-price authorization bypass or evidence of an
observed incorrect charge. Existing draft-serialization source assertions do not
exercise removing/reindexing groups.

Proposed regression: edit, blur, remove preceding option/group, append a replacement,
and submit with an incomplete preceding group. Assert both displayed and submitted
prices by stable option identity. Keep drafts with their option or use stable keys;
do not repair this solely by formatting the hidden JSON.

### LISTING-F02 — A stale general edit form can restore already-consumed stock

**P1; source-confirmed lost-update path.** The general edit form carries the
previously rendered stock quantity (`dashboard/listings/[id]/edit/page.tsx:800-805`,
`ListingTypeFields.tsx:157-170`). Submission parses that quantity (`214-218`) and
unconditionally writes it in `tx.listing.update`, whose predicate is only the
listing ID (`365-388`). It does not identify whether the seller intended a stock
change or compare the originally displayed quantity with the current quantity.

Sequence: open a listing edit form at stock 10; a separate inventory action changes
stock to 8; save only a description change from the old form. The edit writes stock
10 again. The same stale write can overwrite stock consumed by a checkout
reservation that subsequently completed as a purchase. Reservation creation, not
the later payment itself, is the relevant decrement point.

Impact: phantom available units and oversell risk once the listing is purchasable
again. This does not prove an actual oversell occurred in production.

Counterevidence: content/variant/photo writes are transactional; the public-content
review path temporarily sets `PENDING_REVIEW`; later AI-review results use their
own freshness fence. None distinguishes this form's old inventory snapshot from
an intentional new inventory adjustment. The separate inventory endpoint's delta
handling fixes a different lost-update path and does not cover general editing.

Proposed regression: open the edit form, commit a separate stock adjustment or
complete a reservation/purchase, then save an unrelated description. Require the
newer stock to survive. Separate inventory intent from content edits, or condition
the stock change on an explicit baseline and reject/reconcile conflicts.

### LISTING-F03 — Retrying an uncertain inventory adjustment can apply it twice

**P1; source-confirmed retry gap.** `src/app/dashboard/inventory/InventoryRow.tsx:
29,36-39,53-74` submits the requested quantity plus an expected baseline. A successful
response or refreshed listing props can update that baseline, but the failed-response
path does neither. `api/listings/[id]/stock/route.ts:92-121` applies the difference between
requested and expected quantity to the current stock each time. There is no stable
adjustment identity binding a retry to the first committed result.

Sequence: baseline 5, request 10; the server commits +5 but its response is lost.
Retry the same request from the unchanged form. The endpoint adds +5 to the now-10
quantity, yielding 15. This can happen without simultaneous button clicks.

There is also a post-commit failure boundary: the stock transaction precedes the
awaited `syncGuildMemberListingThreshold` call (`stock/route.ts:208-209`). That
helper performs another database write (`guildListingThreshold.ts:3-18`); a thrown
error reaches the route's failure response (`354-359`) after stock already changed.
The user can therefore be told the operation failed even though its effect committed.

Counterevidence: button/ref guards serialize ordinary clicks; successful responses
update the local baseline; deltas intentionally preserve unrelated concurrent
changes. Replacing this with unconditional absolute stock assignment would bring
back a different bug. No real network failure or database exception was induced.

Proposed regression: lose the response after commit, then retry the exact operation;
also fail the post-commit guild update. Require one adjustment and a recoverable
committed result. Use a stable mutation identity, distinguish commit outcome from
ancillary work, and preserve legitimate independent adjustments.

### LISTING-F04 — Sold-out listings cannot save ordinary content edits at zero

**P2; source-confirmed validation mismatch.** `listingEditState.ts:11-32` permits
`SOLD_OUT` editing and the inventory UI links to Edit. Shared stock input enforces
`min="1"` (`ListingTypeFields.tsx:157-170`); the edit action normalizes zero to null
(`edit/page.tsx:214-218`) and rejects it (`270-271`). An in-stock listing sold out
at zero cannot save a title/description correction without entering positive stock
or changing listing type.

Counterevidence: requiring positive stock for a newly published in-stock listing is
reasonable. The defect is reusing that rule for content edits to an existing
sold-out listing. Existing edit-state tests establish that the status is editable,
not that a zero-stock form submission works.

Proposed regression: edit content on a zero-stock `SOLD_OUT` listing, preserve zero
and sold-out status; separately validate explicit restocking and new publication.

## Commissions and custom requests: preserve the selected lifecycle context

### COMMISSION-F01 — Closing or fulfilling a request makes its offered detail link fail

**P2; source-confirmed.** `api/commission/[id]/route.ts:175-178` commits the terminal
status. `commission/[param]/MarkStatusButtons.tsx:15-25` then refreshes the same
detail URL. Both detail metadata (`page.tsx:90-103`) and the body (`375-430`) require
the open/unexpired request predicate. Owner recognition occurs afterward (`440`),
too late to provide an owner's historical view. The predicate is defined in
`commissionState.ts:3-8`; natural expiry alone also makes the lookup fail.

My Commissions selects all statuses and supplies unconditional detail links
(`account/commissions/page.tsx:38-49,111,131-135`). Fulfillment notifications link
to the same unavailable detail page (`api/commission/[id]/route.ts:195-199`).
The detail's terminal-status banner (`476-479`) is unreachable under that lookup.

Counterevidence: removing terminal requests from public discovery is intentional
and tested. Closing a request does not delete its record or demonstrate a payment
loss. The inconsistency is offering history/completion links that cannot resolve;
the account card only preserves a truncated description in its UI.

Proposed regression: owner closes, fulfills with an interested maker, or revisits
an expired request before cron; follow the account and fulfilled-notification
links. Choose a read-only historical destination or an honest redirect/link change
without simply broadening public discovery.

### COMMISSION-F02 — An older request card opens the newest request's context

**P2; source-confirmed.** Each `ThreadMessages.tsx:428-452` card displays its own
description/dimensions/budget/timeline, but its Create Custom Listing link supplies
only conversation and buyer IDs (`455-461`), not the selected message ID.
`dashboard/listings/custom/page.tsx:281-308` explicitly retrieves the latest request
from that buyer and renders it as **Buyer's Request** (`341-365`).

`conversationMessageAuthority.ts:838-873` calls the latest-request lookup; the
corresponding query in `20260726022500_prepare_conversation_message_authority/
migration.sql:515-528` sorts newest-first and returns one. The reviewer found no
later replacement definition changing that selection.

Sequence: buyer sends different projects A then B in one conversation; seller
clicks Create Custom Listing inside A. The form presents B's requirements. A newer
request arriving while the thread is open creates the same mismatch.

Counterevidence: the behavior is explicit in source and may suit a generic
conversation-level action. The misleading context arises because the action is
inside a particular request card. Title, description and price remain seller-entered;
this is not automatic repricing or an automatic charge.

Proposed regression: two distinguishable requests, create from each card and assert
the selected request's context. Carry and validate selected-request identity, or
make a deliberately latest-only action unambiguous and conversation-level.

### COMMISSION-F03 — Invalid custom processing ranges reach the database check

**P2; source-confirmed validation gap, database outcome conditional on the checked-in
constraint being installed.** Shared inputs allow positive numbers but provide no
maximum or cross-field ordering rule (`ListingTypeFields.tsx:119-147`). Custom
creation parses positive minimum/maximum days and sends them to the transactional
create without validating minimum <= maximum or the 365-day ceiling
(`dashboard/listings/custom/page.tsx:161-187`).

`20260523223000_schema_numeric_guards_and_indexes/migration.sql:102-110` requires
each supplied processing value to be 1-365 and minimum <= maximum. Ordinary listing
creation already returns actionable errors for the latter conditions
(`dashboard/listings/new/page.tsx:228-237`). The custom action does not convert
the thrown create failure to the returned error consumed by `ActionForm.tsx:104-107`.

Sequence: otherwise valid custom made-to-order listing with min 10/max 5, or a
400-day processing value. HTML accepts it; the database check rejects the create.
The transaction prevents a partially created listing. Actual error-boundary
presentation and preservation of entered form data remain untested.

Proposed regression: invalid order and >365 return specific errors with no write;
valid boundaries work. Reuse a shared server validation contract across ordinary
create, edit and custom create instead of relying on the database exception as UX.

## Seller settings and discovery

### SELLER-F01 — Inactive featured listings occupy slots the editor cannot release

**P2; source-confirmed.** Profile toggling counts all stored featured IDs against
the six-slot limit (`dashboard/profile/page.tsx:329-344`). The editor loads and
renders only ACTIVE listings (`373-377,789-837`) and disables new selections when
the stored set is full (`828`). Hide/mark-sold actions change availability without
removing featured IDs (`src/app/seller/[id]/shop/actions.ts:129-143,157-177`).

Feature six listings, then hide or mark all six sold. A new active listing cannot be
featured; the inactive selected items are absent, so their Unfeature controls are
also absent. Partial stale selections similarly reduce usable capacity.

Counterevidence: public rendering filters unavailable listings; this is not a leak
of hidden listings. Reactivating an old listing can expose Unfeature again, and
public fallback content can avoid an empty profile. Neither is a sensible way to
manage a persisted selection. The serializable six-slot cap itself is useful.

Proposed regression: hide/sell selected items, then remove/replace them without
reactivation. Render selected inactive items as removable or explicitly reconcile
selection lifecycle. Keep the existing concurrency-safe cap.

### SELLER-F02 — Six featured selections are promised, only three are displayed

**P3; source-confirmed product mismatch.** The editor promises up to six featured
items (`dashboard/profile/page.tsx:42,783-785`). Public selection preserves that
ordered set (`seller/[id]/page.tsx:319-323`), but the >=3 render branch destructures
only hero, second and third and returns (`664-692`). Selections four through six
never appear in Featured Work.

Counterevidence: those listings can still appear in the shop's general inventory;
records are not deleted. A three-item editorial layout can be intentional, but
then the seller-facing selection limit/promise must agree.

Proposed regression: select 1-6 eligible items and assert the intended display and
order. Decide three versus six before adjusting the UI; do not create a new gallery
system solely for this discrepancy.

### SELLER-F03 — A map fallback becomes a persisted Austin location

**P2; source-confirmed default-versus-intent mix-up.** New seller coordinates can
be null (`ensureSeller.ts:51-59`, schema SellerProfile coordinates). The map starts
at Austin when values are null (`LocationPicker.tsx:20-25`) and always submits that
position in hidden fields (`220-223`), even if the seller never touches the map.

Saving an unrelated shipping setting parses and persists those coordinates
(`dashboard/seller/page.tsx:72-74,127-134`) and can assign their metro (`161-167`).
The maker directory filters by that metro (`makers/[metroSlug]/page.tsx:99-103`).
An otherwise publicly eligible shop can consequently enter the wrong city directory;
pickup location presentation can also be wrong when pickup is enabled.

Counterevidence: the fallback pin is visible in the editor; explicitly choosing the
real location avoids the problem. Ship-from postal fields are separate and this
does not bypass public-map opt-in. Directory impact also requires successful metro
assignment and the shop's ordinary visibility conditions.

Proposed regression: null coordinates, save only shipping preferences, require
coordinates to stay unset. Separate a display viewport from an explicitly chosen
location, and test the map-unavailable path as well as a deliberate selection.

### SELLER-F04 — Out-of-range shipping money silently clears the saved setting

**P3; source-confirmed.** Flat shipping and free-shipping-threshold inputs accept a
decimal amount without an HTML ceiling (`dashboard/seller/page.tsx:348-371`). The
action parses both with a $5,000 maximum (`30,78-83`); `money.ts:58-93` returns null
for both blank input and invalid/out-of-range input. The action persists null
(`127-139`) and returns success (`178`) without distinguishing the two.

An entered $10,000 free-shipping threshold can therefore clear the old threshold
instead of displaying a validation error. `shippingQuoteState.ts:74-104` interprets
null as absent configuration; the flat-rate effect also depends on the other
shipping-mode settings.

Counterevidence: integer-cent parsing is sound; a ceiling is reasonable; intentional
blank input may clear an optional setting. The defect is silently treating a
nonblank invalid value as that intent. Existing orders are not repriced by saving
this form.

Proposed regression: blank, zero, $5,000 and $5,000.01. Invalid nonblank values must
preserve the old configuration and return a field error rather than success.

### DISC-F06 extension — City maker directories stop at 24 without continuation

**P2; another occurrence of the previously recorded discovery truncation class.**
`makers/[metroSlug]/page.tsx:106-109` takes the first 24 eligible makers ordered by
profile views/id. It separately counts all eligible makers (`136`) and displays
that full count (`211-214`), while rendering only the first page (`229-279`). There
is no page/cursor continuation; the ending links lead to listing browse or an
opt-in map, not the remainder of this same maker directory (`300-312`).

Counterevidence: the query is bounded and deterministically ordered; alternative
discovery surfaces exist. This is incomplete directory navigation, not evidence
that a 25th shop is absent from the database or all search results.

Proposed regression: 25+ eligible makers in one city, including tie scores. Either
provide complete bounded continuation or explicitly present a curated subset with
an honest route to all makers. Group with prior DISC-F06, not a separate rewrite.

## Account, accessibility and checkout navigation

### FEED-F01 — A visible pagination sentinel can automatically retry failures forever

**P2; source-confirmed retry control gap; browser cadence not measured.**
`account/feed/FeedClient.tsx:25-52` leaves `hasMore` true on failure, then clears
loading. Its IntersectionObserver is recreated when loading changes and calls
loadMore whenever the sentinel intersects (`68-81`). It does not stop on error,
apply backoff, or honor retry timing. The error UI and sentinel coexist (`118-142`).

With the sentinel still visible after a failed initial/pagination request, observing
it again can start another request; failure repeats the cycle. The explicit Retry
button does not make retries manual because the observer independently triggers.
The feed limiter is 120 requests per ten minutes (`ratelimit.ts:127-132`); HTTP 429
is treated like any other failure, so it does not itself stop client retries.

Counterevidence: abort, mounted and request-generation guards suppress stale
responses; `hasMore=false` or a nonvisible sentinel stops fetching. This is not a
claim of measured server saturation, concurrent duplicate requests, or abuse.

Proposed regression: a visible sentinel with network failure, 503 and 429; assert
bounded automatic attempts and effective manual retry/backoff. Preserve the useful
stale-response guards and successful-page continuation.

### ACCOUNT-F01 — Preference switches have state but no accessible name

**P2; source-confirmed markup issue; assistive-technology behavior not exercised.**
`NotificationToggle.tsx:46-61` renders `role="switch"` and `aria-checked`, but its
only child is an empty decorative span. No text, aria-label, aria-labelledby or
associated label supplies a name. Settings rows put labels in sibling paragraphs
without connecting them (`account/settings/page.tsx:50-69`).

Users navigating switches by their accessible names cannot distinguish which
notification/email preference each controls. This is separate from the previously
recorded default-preference mismatch (`PREF-01`).

Counterevidence: the buttons are keyboard-operable, expose checked state and show
save failures. This is not a blanket accessibility or legal-compliance verdict.
Proposed regression: each rendered switch has a unique descriptive accessible name
and appropriate state; confirm with a real screen-reader pass when execution resumes.

### SHIP-F01 extension — A late address save can undo the buyer's Back navigation

**P2; another checkout stale-response occurrence.** Shipping address submission
captures the address, awaits saving it, then calls onConfirm
(`ShippingAddressForm.tsx:73-111`). While waiting, Back remains enabled (`276-283`)
and unmounts the form by returning the cart to review (`cart/page.tsx:943-948`).
The pending callback has no navigation-generation/unmounted guard; a later success
still invokes the parent's callback and advances to shipping (`949-957`).

Sequence: slow successful address save; buyer presses Back; response arrives and
unexpectedly returns them to shipping. Editing the fields during save can likewise
confirm the earlier captured address, rather than the current draft.

Counterevidence: only the address form unmounts; a fully unmounted parent has
different behavior. Saving errors block progression and give an explicit error.
The next step displays the confirmed address; this sequence alone does not create
a charge or demonstrate shipment to an undisclosed address. Existing load-abort
protection covers saved-address GET, not this pending PUT callback.

Proposed regression: delay PUT, press Back, resolve PUT; remain on review. Also test
field changes during submit. Scope async results to the current navigation/draft
generation or explicitly lock the affected interactions. Include with SHIP-F01's
shipping quote selection tests rather than treating it as an unrelated subsystem.

## Decisions and capacity observations, not additional confirmed incidents

- **ADDRESS-N01 — Geographic coverage:** `usStates.ts` contains the 50 states but
  not DC; normalization returns empty for DC/District of Columbia. Shipping address
  validation and selection require this set (`ShippingAddressForm.tsx:63-69`),
  while the saved-address API also has a separate restricted state-code set.
  Checkout seller validation uses the normalizer. A DC address cannot proceed
  through these paths. Decide and document supported destinations, including DC
  and separately territories, then make UI/API/quote rules consistent. No explicit
  DC exclusion policy was found in the bounded search; that is not a claim of a
  legal duty to ship everywhere. No real customer's address was inspected.
- **SELLER-CAP01 — Feature selector fetches every active listing:** the profile
  editor query (`dashboard/profile/page.tsx:373-377`) has no page limit and renders
  every returned item/photo (`792-837`) to choose six. Prefer a bounded searchable
  selector when implementing the related featured-listing corrections. Measure
  large-shop query/response/DOM cost; total registered users is not that workload.
- **FEED-CAP01 — Follow window and accumulated DOM:** the feed query bounds its
  followed-seller source set to the latest 1,000 (`api/account/feed/route.ts:23,74-80`),
  and the client appends all fetched
  cards without windowing (`FeedClient.tsx:40,135-138`). Define behavior for very
  large follow lists and long browsing sessions. These are source-observed limits,
  not a measured failure at 50,000 users. The first-page 90-day rule and broader
  older-page retrieval are explicit design, not reported as an accidental time bug.
- **CUSTOM-N01 — Ready-link failure recovery needs more work:** custom listing
  activation precedes an awaited ready-link send (`custom/page.tsx:251-275`).
  `customOrderReadyLink.ts:54-67` recognizes post-commit notification failure and
  supports replay for an existing listing. The reviewer did not complete seller
  resubmission/recovery tracing, so this is a follow-up, not a new confirmed lost
  message or duplicate-listing finding. Check before implementing any new retry.

## Architecture assessment and implementation sequence

This packet does not justify abandoning the modular monolith or rewriting every
table. Useful foundations are present: transactional listing/variant updates,
explicit lifecycle states, bounded directory reads, serializable featured-slot
updates, numeric database constraints, and async stale-response guards.

The recurring product defects arise where those foundations are combined:
**inventory intent versus an old form snapshot; one committed mutation versus its
retry; stable option/request identity versus an array index or latest query;
public discovery state versus owner history; optional input versus invalid input.**
RLS can correctly authorize all these operations while their product semantics are
still wrong. These require behavior/invariant tests, not only source-text assertions.

On explicit implementation resume:

1. Keep the prior security/financial/checkout recovery blockers first. Add
   LISTING-F02/F03 to the pre-paid-launch inventory package and LISTING-F01 to
   pricing correctness. Test interleavings and response loss before asserting them
   fixed. Do not solve the retry bug by reintroducing absolute stock overwrites.
2. Combine address/navigation fixes with the existing SHIP-F01 quote-identity work.
   Still require representative shipping-provider and end-to-end runtime checks;
   source review alone does not certify Shippo quote reliability.
3. Correct custom creation/request identity and terminal commission navigation in
   bounded product changes, preserving their existing public visibility contracts.
4. Address seller configuration, featured lifecycle, accessible preference labels
   and feed retry/backoff. Group repeated discovery truncation fixes together.
5. Before scale claims, measure concurrent checkout conflicts, retry recovery,
   long feed/thread sessions, large seller catalogs, directory completeness and
   worker backlog recovery. Set workload/SLO targets; do not infer enterprise
   readiness from table count, tests counted, or registered-user totals alone.

The prior legal/counsel decisions remain open. This packet adds no legal assurance
and does not close the prior security finding or change any production RLS state.
Preserve the paused Order release work and its exact evidence; do not turn these
audit notes into a reason to replay old production operations or reconcile the
dirty root worktree during the audit.

## Coverage and remaining work

Complete reads by the assigned reviewers in this packet:

- Standard listing new/edit pages; ListingTypeVariantSection, ListingTypeFields,
  VariantEditor, ListingPurchasePanel, VariantSelector, ActionForm; listingVariants,
  listingEditState, stockMutationState, guildListingThreshold; inventory page/row
  and stock route; listing-edit-state, guild-listing-edit-followups and
  stock-mutation-state tests. Checkout source-snapshot SQL and historic stock
  corrections were checked where relevant, not counted as a new full SQL audit.
- Commission state/expiry helpers, collection/detail/interest API routes, status
  buttons, My Commissions and interest button; custom-request API/access helper,
  ThreadCustomOrderButton, custom listing page, shared fields/ActionForm,
  customOrderReadyLink; commission-state and custom-order-admin-thread-followups
  tests. Commission detail, request-card rendering, latest-request helper/SQL and
  numeric constraint were targeted function/section reads, not entire-file SQL scans.
- Seller profile/settings/public profile and city-maker pages; VacationModeForm,
  vacation API, SellerLocationSection, SellerShipFromAddressFields, LocationPicker,
  ActionForm, LocalDate, ensureSeller, money, shippingQuoteState, sellerVisibility,
  listingVisibility, searchCache, footerMetros, geo-metro; seller-page-performance
  tests. Parent separately checked the mutation, selection and rendering paths
  supporting each promoted finding.
- Parent: account settings/home/following/saved-searches pages, NotificationToggle,
  FollowButton, ShippingAddressForm and saved-address API, usStates,
  AddressAutocomplete/addressAutocompleteState, FeedClient/feed API/accountFeedCursor;
  independent listing/stock/variant, commission, seller and cart sections cited above.
  Existing client-async tests were checked selectively, not fully executed or claimed
  as new coverage.

Counterevidence retained: terminal commissions are intentionally removed from
discovery; fulfillment requires at least one interested maker; standard listing
validation catches processing ranges; public featured rows exclude unavailable
items; vacation date-only input has explicit validation/UTC handling; general shop
listing previews have an actual all-listings route. Missing maker-assignment or
commission acceptance/payment features were not called bugs in a documented lead
board. Previously documented private sold-out custom visibility, ignored category,
upload/composer, preference defaults and expiry-backlog issues were not rediscovered
as new findings.

Outstanding: browser/assistive-technology reproductions; mutation fault injection
and concurrency tests; complete seller notification recovery trace; representative
shipping quotes; measured scale/SLOs; remaining product surfaces; prior legal and
security dispositions. No percentage-complete or all-files-read claim is made.

Preservation: candidate HEAD and the existing four tracked modified paths plus
three untracked Order input-correction proof/doc/test paths were unchanged at the
start/end source status checks. No audit conclusion claims that unknown work from
earlier crashes was recovered; this pass preserved the currently observed work.
