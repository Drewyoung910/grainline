# Claude packets reconciliation — 2026-09-29

## Purpose

Preserve an independent, exact-source disposition of the three Claude audit
packets supplied on 2026-09-29. This is a review record, not authorization to
merge, deploy, apply SQL, change credentials, or enable/FORCE RLS.

## Exact inputs

All three files were read completely twice.

| Packet | Size | SHA-256 |
| --- | ---: | --- |
| `96f98e0f-3115-46b3-a735-a45d3e9f340f/Pasted text.txt` | 356 lines / 33,947 bytes | `669cf1b3c42191df8d8ac287ea3c81621d6fac528189b0e9f31fe5da7512a8ac` |
| `475545bb-7d45-4ade-9dfa-b6d134209fb5/Pasted text.txt` | 56 newline-terminated lines / 15,890 bytes | `941db618fc7f54e5d5413877da19f9fb7b8b200a7156f6ac1f720580382a9f4f` |
| `5246a12f-a46d-4cc3-9b12-35f220d82842/Pasted text.txt` | 587 lines / 62,585 bytes | `005f6b244351a654731497ff7fb04df0020692c7e96301dae8458e1d800ef047` |

The separately supplied listing-preview statement was also reconciled:
staff can request `?preview=admin` outside `/admin` and view nonpublic listing
states without first satisfying the admin PIN challenge.

## Source and release anchors

- Public main, confirmed by remote readback:
  `19e0cece5a72d86df2b22c739f70bb6fb36d1656`.
- Public PR #477 branch, confirmed by remote readback:
  `ae4f332ba93758d21c2e75fd5824bf4dfc7b067b`.
- Corrected #115 recovery branch:
  `recovery/order-item-quote-runtime-lock-ae4f332b-20260929`.
- The #115 head changes only that release family relative to exact main;
  all other source conclusions below refer to main-equivalent files.

## Disposition matrix

| Packet claim | Codex disposition | Release effect |
| --- | --- | --- |
| Logout deletes notifications | Rejected by source. Logout clears browser-only state. | None. |
| Notification read/API paths | Confirmed scoped and unfiltered by age/read state; failed bell load does not become empty-state copy. | Live disappearance remains unproved. |
| Smoke scripts erased the admin inbox | Rejected by source boundaries. Scripts use pinned canary/synthetic identities and exact cleanup. | None. |
| #112 repeated email-change sign-out | Plausible source path; real admin duplicate/conflict and actual trigger unproved. | Separate identity repair; not an Order gate. |
| #113 related-user notification deletion | Confirmed behavior. Causation for Drew's incident unproved. | Separate Notification/privacy decision. |
| 2026-07-22 notification purge | Confirmed one-time migration behavior. | Historical only; do not rerun. |
| #114 broadcast/listing/blog fanout | Confirmed request-lifetime durability and shared-quota risks; seller broadcast also unordered and capped at 10,000. | Separate fanout/outbox design. |
| Commission SQL, quality batch, stock fanout clean claims | Source-confirmed with the already recorded limits. | None. |
| Seller-email predecessor retirement | Confirmed compatible with owner-executed successor chain and atomic provisioning. | Already completed; do not repeat. |
| Order protected-table source boundary | Confirmed for current main. | #115 remains the next Order hardening step. |
| Review reply race/origin guard | Confirmed low-risk source gaps. | Separate review patch. |
| Account export unbounded work | Confirmed scalability concern. | Separate export patch. |
| Case evidence protection | Confirmed participant/staff binding, staff PIN and 60-second private URL. | None. |
| Signed-in ban/Terms gates | Confirmed. | None. |
| #116 local-only commissions | Confirmed missing default-board/detail/indexing and interest-radius enforcement. | Separate product/authority patch. |
| #117 first-XFF | Generic weakness confirmed; Cloudflare-specific premise was ruled out for the then-current Production topology. | Recheck only after infra changes. |
| #118 full-resolution listing media | Confirmed source behavior; bandwidth number was not measured. | Separate media pipeline work. |
| Pickup substring | Confirmed conditional misclassification risk. | Future checkout projection correction. |
| Daily case cron | Confirmed up-to-schedule-delay behavior. | Scheduling choice, not correctness failure. |
| Message tab current-page filtering | Confirmed. | Separate inbox query/UI work. |
| Cart/case/commission/favorite/follow/support clean claims | Source-supported; no hosted fixture rerun in this reconciliation. | None. |
| #119 public browse work | Confirmed with narrower conditional/cached scope. | Separate abuse/performance patch. |
| #120 reported messages | Confirmed missing PIN on staff review page/live surfaces outside admin routes. | Separate confidentiality patch. |
| #120 listing preview | Confirmed missing PIN; all statuses/privacy states become visible to an active staff role with `?preview=admin`. | Separate confidentiality patch; preserve seller/reserved-buyer access. |
| #121 no stuck-order alerts | Narrowed: scheduled ops-health lacks the specified bounded aggregate checks; some individual paths still have telemetry. | Add count-only authority/health work separately. |
| Stripe Connect fixed key | Confirmed conditional 24-hour reconnect edge case. | Separate Stripe patch. |
| Review creation clean | Confirmed lock-time eligibility, duplicate handling and co-transaction rating refresh. | None. |
| Case window/estimate clean | Confirmed for current paid orders; legacy null estimates remain an exception. | None. |
| Private listing ordinary visibility | Confirmed owner/reserved-buyer rules; #120 staff preview is the exception. | Fix #120 separately. |
| #122 unbounded ships-within | Confirmed across new/custom/edit, shared input component, DB schema and paid-checkout/case-clock math. | Fix before accepting extreme seller promises for new orders. |
| Dimension/min-processing validation | Confirmed server/DB mismatch and missing server bounds. | Fold into listing-validation patch. |
| Guild reapply race | Narrowed to stale-write interleavings involving duplicate concurrent apply or concurrent reinstatement; a single ordinary apply cannot race approve/reject from the same initial state. | Low-priority guarded-write patch. |
| Guild admin override | Confirmed EMPLOYEE and ADMIN can both waive the sales threshold after PIN; ADMIN-only is a role-policy hardening choice. | Separate Guild authorization patch. |
| Guild eligibility and blog video | Confirmed use of reviewed Order/Case helpers and strict video host/ID handling. | None. |
| Interim unreviewed lists | Progress markers, not findings; later audit sections cover the named surfaces. | No new Order gate. |

