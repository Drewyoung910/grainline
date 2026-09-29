# Legal, disclosure and architecture review — 2026-09-07

## Scope, boundaries and restart instructions

Audit documentation only. Drew paused implementation until further instruction
at/after 8 PM Central; the clock alone does not authorize resuming implementation.
No application changes, policy publication, commits, pushes, deployments,
migrations, production queries, provider changes or proof operators in this pass.
The paused Order work and old root worktree must remain preserved.

Source snapshot: `/private/tmp/grainline-clerk-legal-provenance-20260903`, branch
`agent/order-checkout-retry-clock-20260906`, HEAD
`bc1ff4d151572086f8d8ca6740256728e6da91e8`, with the same seven preserved modified/
untracked paths recorded in the runtime review. References below are relative to
that candidate, NOT the old root checkout containing this audit document.

Read alongside [the runtime/financial audit](2026-09-07-runtime-review.md) and
[the completed bounded security report](2026-09-07-security-artifacts/report.md).
This follow-up does not reopen, replace or enlarge that security scan's coverage.

Three delegated reviewers covered Terms/product consistency, privacy/data-flow
consistency, and architecture/scalability. Terms (1,953 lines), Privacy (963),
architecture (656), and legal-risk-register (119) were read completely across
the team. Parent independently checked important findings and researched current
primary legal sources. Source inspection is not production attestation.

This is an engineering/legal-issue review, not legal advice, an enforceability
opinion, a compliance certificate or a guarantee against lawsuits. Marketplace
counsel and an accountant must decide applicability and approve final documents.
The pages explicitly remain drafts for attorney review. The source identifies
Grainline LLC and a Texas registered-agent mailing address; those external facts,
entity formation, monitored mailboxes and intended age/geographic scope remain
unverified. A clarification was requested; do not assume an answer.

## Outcome and priority

The application has a credible financial/authority foundation. It is not ready
to be represented as legally finalized or proven at enterprise traffic levels.
The biggest policy problem is inaccurate promises about the actual product,
not a lack of aggressive disclaimers. The architecture needs operational and
domain-boundary improvements, not a wholesale rewrite.

Before public reliance on finalized policies: resolve LEG-01 through LEG-11,
choose the actual Case/refund/age/communication/Guild policies, and obtain the
operational/counsel decisions below. Independently keep the existing financial
and security blockers ahead of further authority activation. Do not silently
weaken behavior to make an inaccurate document true.

## Confirmed source/policy mismatches

### LEG-01 — Adults-only acceptance versus supervised-minor Terms

Terms `src/app/terms/page.tsx:93-98` permits ages 13–17 with verified parental
consent/supervision. `src/app/accept-terms/AcceptTermsForm.tsx:73` requires an
18+ attestation; `src/app/api/account/accept-terms/route.ts:14-18` and
`src/lib/termsAcceptance.ts:15-20` require that attestation. No guardian branch
exists in this acceptance path. An adult operating their own account while
supervising a child could be intended, but is not clearly distinguished.

Decision: adults-only accounts or a separately designed guardian-managed model.
Do not remove the age gate to resolve drafting ambiguity. COPPA's under-13
scope is a different question from contract capacity for teenagers.

### LEG-02 — Seller partial refunds advertised but deliberately unsupported

Terms §8.5 (`terms/page.tsx:823-829`) advertises full/partial dashboard refunds
at any time. `api/orders/[id]/refund/route.ts:109-120` rejects PARTIAL;
`components/SellerRefundPanel.tsx:67-76,107-110` offers FULL and refers partial
refunds to staff. `lib/refundRouteState.ts:111-146` has dispute, ambiguity,
existing-refund and label-purchase restrictions.

These restrictions protect financial consistency; they are not themselves
defects. Describe full cancellation eligibility, staff-reviewed partial refunds,
and actual pre-handoff stock restoration instead of promising unrestricted use.

### LEG-03 — Case deadline is not the deadline promised in Terms

