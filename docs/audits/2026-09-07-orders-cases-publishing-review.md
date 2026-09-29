# Orders, Case workflows and publishing audit — 2026-09-07

## Scope and status

Drew requested another parallel reviewer wave. Three reviewers examined seller
order workflows/exports, participant Case workflows, and blog publishing/reader
interactions. The parent independently checked the promoted causal paths and
reviewed onboarding, saved collections, block management and My Reviews.

This remains an **ordinary source-only product/runtime audit**, not a new security
scan, legal opinion, production attestation or capacity benchmark. Implementation
is paused until Drew explicitly resumes it; the previously mentioned 8 PM time
does not itself authorize coding. No application/test edits, executable tests,
app/browser execution, network/provider/database operations, commits, pushes,
merges, deployments, migrations, RLS changes or worktree cleanup were performed.
Only this audit record and its index were written.

Candidate: `/private/tmp/grainline-clerk-legal-provenance-20260903`, branch
`agent/order-checkout-retry-clock-20260906`, HEAD
`bc1ff4d151572086f8d8ca6740256728e6da91e8`. Source references below are relative to
that candidate. Short component/helper names refer to `src/components`/`src/lib`;
app paths refer to `src/app`. This is **not** the older root's source snapshot.
The records are saved under the durable root `docs/audits`, locally and unpushed.

All findings remain open. P2/P3 describe engineering priorities, not vulnerability
severity or observed incident rates. Reproduction sequences and tests are proposed
from source, not executed. Latest checked-in SQL definitions were resolved where
needed; their installation in production was not queried.

Related records:

- [Runtime/financial register](2026-09-07-runtime-review.md).
- [Shipping/operations/accessibility](2026-09-07-shipping-operations-accessibility-review.md).
- [Checkout recovery/discovery/batch delivery](2026-09-07-checkout-discovery-batch-review.md).
- [Inventory/prices/commissions/settings](2026-09-07-listing-inventory-settings-review.md).
- [Legal/product promises and architecture](2026-09-07-legal-architecture-review.md).
- [Completed bounded security report](2026-09-07-security-artifacts/report.md), unchanged.

## Case functionality: align offered actions with effective transitions

### CASE-04 — Early receipt exposes an Open Case form that the operation rejects

**P2; high source confidence.** For a paid shipping order with an active seller,
no review-needed override and estimated delivery still in the future, buyer
confirmation can transition SHIPPED to DELIVERED and set `deliveredAt` without
changing the estimate (`20260901130000_prepare_order_fulfillment_authority/
migration.sql:267-296`).

Buyer detail considers DELIVERED/PICKED_UP immediately eligible for the delivery
prerequisite (`dashboard/orders/[id]/page.tsx:175-186`) and shows OpenCaseForm
(`630-632`). That form calls the ordinary Case API (`OpenCaseForm.tsx:44-56`,
`api/cases/route.ts:126-133`). However, the latest checked-in `grainline_case_open`
still rejects a future estimate without a completed-delivery exception
(`20260729051000_prepare_case_open_authority/migration.sql:412-418`). Its separate
closing-window calculation uses actual receipt when available (`421-439`).

Sequence: receive and confirm an order early, discover damage or the wrong item,
submit the offered complaint form. The operation rejects it until the estimate
passes, subject to the remaining deadline/eligibility checks. SQLSTATE 23514 maps
to a generic refresh/retry conflict (`api/cases/route.ts:57-68`); refreshing cannot
change this condition.

Counterevidence: unavailable-seller and review-needed exceptions bypass this
particular SQL restriction. The source does not demonstrate an incorrect refund
or actual financial loss. This is related to LEG-03's policy/deadline mismatch but
adds a concrete offered-action failure, not another independent legal conclusion.

Proposed regression: estimate tomorrow, confirm receipt today, immediately open
DAMAGED/WRONG_ITEM. Cover shipping/pickup, absent/past/future estimates and seller
availability. Choose one explicit opening policy and share it between presentation
and mutation, while retaining the separately justified closing deadline.

### CASE-05 — Suspension removes pending-close objection and recommended escalation

