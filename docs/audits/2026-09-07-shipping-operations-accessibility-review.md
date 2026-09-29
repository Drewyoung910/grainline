# Shipping, operations and accessibility follow-up — 2026-09-07

## Scope and disposition

Completed bounded source-only audit, not runtime/provider attestation or WCAG
certification. No code changes, tests executed, application/browser execution,
commits, pushes, production queries or provider operations. Implementation stays
paused until Drew explicitly resumes it; the 8 PM clock is not authorization.

Same candidate as [legal/architecture review](2026-09-07-legal-architecture-review.md):
`/private/tmp/grainline-clerk-legal-provenance-20260903`, HEAD
`bc1ff4d151572086f8d8ca6740256728e6da91e8`, preserved uncommitted work unchanged.
All source references below are relative to that candidate, not the old root.
These findings supplement [the prior runtime audit](2026-09-07-runtime-review.md).
They are product/operational/accessibility issues, not additional canonical
security findings. Prior findings are not silently closed or renumbered.

## Shipping: correctness before claiming quote reliability

### SHIP-F01 — Cart can enter payment with obsolete address/service intent

**P1; source-confirmed, not browser-reproduced.** Parent independently verified.

`src/app/cart/page.tsx:733-798` captures shippingAddress and selectedRates in its
async checkout handler. Address Change and Back controls remain usable during
creatingSession (`976-988,1059-1070`). Confirming address B clears local state
(`949-959`) but does not invalidate the pending request for A. Its late response
unconditionally installs client secrets and enters payment. Payment's Grainline
banner renders current address B (`1087-1096`).

The server correctly persists original A in Checkout metadata
(`api/cart/checkout-seller/route.ts:601-608`); webhook fulfillment prefers that
metadata (`api/stripe/webhook/route.ts:665-672`). Therefore displayed intent can
disagree with the payment/order destination. Changing the shipping service while
creation is pending has the same stale-response problem. This is not a quote-
signature bypass: the server is correctly bound to the earlier request.

Counterevidence: Buy Now already increments request generations on changes and
rolls back late sessions (`BuyNowCheckoutModal.tsx:112-145,235-280`). The existing
`tests/client-async-guardrails.test.mjs:115-141` protects that sibling, not cart.
The actual Stripe iframe presentation was not observed.

Proposed regression: defer checkout response; change/confirm address, release
response; require no transition to obsolete payment and exact late-session
rollback. Repeat for service, multiple sellers and component navigation. Later
fix should add generation invalidation/late cleanup or consistently lock all
intent-changing controls, not merely disable the Continue button.

### SHIP-F02 — Missing/blank provider amount becomes valid free shipping

**P2; coercion confirmed, provider occurrence unverified.** Parent verified.
`lib/shippingQuoteState.ts:29-36` uses Number(value), which converts null, empty
string and whitespace to zero. Complete rate normalization (`154-170`) accepts
that amount if identity/carrier/service and other filtering are valid. Quote
route signs it (`771-806`); the selector can choose it as cheapest and labels
zero Free. Signed zero is valid downstream.

Counterevidence: undefined becomes NaN and is rejected; intentional numeric/
string zero is supported. No evidence that Shippo actually sends malformed
amounts in current production. Existing tests reject negative/NaN/infinite/
extreme amounts but not null/blank (`shipping-quote-state.test.mjs:36-44`).

Proposed regression: test absent/null/blank/whitespace at scalar and full-rate
boundaries while retaining explicit legitimate zero. Reject missing data before
numeric coercion. Do not claim any historical undercharge was demonstrated.

### SHIP-F03 — Timed quote refresh can replace a buyer's chosen service

**P2; state transition confirmed, provider ID stability unmeasured.**
`ShippingRateSelector.tsx:117-134` refreshes before token expiry, preserving the
choice only when its old objectId appears. Otherwise it automatically chooses
the cheapest shippable result or pickup-only (`shippingQuoteState.ts:177-185`).
New provider identities, disappearing service or failed provider/pickup-only
response can replace an explicit expedited choice or change fulfillment mode.