Terms §9.2 (`terms/page.tsx:865-878`) says 30 days after estimated delivery,
or order date if tracking was not supplied. The wired `grainline_case_open`
definition in `20260729051000_prepare_case_open_authority/migration.sql:421-441`
uses actual delivery/pickup when completed, otherwise the estimate. It has no
order-date/no-tracking fallback. Caller: `api/cases/route.ts:126-133` through
`lib/caseOpenAuthority.ts:19-25`; `caseCreateState.ts:21-37` mirrors the timing.

An early delivery can close the implemented window earlier than promised.
Future-estimate, fulfillment and banned/deleted/review-needed exceptions also
exist; simply changing the sentence to "30 days after delivery" is incomplete.
Approve one eligibility policy, then align SQL, UI and Terms. An internal Case
deadline must not be represented as extinguishing mandatory consumer remedies.

### LEG-04 — Mandatory communication descriptions conflict with preferences

Terms §29 (`terms/page.tsx:1726-1730,1741-1744`) says order/security in-app and
order/Case/account emails cannot be disabled. Account/seller settings expose
several such toggles (`dashboard/seller/page.tsx:519-564`). Preference API
`api/account/notifications/preferences/route.ts:58-68` stores explicit false.
Current Notification core
`20260901120000_prepare_order_receipt_notification_authority/migration.sql:182-194`
honors false. Case-open delivery (`api/cases/route.ts:166-184`) consults the email
preference. Not every transactional email is optional; do not generalize that.

Create a per-type mandatory/optional-operational/marketing matrix and align
delivery, preferences and policy. This is separate from the prior default-off
UI/default-on-delivery finding.

### LEG-05 — Guild criteria and human-review promises differ from automation

Terms (`terms/page.tsx:1305-1313`) promises six consecutive months without
unresolved disputes. `lib/metricsState.ts:15-22,48-55` requires account age >=180
days and current activeCaseCount=0, not six-month dispute history. Metrics,
verification application and admin approval use these facts. Staff approval
still exists; source does not prove that staff never checks additional history.

Separately, Privacy (`privacy/page.tsx:286-289,778-782`) says all badge revocations
include human review. `api/cron/guild-metrics/route.ts:277-348` applies automatic
Guild Master rejection/demotion and records `AUTO_REVOKE_GUILD_MASTER`. A warning,
grace period and metric recheck are not a human decision gate. Decide whether
automatic revocation plus appeal is intended; disclose that precisely, or design
a real review gate later. Do not pretend review on request equals prior review.

### LEG-06 — Public map is exact opt-in, not approximate-only

Privacy (`privacy/page.tsx:142-146`) promises only city/region-level public
locations. `app/map/page.tsx:97-124` passes stored lat/lng directly for eligible
opted-in sellers; line 134 says exact pickup locations. Counterevidence matters:
`SellerLocationSection.tsx:42-65` explains the exact pin and opt-in checkbox.
This is a disclosure mismatch, not evidence of involuntary location publication.

### LEG-07 — Seller names deliberately sent to OpenAI

Privacy (`privacy/page.tsx:357-361`) says seller names are not intentionally
sent. `dashboard/listings/new/page.tsx:371-382` passes the display name;
`lib/ai-review.ts:160-170,271-306` places it in listing data and the API prompt.
Prompt-injection redaction bounds the field; it does not anonymize a normal
name. No evidence here establishes intentional buyer/contact/card transmission.
Either accurately disclose the field or separately authorize minimizing it.

### LEG-08 — Upstash is not a provider-wide hash-only store

Privacy (`privacy/page.tsx:365-368`) describes hashed identifiers only. Normal
`lib/accountStateCache.ts:40-52,95-98` uses raw Clerk IDs and account/terms/age
state; `lib/checkoutSessionLock.ts:19-24,60-78` uses account/cart/listing IDs and
short-lived session metadata, including a client-secret field. These are normal
transient operational uses, not a claim of public accessibility. Rate-limit
identifiers themselves are hashed. Relevant TTLs are 60 seconds for account
cache and 32 minutes for checkout locks. Describe actual purpose and retention.

### LEG-09 — Sentry wording overstates anonymity

Privacy (`privacy/page.tsx:351-354`) calls diagnostic data anonymized.
`middleware.ts:254` intentionally sets user ID; `lib/sentryFilter.ts:144-145`
retains it. Other sensitive fields are scrubbed and sendDefaultPii is false.
Describe pseudonymous/account-linked diagnostic identifiers, not uniformly
anonymous data. This finding does not imply blanket raw-contact-data logging.