**P2; high source confidence.** Start IN_DISCUSSION; the seller marks resolved,
creating PENDING_CLOSE before the buyer agrees; the seller is then suspended.
The buyer's reply area is replaced by the unavailable-recipient message
(`dashboard/orders/[id]/page.tsx:585-594`). That message instructs the buyer to
escalate (`caseMessagingState.ts:71-78`), but `caseEscalationAvailable` rejects
PENDING_CLOSE before considering unavailable-counterparty relief
(`caseActionState.ts:2,12-21`). The button is consequently absent (`598-613`).

This is not only a hidden UI action: the message API rejects unavailable recipients
(`api/cases/[id]/messages/route.ts:181-196`), as does the latest reply implementation
(`20260801175000_retire_direct_upload_compatibility_key/migration.sql:379-401`).
The effective escalation function also excludes PENDING_CLOSE before considering
the availability exception (`20260729060000_prepare_case_escalation_cron_authority/
migration.sql:281-317`). Normal reopening through participant reply is therefore
unavailable in this combination. Seller-facing flow mirrors the issue.

The fallback matters: the pending-close cron selects Cases older than seven days
since `updatedAt` (`same July escalation/cron migration:463-487`) and resolves them
as DISMISSED (`557-598`). It skips locks/refund/resolution claims (`522-555`), but
does not special-case suspension or the Order's review-needed flag. The checked-in
schedule is daily at 08:10 UTC; bounded batches and actual worker operation mean
this is not an exact guaranteed dismissal time.

Counterevidence: staff can intervene while the Case is active. Admin detail exposes
the resolution panel for pending-close Cases (`admin/cases/[id]/page.tsx:131-132,
311-323`), and latest staff preparation rejects terminal states rather than
PENDING_CLOSE (`20260901160000_correct_case_order_invariants/migration.sql:1065-1072`).
Ban handling can flag eligible Orders for review but does not itself transition
the Case. The finding is blocked participant self-service objection and possible
automatic dismissal, **not** permanently stuck funds or absence of all support.

Proposed regression: pending close, suspend the resolving party, then let the
other party object before cutoff. Require a usable objection/staff-review route,
appropriate resolution-mark handling, and intentional cron behavior after an
attempted objection. Mirror buyer suspension and test staff intervention/refund
claim skips separately. Do not blindly remove unavailable-recipient safeguards.

Definition resolution: `grainline_case_open` remains the July 29 051000 definition;
escalation/cron remain July 29 060000; message preflight remains July 29 053000;
reply is superseded by August 1 175000; staff resolution has the September 1 160000
correction. The reviewer searched replacement definitions, not just the original
migration. These statements concern candidate source, not live catalog reads.

## Seller order operations and financial export completeness

### ORDER-F01 — A successful note request clears text typed while it was pending

**P2; source-confirmed draft loss.** `SellerNotesForm.tsx:18-45` captures note A.
Its successful completion unconditionally clears the draft (`54-56`); Clear does
the same (`81-83`). The textarea remains editable during either request
(`100-111`), although the action buttons are disabled.

Submit A, type B while waiting, then receive success: B disappears without ever
being submitted. Typing while Clear is pending has the same outcome. Failed
requests preserve text and submitted A can be safely stored; the defect concerns
the later draft, not a lost committed note. This is the same async-draft family
as the earlier message composer issue, in a distinct seller workflow.

Proposed regression: delayed Add/Clear, subsequent typing, success/failure. Clear
only the submitted draft generation or explicitly disable editing; clearing stored
notes must not silently clear a newer draft.

### ORDER-F02 — Adding a note from an older tab replaces intervening notes

**P2; source-confirmed stale-intent write.** `SellerNotesForm.tsx:12,31-45` appends
to its locally held note string and submits the entire replacement. The fulfillment
route passes it without a version (`api/orders/[id]/fulfillment/route.ts:160-168`).
The authority locks the Order and then assigns `sellerNotes = p_seller_notes`
(`20260901130000_prepare_order_fulfillment_authority/migration.sql:387-406`).

Two tabs load N. A adds X successfully. B then adds Y using its older N, replacing
N+X with N+Y. Both report success. Row locking serializes the writes but does not
recognize that the second replacement represents stale intent.