Counterevidence: initial choice prefers shipping over pickup; pickup-only has a
visible warning. Do not report that particular transition as entirely undisclosed.
No request established whether Shippo routinely changes IDs between quotes.

Proposed regression: select expedited, refresh with fresh identities; require
preserved intent or confirmation. Separately test price changes, disappeared
service and shipping-to-pickup. Distinguish an initial default from replacing
an existing affirmative choice.

### SHIP-F04 — Expired selection can remain enabled during refresh

**P3 recovery friction, not acceptance of expired quotes.** At refresh start,
selector clears its own results but not parent selection (`74-79`). Continue
checks the parent value, not refresh/expiry state (`BuyNowCheckoutModal.tsx:477-479`,
`cart/page.tsx:1050-1053`). After a background tab passes expiry, a user can submit
the old selection while refresh is pending. `shipping-token.ts:140-149` correctly
rejects it. A still-valid quote may intentionally remain usable during refresh;
do not invalidate that design without deciding its semantics.

Proposed regression: suspend beyond expiry, resume with slow refresh, submit.
Require understandable direct refresh/reselection rather than a navigation loop.

### Existing shipping limitations — still open, not new discoveries

`docs/shipping-rate-secret-credential-recovery.md:200-204` already records these:

- On provider error/no usable rates, some paths use platform fallback, default
  $15 bounded to $5–$50 (`quote/route.ts:717-759,809-835`,
  `shippingQuoteState.ts:3-5,23-26`). Buyer label is Standard shipping; those
  fallback responses lack a fallback-specific warning. This is a fixed buyer
  charge, not a verified carrier quote. Economic suitability for large furniture
  is unmeasured. Seller flat/free rates remain distinct legitimate choices.
- Multi-item quotes sum weight and take maximum dimensions (`quote/route.ts:444-460`);
  quantity multiplies weight without enlarging dimensions (`564-568`). One parcel
  is submitted (`shippingQuoteProvider.ts:53-63`). This is not a packing engine.
- Checkout quote uses city/state/ZIP and a placeholder street; later label
  purchase requotes using the retained full address. Quote-only IDs prevent
  buying the placeholder-address label. Residential/remote surcharges and final
  price variance need real provider evidence.
- Legacy standalone free thresholds without configured flat rates are ignored
  deliberately. Do not reintroduce them through this audit without a policy decision.

Effective controls: signed/expiring quotes, destination/subject binding, renewed
checkout calculation, inventory/current seller/private listing/pickup checks,
PRICE_CHANGED recovery, canceled stale quote fetches, visible failure retry and
seller-specific payment sessions. These remain valuable; no "shipping is all
broken" conclusion follows. Conversely, these controls do not prove quote accuracy.

Later measure: timeout/empty/fallback frequency; placeholder-address acceptance;
rate-ID stability; buyer quote versus actual label by size/quantity/carrier/ZIP;
maker-processing time versus Stripe's carrier-days delivery estimate. Do not
create real shipments or charges under this audit authorization.

## Operational monitoring findings

### OPS-EMAIL-1 — Queue health misses claimed work and overdue failed retries

**P2; parent source-verified.** Claim sets PROCESSING and nextAttemptAt=null
(`lib/emailOutbox.ts:215-235`). `api/cron/ops-health/route.ts:86-90` requires status
PENDING/PROCESSING AND nextAttemptAt older than 30 minutes. Thus old PROCESSING
cannot match; overdue FAILED is excluded by status. With other counters zero,
the health endpoint can return healthy.

This affects transactional paths too: label finalization co-commits its email
reservation then attempts delivery outside the transaction
(`orderLabelFinalization.ts:26-57`); a process exit there need not leave a stale
email CronRun. Refund/Case finalizers also use immediate delivery.

Counterevidence: worker selection (`emailOutbox.ts:383-393`) correctly recovers
PENDING/FAILED by due time and PROCESSING by updatedAt after ten minutes. DEAD
is separately monitored; crashed cron and Sentry may produce other signals.
This is monitoring blindness, not proven permanent loss.