### LEG-10 — Blanket $600 federal 1099-K assertion is outdated

Terms (`terms/page.tsx:613-618`) attributes a $600 threshold to IRS requirements
and promises Grainline will issue forms. Current IRS guidance distinguishes
TPSO reporting (> $20,000 AND >200 transactions) from payment-card reporting
with no minimum threshold. Reporting can occur below a threshold and taxability
is separate. Do not mechanically replace one blanket number with another:
accounting must determine payment category, filing party, state requirements
and actual Stripe arrangement. [IRS current 1099-K FAQ](https://www.irs.gov/newsroom/form-1099-k-faqs-general-information).

### LEG-11 — California breach deadline is incorrectly described

Privacy (`privacy/page.tsx:868-873`) states California AG notice within 72 hours
when >500 residents are affected. Current Civil Code §1798.82 instead provides
resident notice within 30 calendar days, subject to specified exceptions, and
an AG sample within 15 calendar days after notifying consumers when >500 are
notified. Do not confuse these clocks with another jurisdiction's deadlines.
[California Civil Code §1798.82](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82).

Texas also has separate individual and regulator clocks; applicable incident
facts/exceptions need counsel, not a single universal sentence. Texas AG's
guidance describes individual notice no later than 60 days after determining
the breach and reporting to the AG as soon as practicable, no later than 30
days, for 250+ Texans. [Texas AG breach guidance](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/identity-theft-enforcement-and-protection-act).

## Provider use and additional disclosure gaps

### INTEGRATION-01 — Public Nominatim autocomplete conflicts with usage policy

`components/AddressAutocomplete.tsx:42-97` issues debounced searches while typing.
`api/address/autocomplete/route.ts:15-30,48-66` proxies them to the public
`nominatim.openstreetmap.org/search` service. A shared ~1.1-second lock and a
descriptive User-Agent exist; this is not uncontrolled direct browser traffic.
Nevertheless, the provider explicitly prohibits autocomplete and limits total
application use to one request/second. Proxying is not an exception to the
autocomplete restriction. Policy also cautions against submitting personal or
confidential material. This is a provider-compatibility/availability issue, not
a conclusion that every address is confidential or that the account was banned.
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

Before launch-scale reliance, choose a provider/service that supports this use
with suitable privacy terms, or a permitted deliberate search workflow. Do not
increase traffic, evade limits, or route around a provider block. No provider
change was made. Existing error/empty-result presentation also merits UX review.

### Existing CM-A20 remains unresolved

Ordinary-message uploads return public object URLs; Case evidence uses private
storage. This is already tracked in `docs/message-private-object-remediation-plan.md`,
not a newly discovered finding. New private writes alone do not retire old public
objects/UploadThing links. Preserve legacy disposition and provider/retirement
proof gates. RLS on Message rows does not authorize access to public object URLs.
Privacy does not explicitly promise every message file is privately served,
but confidentiality descriptions must clearly distinguish this behavior.

### Operational promises are not automatically false

Seller structured exports exclude buyer contact/address/gift-note fields
(`orderParticipantExportState.ts:30-36,252-255`): supporting evidence, not a defect.
Reviewed retention defaults agree with read notifications 90 days, unread 365,
closed support requests two years and active order-PII pruning after 90 days.
That does not prove cron execution/backlog clearance or backup/provider erasure.
`docs/runbook.md:1433-1447` already requires manual provider follow-up and keeps
requests open until completion/exception. Keep that process, verify ownership.

Privacy's seven-year retention, permanent audit logs, SCC safeguards and 30-day
advance email plus site notices require records/agreements and a response owner.
They cannot be certified from source. "Optional analytics" also needs a cookie
inventory: browser refusal and an in-app preference are different. Do not infer
that every first-party analytics cookie requires opt-in under every US law.

## Internal Terms issues for counsel

- Limited payment agency (§6.8, lines 654-662) versus blanket no-agency language
  (306-310,1863-1866): expressly distinguish the limited exception.
- Case liability capped at transaction value (§9.6,915-918) versus general
  max(prior twelve-month fees,$100) cap (§13.4,1102-1105): define precedence and
  distinguish returning purchase funds from damages/platform-funded protection.
- Material-change notice: email AND/OR site (102-103) versus email AND site
  (1244-1246). Own one feasible notice process.
- General content-license termination (337-350,991-999), surviving sections
  (1223-1225), and retained reviews/listing snapshots need a narrow, explicit
  retained-record license, not an accidental surviving promotional license.
- Chargeback language (809-820) labels a chargeback after an adverse Case result
  fraudulent; elsewhere direct issuer rights are preserved (540-546). A losing
  internal Case does not by itself establish dishonesty. Counsel must reconcile
  issuer rights, fee allocation, suspension and the required-first-step wording.
- Tax collection/remittance responsibility (595-610) versus sweeping tax-error
  disclaimer (629-634): clarify statutory responsibility and error correction.
- AAA arbitration, Texas-only hearing/small-claims venue, opt-out operation,
  class waiver, liability/indemnity and mandatory-rights carveouts need counsel's
  enforceability review. This audit does not pronounce those provisions valid.

## Legal/operational launch decisions — not verified violations

Assign a named owner, evidence, counsel decision/date, and launch disposition to
each. Do not mark closed merely because a paragraph exists in Terms.

1. **Entity, marketplace payments and insurance.** Verify Grainline LLC, notice
   addresses/inboxes, entity state, adult/geographic scope, agent-of-payee model,
   platform fee/loss responsibility and insurance. Existing register explicitly
   leaves Stripe application fee/loss responsibility for counsel/accounting.
2. **Sales tax.** Validate registrations, nexus, marketplace certification,
   filing/remittance calendar and refunds/tax reversals. Stripe Tax calculation
   is not evidence of remittance. Texas engaged marketplace providers have
   collection/remittance and record obligations; scope depends on actual facts.
   [Texas Comptroller marketplace guidance](https://comptroller.texas.gov/taxes/sales/marketplace-providers-sellers.php).
3. **INFORM.** Determine seller thresholds, verification/annual recertification,
   suspension, reporting mechanism and required disclosures/exceptions. FTC
   describes 200+ transactions AND $5,000+ in a continuous 12-month period within
   the preceding 24 months; certain disclosures attach at $20,000 annual gross.
   Stripe onboarding alone is not proof of the entire program. Terms §33.13
   acknowledges the topic; readiness at thresholds is still unverified.
   [FTC INFORM guidance](https://www.ftc.gov/business-guidance/resources/what-third-party-sellers-need-know-about-inform-consumers-act).
4. **Shipping/custom goods/consumer remedies.** Reconcile non-cancelable
   made-to-order language, risk at carrier handoff, late delivery, damaged goods,
   partial refunds and Case deadlines. FTC's merchandise rule requires a
   reasonable basis for advertised shipping times (30 days if none); delay
   consent/refund duties cannot be dismissed with a generic custom-order clause.
   Determine marketplace versus seller roles with counsel.
   [FTC merchandise-rule guide](https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule).
5. **Privacy applicability and truthful disclosures.** Build the actual data/
   processor/cookie/retention inventory and rights-request procedure. CCPA has
   business thresholds; the 2025 monetary adjustment is $26,625,000, alongside
   other independent tests. Texas generally exempts SBA small businesses except
   certain sensitive-data sale consent obligations. Do not assume either all
   state laws apply or that small size removes every privacy duty. CalOPPA,
   consumer-protection promises and breach laws are separate questions.
   [CPPA applicability FAQ](https://cppa.ca.gov/faq),
   [Texas AG TDPSA guidance](https://www.texasattorneygeneral.gov/es/node/259071),
   [FTC privacy/security guidance](https://www.ftc.gov/business-guidance/privacy-security).
6. **Age and geographic rules.** Resolve LEG-01; document actual-knowledge child
   handling and adult account model. COPPA covers child-directed services and
   relevant actual knowledge about under-13 collection; not all teen accounts
   fall into that rule. US-only positioning is not itself proof GDPR or other
   international rules never apply; SCC promises need signed arrangements.
   [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions).
7. **Content/IP and intimate-image reporting.** Verify DMCA designated-agent
   registration, public contact particulars, counter-notices and repeat-infringer
   operations; an email address alone does not establish safe-harbor compliance.
   Separately assess TAKE IT DOWN coverage for the marketplace's UGC/messaging:
   covered platforms needed a notice/removal process by May 19, 2026 and must
   remove qualifying imagery/known identical copies within 48 hours of a valid
   request. No such completed program was attested; absence of a grep term is
   not conclusive absence of an operational process.
   [Copyright Office agent directory guidance](https://www.copyright.gov/dmca-directory/),
   [FTC TAKE IT DOWN business guidance](https://search.ftc.gov/business-guidance/resources/complying-take-it-down-act).
8. **Accessibility.** Test keyboard/screen-reader/mobile checkout, messaging,
   forms and dialogs; use WCAG as an engineering target. DOJ explains private
   public-accommodation web accessibility obligations, but do not apply the
   separate state/local-government Title II deadline as Grainline's rule or
   certify compliance from static source. [DOJ web guidance](https://www.ada.gov/resources/web-guidance/).
9. **Email and support operations.** Classify marketing versus transactional
   messages, verify commercial-email address/unsubscribe handling and own reply
   SLAs (Case 3–5 business days, re-review 14 days, suspension review 30 days,
   paper communications). CAN-SPAM does not impose blanket prior opt-in on every
   US email, but voluntarily promised consent and other applicable laws matter.
   [FTC CAN-SPAM guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).
10. **Physical products, reviews and incident readiness.** Woodworking can
    include toys/furniture with product-specific obligations; small-batch status
    is not blanket relief from children's-product testing/certification. Have
    counsel define prohibited/recalled items, safety escalation and seller
    evidence. Verify honest-review moderation and promotion disclosures rather
    than equating all unfavorable reviews with abuse. Own incident contacts,
    counsel/insurer escalation and dated jurisdictional notification playbooks.
    [CPSC small-batch guidance](https://www.cpsc.gov/Business--Manufacturing/Small-Business-Resources/Small-Batch-Manufacturers-and-Third-Party-).

Existing `docs/legal-risk-register.md` is dated May 13 and already holds many
of these decisions. One stale claim: it says no public vulnerability contact is
confirmed, but `app/security/page.tsx:26-65` and
`app/.well-known/security.txt/route.ts:5-12` publish it. Publication is implemented;
mailbox operation/response ownership still needs evidence. Reconcile that register
after implementation resumes; do not lose either historical rationale or this pass.

## Architecture assessment

### What to preserve

Next.js plus PostgreSQL is a reasonable modular-monolith foundation. Close
transactional boundaries for inventory, checkout, payment projections, refunds,
Cases and outbox reservations are valuable. Source-bound authority functions,
integer money, provider idempotency, claim generations, rollback proofs, runtime
credential separation and predecessor compatibility should survive refactoring.
`OrderPaymentEvent` is a payment-event ledger, not proof of balanced accounting.

Example: `lib/orderFulfillmentFinalization.ts:33-139` co-commits domain mutation
and delivery reservation; `lib/emailOutbox.ts:156-362` supplies deduplication,
claims, stale recovery and retries. Build on these patterns.

### ARCH-01 — Capacity is not established by registered-user count

Current source inventory: 114 API route files, 67 Prisma models, 363 lib files,
251 migration SQL files, 757 test files. These are not executed test counts or
capacity evidence. Ordinary pool max 10 and staff max 2 are per instance
(`lib/db.ts:12-23`, `lib/orderStaffReadDb.ts:76-88`), not global connection limits.
SSE performs per-connection database polling (`messages/[id]/stream/route.ts:50-117`).

Define representative peak browse/search, checkout, messaging and staff traffic;
measure p95/p99, errors, pool/lock waits, query CPU, provider latency, queue age
and cost at realistic cardinalities. Prior narrow provider proofs are not whole-
marketplace load tests. No vendor tier, concurrency budget or production benchmark
was verified. Do not blindly increase pool size or assert 50,000 concurrent users.

### ARCH-02 — Background durability and capacity are inconsistent

See earlier JOB-01/JOB-02 for provider timeouts, upfront batch claims and monthly
guild continuation. `CronRun` is execution history, not a general task scheduler.
Email worker handles 50 picked rows every five minutes with concurrency two in a
60-second route; nominal selection ceiling is 600/hour, not guaranteed successful
delivery. Defaults are 3,000/day and 20/recipient/day. Bulk and financial delivery
share capacity (`emailOutboxQuota.ts`, `api/cron/email-outbox/route.ts`).

Use durable per-item claims/checkpoints, deadlines below route budgets, reserved
transactional capacity and oldest-due-work alerts. Dedicated workers can share
the same code and database; microservices are not a prerequisite.

### ARCH-03 — Strong primitives need end-to-end behavioral coverage

Prior audit found ordinary-user state failures despite substantial static/SQL
coverage. Add browser journeys and controlled response-loss/two-tab/worker-death/
late-webhook tests. Preserve pinned migration contracts, but do not substitute
them for tests of actual user outcomes. No representative load or real-device
suite was executed during this pass.

### ARCH-04 — Version financial business contracts before expanding them

5% fee logic currently agrees with the Terms and is frozen across application
and SQL; historical Orders do not snapshot a general fee policy/version. Before
changing fees, persist a checkout accounting snapshot and define settlement,
tax/refund/transfer invariants and exception handling. Do not retrofit a generic
event-sourcing rewrite simply because financial events already exist.

### ARCH-05 — Improve domain interfaces incrementally

The flat lib directory and cross-domain coordinators make ownership difficult
to discover. Current webhook is 1,266 lines; deletion coordinator 1,618.
Introduce explicit domain APIs/import rules around identity, catalog, orders,
payments, Cases, messaging and delivery. Separate pure state calculations,
authority adapters and provider orchestration. No wholesale SQL rewrite.

### ARCH-06 — Current architecture must be distinguishable from release history

`docs/architecture.md` contains 656 lines of mixed topology/release chronology,
stale size figures and earlier "next" states alongside later outcomes. Main CI
is one 1,583-line job with many historical transition lanes. Split a concise
current map/status manifest from immutable release history, and consolidate
reusable verification without changing byte-sealed migrations or dropping gates.
Measure CI time before optimization. Node >=22 in package versus pinned CI 22
also leaves runtime-major drift possible; choose an intentional supported major.

### ARCH-07 — Operations are implemented in part, not certified

Sentry, health checks and restore procedures exist. Source is not evidence of
working pager ownership, restore RPO/RTO, contractual residency or provider-side
deletion. `docs/runbook.md:759-768` prescribes quarterly restore drills; retain
actual results and post-restore reconciliation. Vercel sfo1 execution does not
establish that every processor stores all data in the US.

## Proposed sequence after explicit implementation resume

1. Triage validated financial/security/user-blocking defects against the paused
   Order activation gates. Reuse evidence and fix the root behavior, not only
   brittle test wording. Do not treat RLS progress as overall product completion.
2. Decide Case/refund/age/Guild/communication contracts and get focused counsel/
   accounting decisions. Correct published policies only through an authorized,
   versioned release and required notice/acceptance process.
3. Resolve unsupported provider use and add deterministic browser regressions
   for checkout, messaging, Cases and recovery outcomes.
4. Establish load/SLO/backlog budgets, durable worker continuations and recovery
   drills. Reserve financial transaction delivery capacity separately from bulk.
5. Continue isolated authority/RLS work with accepted business behavior, while
   making current architecture/status concise and keeping historical evidence.
6. Defer microservices/rewrite, fee changes, permanent staff outreach and ordinary
   worktree reconciliation to separately scoped work. Carry forward existing
   private-message-object and Preview-environment backlog; neither is erased.

## Follow-up checkpoint

The bounded source-only shipping, worker/health and accessibility passes are
complete. Their evidence and proposed regressions are preserved in
[the follow-up findings](2026-09-07-shipping-operations-accessibility-review.md).
Parent independently checked the cart address race, rate coercion/refresh,
email claim/accounting predicates, mobile Send naming, refund amount labeling,
message sender markup and crop controls. No application/browser/provider test
was executed, and no implementation is authorized by this checkpoint.