Counterevidence: these are mutable private scratch notes, not necessarily immutable
Case evidence. This is a lost update, not an assertion that notes must become an
append-only legal record. Proposed fix: atomic append with operation identity, or
version-checked replacement and a conflict UI retaining the draft. Test sequential
stale-tab adds, simultaneous adds and Clear racing Add.

### ORDER-F03 — Seller account export omits historical gift-wrapping charges

**P2; financial reporting completeness, not incorrect charging.** Seller detail
shows wrapping and the inclusive Order total (`dashboard/sales/[orderId]/page.tsx:
547-555`). The seller export contains item subtotal, shipping and tax, but no
historical wrapping amount or charged total
(`20260901030000_prepare_order_participant_export_authority/migration.sql:194-229`, strict `SELLER_KEYS` in
`orderParticipantExportState.ts:30-36`).

The account route uses that projection (`api/account/export/route.ts:225-228`) and
adds payment history (`499-509`), but that history consists of refunds rather than
original charge totals (`orderPaymentEventReadState.ts:9-18`). For an ordinary
unrefunded sale with $100 items, $10 shipping, $8 tax and $5 wrapping, the exported
Order components sum to $118 instead of its $123 total. Current seller/listing
configuration is not a reliable reconstruction of the historical wrapping charge.

Counterevidence: buyer export includes wrapping; the seller detail UI is not shown
to miscalculate it. This is the account JSON download, not a claimed dedicated
accounting/CSV product or a tax-compliance determination. Nevertheless,
`docs/order-participant-export-authority.md:18-24` explicitly describes both
projections as exposing transaction totals.

Proposed regression: wrapped/unwrapped sales, compare buyer/seller exports with
historical Order totals after current wrapping prices change. Include the appropriate
non-PII historical amount/charged-total contract and reviewed legacy fallback;
preserve existing export privacy exclusions.

### ORDER-F04 — Manual fulfillment errors navigate to raw JSON

**P3; source-confirmed response/UX mismatch.** The manual tracking form is a native
POST form (`dashboard/sales/[orderId]/page.tsx:720-750`). Its tracking field is
required but has no equivalent format constraint. Select UPS, enter `1234`, and
submit: HTML-required validation passes; the server rejects the tracking format
with JSON (`api/orders/[id]/fulfillment/route.ts:186-187`). Only success redirects
back to the Order (`203-205`). State conflicts/rate limits have the same response
presentation problem for native navigation.

Counterevidence: rejection is correct and the valid no-JavaScript path uses a 303
redirect. Browser Back may preserve inputs; permanent input loss was not established.
Proposed regression: invalid tracking, stale state, 429 and 500 remain a usable
form/error/retry flow; preserve the successful no-JavaScript path. Use form-aware
errors or an enhanced client form, not weaker validation.

### ORDER-F05 — Sales page 1,000 throws when history exceeds 25,000 Orders

**P2 at the stated scale; source-derived, no production population measured.**
Sales uses 25 rows/page (`dashboard/sales/page.tsx:34`) and computes uncapped total
pages (`128-137`). A seller with at least 25,001 Orders can reach valid page 1,000;
while rendering it, the page builds a Next cursor for page 1,001 (`157-163`).
`orderHistoryCursor.ts:5,16-27` rejects that page number by throwing, so page 1,000
fails before it renders its own rows.

Counterevidence: the actual query is bounded/keyset-based; smaller histories do not
hit this condition. Unit tests intentionally reject page 1,001 but do not exercise
the consumer boundary. This is related to the prior presentation-pagination ceiling
class but fails the valid boundary page rather than merely hiding later results.

Proposed regression: 25,000 versus 25,001 Orders, valid page 1,000, Previous/Next.
Remove unnecessary presentation-page dependence from keyset traversal or implement
an explicit history window without throwing. The threshold is per seller, not
total platform registrations.

## Blog publishing and reader interactions

### BLOG-F01 — The edit check does not protect an older open editor

**P2; source-confirmed, and a correction to a historical closure claim.** Initial
editor loading omits `updatedAt` (`dashboard/blog/[id]/edit/page.tsx:38-46`); the
form carries no editor-load version (`BlogPostForm.tsx:27-39,231-242`). Save reads
the current row/version when submitted (`edit/page.tsx:68-79`) and uses that newly
read version in its update predicate (`159-180`).