## Exact #120 listing evidence

`src/app/listing/[id]/page.tsx` performs an unrestricted primary-key listing
load, sets staff preview from `preview=admin` plus the EMPLOYEE/ADMIN role, and
passes that signal to `canViewListingDetail`. The helper immediately returns
true for an active staff account before checking status, `isPrivate`, or
`reservedForUserId`. `src/middleware.ts` verifies the PIN only for admin page
and admin API boundaries, and the listing page does not call the page-level PIN
helper. The finding therefore covers DRAFT, REJECTED, PENDING_REVIEW and
private reserved listings.

## Exact #122 evidence

- New/custom/edit server actions accept any positive `shipsWithinDays`.
- `ListingTypeFields` uses `min=1` and has no maximum.
- `Listing_processing_days_valid_chk` constrains processing min/max to 1..365
  but there is no equivalent `shipsWithinDays` constraint.
- Paid-checkout SQL computes the maximum processing time directly from the
  snapshotted `shipsWithinDays`, then adds transit days plus three to form the
  estimated delivery date.
- Not-received opening waits for that estimate, and the case window closes 30
  days after its reference date.

The safe correction is a server/UI maximum plus a validated matching database
CHECK. It belongs in a separate migration from #115.

## Release frontier

Do not widen #115. Its exact public head is in deployment-disabled PR #477 and
still needs the running full-CI gate, conditional merge, and a separately
guarded Production migration before Core Order FORCE.

The #122 Order-adjacent correctness patch and #120 staff-session
confidentiality patch are already prepared on separate private branches. Keep
them separate from #115 and from FORCE. Notification, browse, media, Guild and
general UI findings remain separate families and do not reopen already
completed Order proofs.

## Focused source-contract verification

One combined local command ran the relevant existing source-contract suites.
Twenty-two assertions passed across blog video input, case-window state,
follower notification guardrails, Guild/listing-edit follow-ups, Guild member
revocation state, and Notification delivery preferences. The standalone
`listing-visibility.test.mjs` file did not reach its assertions because this
worktree's generated Prisma CommonJS client did not expose the named
`ListingStatus` ESM export expected by the test. The listing-preview finding
therefore rests on the direct page/helper/middleware source proof above; the
environment import failure is not represented as either a product failure or
a passing test, and it was not papered over with a broad regeneration/retest.

## Third-packet intake and disposition

The third packet was read completely twice. Both reads produced the same exact
byte count and SHA-256 recorded above. It contains Claude findings #123 through
#149, plus clean-path observations and an explicit coverage tracker. Every
numbered claim is preserved below; none is treated as independently confirmed
merely because it appears in the shared audit file.