Proposed query-level regression fixtures: overdue PENDING, overdue FAILED,
old PROCESSING/null nextAttemptAt, recent PROCESSING, future retries/quota
deferrals and DEAD. Use state-specific predicates and verify intended HTTP status.

### OPS-EMAIL-2 — Rejected job promises disappear from failure counts

**P2; parent source-verified.** Claim and attempt-count read are before the
per-job try (`emailOutbox.ts:215-241`); FAILED-state persistence inside catch can
also reject (`346-359`). `concurrency.ts:16-20` preserves such rejections as
rejected settled results. Batch reduction (`emailOutbox.ts:400-410`) counts only
fulfilled results. Email cron records completion and HTTP 200 (`26-29`), hence
an OK check-in; partial-failure monitoring has no positive failed count to detect.

Deterministic source scenario: select one row, claim succeeds, subsequent read
fails transiently, completion write succeeds. Result is picked=1 with sent=0,
failed=0, skipped=0, capped=0. Row remains PROCESSING/null and is also missed by
OPS-EMAIL-1. Failure before claim is similarly omitted but leaves the row due.

Counterevidence: expected provider failure is counted when persistence succeeds;
initial batch selection/final CronRun-write failures reach route catch. Direct
single-job delivery propagates its rejection. Existing stale recovery remains.

Proposed regression: inject claim/read/failure-state-write rejection separately;
count every outcome, require sum(outcomes)=picked, preserve per-job isolation
and recovery, and emit sanitized failure telemetry even if persistence fails.
No failure injection was executed in this audit.

### OPS-CRON-3 — 24-hour partial-failure window is limited to 50 global runs

**P3.** `ops-health/route.ts:24,76-84` looks at the latest 50 completed non-health
runs globally inside its 24-hour filter. Existing documentation
`audit_closed.md:6157-6164` describes a 24-hour partial-failure signal. Fifty newer
healthy email runs alone displace a partial failure in about four hours ten
minutes; other jobs shorten this. Clearing can depend on unrelated traffic,
not recovery.

Counterevidence: bounded reads are intentional; evidence is not deleted, earlier
alerts may exist, and failed/stale CronRuns are monitored separately. Decide if
health means unrecovered work or incident history, then implement a bounded
aggregate/current issue model that matches. Regression: one partial failure plus
50 healthy runs inside 24 hours, including explicit resolution policy.

## Accessibility source findings

Priorities here describe product access, not exploit severity. No contrast,
zoom/reflow, touch target, accessibility tree, screen reader or iframe behavior
was measured. Fix proposals do not constitute an ADA/WCAG certificate.

### A11Y-01 — Mobile Send has no accessible action name

**P2; parent verified.** `MessageComposer.tsx:199-219` hides Send with
`hidden sm:inline` and marks the visible SVG aria-hidden. `ActionForm.tsx:6-38`
adds no fallback name. Below sm, enabled and disabled Send therefore lose their
programmatic name. Desktop text and pending Sending text exist; textarea and
attachment controls have names. Use persistent accessible text/label, then test
mobile empty/ready/uploading/pending states in the accessibility tree.

### A11Y-02 — Staff partial-refund amount lacks a meaningful field label

**P2; parent verified.** `CaseResolutionPanel.tsx:129-142` has a 0.00 placeholder
and adjacent currency span but no associated label/ARIA name. The field's
purpose and currency are not programmatically conveyed. Surrounding workflow
buttons, labeled stock fields and final browser confirmation are counterevidence,
not a substitute for the input label. Test name/currency/invalid input and final
confirmation with a screen reader after a separately authorized fix.

### A11Y-03 — Important async feedback lacks explicit announcement/focus