Open published post in A and B. Save new content in A or archive through the
dashboard. Then save B's older content/status PUBLISHED. If no intervening change
occurs during B's submission, B overwrites the newer content or republishes the
archived post. The source does not detect the stale editor snapshot.

Counterevidence: the existing comparison detects changes between the submission-time
read and write. Normal publish checks still run; first-publication timestamps are
retained and republishing does not repeat first-publication follower fanout.

`audit_closed.md:2853-2860` claims stale tabs cannot overwrite newer status
transitions. Current code supports only the narrower in-flight protection;
`tests/blog-action-guardrails.test.mjs:89-97` asserts that predicate rather than a
two-tab lifecycle. Preserve the historical record, but carry this correction/open
finding forward when reconciling the active audit ledger. No historical ledger
was edited or unrelated closure invalidated during this pass.

Proposed regression: two sequential stale-tab saves and archive-then-stale-save
must retain the newer row and return a recoverable conflict without discarding
the draft. Carry an editor-load revision into the mutation. Revision history is
a possible recovery improvement, not a prerequisite microservice redesign.

### BLOG-F02 — Successful save silently drops the end of an over-limit post

**P2, conditional data loss.** Body editing offers no limit/counter/over-limit
warning (`BlogPostForm.tsx:134-150`). `MarkdownToolbar.tsx:56-78,100-101` propagates
and submits the complete Markdown. Both create (`dashboard/blog/new/page.tsx:60-61`)
and edit (`dashboard/blog/[id]/edit/page.tsx:84-85`) truncate it to
`BLOG_BODY_MAX_CHARS = 50_000` (`blog.ts:10`) before validation/persistence.
`sanitize.ts:38-42` discards the suffix without an indicator. Success redirects
away from the complete editor draft.

Sequence: paste a legitimate post exceeding 50,000 sanitized Markdown characters,
save draft or publish, reopen. Its ending is absent; Markdown constructs can also
be cut. Counterevidence: the cap itself is intentional, documented and reasonable;
shorter posts are unaffected. This is silent truncation rather than an argument
for unlimited bodies.

Proposed regression: below/at/above limit with a distinctive final paragraph.
Reject over-limit writes with clear feedback and preserve the complete draft;
show a shared editor limit instead of silently treating the prefix as success.

### BLOG-F03 — Unsave can report success while keeping an unavailable post's bookmark

**P3; source-confirmed.** The save route resolves the post through public visibility
(`api/blog/[slug]/save/route.ts:17-19`). DELETE returns `saved:false` before deletion
if the post is unavailable (`109-112`); `SaveBlogButton.tsx:21-30` trusts the success
response. The own-bookmark deletion helper is never reached in that case.

Save a public post and leave the page open; author archives it or vacations; click
Remove from saved; author restores visibility; reload. The bookmark returns because
its durable relation was never removed. The Saved page omits unavailable posts in
the interim (`account/saved/page.tsx:52-59,158-165`).

Counterevidence: ordinary unsave of a still-public post deletes correctly. This is
not exposure of archived content. Resolve the user's own saved relation independently
of current publication eligibility, preserving appropriate non-disclosing behavior.
Test unavailable -> unsave -> public again, not only the ordinary public delete.

### BLOG-F04 — Reply notifications point to nonexistent comment anchors

**P3; source-confirmed navigation defect.** Approved reply notifications use
`#comment-<replyId>` (`admin/blog/page.tsx:65-82`; retained by canonical notification
construction in `20260901120000_prepare_order_receipt_notification_authority/
migration.sql:259-270`). Blog detail adds IDs to top-level comments
(`blog/[slug]/page.tsx:474`), but level-two/three reply containers have React keys
and no matching DOM IDs (`BlogReplyToggle.tsx:57,101`).

One top-level comment and one reply suffice: follow the reply notification and the
article opens without jumping to the reply. Counterevidence: the reply can be
rendered; top-level anchors work. This is independent of previously recorded
discussion limits. Add canonical IDs to rendered replies and test fragments at
all three levels; separately handle replies outside the loaded discussion window.