| Finding | Intake disposition on 2026-09-29 | Current release effect |
| --- | --- | --- |
| #123 Gmail-alias account scans | Source path and unbounded candidate load independently confirmed; scale impact remains workload-dependent. | Post-RLS scalability correction. |
| Cross-origin guard coverage | Preserve as a low defense-in-depth review queue; SameSite and PIN-cookie boundaries narrow current exploitability. | No Core Order FORCE gate. |
| Stale listing metro | Preserve for independent flow verification. | Post-RLS listing correctness. |
| Stock route notes | Claude reports core route sound; private-custom restock and silent email failure remain unverified here. | Post-RLS. |
| #124 blocked-checkout refund failure | Independently confirmed: a pre-provider exception can be caught, recorded as `provider_failure`, and returned without rethrow, allowing the signed event to complete. | Money/ops fix after the current isolated RLS grant lock; do not widen #115. |
| Stripe `charge.refunded` detail | Source independently confirms the signed payload's optional embedded refund array is used without a provider retrieval. Provider-version behavior still needs an authoritative Stripe contract check. | Post-RLS refund-ledger hardening. |
| #125–#133 UI/public-route findings | Preserved as separate visual, route, and consistency work. No visual/browser claim is promoted here. | Post-RLS launch queue. |
| #134 repeat custom purchase | Source independently confirms paid-checkout only auto-transitions exhausted `IN_STOCK` listings to `SOLD_OUT`; private made-to-order listings have no equivalent paid transition. | Launch money/correctness fix after RLS. |
| #135 republish delivery gap | Source independently confirms ready-link delivery is not called from the ordinary publish/mark-available path. | Launch correctness fix after RLS. |
| #136–#138 custom form/media findings | Preserved for targeted source verification. | Post-RLS launch queue. |
| #139–#145 UI/date/custom archive findings | Preserved for targeted source and visual verification. | Post-RLS launch queue. |
| #146 webhook-time soft-state refund | Current order-create SQL independently confirms current seller/listing state is evaluated during signed webhook processing; product intent and safe remediation need a separate design review. | Launch money/trust review after RLS. |
| #147 refund error ambiguity | Seller refund source independently confirms provider exceptions without a refund id are marked ambiguous and return the outer generic server error; Stripe error classification remains to be designed. | Launch money/ops fix after RLS. |
| #148 shared notification keys | Preserved for notification producer/settings verification. | Separate Notification product work. |
| #149 blocked-pair checkout | Independent source sweep confirms the named cart add/update, seller checkout, single checkout, reservation, and paid-order-create paths do not bind authorization to a reciprocal `Block` check. | Launch trust/safety fix after RLS. |

The packet's clean-path statements remain useful review notes, not substitutes
for the existing exact release proofs. Its own coverage tracker says only a
small part of the repository was read line by line, so the finding numbers are
neither a count of confirmed open defects nor evidence of exhaustive coverage.
The active RLS patch stays narrow; these items move into the post-RLS launch
queue for independent verification and fixes, with #124, #134, #135, #146,
#147, and #149 first because they touch money or buyer/seller trust.

## Implementation continuation

### #115 runtime lock

The public PR is now exact head
`ae4f332ba93758d21c2e75fd5824bf4dfc7b067b`. Earlier full CI reached the late
historical ENABLE replay and found that a prior test intentionally dropped the
disposable `grainline_staff_read_runtime` role. The exact correction recreates
that restricted role and runs the existing staff-role provisioner immediately
before the accepted ENABLE replay. The three specialized checks pass on the
exact head; full CI run `36636202493` remains the conditional-merge gate. The
head is backed up at exact private branch
`recovery/order-item-quote-runtime-lock-ae4f332b-20260929`. It is public in
draft PR #477 but is not merged or applied to Production at this checkpoint.

### #120 staff preview PIN boundary

An isolated source fix now requires the existing session-bound admin PIN for
staff-only listing previews, initial reported-thread reads, and reported-thread
polling. Ordinary public listing access, seller preview, reserved-buyer access,
and participant message access retain their existing behavior. Exact local
commit `effd3ec0` is backed up at private branch
`recovery/staff-preview-pin-effd3ec0-20260929`; it is not public or merged.

Verification on that exact tree: 32 focused PIN/message assertions passed,
targeted ESLint passed, and `tsc --noEmit` passed after generating the current
Prisma client. No Production state, migration, credential, alias, or RLS
setting changed while preparing this patch.

### #122 listing fulfillment bounds

An isolated source and migration patch now parses listing fulfillment inputs as
whole days, rejects values outside 1..365 across new, custom, and edit actions,
rejects inverted made-to-order ranges, exposes the same maximum in all shared
form inputs, and adds a validated database CHECK for non-null
`shipsWithinDays`. Exact local commit `b8ce35f3` is backed up at private branch
`recovery/listing-delivery-bounds-b8ce35f3-20260929`; it is not public, merged,
or applied to Production.

Verification on that exact tree: 23 focused listing/Order assertions passed,
targeted ESLint passed, `tsc --noEmit` passed, Prisma schema validation passed,
and `git diff --check` passed. Historical paid-order snapshots are deliberately
unchanged; any existing extreme promise inspection or remediation is a separate
data decision and must not silently rewrite a buyer's recorded order terms.