**P2.** Acceptance error (`AcceptTermsForm.tsx:37-40,76-80`), cart error
(`cart/page.tsx:860-864`), Buy Now error (`BuyNowCheckoutModal.tsx:373-377`),
Case reply (`CaseReplyBox.tsx:115-127,203`), resolution (`CaseResolutionPanel.tsx:192`)
and ActionForm feedback (`100-108`) use ordinary paragraphs/divs without a live
region or error-focus step. Visible failure is present, but focused users may
not promptly learn it. Exact assistive-technology behavior remains untested.

Counterevidence: OpenCaseForm and ShippingAddressForm associate alert feedback;
ShippingRateSelector has an error alert; ToastProvider has live semantics.
Adopt a consistent pattern, not assertive announcements for every minor success.
Test network, repeated identical, validation, expiry and upload failures.

### A11Y-04 — Ordinary chat does not expose author identity as text

**P2; parent verified.** `ThreadMessages.tsx:515-520,581-619` conveys ownership
through color/alignment; other avatar is decorative with empty alt. Ordinary
message content/timestamp has no You/participant name. Conversation context or
some structured cards do not label every ordinary message. Test alternating and
grouped messages/attachments with author-content-time ordering.

### A11Y-05 — Image repositioning is pointer-only

**P2; parent verified.** `ImageCropModal.tsx:49-59,148-155` updates pan on pointer
drag; only Zoom has a labeled keyboard range (`181-193`). Keyboard users cannot
perform equivalent off-center crop positioning. Dialog name, focus/Escape
helper, confirm/cancel and zoom do exist. Add a keyboard equivalent later and
verify achievable crop positions, not just that Confirm is reachable.

### Manual verification / lower-confidence items, not confirmed traps

- CaseReplyBox's placeholder may be used as fallback name; provide a stable
  associated label, but do not call it universally unnamed without a tree check.
- Checkout steps change without explicit current-step semantics or focus
  movement (`BuyNowCheckoutModal.tsx:132-140,268-271,350-368`, `cart/page.tsx:839-857`).
  Test focus after replacement/back/resume/multi-seller progression.
- Shared dialog helper implements Escape, first/last Tab wrapping and focus
  restoration, including iframes in its selector (`dialogFocus.ts:12,72-105`).
  Stripe iframe behavior and mobile background isolation were not executed;
  do not claim a reproduced keyboard trap.
- BlockReportButton opens a nonmodal body portal without focus movement
  (`64-68,160-245`); Escape returns focus (`82-93`). Test keyboard travel and
  success announcement. A nonmodal popover does not inherently require a trap.
- Incoming chat lacks log/live semantics (`ThreadMessages.tsx:344-380`). Design
  a useful non-disruptive signal while reading older history/composing; reading
  every arriving message aloud is not automatically the right solution.

Positive evidence: labeled acceptance checkboxes and quantity selects, native
shipping radios/fieldset, accessible OpenCase errors, named attachment links,
toasts and shared modal focus support. The assessment is mixed, not a blanket
claim that no accessibility work has been done.

## Coverage and handoff

Shipping worker fully read ShippingRateSelector, shipping quote route/provider/
state/token/Shippo adapter, BuyNowCheckoutModal, ShippingAddressForm,
EmbeddedCheckoutPanel and shipping quote tests. Cart/checkout routes were fully
read in preceding passes and targeted here; webhook/label/docs excerpts are not
counted as full additional reads.

Operations worker fully read ops-health/email cron, email outbox/state,
concurrency, CronRun/state/partial-results, cron monitor/state, four domain
finalizers, and email/cron state/termination tests. Accessibility was bounded
targeted coverage, not every UI component. Parent rechecked primary paths for
SHIP-F01/F02/F03, OPS-EMAIL-1/2 and A11Y-01/02/04/05. The SHIP-F prefix
distinguishes this follow-up from SHIP-01/02 in the earlier runtime record.

All findings remain open; suggestions/tests are unimplemented. Preserve these
notes outside temporary worktrees and link them into the implementation backlog
once authorized. Next implementation should prioritize obsolete-address checkout,
financial retry correctness from the earlier audit, truthful policy decisions,
and operationally recoverable outcomes before additional broad feature work.