### Smaller blog contracts and capacity decisions

- **BLOG-N01, P3:** New Post offers Archived (`BlogPostForm.tsx:239-241`) although
  `blogStatusInput.ts:3-6` permits only Draft/Published for create and the action
  rejects Archived (`new/page.tsx:78-79`). Edit legitimately supports it. Make form
  choices operation-specific and test each displayed option against its action.
- **BLOG-N02, P3:** Edit's slug preview follows the new title (`BlogPostForm.tsx:
  52-69`) although the update preserves the old slug (`edit/page.tsx:166-180`).
  Stable URLs are desirable; show the actual edit URL, and label new-post previews
  provisional. Test title rename with unchanged public URL.
- **BLOG-N03, P3 policy clarification:** Draft creation consumes the same three/24h
  allowance as publication (`new/page.tsx:55-58`, `edit/page.tsx:146-152`,
  `ratelimit.ts:215-219`). Create three drafts, then try to publish one: the message
  says the daily publication limit is exhausted even though none were published.
  Creation-attempt limits may be intentional. Define draft versus publish policy,
  align wording, and test validation retries/first-publish before changing limits.
- **BLOG-CAP01:** New/edit pages fetch the author's entire active catalog for
  featured-listing checkboxes (`new/page.tsx:35-39`, `edit/page.tsx:52-55`). A CSS
  scroll height (`BlogPostForm.tsx:211-226`) does not bound query/DOM work. Group a
  searchable paged selector with SELLER-CAP01 in the prior packet. No real latency
  or supported catalog size was measured.

## Additional account findings and counterevidence

### ACCOUNT-F02 — Block management hides entries beyond its newest 50

**P2 at this collection size; ordinary settings completeness, not a block bypass.**
`account/blocked/page.tsx:13-31` takes the newest 50 Block rows with no pagination.
The page labels `blocks.length` as the blocked-user count (`38`) and renders only
those rows' Unblock forms (`69-76`), with no continuation. If a user has 51+ blocked
accounts, older entries cannot be selected through this management page and its
displayed count understates the stored collection.

The ordinary create path (`api/users/[id]/block/route.ts`, `blockMutationAccess.ts`)
does not enforce a total-of-50 limit. Counterevidence: a block action can also be
available on another reachable surface, and removing a newer block can expose the
next old row. Neither makes this a complete management list; no claim that the
underlying block stopped working is justified.

Proposed regression: 51 entries, accurate total, retrieve/remove an older entry
without unblocking unrelated newer accounts. Use bounded continuation/search.
Group with collection-pagination work rather than treating it as a new isolation
architecture requirement.

### REVIEW-04 — My Reviews rounds valid half-star ratings upward

**P3; source-confirmed display mismatch.** `account/reviews/page.tsx:78-80` renders
whole star characters using `Math.round(r.ratingX2 / 2)`. Review composition and
persistence support half steps (`ReviewComposer.tsx:41-42,66`; reviews API accepts
integer `ratingX2` values 2-10). A saved 3.5-star review therefore looks like four
stars in the author's review history, with no numeric half-star value beside it.

Counterevidence: the stored rating is not changed; the shared ReviewStars visual
supports fractional fill. This is not an aggregate-rating corruption finding.
Proposed regression: odd/even ratingX2 values in My Reviews, displayed value agrees
with the saved review and public rendering. Reuse a consistent accessible rating
presentation rather than rounding away precision.

Onboarding counterevidence: ordinary save-step actions return explicit failures,
advance uses a current-step conditional update, and completion checks Stripe
readiness plus an existing listing. Optional setup fields and pending/draft listing
states do not alone establish a bypass or broken onboarding flow. The parent read
the wizard/actions but did not run actual onboarding, inspect a provider account,
or certify that payouts, public listing readiness and every setup promise agree.

Other non-promoted leads: review deletion resets loading but lacks local handling
for a thrown network request; expected HTTP errors are surfaced. Browser-specific
handling remains untested. Existing saved-collection refresh/pagination and private
sold-out listing-link issues are not counted again.

## Resume priorities and architecture implications

Keep the earlier P1 inventory/financial and accepted security findings ahead of
cosmetic work. Add CASE-04/05 to the participant-protection/state-contract package
before claiming the Case experience is complete. Group seller export totals with
financial reporting verification; notes with draft/retry/version correctness; blog
stale saves and silent truncation with data-preserving editor behavior.

This pass supports **targeted shared contracts**, not a wholesale rewrite:

- Row locks and a fresh-read version predicate cannot detect an old form's intent.
  State which interval each concurrency guarantee protects and test that interval.
- An action shown to a participant must have the same prerequisites as its mutation,
  including terminal, unavailable-counterparty and deadline combinations.
- A data-export projection must retain the historical facts needed for the totals
  it promises; current product configuration is not historical accounting evidence.
- Bounded queries are good, but their UI needs truthful totals and complete
  continuation. Test the largest valid page, not just invalid-cursor rejection.
- Returning success should mean the intended state changed; dropping a body suffix
  or skipping a bookmark deletion is not merely a presentation detail.

Measure large catalogs, long discussions, deep order histories and recovery under
failure before making tens-of-thousands-user claims. These conditions depend on
per-seller history, content size and concurrency, not just registered-user counts.
Whole-account asynchronous export is already a documented deferral, not a new
finding in this packet. Minor blog/account presentation work need not block every
unrelated RLS step, but unresolved product authority/state mismatches must be
classified before the affected domain's activation.

## Coverage, limits and durable handoff

Complete reads by the assigned reviewers:

- Seller sales list/detail, fulfillment/confirm-delivery routes, SellerNotesForm,
  ConfirmButton, OrderTimeline, AccountExportButton; fulfillment authority/finalizer,
  participant detail/export authority/state, sellerFacingUser, payment-event read
  authority, account export payload/format/route, orderTotals, participant read
  authority, orderHistoryCursor; the September 1 fulfillment and export migrations;
  fulfillment-product and history-cursor tests and the relevant product/export docs.
- OpenCaseForm, CaseResolutionPanel, CaseReplyBox, CaseMarkResolvedButton,
  CaseEscalateButton; create/escalate APIs, shipping/returns help, case create/action/
  messaging state and open/reply/preflight wrappers; case-create-state tests,
  admin ban route, July Case-message-preflight migration. Large buyer/seller/admin
  pages, other effective transitions and cron/ban code were **targeted** reads.
- Blog dashboard/new/edit/admin, index/detail/author and Saved pages; blog collection,
  comment and save APIs; BlogPostForm, BlogStatusButton, MarkdownToolbar,
  BlogCommentForm, BlogReplyToggle, SaveBlogButton; blog/input/status/visibility/
  comment-limit/markdown/video helpers, saved-post owner helper; blog-action,
  blog-input and social-interaction tests. Notification construction, schema,
  rate-limit and historic audit references were targeted reads.
- Parent full reads: onboarding page/wizard/actions, account Saved/My Reviews/Blocked
  pages, block management action and ordinary block API/helper, ReviewStars,
  DeleteOwnReviewButton, SellerNotesForm, blog edit page/form. Parent also checked
  the relevant effective Case predicates/fallback, export keys/SQL/enrichment,
  fulfillment form/route, cursor builder/consumer, blog truncation/save/reply paths.
  These targeted checks are not claimed as full reads of every containing migration,
  API or page. Onboarding's editor rendering was read in chunks, including overlap;
  duplicated excerpt lines in tool output were not mistaken for duplicate JSX.

No tests or proposed reproductions were executed. No latest CI, deployed commit,
production catalog/rows or provider configuration was queried. The completed
security artifacts and earlier legal decisions were not modified or re-certified.
Remaining work includes behavioral/fault-injection tests, actual return/help flow
exercise, accessible UI checks, provider verification, measured scale and prior
legal/security follow-ups. No all-files-audited claim or completion percentage.

All three reviewers report no file changes. Candidate HEAD and the same four
tracked modified paths plus three untracked paused Order proof/doc/test paths
were preserved. This records observed preservation, not a claim to have recovered
every file possibly lost in historical crashes. Only audit documentation was saved
in the old root; do not switch or reconcile that dirty root as part of this audit.
