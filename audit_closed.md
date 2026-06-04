# Grainline Closed Audit Findings

This is the active closed-finding tracker for the current hardening program.
`CLOSED_AUDIT_HISTORY.md` remains the long historical archive, and
`audit_open_findings.md` remains the live ledger that may include fixed,
deferred, stale, and open findings for traceability.

## Counter Rules

- Count only verified findings, hardening fixes, or explicitly clean audited
  surfaces.
- Do not count Claude-reported issues until Codex verifies them against `main`.
- Report progress as `verified closed / verified candidate total` once a
  Claude batch has a triaged denominator.
- Until a Claude batch is fully triaged, report the denominator as `pending`
  instead of pretending the raw claim count is real.
- Record whether each entry had code changes, docs-only evidence, or was a
  stale/false-positive audit claim.

## Active Hardening Program Counter

Last updated: 2026-06-02

- Raw Claude/new-audit candidate total: pending triage.
- Verified hardening/doc commits since 2026-05-13: 230.
- Verified code/feature fix commits since 2026-05-13: 204.
- Verified docs/audit-only commits since 2026-05-13: 11.
- Most recent reported pass tally: 384 verified fixed/reduced findings,
  402 verified stale/false-positive findings, and 70 deferred/manual findings
  in the 2026-05-14 active tracker below.

## 2026-05-14 Active Tracker

1. **Account deletion media cleanup scoped to deleted uploader** — code fix.
   Prevents one deleted account from removing another user's first-party media
   by referencing copied public URLs. Commit: `0408673`.
2. **Commission reference uploads use buyer-safe endpoint** — code fix.
   Non-seller commission buyers now use `messageImage` instead of seller-only
   `listingImage`. Commit: `75aa56f`.
3. **Message attachment upload rules match image/PDF UX** — code fix.
   `messageAny` allows images/PDFs only; `messageFile` allows PDFs only.
   Commit: `acccc42`.
4. **Public forms/webhooks/payment scripts/XSS surfaces recorded clean** —
   docs-only audited surface. Commit: `afa18da`.
5. **Blog notification side-effect failures captured** — code fix. Admin blog
   comment approval and maker blog follower fanout now emit bounded Sentry
   evidence. Commit: `3b7c325`.
6. **Central email telemetry hashes recipients** — code fix. Raw `to` and raw
   subject values no longer go to Sentry extras from `src/lib/email.ts`.
   Commit: `f1b26f0`.
7. **Profanity telemetry avoids raw matched terms** — code fix. Moderation logs
   now emit bounded IDs and match counts instead of submitted words. Commit:
   `4589725`.
8. **Notification read-state writes fail closed** — code fix. Mark-read routes
   now use fail-closed rate limiting. Commit: `c043279`.
9. **Authenticated account-state routes tightened** — code fix. Favorites now
   honor reciprocal block state before writes/notifications; saved-search and
   shipping-address reads are bounded earlier. Commit: `d36ecba`.
10. **Public blog search inputs bounded** — code fix. Blog search now bounds
    page/limit/tags before Prisma/raw SQL; suggestions use shared query
    normalization and fuzzy threshold constants. Commit: `99e47ff`.
11. **API query pagination/timestamps centralized and bounded** — code fix.
    `page`, `limit`, and message `since` params now use shared helpers before
    Prisma `skip`/`take`/date filters across blog, commission, account feed,
    seller broadcast history, and message polling. Public commission reads now
    share the public search IP limiter. Commit: `fix: centralize api query bounds`.
12. **Fail-open limiter policy tightened** — code fix. `safeRateLimitOpen()` is
    now regression-limited to telemetry, diagnostics, and support/legal
    escalation. Public newsletter, account feed, blog/search APIs, recently
    viewed, global search suggestions, and public commission reads fail closed
    before Prisma/raw SQL work when Redis limiting is unavailable. Commit:
    `fix: tighten fail-open limiter policy`.
13. **Public form/report body reads bounded** — code fix. Public newsletter,
    support, legal data-request, and CSP report routes now read through
    `readBoundedJson()` / `readBoundedText()` before parsing or Sentry
    processing, with route-specific byte caps and streamed-body enforcement.
    Commit: `fix: bound public request bodies`.
14. **Signed webhook raw body reads bounded** — code fix. Stripe snapshot,
    Stripe v2 thin, Clerk, and Resend webhook routes now read through
    `readBoundedText()` before vendor signature verification, with
    route-specific byte caps and bounded telemetry for oversized payloads.
    Commit: `fix: bound signed webhook bodies`.
15. **Rendering/XSS guardrails tightened** — code fix. JSON-LD and blog
    markdown rendering were verified behind safe serializers/sanitizers, and
    remaining target-blank links now use explicit `rel="noopener noreferrer"`.
    Commit: `fix: tighten rendering security guardrails`.
16. **Authenticated JSON mutation body reads bounded** — code fix. Checkout,
    shipping quote, direct upload presign/verify, seller broadcast, admin
    email, user report, case, review, custom-order, and commission JSON
    mutations now use `readBoundedJson()` with route-specific caps before Zod
    parsing and downstream side effects. Commit: `fix: bound authenticated json
    mutations`.
17. **All API JSON body reads bounded** — code fix. Remaining smaller JSON
    readers now use `readBoundedJson()` or `readOptionalBoundedJson()` and the
    regression test recursively scans every API route to prevent raw
    `req.json()` / `request.json()` from returning. Commit: `fix: bound
    remaining api json reads`.
18. **API form-data body pre-checks added** — code fix. Processed image upload,
    order fulfillment form fallback, and unsubscribe form fallback now run
    `assertContentLengthUnder()` before `formData()` parsing when
    `Content-Length` is present. Commit: `fix: precheck api form data bodies`.
19. **Public API auth inventory and similar-listing limiter** — code fix.
    Unauthenticated API routes are regression-allowlisted, and the public
    similar-listings endpoint now fails closed through `searchRatelimit` before
    Prisma/raw-SQL work. Commit: `fix: rate-limit public similar listings`.
20. **API read amplification limiter sweep** — code fix. Optional-public GET
    routes that do Prisma work before requiring auth now use the public
    `searchRatelimit`, and heavier signed-in fan-out reads for cart contents,
    message history, notifications, and seller analytics now use dedicated
    fail-closed read limiters before Prisma work. Commit: `fix: rate-limit api read fanouts`.
21. **Empty message-thread submissions blocked server-side** — code fix. Forged
    message-thread server-action posts with no text and no valid attachments
    now return an error before conversation lookup/update work, and
    message-email failures from that action emit bounded Sentry evidence.
    Commit: `fix: reject empty message sends`.
22. **Seller listing server actions rate-limited** — code fix. Dashboard
    status/archive actions and public-shop listing actions now use
    `listingMutationRatelimit` before ownership DB lookups, so forged server
    action posts cannot hammer listing state transitions. Commit: `fix: rate-limit listing server actions`.
23. **Settings and notification server actions rate-limited** — code fix.
    Profile/shop/onboarding settings mutations now use `sellerProfileRatelimit`
    before seller/profile DB work, and notification mark-all-read uses
    `markReadRatelimit` plus a local banned/deleted guard. Commit: `fix: rate-limit settings server actions`.
24. **Non-admin server-action mutation sweep rate-limited** — code fix.
    Blocked-user unblocks, dashboard blog deletes, custom-listing creation,
    listing edit saves, and dashboard Guild applications now use local
    fail-closed limiters before DB/form/metrics work. Commit: `fix: rate-limit remaining user server actions`.
25. **Admin server actions rate-limited before local admin lookup** — code fix.
    Admin order/support/blog/broadcast/verification server actions now use
    `adminActionRatelimit` before local admin-user DB lookups. Commit: `fix: rate-limit admin server actions`.
26. **Similar-listings carousel block filter restored** — code fix.
    Signed-in similar-listing requests now resolve the local user and exclude
    reciprocal blocked seller profiles before raw-SQL candidate selection.
    Commit: `fix: filter blocked sellers from similar listings`.
27. **Rich-text sanitizer hardened against future HTML sinks** — code fix.
    `sanitizeRichText()` now strips all HTML via `sanitize-html` before
    protocol/event cleanup; blog markdown remains on its separate explicit
    sanitizer. Commit: `fix: harden rich text sanitization`.
28. **Founding Maker grant burst race serialized** — code fix. The current
    helper already handled the two-concurrent-seller collision Claude described
    with `max + 1` and unique-conflict retry, but a larger publish burst could
    still exhaust the bounded retry count and silently miss eligible makers while
    slots remained. Number assignment now uses a short Postgres advisory
    transaction lock before reading max/assigning. Commit: `fix: serialize
    founding maker grants`.
29. **Blog notification dedup and republish spam tightened** — code fix.
    Approved comment notifications now include `dedupScope: commentId`, and
    blog edit publishes preserve the first `publishedAt` timestamp so
    archive/re-publish cycles do not refire follower notifications. Commit:
    `fix: tighten blog notification dedup`.
30. **Dev order fixture gate made positive-local-only** — code fix. The
    `/api/dev/make-order` fixture already required `NODE_ENV !== "production"`
    and no Vercel env, but the gate now positively requires
    `NODE_ENV === "development"`, `VERCEL !== "1"`, `VERCEL_ENV === undefined`,
    and `ENABLE_DEV_MAKE_ORDER === "true"`. Commit: `fix: harden dev order
    fixture gate`.
31. **Saved-search tag-order duplicates canonicalized** — code fix. Saved-search
    reads/writes were already rate-limited and capped at 25 rows per user, so
    Claude's 10k-row DoS version was stale; the remaining real issue was
    order-sensitive tag dedup. Writes now sort normalized tags before duplicate
    lookup and create. Commit: `fix: canonicalize saved search tags`.
32. **Guild badge good-standing checks tightened** — code fix. Guild Master
    metrics now count all unresolved cases, Guild Member revocation includes
    `UNDER_REVIEW` cases older than 90 days, and admin reinstatement re-checks
    unresolved-case and active-listing blockers before restoring the badge.
    Commit: `fix: tighten guild reinstatement checks`.
33. **Email unsubscribe/newsletter normalization tightened** — code fix. The
    claimed self-service unsubscribe replay loop was stale because suppression
    is permanent and newsletter signup refuses suppressed emails, but newsletter
    signup and unsubscribe token signing now NFC-normalize before lowercasing so
    Unicode email variants stay aligned. Commit: `fix: normalize unsubscribe
    email inputs`.
34. **Stripe charges mirror respects local inactive accounts** — code fix.
    `mirrorStripeChargesEnabled()` now computes `chargesEnabled && local user
    active`, so queued Stripe account events cannot re-enable seller
    orderability after a ban or account deletion. Commit: `fix: keep stripe
    mirror local-state safe`.
35. **Admin PIN cookie SameSite strict restored** — code fix. Both production
    admin PIN verification and local dev-bypass cookie issuance now set
    `sameSite: "strict"`, matching the documented privileged-cookie contract.
    Commit: `fix: make admin pin cookie strict`.
36. **Sentry exception-message PII scrub restored** — code fix. `beforeSend()`
    now scrubs top-level event messages, transaction names, exception values,
    and exception stack-frame vars, so SDK/Prisma/email error strings cannot
    bypass the existing request/extra/context/tag/breadcrumb privacy filter.
    Commit: `fix: scrub sentry exception messages`.
37. **Email/Resend observability raw-recipient leakage reduced** — code fix.
    Dev-mode email logs now use hashed recipient telemetry, Resend webhook
    `lastError` uses the shared email-error sanitizer, and Resend suppression
    details store safe webhook IDs/counts/hashes instead of full provider
    payloads. Commit: `fix: sanitize resend email observability`.
38. **CSP report breadcrumb URL sanitization restored** — code fix. CSP report
    Sentry tags/extras were already sanitized, but breadcrumbs still used raw
    `blocked-uri`. Breadcrumb data now reduces blocked/source URLs to origins
    and strips document query strings through `cspReportBreadcrumbData()`.
    Commit: `fix: sanitize csp report breadcrumbs`.
39. **Direct-upload media signature verification added** — code fix. R2 direct
    uploads were already signed by key/endpoint/size/content-type metadata, but
    `/api/upload/verify` now also reads the first 512 bytes and checks PDF/video
    magic signatures before accepting direct-uploaded files.
    Commit: `fix: verify direct upload file signatures`.
40. **Checkout primary exception telemetry tagged** — code fix. Single-listing
    and seller-cart checkout routes no longer use bare outer
    `Sentry.captureException(err)`; primary unexpected failures carry explicit
    route/source tags plus bounded reservation context.
    Commit: `fix: tag checkout route exceptions`.
41. **Message thread external media rendering constrained** — code fix.
    `ThreadMessages` now renders image/PDF/download bubbles only for trusted
    Grainline/legacy media URLs; arbitrary external bare URLs remain plain text.
    Commit: `fix: trust-bound message media rendering`.
42. **Runtime/security-header doc drift corrected** — docs/test fix. CLAUDE now
    reflects the resolved `next@16.2.6` runtime and the actual
    `Cross-Origin-Opener-Policy: same-origin-allow-popups` header used for
    Clerk/Stripe popup compatibility. Commit: `docs: align security runtime docs`.
43. **Email outbox quota deferrals no longer stall or age jobs** — code fix.
    A Redis quota-counter outage now retries on the normal capped outbox retry
    cadence instead of waiting until UTC midnight, and both true daily-cap and
    counter-outage deferrals roll back the claim attempt so quota pressure does
    not age legitimate jobs toward dead-lettering without a send attempt.
    Commit: `fix: retry email outbox quota outages`.
44. **Email outbox dead-letter monitoring and retention added** — code fix.
    Ops-health now reports `DEAD` outbox rows, and the daily
    notification-prune cron removes `SENT`, `SKIPPED`, and `DEAD` outbox rows
    after 30 days so recipient addresses and full rendered email HTML are not
    retained indefinitely. Commit: `fix: prune stale email outbox rows`.
45. **Ops-health Sentry monitor reflects actionable issues** — code fix.
    `/api/cron/ops-health` now returns 503 when it finds failed cron runs,
    stale/dead outbox jobs, or overdue support requests, after recording the
    completed local `CronRun`; this keeps the Sentry cron check-in red instead
    of reporting a green 200 while warning separately.
    Commit: `fix: mark ops health unhealthy on issues`.
46. **Verbose health token comparison made constant-time** — code fix.
    `/api/health` still returns only `{ ok }` anonymously, but verbose
    dependency details now require `HEALTH_CHECK_TOKEN` through the same
    SHA-256 `timingSafeEqual` pattern used by cron auth instead of raw string
    equality. Commit: `fix: harden verbose health token compare`.
47. **User-visible text normalization centralized at write boundaries** — code
    fix. Canonical sanitizers now strip U+061C/bidi controls, zero-width chars,
    null bytes, active markup, dangerous protocol text, and common Cyrillic
    confusables; the profanity normalizer strips the same invisible/confusable
    bypasses. Raw message, case, custom-order, gift-note, report, seller-note,
    blog, shipping-address, and audit-reason write paths now pass through the
    canonical sanitizers before persistence. Commit: `fix: normalize user text writes`.
48. **Saved-search duplicate/cap race closed** — code fix. Saved-search POST
    already canonicalized tag order and rate-limited reads/writes, but the
    duplicate lookup, per-user 25 cap, and create now run inside a serializable
    transaction with retry so parallel save attempts cannot bypass the cap or
    create duplicate rows. Commit: `fix: serialize saved search creation`.
49. **Resend webhook retry boundary closed** — code fix. In-progress Resend
    webhook reservations now return retryable 503 with `Retry-After` instead of
    200 so bounce/complaint events are not permanently dropped if the active
    handler crashes. Failed processing clears `processingStartedAt`, and
    multi-recipient suppression/failure work uses `Promise.allSettled()` with
    per-recipient Sentry evidence before returning 500 for provider retry.
    Commit: `fix: retry in-progress resend webhooks`.
50. **Sanitizer protocol obfuscation tightened** — code fix. Shared
    `sanitizeText()` / `sanitizeRichText()` now strip dangerous protocol words
    even when whitespace-obfuscated and include `file:` alongside existing
    `javascript:`/`data:`/`vbscript:` handling, preserving write-boundary
    defense even if future render paths change. Commit:
    `fix: harden text protocol sanitization`.
51. **Message file read-path URL validation closed** — code fix.
    `parseFileMessageBody()` now rejects non-Grainline/legacy media URLs by
    default, caps URL length, and sanitizes name/type metadata; attachment
    metadata normalization also reuses the shared sanitizer so dangerous
    protocol text stays stripped consistently. Commit:
    `fix: validate message file body urls`.
52. **Support/data-request email normalization tightened** — code fix. Public
    support and legal data-request email input now passes through canonical text
    normalization and a strict email pattern before durable write/email
    delivery, rejecting CRLF/header-injection strings that previously only had
    to contain `@`. Commit: `fix: validate support request email input`.
53. **Rate-limit failure policy covered by pure tests** — code/test fix.
    `safeRateLimit()` and `safeRateLimitOpen()` now delegate Redis-error
    fallback to `ratelimitPolicy.ts`, whose direct tests assert fail-closed vs
    fail-open behavior without importing Next/Upstash route wiring. Commit:
    `test: cover rate limit failure policy`.
54. **Stripe charges-disabled mirror expires open checkouts** — code fix.
    `mirrorStripeChargesEnabled()` now proactively expires open Stripe Checkout
    Sessions when Stripe/account mirroring flips `chargesEnabled` false,
    reducing stale-payment/auto-refund UX when Stripe disables a seller.
    Commit: `fix: harden refund and seller disable flows`.
55. **Newsletter suppression enumeration closed** — code fix. Public newsletter
    signup now returns the same success shape for suppressed/unsubscribed
    addresses as normal accepted signups, preventing suppression-history
    probing from the public endpoint. Commit:
    `fix: harden refund and seller disable flows`.
56. **Full-refund stock restoration excludes buyer handoff states** — code fix.
    Seller full refunds restore IN_STOCK inventory only before buyer handoff;
    `SHIPPED`, `DELIVERED`, and `PICKED_UP` orders can still be refunded, but
    do not inflate sellable stock. Commit:
    `fix: harden refund and seller disable flows`.
57. **Seller refund lock stale window and record precondition hardened** — code
    fix. Stale pending refund locks now use a 15-minute window, and seller
    refund success recording runs inside a transaction that only writes the
    Stripe refund when the pending lock is still present. Commit:
    `fix: harden refund and seller disable flows`.
58. **Platform-only seller refunds surface seller-level reconciliation** — code
    fix. When Stripe refund creation cannot reverse the connected-account
    transfer and uses a platform-only refund, the seller profile now gets
    `manualStripeReconciliationNeeded` plus staff-facing note, not just an
    order-level review note. Commit: `fix: harden refund and seller disable flows`.
59. **Operational error string sanitizer expanded** — code fix.
    `sanitizeEmailOutboxError()` now redacts common Stripe IDs and cuids in
    addition to emails, URLs, token-like secrets, and long hex values before
    values reach durable outbox errors or operational console output. Commit:
    `fix: sanitize operational email and webhook logs`.
60. **Stripe/email console error output sanitized** — code fix. Stripe webhook
    thin-event retrieval/outer-handler console errors and central email
    inactive-account lookup console errors now log sanitized error strings
    instead of raw SDK/Prisma error objects. Commit:
    `fix: sanitize operational email and webhook logs`.
61. **BAN_USER audit metadata no longer stores raw review notes** — code fix.
    Open-order snapshots in ban audit metadata store previous review-note hash
    and length only, preserving rollback/diagnostic shape without durably
    copying admin-written free text into audit metadata. Commit:
    `fix: sanitize operational email and webhook logs`.
62. **Resend transient delivery delays no longer create hard suppression** —
    code fix. `email.delivery_delayed` remains observable but does not count
    toward durable suppression; suppression now requires five final
    `email.failed` events inside the 30-day window. Commit:
    `fix: sanitize operational email and webhook logs`.
63. **Create-time AI review no longer reverts staff removal** — code fix.
    Listing create AI-review follow-up writes now require the listing to still
    be `PENDING_REVIEW` before setting AI status/flags or backfilling AI alt
    text, so a concurrent admin removal/rejection cannot be undone by a late AI
    response. Commit: `fix: harden stale write races`.
64. **Blog comment approval side effects deduped** — code fix. Admin comment
    approval now uses `updateMany({ approved: false })` and returns before
    audit/notification side effects when another click/process already approved
    the comment. Commit: `fix: harden stale write races`.
65. **Review helpful unvote race closed** — code fix. Helpful-vote unvote now
    uses `deleteMany` and decrements only when a vote row was actually deleted,
    avoiding P2025/generic 500s and over-decrements on concurrent unvotes.
    Commit: `fix: harden stale write races`.
66. **Case duplicate-create race returns conflict** — code fix. Buyer case
    creation now catches the unique-order `P2002` race and returns a friendly
    `409` instead of a generic 500. Commit: `fix: harden stale write races`.
67. **Guild listing threshold sync race closed** — code fix. Listing-state
    changes now call `syncGuildMemberListingThreshold()`, which recomputes the
    active public listing threshold and updates/clears
    `listingsBelowThresholdSince` in one SQL statement. Commit:
    `fix: harden guild cart and webhook races`.
68. **Cart update checkout-cleanup race closed** — code fix. `/api/cart/update`
    now uses `deleteMany`/`updateMany` scoped by cart item and cart id, returning
    a 409 refresh message if checkout webhook cleanup removed the row first.
    Commit: `fix: harden guild cart and webhook races`.
69. **Stripe webhook in-progress duplicates retry** — code fix.
    `beginStripeWebhookEvent()` now distinguishes `process`, `processed`, and
    `in_progress`; legacy snapshot and v2 thin webhook routes return 503 with
    `Retry-After` for non-stale in-progress duplicates so Stripe retries instead
    of treating the event as complete. Commit:
    `fix: harden guild cart and webhook races`.
70. **Prisma User relation over-fetch removed** — code fix. Public browse and
    review-reply ownership code now select only needed `User` fields instead of
    `include: { user: true }`; browse no longer falls back to seller email as a
    public display name. A recursive source guard blocks future full-user
    relation selects. Commit: `fix: narrow user selects and document security
    tradeoffs`.
71. **Secret-rotation cadence documented** — docs fix. The operations runbook
    now records recommended rotation cadence, staged webhook rotation, and
    dual-verify preferences for HMAC/application secrets. Commit:
    `fix: narrow user selects and document security tradeoffs`.
72. **Unsubscribe URL PII tradeoff documented** — docs fix. CLAUDE.md now records
    the one-click-unsubscribe email query parameter as an accepted tradeoff with
    required referrer-policy, no third-party-resource, and no raw query/token
    logging guardrails. Commit: `fix: narrow user selects and document security
    tradeoffs`.
73. **Blog slug collision race returns gracefully** — code fix. Dashboard blog
    creation now catches unique-slug `P2002` races and retries with the next
    `baseSlug-N` value before returning a user-facing slug failure. Commit:
    `fix: harden blog message and follow races`.
74. **Message first-response timestamp drift closed** — code fix. Message-thread
    sends now set `firstResponseAt` through a null-preconditioned
    `conversation.updateMany()` while keeping the ordinary `updatedAt` bump
    separate, preventing concurrent replies from rewriting the metric. Commit:
    `fix: harden blog message and follow races`.
75. **Follow/block insertion race narrowed** — code fix. Follow POST now
    re-checks reciprocal block state immediately after `Follow.upsert()`,
    deletes the just-written follow row if a block raced the write, and returns
    403 before counting followers or notifying the seller. Commit:
    `fix: harden blog message and follow races`.
76. **Custom-order ready-link duplicate race closed** — code fix.
    `sendCustomOrderReadyLink()` now serializes ready-link message creation with
    a transaction-scoped advisory lock keyed by conversation and listing, then
    runs the duplicate read and message create inside that lock. Commit:
    `fix: serialize custom order ready links`.
77. **Account deletion double-submit Stripe side effect guarded** — code fix.
    `anonymizeUserAccount()` now acquires a short Redis account-deletion lock
    before Stripe connected-account rejection and local anonymization, returning
    an in-progress terminal response if another delete/webhook path is already
    running. Commit: `fix: serialize account deletion`.
78. **Signed-in cart size abuse capped** — code fix. `/api/cart/add` now caps
    signed-in carts at 50 distinct item/variant rows and 200 total quantity,
    in addition to the existing 99-per-item cap. Commit:
    `fix: cap signed-in cart size`.
79. **Banned reviewer identity leakage closed** — code fix.
    `ReviewsSection` now selects `reviewer.banned` and redacts banned reviewers
    the same way as deleted reviewers: "Former buyer", `FB` initials, no saved
    avatar/name/email fallback, and no report button. Commit:
    `fix: close account-state residue gaps`.
80. **Banned/deleted seller commission-interest residue removed** — code fix.
    `removeSellerCommissionInterests()` deletes a seller's commission interests
    during admin ban and account deletion, then recomputes every affected
    `CommissionRequest.interestedCount` so hidden sellers do not inflate public
    interest counts. Commit: `fix: close account-state residue gaps`.
81. **Account-state search-cache invalidation wired** — code fix. Admin
    ban/unban and account deletion now invalidate listing/blog popular-tag
    caches, and dashboard blog deletion invalidates the popular-blog-tag cache.
    Commit: `fix: close account-state residue gaps`.
82. **Email outbox account-state recheck made unconditional** — code fix.
    `processEmailOutboxBatch()` now rechecks recipient account state by
    `userId` when present, or by recipient email when no user id exists, before
    every send even when `preferenceKey` is null. Commit:
    `fix: close account-state residue gaps`.
83. **Node stripped-type full-suite import drift closed** — code fix.
    `aiReviewSafety.ts` and `notificationPayload.ts` no longer depend on the
    Next/TypeScript `@/lib` alias when imported directly by Node's stripped-type
    test runner, restoring full `npm test` portability. Commit:
    `fix: close account-state residue gaps`.
84. **Sensitive Guild restoration/promotion actions made admin-only** — code
    fix. `/admin/verification` now separates staff-wide review auth from
    `requireAdminOnly()` and requires ADMIN for Guild Member reinstatement,
    maker featuring, and unfeaturing. Commit:
    `fix: harden admin report and deletion lifecycle`.
85. **Admin report resolution reason persisted** — code fix.
    `/api/admin/reports/[id]/resolve` now requires a bounded JSON reason,
    stores it in `UserReport.resolutionNote`, writes it to admin audit
    metadata, and the admin UI collects the reason before posting. Commit:
    `fix: harden admin report and deletion lifecycle`.
86. **Same-email re-signup after account deletion unblocked** — code fix.
    Clerk `user.created` webhooks now delete only `EmailSuppression` rows with
    `source: "account_deletion"` for the normalized primary email, leaving
    bounce/complaint/manual suppressions intact. Commit:
    `fix: harden admin report and deletion lifecycle`.
87. **Deleted-seller derived metrics removed** — code fix. Account deletion
    removes `SellerMetrics` and `SellerRatingSummary` rows for the deleted
    seller so stale derived trust metrics cannot survive anonymization. Commit:
    `fix: harden admin report and deletion lifecycle`.
88. **Deleted-seller review replies redacted** — code fix. Account deletion
    clears `Review.sellerReply` and `sellerReplyAt` for reviews on the deleted
    seller's listings, matching the existing buyer-comment redaction behavior.
    Commit: `fix: harden admin report and deletion lifecycle`.
89. **Reports against deleted users auto-resolved** — code fix. Account
    deletion now resolves unresolved reports where the deleted user is the
    reported account, nulls report details through the existing redaction pass,
    and records a system resolution note. Commit:
    `fix: harden admin report and deletion lifecycle`.
90. **Dependency audit vulnerability drift closed** — dependency fix.
    `npm audit` flagged a critical `sanitize-html` advisory and a moderate
    transitive `brace-expansion` advisory during this pass. `npm audit fix`
    updated the lockfile to `sanitize-html@2.17.4` and `brace-expansion@5.0.6`;
    sanitizer guardrail tests and full `npm test` passed afterward. Commit
    `fix: harden admin report and deletion lifecycle`.
91. **Durable user email normalization aligned** — code fix.
    `ensureUserByClerkId()` now normalizes provided emails through
    `normalizeEmailAddress()` before create/update, so Clerk/OAuth NFC/casing
    variants do not split durable `User.email` identity or suppression matching.
    Commit: `fix: normalize email and plaintext controls`.
92. **Clerk webhook primary-email normalization aligned** — code fix.
    `resolveClerkWebhookPrimaryEmail()` now returns NFC/lowercase primary
    emails and rejects invalid resolved addresses instead of returning trimmed
    raw provider values. Commit: `fix: normalize email and plaintext controls`.
93. **Account-deletion suppression key normalization aligned** — code fix.
    account deletion now writes the deletion-time `EmailSuppression` key through
    the shared email normalization helper, matching suppression lookups and
    re-signup cleanup. Commit: `fix: normalize email and plaintext controls`.
94. **Plain-text email entity control stripping closed** — code fix.
    `htmlToText()` now strips decoded bidi, zero-width, and null characters
    after HTML entity decoding so plaintext email fallbacks cannot reintroduce
    invisible spoofing controls. Commit: `fix: normalize email and plaintext controls`.
95. **Saved-search query Unicode normalization closed** — code fix.
    Saved-search POST now routes free-text `q` through `sanitizeText()` before
    whitespace collapsing and code-point-safe truncation, matching other saved
    user text. Commit: `fix: harden unicode text boundaries`.
96. **Blog markdown render cap made code-point-safe** — code fix.
    `renderBlogMarkdown()` now uses `truncateText()` instead of UTF-16
    `slice()` before calling `marked.parse()`, so astral characters are not
    split at the 200k render cap. Commit: `fix: harden unicode text boundaries`.
97. **Avatar fallback initials centralized** — code fix.
    Fallback avatars now use `src/lib/avatarInitials.ts`, sanitizing names and
    deriving initials by Unicode code point instead of `charAt(0)` or `[0]`.
    Commit: `fix: harden unicode text boundaries`.
98. **Stripe order snapshot strings sanitized** — code fix.
    Stripe webhook order-item snapshots now sanitize/truncate listing titles,
    descriptions, and seller display names before permanent order storage.
    Commit: `fix: harden unicode text boundaries`.
99. **Short-name account-deletion notification redaction closed** — code fix.
    Notification redaction now handles two-character names as bounded tokens, so
    deleted users named like "Li" are redacted without replacing embedded text in
    unrelated words. Commit: `fix: harden unicode text boundaries`.
100. **Custom-order conversation FK added** — schema/code fix.
     `Listing.customOrderConversationId` is now a real `Conversation` foreign key
     with `onDelete: SetNull`, an index, and migration cleanup for pre-existing
     orphans. Commit: `fix: harden schema text and custom order refs`.
101. **Email outbox HTML bounded** — schema/code fix.
     `EmailOutbox.html` is now `@db.VarChar(200000)` and `enqueueEmailOutbox()`
     caps queued HTML at the same code-point-safe limit before persistence.
     Commit: `fix: harden schema text and custom order refs`.
102. **Order payment-event descriptions bounded** — schema/code fix.
     `OrderPaymentEvent.description` is now `@db.VarChar(5000)` and Stripe
     webhook ledger writes sanitize/truncate descriptions through
     `paymentEventDescription()`. Commit: `fix: harden schema text and custom order refs`.
103. **Raw-managed blog tag GIN index restored** — schema/migration fix.
     `BlogPost_tags_gin_idx` was dropped by a later Prisma migration after the
     original blog search pass. Migration
     `20260521154500_schema_drift_and_raw_index_followups` re-creates it, and
     `tests/schema-drift-followups.test.mjs` now guards against future silent
     drops. Commit: `fix: close schema drift followups`.
104. **Listing CHECK constraints validated** — schema/migration fix.
     The positive-price and non-negative-stock CHECK constraints originally
     added `NOT VALID` are now validated by migration
     `20260521154500_schema_drift_and_raw_index_followups`, so historical rows
     are covered in addition to future writes. Commit:
     `fix: close schema drift followups`.
105. **Notification dedup default drift aligned** — schema/migration fix.
     `Notification.dedupKey` now uses the same `dbgenerated(md5(...))` default
     in Prisma that the database applies, with a follow-up migration setting the
     DB default explicitly. Commit: `fix: close schema drift followups`.
106. **Unread notification retention added** — privacy/storage fix.
     Daily notification pruning now deletes unread notifications older than 365
     days while keeping the existing 90-day read-notification retention.
     Commit: `fix: add retention and webhook health guards`.
107. **Webhook idempotency retention added** — storage/ops fix.
     Processed Stripe/Resend/Clerk webhook idempotency rows are pruned after 90
     days through the daily notification-prune cron. Failed or unprocessed rows
     are retained for investigation. Commit: `fix: add retention and webhook health guards`.
108. **Listing-view cleanup time budget added** — cron reliability fix.
     The guild-metrics cleanup of old `ListingViewDaily` rows now has an
     explicit time budget and reports whether cleanup completed, avoiding an
     unbounded delete loop inside the monthly metrics cron. Commit:
     `fix: add retention and webhook health guards`.
109. **Webhook failure piles added to ops-health** — observability fix.
     `/api/cron/ops-health` now counts unprocessed Stripe/Resend/Clerk webhook
     rows with `lastError` set and reports unhealthy when any are present.
     Commit: `fix: add retention and webhook health guards`.
110. **Retention behavior documented and guarded** — docs/test fix.
     CLAUDE.md now records notification/webhook retention and failed-webhook
     aggregate behavior, with tests covering the cron wiring and retention
     constants. Commit: `fix: add retention and webhook health guards`.
111. **Vacation return-date rendering aligned** — UX/date fix.
     Public seller profile and seller shop pages now both render vacation return
     dates through `LocalDate dateOnly`, avoiding UTC-vs-client date drift and
     preventing an accidental time component from appearing. Commit:
     `fix: align vacation return date display`.
112. **Admin listing approval rechecks seller orderability** — safety fix.
     Admin approval now refuses to activate pending listings when the seller has
     become charges-disabled, vacationing, banned, or deleted during review; the
     final `updateMany` predicate repeats the seller-state guard before Founding
     Maker can be granted. Commit: `fix: guard admin listing approval state`.
113. **SiteConfig singleton seeded** — migration fix.
     Migration `20260521161000_seed_site_config_and_fallback_cap` inserts the
     default `SiteConfig` row `id=1` if missing, so fallback-shipping lookup does
     not rely on manual seed state. Commit: `fix: seed site config fallback guard`.
114. **Fallback shipping ceiling added** — pricing safety fix.
     `safeFallbackShippingCents()` now clamps fallback shipping to the $5-$50
     range before quote/checkout use, preventing extreme buyer-facing fallback
     rates from a bad config value. Commit: `fix: seed site config fallback guard`.
115. **Admin custom-order ready retry respects seller orderability** — safety fix.
     The admin listing approval idempotency path now avoids sending a custom-order
     ready link on an already-active listing if the seller has since become
     unsellable. Commit: `fix: tighten admin approval retry guard`.
116. **Variant selector radio semantics added** — accessibility fix.
     Listing variant groups now expose `radiogroup` / `radio` semantics,
     selected state, disabled state, and arrow/Home/End keyboard behavior so
     assistive technology can operate mutually exclusive options. Commit:
     `fix: close accessibility launch blockers`.
117. **Open case form labels and errors wired** — accessibility fix.
     Case reason and description controls now have stable label associations,
     description help/error wiring, `aria-invalid`, and `role="alert"` error
     copy. Commit: `fix: close accessibility launch blockers`.
118. **Checkout shipping address errors wired** — accessibility fix.
     Required checkout address inputs/selects now expose validation state via
     `aria-invalid`, `aria-describedby`, stable error IDs, and alert roles.
     Commit: `fix: close accessibility launch blockers`.
119. **Image crop modal dialog semantics added** — accessibility fix.
     The cropper portal now uses dialog ARIA, labelled title, Escape close,
     focus trap/return, and shared body scroll lock helpers. Commit:
     `fix: close accessibility launch blockers`.
120. **Map widgets labelled for assistive tech** — accessibility fix.
     MapLibre containers now expose `role="application"` with specific labels;
     multi-maker maps include screen-reader text summaries and pickup maps
     connect helper text with `aria-describedby`. Commit:
     `fix: close accessibility launch blockers`.
121. **Order confirmation direct-send fallback added** — reliability fix.
     Stripe completed-checkout side effects still send order-confirmed and
     first-sale emails directly for speed, but direct-send failures now enqueue
     the rendered email into `EmailOutbox` with deterministic order-scoped dedup
     keys so the cron drain gets a second chance. Commit:
     `fix: add order email outbox fallback`.
122. **Future-dated public blog leak blocked** — visibility hardening.
     `publicBlogPostWhere()` and equivalent raw-SQL blog predicates now require
     `publishedAt` to be non-null and at or before the current time, so manually
     future-dated posts do not appear on public blog/detail/search/sitemap/tag
     surfaces before their timestamp.
123. **Made-to-order processing window validation tightened** — UX/data fix.
     Listing create/edit actions now reject made-to-order processing windows
     where the minimum exceeds the maximum, preventing confusing "Ships in
     10-5 days" order timeline output.
124. **Stripe webhook future-timestamp guard added** — replay hardening.
     Stripe snapshot and v2 thin event age checks still allow a 10-minute clock
     skew but reject impossible future-dated events before side effects.
125. **Signed upload/shipping token future-expiry caps added** — token hardening.
     Upload verification tokens and HMAC-signed shipping rates now reject
     excessive future expiries before expensive verification work, while keeping
     the normal signed TTL plus skew window.
126. **Guild Master warning grace enforced** — deadline fix.
     The monthly Guild metrics cron now refuses to revoke Guild Master status
     until `metricWarningSentAt` is at least 30 days old, and the final DB update
     repeats that predicate so short-month cron runs cannot revoke before the
     seller's promised warning window.
127. **Seller broadcast cooldown date moved to client formatting** — timezone fix.
     `/api/seller/broadcast` now returns `nextAvailableAt` as an ISO timestamp
     on cooldown errors, and `BroadcastComposer` formats it in the browser so
     sellers see their local date instead of a Vercel UTC date.
128. **Seller metrics period rollover stabilized** — date math fix.
     `calculateSellerMetrics()` now derives rolling windows through
     `metricsPeriodStart()` with fixed 30-day-per-month periods, avoiding
     `Date.setMonth()` month-end rollover drift.
129. **Admin feature-maker writes use public seller visibility gates** — trust-signal hardening.
     `featureMaker()` now writes through `activeSellerProfileWhere()` and
     requires an active Guild Member/Master, so banned/deleted, vacation-mode,
     Stripe-disabled, unsupported-account-version, or non-Guild sellers cannot
     be manually spotlighted.
130. **Guild Member reinstatement rejects inactive accounts and notifies sellers** — admin action hardening.
     `reinstateGuildMember()` now refuses banned/deleted target users in the
     transaction, keeps the case/listing good-standing checks, and sends a
     `VERIFICATION_APPROVED` notification when the badge is restored.
131. **Admin Guild revoke/reinstate stale states now surface errors** — admin UX/ops hardening.
     Guild Member revoke, Guild Master revoke, and Guild Member reinstatement
     now return `ActionState` responses through `ActionForm`, so races with
     cron/admin actions produce visible admin errors instead of silent no-ops.
132. **Icon-only Guild badges have accessible names** — accessibility fix.
     `GuildBadge` now sets `aria-label` from the same Guild Member/Master label
     used for the title, so icon-only badge buttons on cards and compact
     surfaces are announced correctly.
133. **Guild verification narratives sanitize at write boundaries** — text-boundary hardening.
     Guild Member `craftDescription` and Guild Master `craftBusiness` writes now
     use `truncateText(sanitizeText(...), 500)` on dashboard/API paths before
     persisting application narrative text.
134. **Guild Master revocation rechecks metrics at decision time** — trust-signal race hardening.
     The monthly Guild metrics cron recalculates seller metrics immediately
     before revoking Guild Master status and clears the warning state instead
     if the seller has recovered during the 30-day grace window.
135. **Seller rating summaries refresh inside review transactions** — aggregation race hardening.
     Review create, buyer edit/delete, and admin delete now call
     `refreshSellerRatingSummary(..., tx)` inside the same Prisma transaction
     as the review mutation, preventing concurrent writes from leaving stale
     public rating summaries until the next refresh.

## Verified Stale / Not Fixed

1. **Report target access gap** — stale claim. Current `main` already requires
   reporter access for private order/message/thread/listing report targets and
   has guardrail coverage in `tests/user-report-target-access.test.mjs`.
2. **Active-listing photo POST AI-review bypass chain** — stale claim. Current
   `main` disables `POST /api/listings/[id]/photos` with HTTP 410; edit-page
   photo changes are staged through `photoManifestJson` and reviewed only when
   the seller presses Save.
3. **Similar-listing block filter gap** — stale claim. Current `main` resolves
   the signed-in local user in `/api/listings/[id]/similar`, loads blocked
   seller profile IDs, and excludes those sellers in the raw SQL predicate.
4. **Sanitize helper stored-XSS chain** — stale claim. Current `main` routes
   `sanitizeText()` and `sanitizeRichText()` through `sanitize-html`, strips all
   tags, removes dangerous protocol text including whitespace-obfuscated
   variants, and test-covers exception/message Sentry redaction separately.
5. **Founding Maker number race** — stale claim. Current `main` assigns the
   badge under a Postgres advisory transaction lock and uses max-number
   assignment instead of count-plus-one.
6. **Dev make-order production gate** — stale claim. Current `main` requires
   `NODE_ENV === "development"`, `VERCEL !== "1"`, `VERCEL_ENV === undefined`,
   and `ENABLE_DEV_MAKE_ORDER === "true"` before the fixture route is reachable.
7. **Saved-search amplification chain** — stale claim. Current `main`
   normalizes tag order, caps saved searches at 25 inside a serializable retry
   transaction, and rate-limits saved-search GET/POST/DELETE.
8. **Blog republish/comment notification chain** — stale claim. Current `main`
   preserves first-publication `publishedAt`, notifies followers only on first
   publish, and blog comment approval uses `dedupScope: commentId`.
9. **Sentry exception value scrub gap** — stale claim. Current `main` scrubs
   top-level `event.message`, `event.transaction`,
   `event.exception.values[*].value`, and exception frame vars; regression
   coverage exists in `tests/sentry-filter.test.mjs`.
10. **Email outbox/resend reliability stale cluster** — stale claims. Current
    `main` retries quota-counter outages on normal retry cadence, monitors and
    prunes DEAD outbox rows, stores safe Resend webhook details, uses
    `Promise.allSettled()` for multi-recipient webhook tasks, and returns 503
    with `Retry-After` for in-progress webhook reservations.
11. **Admin PIN SameSite lax drift** — stale claim. Current `main` already sets
    the admin PIN cookie with `sameSite: "strict"` in both normal and dev-bypass
    branches, matching CLAUDE.md.
12. **Direct upload video/PDF magic-byte gap** — stale claim. Current `main`
    already range-reads uploaded objects in `/api/upload/verify` and checks PDF,
    MP4, and QuickTime signatures before accepting direct uploads.
13. **Checkout external script SRI gap** — accepted documented deviation. Current
    CLAUDE.md and checkout script inventory require Stripe.js to load directly
    from `https://js.stripe.com` and explicitly prohibit stale SRI hashes for
    Stripe/Clerk/Turnstile-style rotating scripts; CSP host allowlisting plus
    checkout CSP monitoring are the compensating controls.
14. **Saved-search tag-order cap bypass** — stale claim. Current `main`
    normalizes saved-search tags through `normalizeTags(...).sort(...)`, performs
    dedup and 25-cap checks inside a serializable retry transaction, and
    rate-limits GET/POST/DELETE.
15. **Newsletter NFC normalization gap** — stale claim. Current newsletter signup
    trims, NFC-normalizes, lowercases, validates, and hashes the submitted email
    before lookup/persistence/telemetry.
16. **Newsletter suppression enumeration gap** — stale claim. Current newsletter
    signup returns the same `{ subscribed: true }` response for suppressed and
    accepted addresses, preventing public suppression-history probing.
17. **Banned seller Stripe dashboard access gap** — stale claim. Current Stripe
    Connect login-link and dashboard routes call `ensureUserByClerkId()` and
    return the shared account-access response before creating login links, so
    banned/deleted users cannot open connected-account dashboards.
18. **Banned user message-send gap** — stale claim. Current message routes use
    `ensureUserByClerkId()` for streaming/list/read APIs and the message-thread
    send action explicitly returns before create when `me.banned` or
    `me.deletedAt` is set.
19. **Banned seller fulfillment-action gap** — stale claim. Current order
    fulfillment routes resolve the seller through `ensureSellerOwnsOrder()`,
    which returns null when the Clerk user maps to a banned or deleted local
    user, causing the mutation to return 403 before status changes or emails.
20. **Similar-listing route listed as fully unauthenticated** — stale test
    inventory. Current `/api/listings/[id]/similar` intentionally performs
    optional `auth()` to filter blocked sellers and reject banned/deleted signed
    in users, while still returning public similar listings to signed-out users.
21. **Staff reported-thread access write gap** — stale claim. Current message
    thread pages allow staff to open only unresolved reported
    `MESSAGE_THREAD` targets, set `isStaffReviewMode` only for non-participants,
    skip mark-read side effects, hide the composer/custom-order/archive actions,
    and are covered by `tests/custom-order-admin-thread-followups.test.mjs`.
22. **Hostile staff destructive-admin action gap** — stale claim. Review
    deletion, listing removal, user ban/unban, and admin email routes all require
    `role === "ADMIN"` and reject EMPLOYEE accounts with 403.
23. **Newsletter NFC normalization gap** — stale claim. Current newsletter
    signup trims, NFC-normalizes, lowercases, suppression-checks, and stores the
    normalized email key.
24. **Unsubscribe token NFC normalization gap** — stale claim. Current
    `normalizeUnsubscribeEmail()` trims, NFC-normalizes, lowercases, and rejects
    invalid addresses before signing or verifying tokens.
25. **Display-name homograph sanitizer gap** — stale claim. Current
    `sanitizeUserName()` routes through `sanitizeText()`, which normalizes NFKC,
    strips bidi/zero-width/null characters, and folds Cyrillic confusables.
26. **Listing/profile text zero-width/homograph sanitizer gap** — stale claim.
    Current `sanitizeText()` / `sanitizeRichText()` already strip zero-width and
    bidi controls and fold Cyrillic confusables for listing/profile text.
27. **Message body raw Unicode spoofing gap** — stale claim. Current message
    thread sends use `truncateText(sanitizeText(...), 2000)` before persistence.
28. **Case description/message raw Unicode spoofing gap** — stale claim. Current
    case creation and case-message routes sanitize rich text before persistence.
29. **Custom-order field sanitization gap** — stale claim. Current custom-order
    request handling sanitizes description, dimensions, budget/timeline copy, and
    notification text before JSON/message persistence.
30. **Commission timeline raw Unicode spoofing gap** — stale claim. Current
    commission creation sanitizes timeline text before persistence.
31. **Checkout gift-note raw Unicode spoofing gap** — stale claim. Current
    seller and single-checkout routes sanitize and truncate gift notes before
    Stripe metadata or DB persistence.
32. **User report details raw Unicode spoofing gap** — stale claim. Current
    report submission sanitizes and truncates `details` before persistence.
33. **Profanity zero-width bypass** — stale claim. Current profanity
    normalization strips zero-width characters, bidi controls including U+061C,
    and Cyrillic confusables before matching.
34. **Bidi regex inconsistency cluster** — stale claim. Current sanitizer,
    profanity, notification, AI review, support, and tag helpers strip U+061C
    and the broader bidi control ranges; message attachments route through
    `sanitizeText()`.
35. **HTML email body bidi/zero-width gap** — stale claim. Current email HTML
    escaping first runs user-facing strings through `normalizeUserText()` before
    entity escaping.
36. **Shipping address newline/control gap** — stale claim. Current account
    shipping-address sanitization collapses CR/LF, U+0085, U+2028, and U+2029
    to spaces before persistence.
37. **Order seller-notes raw Unicode gap** — stale claim. Current fulfillment
    route stores `sellerNotes` through `truncateText(sanitizeText(...), 2000)`,
    and `tests/user-text-normalization-followups.test.mjs` guards it.
38. **Admin audit reason raw Unicode gap** — stale claim. `logAdminAction()`
    sanitizes and truncates `reason` before persistence.
39. **Blog write-path raw Unicode gap** — stale claim. Blog create and edit
    actions sanitize/truncate title, body, excerpt, and meta description before
    storing.
40. **Seller FAQ raw Unicode gap** — stale claim. Profile FAQ question/answer
    writes already use `sanitizeText()` / `sanitizeRichText()` with bounds.
41. **Message attachment filename raw Unicode gap** — stale claim. Attachment
    `name` and `type` fields route through `sanitizeText()` and
    code-point-safe `truncateText()`.
42. **Null-byte user-text sanitizer gap** — stale claim. Current
    `normalizeUserText()` strips null bytes, and the audited DB-boundary text
    surfaces route through `sanitizeText()` or `sanitizeRichText()`.
43. **Attachment filename surrogate-split gap** — stale claim. Attachment names
    use shared `truncateText()` rather than UTF-16 `slice()`.
44. **Saved-search dedup race without DB unique** — stale as a race claim.
    Current saved-search POST deduplicates and checks the per-user cap inside a
    serializable transaction wrapped by `withSerializableRetry()`. A future
    criteria-hash unique index would be additional defense-in-depth, but the
    reported `findFirst + create` race is already guarded on `main`.
45. **Nine schema-vs-migration onDelete drifts** — stale claim. A static final
    migration-history comparison against `schema.prisma` found no onDelete
    mismatches. `tests/schema-drift-followups.test.mjs` now guards this class so
    future FK drift is caught before merge.
46. **EmailOutbox has no retention policy** — stale claim. `pruneEmailOutboxRetention()`
    runs from the daily notification-prune cron and deletes terminal outbox rows
    after 30 days.
47. **Verbose health token uses non-constant comparison** — stale claim.
    `isVerboseHealthRequest()` hashes both supplied and configured tokens and
    compares the digests with `timingSafeEqual()`.
48. **Buy Now loaded Stripe.js for crawlers before checkout intent** — code fix.
    `BuyNowCheckoutModal` now dynamically imports `EmbeddedCheckoutPanel` only
    when the buyer reaches the payment step, keeping listing-page crawlers from
    loading Stripe.js. Sentry filtering drops bot-only Stripe.js load failures
    while preserving real buyer checkout failures. Regression coverage:
    `tests/checkout-script-inventory.test.mjs` and
    `tests/sentry-filter.test.mjs`.
49. **Made-to-order cart add duplicate-submit race could surface P2002** — code
    fix. `/api/cart/add` now uses the same create-then-update idempotency
    pattern for made-to-order cart rows that in-stock rows already used, and the
    guardrail test rejects future `cartItem.upsert` drift in the add path.
    Regression coverage: `tests/order-state-followups.test.mjs`.
50. **Message stream abort cleanup could enqueue/close after client disconnect**
    — code fix. The SSE stream now uses safe enqueue/close helpers and a
    once-only abort listener, preventing abort races from throwing noisy
    WebStream lifecycle errors. Regression coverage:
    `tests/custom-order-admin-thread-followups.test.mjs`.
51. **CSP reports leaked dynamic path identifiers into Sentry tags/extras** —
    code fix. CSP report sanitization now turns dynamic path segments into
    route shapes such as `/messages/[id]` and `/listing/[id]` before Sentry
    tags, breadcrumbs, or sanitized report extras are emitted. Regression
    coverage: `tests/csp-report-sanitization.test.mjs`.
52. **CI high-severity dependency audit failure** — dependency hardening fix.
    Targeted package updates moved Clerk to `@clerk/nextjs@7.4.0`, Resend to
    `6.12.3`, Svix to `1.94.0`, and npm overrides force `js-cookie@3.0.7`
    plus the direct Svix spec, clearing the `js-cookie` and `uuid` advisory
    chains without using `npm audit fix --force`. Verification:
    `npm audit --audit-level=high`.
53. **Checkout error console logs could serialize raw Stripe/Prisma errors** —
    code fix. Single-seller and seller-group checkout routes now log sanitized
    error summaries via `sanitizeEmailOutboxError(err)` while keeping structured
    Sentry tags/extras for debugging. Regression coverage:
    `tests/payment-side-effect-observability.test.mjs`.
54. **Central email send failures logged raw errors to Vercel logs** — code
    fix. `src/lib/email.ts` now logs sanitized send-failure summaries and keeps
    hashed-recipient telemetry in Sentry. Regression coverage:
    `tests/account-privacy-observability.test.mjs`.
55. **Admin email audit logs stored raw recipient emails** — code fix. Admin
    staff email sends now audit by recipient user id when available, or by a
    hashed `email:sha256:...` target when the email is ad hoc. Raw recipient
    emails stay out of durable `AdminAuditLog.targetId`. Regression coverage:
    `tests/admin-moderation-observability.test.mjs`.
56. **New-message email throttle was a read-before-write race** — code/schema
    fix. Conversations now track `lastMessageEmailSentAt`; the message send
    action claims the 5-minute email window with a guarded `updateMany` before
    calling `sendNewMessageEmail`, preventing concurrent duplicate message
    emails. Regression coverage:
    `tests/custom-order-admin-thread-followups.test.mjs`.
57. **Grainline-branded email images accepted legacy UploadThing origins** —
    code fix. Email `<img>` URL validation now uses first-party media origins
    only, so old UploadThing URLs are omitted from rendered emails instead of
    being embedded if legacy tenancy changes. Regression coverage:
    `tests/pr-i-media-upload-unsubscribe-followups.test.mjs`.
58. **One-click unsubscribe had only IP-level mutation throttling** — code fix.
    `POST /api/email/unsubscribe` now adds a per-signed-email hash throttle
    before mutation while preserving RFC 8058 one-click POST support and the
    non-mutating GET confirmation page. Regression coverage:
    `tests/pr-i-media-upload-unsubscribe-followups.test.mjs`.
59. **Admin email form relied on placeholder-only fields** — accessibility fix.
    Admin staff email controls now have programmatic labels, an accessible close
    button name, and a polite status region for send success/failure. Regression
    coverage: `tests/accessibility-followups.test.mjs`.
60. **Follow toggle state was visible-only** — accessibility fix. Follow buttons
    now expose `aria-pressed` and hide the decorative checkmark from assistive
    tech while keeping the visible count. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
61. **Unread badge count lacked context for screen readers** — accessibility fix.
    Unread badges now announce "`N` unread message(s)" and hide the bare visual
    number from assistive tech. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
62. **Blog comment form textarea lacked a programmatic label** — accessibility
    fix. Blog comments/replies now label the textarea, connect error text via
    `aria-describedby`, and expose errors as alerts. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
63. **Review composition controls lacked labels** — accessibility fix. The
    rating select and comment textarea now have programmatic labels. Regression
    coverage:
    `tests/accessibility-followups.test.mjs`.
64. **Shipping rate choices lacked group semantics** — accessibility fix.
    Shipping rates now render inside a `fieldset` with a seller-specific
    `legend`, preserving the existing radio inputs. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
65. **Browse filter radio/price/location controls lacked fieldsets and labels**
    — accessibility fix. Listing type, price range, and location radius now use
    semantic grouping and per-input labels; category/rating/sort/ships controls
    also have explicit `htmlFor`/`id` pairs. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
66. **Listing type toggle buttons lacked radio semantics** — accessibility fix.
    Listing create/edit type toggles now expose a radiogroup and radio checked
    state while keeping the existing visual button design. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
67. **Variant editor option rows were placeholder-only** — accessibility fix.
    Variant option name and price-adjustment inputs now have row-specific
    screen-reader labels generated from a stable component id. Regression
    coverage: `tests/accessibility-followups.test.mjs`.
68. **Review star preview was decorative-only** — accessibility fix. Review
    composer star display now has `role="img"` with the actual rating label and
    hides the decorative fill layers. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
69. **Browse filter standalone labels were not associated with controls** —
    accessibility fix. Category, ships-within, minimum rating, and sort controls
    now use explicit labels tied to input/select ids. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
70. **Block/report dropdown form lacked labels** — accessibility fix. Report
    reason and details controls now have explicit labels/ids while preserving
    the compact dropdown layout. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
71. **Address autocomplete lacked combobox/listbox semantics** — accessibility
    fix. Address search now exposes combobox state, a listbox of options, and
    Arrow/Enter/Escape keyboard handling. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
72. **PDF attachment links did not announce new-tab behavior** — accessibility
    fix. Message PDF chips now include SR-only "in a new tab" copy alongside
    the visible "Open" affordance. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
73. **FavoriteButton tap target was below the 44px polish target** —
    accessibility polish. Favorite buttons now use `p-2.5` while keeping the
    same visual placement. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
74. **Decorative close glyphs were announced despite labeled buttons** —
    accessibility polish. Image lightbox and listing-gallery close glyphs are
    now hidden from assistive tech while the buttons keep their accessible
    labels. Regression coverage: `tests/accessibility-followups.test.mjs`.
75. **Homepage scroll indicator SVG was decorative but exposed** —
    accessibility polish. The scroll chevron is now `aria-hidden`. Regression
    coverage: `tests/accessibility-followups.test.mjs`.
76. **Account popover used menu roles without menu keyboard behavior** —
    accessibility fix. `UserAvatarMenu` now stays a plain link/button popover,
    avoiding ARIA `menu`/`menuitem` promises it does not implement. Regression
    coverage: `tests/accessibility-followups.test.mjs`.
77. **StarInput slider lacked keyboard controls** — accessibility fix. The star
    slider now supports Arrow/Home/End keys, exposes `aria-valuetext`, and
    labels its fallback select. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
78. **Footer sub-line contrast was too low** — accessibility fix. The Texas
    footer sub-line now uses solid `text-stone-100` instead of translucent
    `text-stone-300/60`. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
79. **Vacation mode warning toggle and message boundary tightened** — UX/security
    fix. The seller vacation warning state now explicitly lets the switch-off
    action cancel pending enablement, matching the Cancel button, and the
    buyer-facing vacation message is sanitized/truncated at the API boundary
    before persistence. Regression coverage:
    `tests/vacation-mode-followups.test.mjs`.
80. **Block-filter behavior now has explicit guardrail coverage** — test fix.
    `tests/block-filter-guardrails.test.mjs` verifies the shared block helper
    reads both block directions, excludes deleted participants, and derives
    seller-profile blocks from the blocked user set so privacy filtering cannot
    silently drift across seller/listing/blog/message surfaces.
81. **Email plaintext fallbacks no longer reintroduce decoded markup** —
    security/UX fix. `htmlToText()` removes head/style/script blocks before
    tag stripping and repeats the tag-removal pass after entity decoding, so
    escaped user content cannot show up as raw-looking `<script>` markup in
    plaintext emails. Regression coverage: `tests/email-text.test.mjs`.
82. **Resend transient-failure counting is atomic** — reliability fix.
    `/api/resend/webhook` now records final `email.failed` events through one
    `INSERT ... ON CONFLICT ... DO UPDATE` statement, preserving the existing
    five-failure/30-day suppression threshold without under-counting concurrent
    webhook deliveries. Regression coverage:
    `tests/account-privacy-observability.test.mjs`.
83. **Round 2 top chained-exploit claims re-verified against current main** —
    stale/closed audit sweep. Claude #349 (similar-listing block bypass), #350
    (sanitize/entity XSS chain), #351 (Founding Maker number race), #353
    (dev make-order production gate), and #354 (saved-search amplification)
    are already fixed on current `main` with existing guardrails covering the
    relevant behavior. No code changes were needed for those five claims.
84. **Existing-listing photo manifest conflicts fail cleanly** — storage
    hardening fix. Existing-listing photo uploads/re-crops remain staged until
    Save, and the Save-time transaction now checks `photo.updateMany().count`
    for each retained photo id. If a concurrent cleanup removed a row after the
    edit page loaded, the action returns a refresh error and best-effort deletes
    newly submitted R2 URLs instead of silently leaking an uploaded object.
    Regression coverage: `tests/r56-r67-small-fixes.test.mjs`.
85. **JSON-LD script embedding guardrail tightened** — rendering security
    fix. `safeJsonLd()` still escapes `<` for script-breakout protection and
    now also escapes bidi/line-separator controls so structured-data payloads
    cannot hide confusing directional text in embedded JSON. Regression
    coverage: `tests/rendering-security.test.mjs`.
86. **Round 2 race/test-gap claims re-verified against current main** —
    stale/closed audit sweep. Claude #418 (blog slug P2002), #424 (cart update
    P2025 after checkout cleanup), #428 (JSON-LD escape test), #429 (block
    helper test), #430 (Shippo carrier/local-pickup quote state), #433
    (rate-limit fail-open/fail-closed policy), and the Sentry follow-up claims
    for notification P2002/cart-add P2002/Googlebot Stripe.js noise are already
    fixed or covered on current `main`.
87. **AI review response normalization is directly tested** — guardrail fix.
    The OpenAI listing-moderation response normalizer now lives in
    `src/lib/aiReviewResultState.ts`, where malformed provider responses can be
    unit-tested without Prisma/OpenAI. Missing or wrong-shaped responses fail
    closed with `approved: false`, confidence `0`, bounded text, and padded
    fallback alt text. Regression coverage:
    `tests/ai-review-result-state.test.mjs`.
88. **Reverse-geocode Nominatim throttle fails closed under shared-lock pressure**
    — third-party policy hardening fix. `reverseGeocode()` now requires the
    shared Redis Nominatim lock before calling OpenStreetMap and skips external
    geocoding with Sentry telemetry when Redis is unavailable or the lock stays
    contended. It no longer falls back to per-instance local throttling, which
    cannot enforce a global 1 req/sec limit across Vercel instances. Regression
    coverage: `tests/reverse-geocode-throttle.test.mjs`.
89. **Refund-lock cleanup no longer masks notification-prune health** — cron
    observability fix. The daily notification prune still releases stale refund
    locks as a side job, but refund-lock release errors are now caught and sent
    to Sentry with source `cron_refund_lock_release` instead of failing the
    notification/email/webhook retention cleanup under the generic
    `cron_notification_prune` source. Regression coverage:
    `tests/retention-and-ops-followups.test.mjs`.
90. **Auto-created metro logs no longer include locality detail** — privacy
    polish. `findOrCreateMetro()` still logs that a metro was created, but it
    no longer emits the slug/city/state derived from a seller pickup location,
    avoiding log-timing correlation between onboarding requests and seller
    geography. Regression coverage: `tests/geo-metro-privacy.test.mjs`.
91. **Non-listing sitemap chunk cannot exceed the XML entry limit** — SEO
    guardrail fix. `/sitemap/0.xml` now passes the combined static,
    seller/shop/customer-photo, blog, commission, metro, and metro-category
    route set through `limitSitemapEntries()` so it never emits more than
    50,000 URLs. Listing routes remain chunked separately at 5,000 per sitemap.
    Regression coverage: `tests/sitemap-entry-limit.test.mjs`.
92. **Quality-score AI flags tolerate malformed row data** — cron reliability
    fix. `qualityPenaltyForListing()` now normalizes `aiReviewFlags` through
    `normalizeQualityScoreAIReviewFlags()`, ignoring non-string array members
    and non-array values before applying moderation penalties. The daily
    quality-score cron no longer depends on every raw-SQL flag value being a
    clean string. Regression coverage: `tests/quality-score-state.test.mjs`.
93. **Stock updates use the atomic Guild listing-threshold sync** — race
    hardening fix. `/api/listings/[id]/stock` now calls the shared
    `syncGuildMemberListingThreshold()` helper instead of its old local
    read-then-write threshold helper, so stock-driven ACTIVE/SOLD_OUT changes
    use the same single-SQL, active-public-listing threshold calculation as
    dashboard/shop listing state changes. Regression coverage:
    `tests/guild-listing-edit-followups.test.mjs`.
94. **Checkout shipping estimated-days metadata is bounded** — defensive
    checkout hardening fix. Both checkout routes now reject selected shipping
    rates whose `estDays` is not a positive integer within the supported
    60-day window, and the Stripe webhook re-bounds
    `shipping_rate_data.metadata.estDays` before computing
    `estimatedDeliveryDate`. Quantity parsing still uses the existing
    positive-int fallback helper. Regression coverage:
    `tests/checkout-est-days-bounds.test.mjs` and
    `tests/stripe-webhook-state.test.mjs`.
95. **Cart update preserves the cart-wide total quantity cap** — cart hardening
    parity fix. `/api/cart/update` now recalculates projected total cart
    quantity before increasing an existing row and rejects updates that would
    exceed the same 200-total-item limit enforced by `/api/cart/add`. This
    closes the remaining path where an existing cart item could be inflated
    after the add route's distinct-row and total-quantity checks had already
    passed. Regression coverage: `tests/order-state-followups.test.mjs`.
96. **Accessibility guardrails extended across counters, attachments, and
    ratings** — UI hardening fix. Shared character-counter fields now expose
    generated IDs, connect controls to their counters with `aria-describedby`,
    and announce changes politely. Listing photo alt-text modals now label the
    textarea, message attachment links avoid noisy glyph-only copy and announce
    new-tab behavior, read-only star displays expose an assistive label, and
    low-contrast pagination/checkout divider text was raised to neutral-500 or
    marked decorative. Regression coverage:
    `tests/accessibility-followups.test.mjs`.
97. **Future feed/notification timestamps no longer read as "just now"** —
    time-label correctness fix. The account feed and notification bell now
    validate timestamp parsing and render a calendar date for timestamps more
    than 60 seconds in the future instead of collapsing negative deltas to
    "just now". Regression coverage:
    `tests/post-launch-ui-followups.test.mjs`.
98. **Upload signature checks fail closed for images and unknown content types**
    — upload defense-in-depth fix. Current image uploads are server-processed
    through Sharp before R2, and current presigned direct uploads are limited
    to video/PDF, so Claude's Round 4 image-XSS severity was overstated for
    current routes. The shared verifier was still hardened so JPEG, PNG, WebP,
    PDF, MP4, and QuickTime content types require matching magic bytes, SVG is
    explicitly rejected, and unknown content types no longer pass by default.
    Regression coverage: `tests/upload-verification-token.test.mjs`.
99. **AI-review prompt-injection redaction covers common non-English and
    model-control markers** — AI safety hardening fix. `redactPromptInjection()`
    now redacts common Spanish/French/Portuguese/CJK/Korean/Russian control
    phrases plus ChatML markers, `[INST]` blocks, and `Human:` role labels
    before seller-provided listing text is included in the AI review prompt.
    Regression coverage: `tests/ai-review-safety.test.mjs`.
100. **Cart add/update reject obvious in-stock over-quantity before checkout**
     — cart UX and state-consistency fix. The checkout routes still own the
     authoritative atomic stock reservation, but `/api/cart/add` and
     `/api/cart/update` now reject requested quantities above live
     `stockQuantity` for in-stock listings so stale carts fail earlier with a
     clear "Only N available" response. Regression coverage:
     `tests/order-state-followups.test.mjs`.
101. **Founding Maker grant failures are observable in production** —
     operational hardening fix. `maybeGrantFoundingMaker()` remains non-fatal
     to listing publication, but failures now capture a warning-level Sentry
     exception tagged `founding_maker_grant` with bounded seller profile
     context instead of disappearing silently in production. Regression
     coverage: `tests/post-launch-ui-followups.test.mjs`.
102. **Shipping-rate HMAC canonicalization is separator-safe** — token
     hardening fix. `signRate()` / `verifyRate()` now build the canonical HMAC
     input as an ordered JSON array instead of a colon-joined string, so
     Shippo/carrier display names containing punctuation cannot shift field
     boundaries or create ambiguous token inputs. Regression coverage:
     `tests/shipping-token.test.mjs`.
103. **Self-purchase add-then-ban checkout race was already closed** —
     verified stale Round 4 Q finding. Single-listing checkout re-reads seller
     orderability (`chargesEnabled`, Stripe account, vacation/order block,
     banned/deleted user) before session creation, and the Stripe webhook
     revalidates paid sessions before order side effects. Existing guardrails:
     `tests/order-state-followups.test.mjs`.
104. **Account deletion keeps Clerk-delete ordering fail-closed** — verified
     stale Round 4 Q finding. `/api/account/delete` deletes the Clerk account
     before anonymization and does not mutate the local DB if Clerk deletion
     fails; if Clerk deletion succeeds but anonymization fails, the route
     returns the terminal support-follow-up state instead of reporting a clean
     deletion. Existing guardrails:
     `tests/account-deletion-timeout-fix.test.mjs`.
105. **Stripe charges-enabled backfill has a deliberate production override**
     — verified stale Round 4 Q finding. `scripts/backfill-charges-enabled.ts`
     supports the explicit `--force-prod` operator flag and production
     environment checks, so the backfill is runnable when intentionally
     invoked for live Stripe reconciliation.
106. **Checkout transfer math no longer deducts estimated Stripe processing
     fees from sellers** — verified stale Round 4 Q finding. Checkout seller
     transfers use the documented platform-absorbs-Stripe-fee model: sellers
     pay the 5% platform fee, and Stripe processing is not double-deducted
     from `transfer_data.amount`. Existing guardrails:
     `tests/checkout-amounts.test.mjs`.
107. **Banned/deleted review authors render as former buyers** — verified
     stale Round 4 Q finding. `ReviewsSection` uses the current
     `reviewerUnavailable()` / `reviewerName()` / `reviewerInitials()` helpers
     so public review UI does not expose banned or deleted account identity.
108. **Account deletion scrubs order address PII** — verified stale Round 4 Q
     finding. `accountDeletion.ts` clears buyer names/emails, shipping address
     lines, quoted address fields, phone, gift note, and sets
     `buyerDataPurgedAt` so order fulfillment history can remain without
     retaining the deleted buyer's address details. Existing guardrails:
     `tests/order-pii-retention.test.mjs`.
109. **Stripe checkout shipping-address casts are centralized** — webhook type
     safety cleanup. Order creation in the Stripe webhook now reads
     `shipping_details.address` through one `checkoutSessionShippingAddress()`
     helper instead of repeating inline `as unknown as { shipping_details... }`
     casts for every address field. Regression coverage:
     `tests/stripe-webhook-state.test.mjs`.
110. **Email outbox terminal-retention query is indexed** — performance and
     retention hardening fix. `EmailOutbox` now has a `[status, updatedAt]`
     index so `pruneEmailOutboxRetention()` can efficiently delete terminal
     `SENT`/`SKIPPED`/`DEAD` rows in updated-at order instead of relying on
     unrelated outbox indexes as volume grows. Regression coverage:
     `tests/email-outbox-retention.test.mjs`.
111. **Admin PIN SameSite drift was already closed** — verified stale Round 4
     ASVS finding. Current `/api/admin/verify-pin` sets the signed admin PIN
     cookie with `sameSite: "strict"` for both normal and local-dev bypass
     success paths, matching the privileged-cookie contract in `CLAUDE.md`.
112. **Direct upload verification already byte-sniffs stored video/PDF bytes**
     — verified stale Round 4 ASVS finding. `/api/upload/verify` reads the
     first bytes from R2 with `GetObjectCommand` range requests, rejects
     mismatched signatures through `uploadFileSignatureMatches()`, and deletes
     unverifiable or invalid objects before returning success. Existing
     guardrail: `tests/upload-verification-token.test.mjs`.
113. **Email outbox quota-counter outages use retry cadence** — verified stale
     Round 4 email finding. `emailOutboxQuotaDeferralState()` decrements the
     claim attempt and schedules quota-counter outage retries through
     `emailOutboxRetryDelayMs()` instead of delaying every touched job until
     the next UTC midnight. Existing guardrail:
     `tests/email-outbox-state.test.mjs`.
114. **Dead email outbox rows are monitored and pruned** — verified stale Round
     4 retention finding. `ops-health` counts `DEAD` outbox rows, and
     `pruneEmailOutboxRetention()` deletes terminal `SENT`/`SKIPPED`/`DEAD`
     rows after the documented 30-day retention window. Existing guardrail:
     `tests/email-outbox-retention.test.mjs`.
115. **Data tables have captions and scoped headers** — accessibility fix.
     Seller-fee, admin case/order/review/audit/user, and seller analytics
     tables now include screen-reader captions and `scope="col"` on all header
     cells, with hidden text for action columns. Regression coverage:
     `tests/accessibility-followups.test.mjs`.
116. **Resend webhook stored-error sanitization was already closed** —
     verified stale observability finding. `markWebhookFailed()` writes
     `sanitizeEmailOutboxError(err)` to `ResendWebhookEvent.lastError`, keeping
     raw provider errors out of durable webhook state.
117. **Stripe completed-checkout emails already have outbox fallback** —
     verified stale email-delivery finding. Time-critical order confirmation
     and first-sale emails call `sendOrderTransactionalEmailWithFallback()`,
     direct-send first, then enqueue deterministic `EmailOutbox` fallback on
     direct-send failure without blocking the Stripe webhook response.
118. **Email outbox HTML is bounded at write and schema layers** — verified
     stale storage finding. `enqueueEmailOutbox()` truncates rendered HTML to
     200,000 characters, and `EmailOutbox.html` is bounded by
     `@db.VarChar(200000)`.
119. **Email outbox error sanitization redacts Stripe IDs and cuids** —
     verified stale observability finding. `sanitizeEmailOutboxError()` redacts
     emails, URLs, provider tokens, common Stripe IDs, cuids, and long hex
     tokens before console/lastError storage. Existing guardrail:
     `tests/email-outbox-sanitize.test.mjs`.
120. **Broad Prisma user relation selects are source-guarded** — authorization
     and PII-overfetch guardrail. Current source has no `include: { user: true }`
     or `select: { user: true }` relation loads, and
     `tests/verified-audit-followups.test.mjs` now scans `src/**/*.ts(x)` so
     future route changes must keep user relation fields explicitly narrowed.
121. **HMAC secret rotation cadence is documented** — verified stale ASVS
     process finding. `docs/runbook.md` now includes a Secret Rotation section
     with 90-day hot HMAC/application-secret cadence, annual provider/webhook
     rotation guidance, zero-downtime dual-verify preference, and emergency
     rotation notes.
122. **Checkout SRI omission is documented as an intentional PCI/security
     decision** — verified stale ASVS process finding. `CLAUDE.md`,
     `docs/security-hardening-plan.md`, and
     `docs/checkout-script-inventory.md` document that Stripe.js must load
     directly from `js.stripe.com`, stale SRI hashes must not be added blindly,
     and CSP/inventory/change control are the compensating controls.
123. **Unsubscribe email query parameter is documented as an accepted
     one-click tradeoff** — verified stale ASVS process finding. `CLAUDE.md`
     documents GET as confirmation-only, POST as the only mutating path,
     signed/rate-limited unsubscribe tokens, `Referrer-Policy:
     strict-origin-when-cross-origin`, no third-party resources on the
     confirmation page, and no raw query/token logging.
124. **Cart add cap checks are serialized inside a cart-row lock** —
     concurrency hardening fix. `/api/cart/add` now locks the buyer's `Cart`
     row inside a transaction before re-reading item count/quantity state and
     creating or incrementing `CartItem`, so concurrent adds cannot slip past
     the 50 distinct item or 200 total quantity caps. Regression coverage:
     `tests/order-state-followups.test.mjs`.
125. **Stripe capability webhooks cannot re-enable inactive local sellers** —
     verified stale Round 4 charges-enabled race finding. Shared
     `mirrorStripeChargesEnabled()` selects the local account state, computes
     `effectiveChargesEnabled = stripeChargesEnabled && !banned && !deletedAt`,
     logs an ownership-violation security event when Stripe reports true for
     an inactive local account, and expires open checkout sessions when the
     effective state is disabled. Existing guardrail:
     `tests/stripe-webhook-v2-route.test.mjs`.
126. **Admin audit-log identifier retention is disclosed in the Privacy
     Policy** — privacy documentation fix. Account deletion keeps
     `AdminAuditLog.adminId` for permanent moderation/legal/undo audit
     integrity while redacting/anonymizing associated profile and contact
     metadata. `/privacy` now tells users that deleted administrator account
     internal identifiers may remain on administrative logs for those purposes.
     Regression coverage: `tests/launch-readiness-followups.test.mjs`.
127. **Non-listing sitemap entries are chunked instead of silently truncated**
     — SEO correctness fix. `/sitemap_index.xml` now counts seller, customer
     photo, blog post, commission, and listing row sources; `/sitemap/0.xml`
     contains only static/metro/category/index routes, while each large dynamic
     source gets first-class chunks through `sitemapChunkForId()`. This closes
     the Round 4 #632/#82/#2468 concern that non-listing routes could be packed
     into chunk `0` and sliced at 50,000 entries. Regression coverage:
     `tests/sitemap-index.test.mjs` and `tests/sitemap-entry-limit.test.mjs`.
128. **Runtime currency fallbacks use `DEFAULT_CURRENCY`** — cleanup and
     future-proofing fix. Application pages, API routes, client components,
     anonymous-cart snapshots, and Stripe webhook state now import the shared
     `DEFAULT_CURRENCY` constant instead of scattering raw `"usd"` fallbacks.
     Schema defaults, migrations, and test fixtures remain literal by design.
     Regression coverage: `tests/money.test.mjs`.
129. **Obsolete root Prisma demo seed scripts removed** — repo hygiene and
     typecheck-integrity fix. `prisma/seed.ts` and `prisma/seed-bulk.ts` were
     stale, destructive/demo-only scripts excluded from TypeScript checking and
     no longer referenced by package scripts. They were removed, their env flags
     were dropped from `.env.example`, and `tsconfig.json` no longer carries
     per-file exclusions for them. The supported seed path remains
     `npm run seed:metros`. Regression coverage:
     `tests/verified-audit-followups.test.mjs`.
130. **Direct-upload image magic-byte finding was already closed** — verified
     stale Round 4 P-10 finding. `/api/upload/presign` rejects image content
     types and routes images through the processed image endpoint, while
     `uploadFileSignatureMatches()` already byte-sniffs JPEG, PNG, WebP, PDF,
     MP4/QuickTime and rejects SVG. Existing guardrails:
     `tests/upload-verification-token.test.mjs` and
     `tests/upload-ux-followups.test.mjs`.
131. **Listing pages lazy-load Stripe checkout modal code** — production
     Sentry noise fix. `BuyNowButton` no longer statically imports or mounts
     `BuyNowCheckoutModal` while closed, so listing-page crawls do not eagerly
     pull the Embedded Checkout/Stripe.js path. Stripe code still loads when a
     signed-in buyer opens Buy Now. Regression coverage:
     `tests/verified-audit-followups.test.mjs`.
132. **Notification duplicate-create races are idempotent** — verified stale
     production Sentry finding. `createNotification()` treats Prisma `P2002`
     from the `Notification(userId,type,dedupKey)` unique constraint as a
     dedup collision, returns the existing notification when available, and
     never lets duplicate notification inserts break the primary follow/comment
     mutation. Existing guardrail: `tests/social-interaction-hardening.test.mjs`.
133. **Founding Maker grant failures are observable** — verified stale Round 4
     P-8 finding. `maybeGrantFoundingMaker()` keeps the badge grant
     non-blocking, but production failures are captured to Sentry at warning
     level with `source: founding_maker_grant` and bounded seller-profile
     context. Existing guardrail: `tests/post-launch-ui-followups.test.mjs`.
134. **Sentry event messages and exception values are PII-scrubbed** —
     verified stale observability finding. `beforeSend()` redacts top-level
     `event.message`, transactions, request URLs/query strings, nested
     exception values, stack-frame vars, extras, contexts, tags, headers,
     cookies, and user metadata before upload. Existing guardrail:
     `tests/sentry-filter.test.mjs`.
135. **Email inactive-account lookup logs are sanitized** — verified stale
     email observability finding. `findInactiveEmailAccount()` logs sanitized
     error text through `sanitizeEmailOutboxError()` and sends only hashed
     recipient telemetry to Sentry. Existing guardrail:
     `tests/account-privacy-observability.test.mjs`.
136. **Dead email-outbox jobs are monitored and retained intentionally** —
     verified stale outbox retention finding. `ops-health` includes
     `deadEmailOutboxCount`; `notification-prune` calls the shared
     `pruneEmailOutboxRetention()` path so dead-letter accumulation is visible
     and retained/deleted under the documented outbox retention rules.
     Existing guardrails: `tests/email-outbox-retention.test.mjs` and
     `tests/retention-and-ops-followups.test.mjs`.
137. **Resend transient failures no longer auto-suppress on delayed delivery**
     — verified stale notification DoS finding. Resend webhook handling only
     counts `email.failed` as transient failure evidence, ignores
     `email.delivery_delayed` for suppression, and requires five failures in
     the rolling window before suppressing. Existing guardrail:
     `tests/account-privacy-observability.test.mjs`.
138. **Blog status input is validated before Prisma enum writes** — hardening
     fix. Blog create/edit server actions now parse status through
     `parseCreateBlogStatus()` / `parseUpdateBlogStatus()` and return a clean
     action error for forged statuses instead of relying on unsafe TypeScript
     casts that could bubble Prisma enum errors. Regression coverage:
     `tests/blog-action-guardrails.test.mjs`.
139. **Similar-listing carousel respects block visibility** — verified stale
     block-bypass chain. `/api/listings/[id]/similar` resolves the signed-in
     user, rejects restricted accounts, loads reciprocal blocked seller IDs
     through `getBlockedSellerProfileIdsFor()`, and excludes those sellers in
     the raw SQL candidate query. Existing guardrail:
     `tests/public-cron-search-hardening.test.mjs`.
140. **Saved-search duplicates and caps are serialized** — verified stale
     saved-search DoS chain. Saved-search POST normalizes and sorts tags,
     runs dedup/count/create inside `withSerializableRetry()` with Prisma
     Serializable isolation, and GET/POST/DELETE all use fail-closed
     `savedSearchRatelimit` before current-user data reads/writes. Existing
     guardrails: `tests/r49-account-state-routes.test.mjs` and
     `tests/schema-hardening-followups.test.mjs`.
141. **Verification application writes are fail-closed rate-limited** —
     verified stale admin-queue DoS finding. `/api/verification/apply` uses
     `verificationApplyRatelimit` through `safeRateLimit()` after seller
     account resolution and before body parsing, eligibility checks, and
     `MakerVerification` upsert. Existing guardrail:
     `tests/guild-listing-edit-followups.test.mjs`.
142. **Support intake no longer fails open on limiter outage** — hardening
     fix. `/api/support` now uses fail-closed `safeRateLimit()` instead of
     `safeRateLimitOpen()` before parsing, creating durable `SupportRequest`
     rows, or sending support email. Legal data requests remain intentionally
     fail-open as a user escalation path. Regression coverage:
     `tests/public-cron-search-hardening.test.mjs`.
143. **Blog notification spam/dedup chain is closed** — verified stale chain.
     Admin comment approval side effects now run only after
     `updateMany({ approved: false })` succeeds and pass
     `dedupScope: commentId`; maker blog update preserves the first
     publication timestamp and follower fanout only runs on the first-ever
     publish, not archive/re-publish cycles. Existing guardrail:
     `tests/blog-action-guardrails.test.mjs`.
144. **Duplicate-submit race UX paths return friendly conflicts** — verified
     stale concurrency findings. Review creation catches duplicate `P2002` and
     returns 409 "Already reviewed"; case creation catches duplicate order case
     `P2002` and returns 409; review helpful-vote unvote uses `deleteMany`;
     cart update/delete uses `updateMany`/`deleteMany` and returns 409 when the
     cart item changed under it. Existing guardrails:
     `tests/social-interaction-hardening.test.mjs`,
     `tests/case-create-state.test.mjs`, and
     `tests/order-state-followups.test.mjs`.
145. **Message first-response timestamp is null-preconditioned** — verified
     stale metric-drift finding. Message thread replies set
     `Conversation.firstResponseAt` with `updateMany({ where: { id,
     firstResponseAt: null } })`, so parallel replies cannot overwrite the
     first recorded response time. Existing guardrail:
     `tests/custom-order-admin-thread-followups.test.mjs`.
146. **Accessibility audit cluster is guarded** — verified stale WCAG findings.
     Variant selectors, listing-type controls, case forms, checkout address
     errors, shipping-rate fieldsets, blog/review composition, admin email,
     image crop modal dialog behavior, maps/text alternatives, address
     autocomplete combobox behavior, compact header controls, footer contrast,
     and data-table captions/header scopes are covered by
     `tests/accessibility-followups.test.mjs`.
147. **Custom-order ready-link duplicate message race is serialized** —
     verified stale duplicate-message finding. `sendCustomOrderReadyLink()`
     takes a Postgres advisory transaction lock keyed by conversation/listing,
     checks for an existing `custom_order_link` message, and only sends buyer
     notification/email when the message was newly created. Existing guardrail:
     `tests/custom-order-admin-thread-followups.test.mjs`.
148. **Seller listing photo edits are save-staged and conflict-cleaned** —
     verified stale photo-mutation finding. The retired
     `/api/listings/[id]/photos` POST is gone; edit-page photos are staged in
     the form manifest until Save, committed in the listing transaction, and
     failed photo-row updates clean up newly submitted R2 URLs instead of
     silently orphaning them. Existing guardrails:
     `tests/post-launch-ui-followups.test.mjs` and
     `tests/upload-verification-token.test.mjs`.
149. **JSON-LD script-breakout escaping is tested** — verified stale test-gap
     finding. `safeJsonLd()` escapes `<` and bidi/line-separator controls
     before embedding structured data, and `tests/rendering-security.test.mjs`
     covers crafted `</script>`, comment-start, CDATA, and bidi payloads.
150. **Blog markdown sanitization is tested against unsafe render paths** —
     verified stale XSS test-gap finding. Blog markdown rendering stays behind
     `sanitize-html` with narrow URL schemes and first-party image filtering,
     guarded by `tests/rendering-security.test.mjs`.
151. **Email outbox quota-counter outages use retry cadence** — verified stale
     outbox delay finding. When the daily quota Redis counter is unavailable,
     `emailOutboxQuotaDeferralState()` schedules the job through the normal
     retry delay instead of deferring every queued email until UTC midnight;
     true quota exhaustion still waits for the daily reset. Existing guardrail:
     `tests/email-outbox-state.test.mjs`.
152. **Email-outbox errors redact Stripe IDs and cuids** — verified stale
     telemetry finding. `sanitizeEmailOutboxError()` redacts emails, URLs,
     Stripe-like IDs, Svix/webhook/API tokens, cuids, and long hex strings
     before persisting `lastError` or logging sanitized email failures.
     Existing guardrail: `tests/email-outbox-sanitize.test.mjs`.
153. **Resend webhook transient failure handling is retryable and bounded** —
     verified stale Resend webhook cluster. In-progress duplicate deliveries
     return 503 with `Retry-After`; suppression writes use minimal safe details
     instead of the full provider payload; transient failure counts are updated
     atomically; and per-recipient task failures are captured via
     `Promise.allSettled()` before retrying the webhook. Existing guardrails:
     `tests/account-privacy-observability.test.mjs` and
     `tests/resend-webhook-config.test.mjs`.
154. **Order-confirmation direct sends have outbox fallback** — verified stale
     transactional-email reliability finding. Stripe webhook order emails send
     immediately through `sendRenderedEmail(..., { throwOnFailure: true })`,
     then enqueue an idempotent outbox fallback if direct send fails, without
     blocking webhook success. Existing guardrail:
     `tests/post-launch-ui-followups.test.mjs`.
155. **Plain-text email fallback strips decoded HTML-like tags** — verified
     stale email text finding. `htmlToText()` removes `<head>`, style/script
     blocks, and tags both before and after entity decoding so encoded
     `<script>` text cannot reappear in the plain-text part. Existing guardrail:
     `tests/email-text.test.mjs`.
156. **Admin email audit logs do not store ad-hoc recipient emails verbatim** —
     verified stale compliance finding. Admin email sends to known users log
     the user ID; ad-hoc recipient sends log a hashed email target ID and
     Sentry telemetry uses hashed recipient context. Existing guardrail:
     `tests/admin-moderation-observability.test.mjs`.
157. **Rate-limit failure policy is unit-tested** — verified stale test-gap
     finding. `limitWithFailurePolicy()` is covered for fail-closed protected
     writes/expensive reads and fail-open telemetry/diagnostic paths, while the
     public route sweep constrains where `safeRateLimitOpen()` may appear.
     Existing guardrails: `tests/ratelimit-policy.test.mjs` and
     `tests/public-cron-search-hardening.test.mjs`.
158. **Block helper query-shape coverage exists** — verified stale test-gap
     finding. `tests/block-filter-guardrails.test.mjs` guards reciprocal block
     lookup, deleted-participant exclusions, and blocked seller-profile ID
     derivation.
159. **Shipping quote behavior is covered by state-helper tests** — verified
     stale Shippo quote test-gap finding. `tests/shipping-quote-state.test.mjs`
     covers fallback shipping clamps, exact preferred-carrier matching, and
     same-currency carrier-filter behavior.
160. **Admin email is constrained to existing Grainline users** — code fix.
     The admin email API no longer sends to arbitrary raw email addresses; an
     email payload is treated only as a lookup key for an existing `User`, and
     the admin users page now tells staff to use the support mailbox for
     external replies.
161. **Case message double-submit side effects are serialized** — code fix.
     Case-message POSTs now take a short advisory lock keyed by case, author,
     and sanitized body, return the recent matching message for duplicate
     submits, and skip duplicate notification/email side effects.
162. **Admin listing actions resync Guild listing thresholds** — code fix.
     Admin listing removal and successful review approve/reject paths now call
     `syncGuildMemberListingThreshold()` with Sentry-captured best-effort
     errors so derived Guild eligibility state does not go stale after staff
     moderation actions.
163. **Account deletion locks before Clerk deletion** — code fix. The account
     deletion route now acquires the same Redis `account-delete:${userId}` lock
     before deleting the Clerk user, releases it if Clerk deletion fails, and
     passes the already-held lock into anonymization. This prevents
     double-submit/race retries from deleting the Clerk session before the
     server can return an in-progress response.
164. **Clerk welcome emails have outbox fallback** — code fix. The Clerk
     `user.created` webhook now renders buyer/seller welcome emails, attempts
     direct `sendRenderedEmail(..., { throwOnFailure: true })`, and enqueues
     idempotent email-outbox fallbacks if the direct send fails before marking
     the webhook processed.
165. **Node strip-types tests no longer depend on path aliases** — CI fix.
     Directly imported helper modules (`anonymousCart.ts` and
     `stripeWebhookState.ts`) now use relative `.ts` imports for shared money
     helpers, and `tsconfig.json` enables `allowImportingTsExtensions` under
     the existing no-emit setup so Node's test runner does not need a
     Next/tsconfig path resolver.
166. **Unsubscribe POST rejects explicit cross-origin browser requests** —
     code fix. `POST /api/email/unsubscribe` now rejects explicit Origin or
     Referer headers that do not match the request origin while preserving
     standards-compliant one-click unsubscribe providers that POST without
     browser origin metadata. The route still requires the signed unsubscribe
     token and keeps the existing IP plus signed-email throttles.
167. **Upload signature verification gap was already closed** — verified
     stale audit finding. `uploadFileSignatureMatches()` checks JPEG, PNG,
     WebP, PDF, MP4/QuickTime signatures, explicitly rejects SVG, and returns
     false for unknown content types. Regression coverage:
     `tests/upload-verification-token.test.mjs`.
168. **AI prompt-injection redaction already covers common non-English and
     model-control markers** — verified stale audit finding. The AI review
     prompt sanitizer redacts common Spanish/French/Portuguese/CJK/Korean/
     Russian prompt-control phrases plus ChatML, `[INST]`, and role markers.
     Regression coverage: `tests/ai-review-safety.test.mjs`.
169. **Bulk AI alt-text normalization now reuses the canonical sanitizer** —
     code cleanup. `normalizeAIReviewResult()` no longer carries a separate
     alt-text sanitizer; bulk review alt text now uses `sanitizeAIAltText()`
     from `aiReviewSafety.ts`, keeping confusable, bidi, protocol, and tag
     stripping behavior aligned with per-photo generated alt text.
170. **Cart stock and quantity-cap findings were already closed** — verified
     stale audit findings. `/api/cart/update` checks active seller state,
     made-to-order quantity, in-stock availability, and projected total cart
     quantity before updating an item; `/api/cart/add` locks the cart row in
     the add transaction before checking distinct-item and total-quantity caps.
171. **Founding Maker grant failure observability was already closed** —
     verified stale audit finding. `maybeGrantFoundingMaker()` wraps the
     advisory-lock assignment transaction in Sentry warning telemetry tagged
     `source: "founding_maker_grant"` while keeping the listing transition
     non-fatal.
172. **EmailOutbox retention index was already present** — verified stale
     audit finding. `EmailOutbox` has `@@index([status, updatedAt])`, matching
     the retention query shape used by notification pruning.
173. **Unicode/confusable normalization copies were consolidated** — code
     cleanup. Notification payloads, profanity matching, tag normalization,
     AI prompt-injection redaction, and AI alt-text sanitization now import the
     canonical `normalizeUserText()` helper from `sanitize.ts` instead of
     carrying local bidi/control/confusable regex tables that can drift.
174. **Email/outbox audit cluster #387-406 was re-verified on current main** —
     verified stale/accepted findings. Current code already handles Redis
     quota blips on normal retry cadence, prunes and monitors DEAD outbox rows,
     counts only final Resend failures with atomic failure counters, constrains
     admin email to existing users, throttles message notification emails,
     sanitizes plain-text email fallbacks and outbox errors, uses first-party
     listing images in email, rejects explicit cross-origin unsubscribe POSTs,
     adds direct-send outbox fallback for Stripe/Clerk webhook paths, dedupes
     case-message side effects, bounds `EmailOutbox.html`, stores minimal
     Resend suppression details, captures all settled recipient task failures,
     returns retryable status for in-progress Resend webhook reservations, and
     logs admin email audit targets by user ID or hashed fallback. The only
     accepted design in this range is that outbox deduplication is scoped by
     caller-provided `dedupKey`.
175. **Stripe checkout payment-intent references use runtime narrowing** —
     code cleanup. The remaining broad `as unknown as ExpandedPI` cast in the
     Stripe snapshot webhook was replaced with `checkoutSessionPaymentIntentRefs()`,
     which extracts payment intent, charge, application-fee, and transfer IDs
     through small runtime-narrowing helpers instead of trusting an expanded
     provider object shape inline.
176. **Base sitemap chunk no longer silently truncates** — code fix. Large
     dynamic sitemap sources were already chunked, but the base static/metro/
     category/commission-city chunk still used `.slice(0, SITEMAP_ENTRY_LIMIT)`.
     It now fails with Sentry evidence if that base chunk ever exceeds the
     protocol limit, so future scale pressure is visible instead of quietly
     dropping URLs.
177. **Partial seller refunds can explicitly restore purchased stock** — code
     fix. Seller-initiated partial refunds now expose an optional restore
     inventory control in `SellerRefundPanel`, send a bounded `restoreStock`
     array, validate requested quantities against the order's purchased
     in-stock items, reject restoration after shipped/delivered/picked-up
     states, and keep full-refund stock restoration automatic.
178. **Middleware account-state checks now use a short Redis cache with safe
     invalidation** — code fix. Middleware now reads ban/deletion/Terms/age
     state through a 60-second Redis cache that falls back to the database on
     cache miss, malformed cache data, or Redis errors. Cache invalidation is
     wired into terms acceptance, Clerk terms metadata writes, ban/unban,
     admin undo-ban, and account deletion. Cached missing users use an
     explicit `{ exists: false }` sentinel so Redis misses cannot be treated
     as a clean account state.
179. **AI alt-text HTML stripping now uses the canonical sanitizer** — code
     cleanup. `sanitizeAIAltText()` no longer carries a local regex-based
     HTML strip; it runs generated alt text through `sanitizeText()` before
     control-character cleanup and truncation, keeping AI alt-text persistence
     aligned with the shared user-text sanitizer.
180. **Vacation-mode enable confirmation is already cancellable from the
     toggle** — verified stale UX finding. `VacationModeForm` keeps a
     separate `pendingEnable` state while the warning is open; toggling off or
     pressing Cancel clears the warning without saving, and the Save button is
     disabled while confirmation is pending. Regression coverage:
     `tests/seller-ops-hardening.test.mjs`.
181. **Production Sentry noise cluster was already covered** — verified
     stale findings. Bot-only Stripe.js load failures are dropped by
     `beforeSend()` without hiding real buyer checkout failures, notification
     `P2002` collisions return the existing deduped notification when
     possible, and cart-add `P2002` collisions are handled inside the cart-row
     lock transaction. Regression coverage spans `tests/sentry-filter.test.mjs`,
     `tests/social-interaction-hardening.test.mjs`, and
     `tests/order-state-followups.test.mjs`.
182. **Round 4 fixed-not-logged checkout/account items were verified on
     current main** — verified stale/logging cleanup. Checkout preflight uses
     `sellerOrderBlockReason()` for seller orderability, account deletion
     deletes the Clerk user before local anonymization under the deletion lock,
     the production charges-enabled backfill requires `--force-prod`, seller
     transfers retain only the 5% platform fee without subtracting estimated
     Stripe processing fees, deleted/banned reviewers render as "Former buyer,"
     and account deletion scrubs shipping/gift-note buyer PII with
     `buyerDataPurgedAt`.
183. **Label-cost clawback failures now have durable retry state** — code fix.
     Shippo label purchase still succeeds independently from Stripe transfer
     reversal, but successful reversals now record `Order.labelClawbackStatus =
     "REVERSED"` and the Stripe reversal ID. Missing transfer IDs go to
     `"MANUAL_REVIEW"`. Stripe reversal failures go to `"RETRY_PENDING"` with
     retry counters/timestamps, and `/api/cron/label-clawback-retry` retries
     them with stable Stripe idempotency keys before final manual review.
184. **Shippo label double-purchase finding is stale on current main** —
     verified audit cleanup. The label route already claims the order through
     an atomic SQL `UPDATE "Order" SET "labelStatus" = 'PURCHASED'` guarded by
     `fulfillmentStatus = 'PENDING'`, no purchased label, no refund lock, and
     no refund ledger before calling Shippo. A concurrent request cannot pass
     that row-level update after the first claim commits. Regression source
     coverage lives in `tests/verified-audit-followups.test.mjs`.
185. **Dev make-order production-gate finding is stale on current main** —
     verified audit cleanup. `/api/dev/make-order` is gated by a positive local
     development check: `NODE_ENV === "development"`, `VERCEL !== "1"`,
     `VERCEL_ENV === undefined`, and `ENABLE_DEV_MAKE_ORDER === "true"`.
     `tests/public-cron-search-hardening.test.mjs` already blocks the old
     fragile `NODE_ENV !== "production"` / `!VERCEL_ENV` style.
186. **Shipping and ship-from address fields now share single-line
     normalization** — code hardening. `src/lib/addressFields.ts` centralizes
     address/name/phone cleanup, collapses CR/LF/Unicode line separators and
     repeated whitespace, and is used by saved account shipping addresses,
     seller ship-from settings, checkout shipping payloads before Stripe
     metadata/idempotency hashing, and shipping quote Shippo destinations.
187. **CI permissions, audit docs, and verification env tightened** — CI
     hardening. `.github/workflows/ci.yml` now declares `permissions:
     contents: read`, seeds deterministic CI-only upload verification,
     health-check, and email-outbox limit env values, and CLAUDE.md now matches
     the real blocking `npm audit --audit-level=high` CI behavior instead of
     the old informational-audit wording.
188. **Account deletion now writes its own retained audit row** — forensic
     hardening. `anonymizeUserAccount()` creates a `USER_ACCOUNT_DELETE`
     `AdminAuditLog` row inside the 30s deletion transaction before the `User`
     row is anonymized, with non-PII metadata for seller/Stripe presence and
     Stripe reject success. The existing post-transaction audit-redaction pass
     still marks direct account-reference logs for deletion retention.
189. **Terms acceptance now writes a retained audit row** — forensic
     hardening. `POST /api/account/accept-terms` still writes durable
     `User.termsAcceptedAt`, `termsVersion`, and `ageAttestedAt` before
     invalidating the middleware account-state cache, and now also records a
     non-blocking `TERMS_ACCEPTED` user audit row with the accepted version and
     timestamps so clickwrap acceptance has a retained compliance trail.
190. **Favorites ensure-user failure logs no longer include Clerk user IDs** —
     observability cleanup. `POST /api/favorites` still returns 401 if the
     local account lookup fails, but the catch-path console telemetry now keeps
     only the error message instead of pairing that failure with the raw Clerk
     `userId`.
191. **Round 5 privacy/observability cluster is stale on current main** —
     verified audit cleanup. Current code already scrubs Sentry messages,
     transactions, exception values, extras, contexts, tags, request URLs, and
     query strings through `src/lib/sentryFilter.ts`; checkout and Stripe
     webhook catch paths log sanitized errors with bounded tags; central email
     logs and Sentry extras use hashed email telemetry; raw `[PROFANITY]`
     match-word console lines are gone in favor of `captureProfanityFlag()`;
     CSP reports are sanitized through `src/lib/cspReport.ts`; Resend webhook
     `lastError` uses `sanitizeEmailOutboxError()` and suppression details keep
     only safe event metadata plus recipient hashes; ban audit metadata stores
     review-note hashes/lengths instead of note text; `htmlToText()` strips
     decoded entity-encoded tags/head content; `EmailOutbox` has retention,
     DEAD-job ops-health monitoring, bounded HTML, quota-outage retry cadence,
     and expanded error redaction for Stripe IDs and cuids. The remaining
     favorites Clerk-ID console leak was closed separately above.
192. **Round 2 race/TOCTOU priority cluster is stale on current main** —
     verified audit cleanup. The sampled race findings from the raw Round 2
     list are already guarded: create-time listing AI review only writes while
     `status = PENDING_REVIEW`, Guild listing-threshold sync uses one SQL
     `CASE`/`COUNT` update, saved searches run dedup/count/create inside
     `withSerializableRetry()`, custom-order ready links take an advisory
     transaction lock before creating the durable message, blog comment approval
     side effects run only after `updateMany({ approved: false })`, review/case
     duplicate creates return friendly 409s on `P2002`, review unvotes and cart
     updates use `deleteMany`/`updateMany`, message `firstResponseAt` is
     null-preconditioned, edit-photo conflict cleanup deletes new uploaded R2
     URLs, follow rechecks block state after insert and deletes the row on a
     race, Stripe webhooks return retryable 503 while an event is in progress,
     and account deletion uses the Redis deletion lock before Clerk deletion.
193. **Round 2 accessibility launch-blocker cluster is stale on current main**
     — verified audit cleanup. The current code already has VariantSelector
     radiogroup/radio semantics with roving Arrow-key handling, OpenCaseForm
     labels and alert-linked errors, ShippingAddressForm `aria-invalid` and
     `aria-describedby` errors, AdminEmailForm labels and close-button name,
     ImageCropModal dialog semantics/focus/scroll-lock/Escape handling, and
     labelled map widgets with screen-reader summaries. Existing regression
     coverage lives in `tests/accessibility-followups.test.mjs`,
     `tests/review-vote-visibility.test.mjs`, and related a11y guardrail tests.
194. **Round 2 adversarial-persona cleanup cluster is stale on current main**
     — verified audit cleanup. Banned/deleted reviewers render as "Former
     buyer"; seller ban/account deletion cleanup removes commission interests,
     seller metrics, seller rating summaries, stale reports, and seller review
     replies; Clerk `user.created` clears only account-deletion email
     suppressions for re-signups; sensitive Guild reinstatement/feature actions
     require `ADMIN`; report resolution reasons are required and persisted; and
     banned users remain blocked from Stripe dashboard links, messages,
     fulfillment, and label flows through `ensureUserByClerkId()`/account-state
     checks.
195. **Round 3 Unicode/email-normalization root-cause cluster is stale on
     current main** — verified audit cleanup. `src/lib/sanitize.ts` is now the
     single canonical sanitizer for NFKC normalization, U+061C/bidi stripping,
     zero-width removal, null-byte removal, Cyrillic-confusable folding, HTML
     stripping, dangerous protocol removal, and code-point-safe truncation.
     Email writers/readers now align on NFC/lowercase normalization through
     `normalizeEmailAddress()` or equivalent helpers; newsletter and unsubscribe
     flows normalize consistently; profanity, AI-review, notification payload,
     support request, and tag helpers delegate to canonical normalization; email
     body/plain-text rendering strips bidi/zero-width/null controls; and
     shipping address fields use single-line normalization before persistence or
     carrier/Stripe payload use.
196. **Payment/webhook race cluster is stale on current main** — verified audit
     cleanup. Stripe capability mirroring suppresses `chargesEnabled` when the
     local seller user is banned or deleted; account deletion clears Stripe
     account references and forces `chargesEnabled=false`/`vacationMode=true`;
     both Stripe webhook routes return retryable `503` with `Retry-After` while
     a duplicate event is already in progress; account deletion takes the Redis
     `account-delete:${userId}` lock before Clerk deletion/anonymization;
     custom-order ready links use an advisory transaction lock; blog comment
     approval side effects run only after `updateMany({ approved: false })`;
     blog create retries `P2002` slug collisions; and message `firstResponseAt`
     is set with a null precondition. The remaining partial-refund accounting
     question is downgraded to a Stripe test-mode reconciliation proof, not a
     confirmed exploit.
197. **Round Q stale "still open" rows rechecked against current main** —
     verified audit cleanup. Non-listing sitemap sources are chunked through
     `sitemapChunkForId()`; Stripe checkout shipping address access is behind
     `checkoutSessionShippingAddress()` with no `as unknown as` casts; seller
     partial refunds support explicit bounded stock restoration; middleware uses
     the Redis account-state cache; runtime currency fallbacks use
     `DEFAULT_CURRENCY`; label clawback has durable retry state plus cron; the
     Privacy Policy discloses retained internal admin audit identifiers; and the
     old root `prisma/seed.ts`/`seed-bulk.ts` files no longer exist. Still-open
     product/ops items from the same section remain open: tag/author routes,
     high-traffic raw `<img>` migration, tax reconciliation monitoring,
     display-name confusable search, and optional observability helper work.
198. **Additional test-gap and accessibility/persona findings are stale on
     current main** — verified audit cleanup. `safeJsonLd()` has script-breakout
     tests; rate-limit fail-open/fail-closed behavior is tested through
     `limitWithFailurePolicy`; blog markdown sanitizer tests now execute hostile
     payloads; `VariantSelector`, `OpenCaseForm`, `ShippingAddressForm`,
     `AdminEmailForm`, `ImageCropModal`, and map widgets have the documented
     accessibility semantics and guardrail tests; banned reviewers render as
     unavailable/former buyers; ban/unban invalidates listing/blog search
     caches; email outbox rechecks inactive recipients before send even without
     a preference key; saved-search tags are sorted before dedup; and newsletter
     signup NFC-normalizes emails while returning the same success shape for
     suppressed and newly subscribed addresses.
199. **Behavioral guardrail tests added for four previously source-only
     contracts** — test hardening. `adminUndoWindowBlockReason()` now gives the
     24-hour audit undo window a pure tested boundary; block filtering now tests
     both-direction set construction and seller-id mapping through
     `blockFilterState.ts`; email preference lookup failures now route through a
     pure fail-closed helper; and quality-score formula boundaries now test
     discovery-bump decay plus Bayesian dampening so one lucky view cannot
     outrank sustained engagement without an explicit formula change.
200. **Round 8 fulfillment fraud-chain blockers tightened** — code fix for
     #737-#739. Manual seller shipping now requires both a supported carrier
     and a valid tracking number; seller-side delivery marking for shipped
     orders is disabled in favor of buyer confirmation through
     `/api/orders/[id]/confirm-delivery`; and account deletion now blocks open
     fulfillment plus recent terminal `DELIVERED`/`PICKED_UP` orders inside the
     30-day case window unless a refund exists.
201. **Round 8 public seller-profile projection and structured-data privacy
     tightened** — code fix for #740, #764, #776, #777-#779, #783, and #784.
     Listing detail, browse, and public seller profile pages now use narrow
     `SellerProfile` selects instead of full public RSC includes, listing detail
     no longer selects or falls back to seller email for display/URLs/JSON-LD,
     seller JSON-LD emits precise geo only for explicit public opt-in without a
     privacy radius, listing JSON-LD review snippets filter blocked and inactive
     reviewers, and seller customer-photo queries filter blocked/inactive
     reviewers without exposing `reviewerId`.
202. **Round 8 similar-listing rate-limit finding is stale on current main** —
     verified stale #741. `/api/listings/[id]/similar` already calls
     `safeRateLimit(searchRatelimit, getIP(req))` before loading the listing or
     running the raw similarity SQL, and existing read-rate-limit guardrails
     assert that public Prisma/raw-SQL search reads fail closed.
203. **Round 8 privacy/terms compliance wording truth-matched to current
     implementation** — docs fix for #750-#754, with adjacent #755/#758/#759
     cleanup. The Privacy Policy no longer claims implemented GPC persistence,
     three-year message deletion, commission-request one-year deletion, or
     automated seller analytics/Guild export fields that the code does not yet
     provide; it now names OpenFreeMap and Cloudflare Email Routing accurately.
     Terms 33.13 now frames INFORM high-volume seller verification as an
     applicable/future workflow rather than an already-built 10-day
     recertification system, and `STRATEGY.md` tracks that workflow as unbuilt.

204. **Round 9 public notification and display-name PII surfaces tightened** —
     code fix for #795, #862, #864, and #865; #863 was verified stale after the
     prior public SellerProfile projection pass. The dashboard notifications
     page now runs stored links through `safeNotificationPath()` before rendering
     a `Link`; seller auto-created display names no longer fall back to email
     local-parts; review, message, follow-notification, and buyer case-thread
     displays no longer select or render cross-user email fallbacks. Guardrail:
     `tests/round9-public-pii-guardrails.test.mjs`.

205. **Round 9 helper drift and money-formatting gaps closed** — code fix for
     #796, #797, #799, and #890. New-listing AI review now uses the shared
     `backfillEmptyAltTexts()` helper, checkout success receipts use
     `orderItemsSubtotalCents()` / `orderTotalCents()`, follower listing emails
     use `formatCurrencyCents()`, and the formatter now respects zero-decimal
     currency minor units such as JPY. Guardrails:
     `tests/round9-public-pii-guardrails.test.mjs`, `tests/money.test.mjs`.

206. **Round 9 ops-health stale-running cron detection added** — code fix for
     #806. `/api/cron/ops-health` now counts stale `CronRun.status = "RUNNING"`
     rows older than 30 minutes, includes them in Sentry warning context, and
     returns an unhealthy response when present. Guardrail:
     `tests/public-cron-search-hardening.test.mjs`.

207. **Round 9 cron and AI allegations verified stale on current main** —
     verified stale/false-positive #805, #807, #808, #809, #811, #812, #818,
     and #819. `label-clawback-retry` is already scheduled; Guild Master
     revocation already has an atomic `guildLevel = "GUILD_MASTER"` predicate;
     case auto-close copy is neutral; commission expiry fan-out already uses
     bounded concurrency; listing edit/publish paths are already rate-limited;
     AI prompt-injection redaction is multilingual with structural prompt
     separation; fail-closed AI results include `altTexts: []`; and
     `reviewListingWithAI()` call sites pass SellerProfile ids.

208. **Round 9 account-deletion PII retention tightened** — code fix for #822,
     #824, #829, #866, #867, #869, #870, and #872, with #823 reduced by the
     public/cross-user display-name fixes. Buyer deletion and fulfilled-order PII
     pruning now clear retained city/state/postal/country address snapshots,
     tracking fields, Shippo label URLs/IDs, gift notes, and seller notes.
     Account deletion removes block rows in both directions, redacts scoped
     other-party message and case-message bodies that quote deleted-account
     sensitive values, includes saved shipping fields in deletion redaction
     needles, and narrows message media cleanup collection to sender-owned
     messages. Guardrail:
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

209. **Round 9 account-deletion allegations verified stale or product-scoped** —
     verified stale/false-positive #825, #828, #830, #831, and #871. Current
     deletion redaction already handles two-character names as bounded tokens;
     `UserReport.reason` is controlled enum input while free-text `details` is
     cleared; first-party media cleanup already filters by deleted Clerk user key;
     account-deletion email suppression already uses NFC normalization; and
     seller deletion already clears public seller review replies. Larger
     product/legal/design items remain open: durable Stripe rejection/retry
     ordering (#820/#821/#826), account export scope (#868), and exact
     retention policy tradeoffs where not fixed in #208.

210. **Round 9 admin-audit and ban triage reviewed without code changes** —
     verified current behavior for #832-#837, #839, #843, and #844; verified
     stale/false-positive #840 and #845; marked #838, #841, #842, and #846 as
     product/design decisions. Remaining actionable admin/ban category is a
     dedicated undo/ban side-effect durability pass, especially audit failure
     semantics, undo target-state races, order review-note restoration, and
     Clerk sync retryability.

211. **Round 9 refund, metrics, ranking, and test-quality gaps reduced** —
     code/test fix for #847, #848, #851, #859, #884, #885, #893, and #894.
     `createMarketplaceRefund()` now rejects immediately failed/canceled Stripe
     refund responses and carries pending/requires_action statuses into manual
     order review notes without dropping the refund id. Guild metrics threshold
     state and AI alt-text backfill planning now have direct pure tests.
     Quality-score inputs no longer count favorites from banned/deleted or
     mutually blocked users, order/conversion counts exclude open Stripe
     disputes, and final scores are finite and capped at the documented maximum.
     Rate-limit API error parsing now covers the shared `RATE_LIMITED` payload
     shape. Guardrails: `tests/marketplace-refunds.test.mjs`,
     `tests/guild-metrics-state.test.mjs`,
     `tests/photo-alt-text-backfill.test.mjs`,
     `tests/quality-score-state.test.mjs`,
     `tests/quality-score-query-guardrails.test.mjs`, and
     `tests/api-error.test.mjs`.

212. **Round 9 metrics/rendering/utility allegations verified stale or
     product-scoped** — verified stale/false-positive #850, #853, #854, #856,
     #861, #881, #882, #883, #886, #891, and #892; #890 was already closed in
     entry #205. Marked #849, #852, #857, #858, #860, and #880 as
     product/performance/retention decisions rather than current-code defects.
     Still-open high-risk items from this slice after the metrics/ranking pass
     were legacy conversation response backfill/performance (#855/#858),
     account export/deletion privacy scope (#873-#879), AI fail-closed
     integration regression coverage (#887), checkout concurrency integration
     coverage (#888), and anonymous-cart merge loss behavior (#889).

213. **Round 9 account export and deletion privacy omissions reduced** —
     code/test fix for #873, #874, #875, #876, #878, and #879; verified
     stale/false-positive #877. Account export now includes seller listing
     `Photo.originalUrl`, order payment-event metadata, seller broadcasts, and
     explicit sections for blocks, submitted/received reports, support/data
     requests, email suppressions, stock notifications, maker verification,
     seller FAQs, newsletter subscriptions, and review votes. Account deletion
     now clears parallel `SellerProfile.galleryAltTexts`, skips and scrubs
     unsent `EmailOutbox` rows for the deleted user/email, and redacts
     `AdminAuditLog.reason` text alongside metadata. Guardrails:
     `tests/account-export-privacy.test.mjs`,
     `tests/account-export-payload.test.mjs`, and
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

214. **Round 9 Guild response metrics backfill risk reduced** — code/test fix
     for #855. `calculateSellerMetrics()` now derives buyer-initiated
     conversations and seller replies from `Message` history instead of
     relying on nullable `Conversation.firstResponseAt`, so legacy threads with
     missing cached timestamps are counted from current source-of-truth data.
     The query also replaces the prior per-conversation `JOIN LATERAL` with a
     set-based CTE, reducing the #858 hot path shape; seeded EXPLAIN/benchmark
     evidence remains a future performance-validation task. Guardrail:
     `tests/guild-metrics-state.test.mjs`.

215. **Round 10 client session and Stripe redirect risks reduced** —
     code/test fix for #902, #903, #904, #905, #906, and #907.
     Sign-out, account deletion sign-out, and Clerk user-switch transitions now
     clear recently viewed state, anonymous cart rows, and cart checkout
     session state through `clearSignedOutLocalAccountState()`. Cart checkout
     no longer persists Stripe `clientSecret` values to browser storage and
     clears legacy `grainline_checkouts` entries on cart mount. Stripe Connect
     client navigation now passes server-returned URLs through
     `safeStripeRedirectUrl()` and opens dashboard links with
     `noopener,noreferrer`. Seller fulfillment POSTs reject explicit
     cross-origin browser headers before auth, form parsing, or mutation work.
     Guardrails: `tests/local-account-state.test.mjs`,
     `tests/stripe-redirect-state.test.mjs`, and
     `tests/request-origin-guard.test.mjs`.

216. **Round 10 auth-aware API cache headers hardened** — code/test fix for
     #897, #898, #1028, and #1035. User-specific and auth-varying JSON routes
     now use `privateJson()` or `privateResponse()` so responses explicitly set
     `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie` while
     preserving headers such as `Retry-After` and account-export
     `Content-Disposition`. The pass also covered adjacent auth-varying GET
     routes that were not in the raw Claude list, including saved searches,
     saved-blog/follow state, saved shipping address, seller broadcast history,
     search suggestions, similar-items personalization, account export, and
     message streams. Guardrails:
     `tests/private-json-cache-headers.test.mjs` and the updated account export
     header assertions in `tests/account-export-format.test.mjs`.

217. **Round 10 client async race and cleanup risks reduced** — code/test fix
     for #908, #909, #910, #911, #912, #913, and #914. Search suggestions and
     header account/cart/notification loaders now abort stale requests and
     ignore older responses. Recently viewed and saved-address fetches abort on
     cleanup and avoid unmounted state/toast updates. Buy Now checkout stays
     mounted after first open, invalidates stale session-creation responses on
     close/unmount, and rolls back any stale Stripe session id returned to the
     client unless checkout completed. ActionForm success/error events now carry
     `formId`, and message-thread refresh plus composer clearing filter to the
     message composer form so unrelated archive/profile forms cannot clear
     drafts or trigger thread fetches.
     Guardrail: `tests/client-async-guardrails.test.mjs`.

218. **Round 10 schema numeric and index guardrails hardened** — code/test fix
     or verified closure for #942 through #961. #942 was stale because
     `20260521154500_schema_drift_and_raw_index_followups` already validates
     the prior Listing price/stock CHECK constraints. New migration
     `20260523223000_schema_numeric_guards_and_indexes` adds validated raw
     CHECK constraints for order money fields, case refund non-negativity,
     commission budget ordering/ranges, listing processing windows,
     IN_STOCK non-null stock, seller shipping/package ranges, listing
     analytics/score ranges, Founding Maker numbers, radius bounds, and review
     rating bounds, reducing #943, #944, #946, #947, #948, #949, #950, #951,
     #952, and #953. It also adds schema-visible indexes for the verified hot
     query paths in #955, the seller-case subset of #957, the message/case/blog
     author subset of #958, plus #959 and #960. #954 and #956 were verified
     not hot enough for current traffic, and #961 was false as written:
     `Order.stripeSessionId` remains a normal nullable unique; the partial
     unique drift risk belongs to the separate payment-intent/charge indexes.
     #945 remains a product/data-model decision because variant adjustments can
     be negative by design and the effective-price lower bound is cross-table.
     Guardrail: `tests/schema-numeric-index-guardrails.test.mjs`.

219. **Round 10 retention FK and partial-unique schema drift reduced** —
     code/test fix or verified closure for #962 through #984. Verified
     retention-sensitive FK allegations #962-#971 were reduced by changing
     listing photo/review, commission request, block/report moderation,
     blog-comment, order payment-event, and seller payout-event relations away
     from destructive cascades; dashboard blog post removal now archives posts
     instead of hard-deleting comment trees; `BlogComment.parentId` and
     `CommissionInterest.conversationId` use `SET NULL`, with migration cleanup
     for orphaned commission conversation ids. #970's blocking-delete claim was
     false because the DB already used `SET NULL`, but Prisma now declares that
     behavior explicitly. #972, #975, #976, #977, and #978 were verified stale
     or fixed in current schema/migration history. #974 was reduced by removing
     Prisma `@unique` from `Order.stripePaymentIntentId` / `stripeChargeId`
     while retaining the raw partial unique indexes and `findFirst` lookup
     pattern. #973, #979, #980, #981, #982, #983, and #984 remain deferred
     operational/product decisions requiring production data scans or
     cross-surface design work before migration. Guardrail:
     `tests/schema-retention-guardrails.test.mjs`.

220. **Round 10 email and public cache visibility risks reduced** —
     code/test fix or verified closure for #985 through #1036. Email delivery
     now sets a central Reply-To, refuses live Resend sends when a one-click
     unsubscribe URL cannot be generated, replaces unsubscribe links only in
     the footer href placeholder, and adds support contact/footer/current-year
     copy. Privacy-sensitive user-authored previews were removed from case,
     private-message, custom-order, and review notification emails, and order,
     case, refund, custom-order, back-in-stock, and Guild subjects were made
     easier to reconcile without non-ASCII subject punctuation. Buyer receipts
     now include order context, multi-seller checkout context, and free gift
     wrap visibility while hiding zero shipping/tax rows. Homepage featured
     makers are filtered against viewer block state after the global cache read,
     `home-featured-maker` staleness was reduced to 5 minutes, and public seller
     visibility cache invalidation is centralized for ban/unban, account
     deletion, Stripe Connect/webhook changes, deauthorization, vacation mode,
     seller shop listing actions, admin listing review, and Guild revocation
     crons. Popular tag API routes no longer add a second route-level ISR layer
     over tagged `unstable_cache`, and `/why-grainline` now revalidates its DB
     counters every 5 minutes. Verified stale/false-positive: #995 as mostly
     false for current namespaced outbox keys, #1000, #1004, #1010, #1011,
     #1028, #1034, and #1035. Later verified closures removed #1003, #1005,
     #1006, #1007, and #1009 from this deferred set. Remaining
     deferred/product/ops decisions from this range: #993, #1026, #1030, and
     #1033. Guardrails: `tests/email-delivery-guardrails.test.mjs` and
     `tests/cache-invalidation-guardrails.test.mjs`.

221. **Round 10 state-machine transition risks reduced** — code/test fix or
     verified closure for #1037 through #1061. Immediate Guild Member and Guild
     Master reapplication after rejection/revocation now goes through a
     30-day helper-enforced cooldown; Guild Master revocation keeps the seller
     at Guild Member while recording `GUILD_MASTER_REJECTED` so the cooldown
     applies. Admin listing undo now parses malformed rollback metadata
     fail-closed to non-public state and uses current listing-state
     `updateMany` guards before restoring REMOVE_LISTING/HOLD_LISTING rows.
     Case automation now escalates stale IN_DISCUSSION cases, bulk escalation
     covers expired discussion windows, seller refunds and Stripe dispute case
     updates use active-case compare-and-swap guards, manual mark-shipped is
     blocked after a Grainline label purchase, admin listing approval fans out
     followed-maker listing notifications only after an actual pending-to-active
     transition, and case mark-resolved notifies the counterparty on
     pending-close/final resolution. Verified stale/false-positive or
     intentional: #1039, #1053, and #1060. Deferred product/system-audit work:
     #1049, #1050, #1051, #1052, #1054, #1055, #1056, #1057, #1058, #1059,
     and #1061. Guardrail: `tests/round10-state-machine-guardrails.test.mjs`.

222. **Round 10 email outbox quota and tracking-link risks reduced** —
     code/test fix or verified closure for #1003, #1004, and #1006. Email
     tracking links now choose carrier-specific URLs only after strict carrier
     normalization for `UPS`, `USPS`, `FEDEX`, or `DHL`; unknown carrier text is
     no longer interpolated into external tracking URLs. The queued-email
     outbox now reserves from a hashed per-recipient UTC daily cap before the
     global daily cap, fails closed when that counter is unavailable, and
     records a distinct per-recipient quota deferral for ops triage. #1004 was
     verified stale because `formatCurrencyCents()` already normalizes
     currency codes and falls back safely when `Intl.NumberFormat` rejects a
     malformed value. Guardrails: `tests/email-delivery-guardrails.test.mjs`
     and `tests/email-outbox-quota.test.mjs`.

223. **Round 9 AI review semantic and doc-drift risks reduced** — code/test
     fix or verified closure for #813, #815, #816, and #817. AI review result
     normalization now fail-closes semantic contradictions such as
     `approved: true` with non-empty `flags`, and fills an explicit hold flag
     when a rejection comes back without a usable reason flag. The moderation
     prompt now states the same decision invariant so model output and local
     normalization agree; same-seller duplicate auto-rejects also return the
     full AI result shape with `altTexts: []`, and custom listing creation now
     uses the shared alt-text backfill helper. The AI behavior contract now
     matches current code for the 10-photo listing cap, current caller set,
     same-seller seven-day duplicate window, and max-token behavior; #816 was
     verified stale because current code already uses `gpt-4o-mini`,
     temperature `0.1`, and max `700` tokens. Guardrails:
     `tests/ai-review-result-state.test.mjs`,
     `tests/ai-review-safety.test.mjs`, and
     `tests/post-launch-ui-followups.test.mjs`.

224. **Round 9 account-deletion side-effect durability reduced** — code/test
     fix for #820, #821, and #826. Account deletion now creates a durable
     local-anonymization recovery row before Clerk deletion or Stripe rejection,
     uses retryable `AccountDeletionSideEffect` rows for Stripe Connect
     rejection, enqueues first-party media cleanup inside the anonymization
     transaction, and stores already-redacted audit-log patches for retry rather
     than raw redaction needles. `/api/cron/account-deletion-side-effects`
     retries pending/failed rows every half hour, and completed rows clear their
     payloads. The original #820 "user can log back in" impact remains stale on
     the user-requested route because Clerk deletion is terminal, but the
     partial-local-anonymization retry gap was reduced. Guardrails:
     `tests/account-deletion-side-effects.test.mjs`,
     `tests/account-deletion-timeout-fix.test.mjs`,
     `tests/stripe-connect-v2.test.mjs`, and
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

225. **Round 9 ban and undo side-effect pass reduced** — code/test fix for
     #835, #836, #840/#1075, #841/#1076, #843, and #845. Buyer warning
     notifications now use all-settled handling with Sentry evidence, checkout
     session expiry failures no longer block Clerk session revocation, buyer
     commission bans close both `OPEN` and `IN_PROGRESS` requests, and unban /
     BAN_USER undo restores ban-added order review markers only when the current
     note still matches the captured hash/length snapshot. BAN_USER undo can
     now retry a failed post-commit Clerk unban sync for an already-undone audit
     row when the latest related sync log is `UNDO_BAN_USER_CLERK_SYNC_FAILED`.
     Verified stale/false-positive in current behavior: #837/#1040 (listing
     undo no longer defaults to ACTIVE) and #1042 (listing undo uses current
     state `updateMany` guards). #839 is reduced but not fully closed because a
     process kill between the local ban transaction and Clerk sync still lacks a
     durable retry queue; #832-#834 and #844 remain for a later admin-audit
     durability pass. Guardrails: `tests/ban-order-review-state.test.mjs`,
     `tests/ban-side-effect-guardrails.test.mjs`,
     `tests/ban-audit-metadata.test.mjs`,
     `tests/admin-audit-undo-state.test.mjs`, and
     `tests/round10-state-machine-guardrails.test.mjs`.

226. **Round 9 ban external-sync repair reduced** — code/test fix for #833,
     #839, and the remaining retry portion of #836. Modern `BAN_USER` audit
     rows now store the exact `appliedBannedAt` used on the `User` row plus
     `externalSyncVersion: 1`, and BAN undo uses that timestamp in an
     `updateMany` guard before clearing ban fields so a later ban is not
     silently undone. Ban side-effect audit logs now include `originalActionId`,
     and `/api/cron/ban-side-effects` retries recent modern BAN_USER rows whose
     Clerk ban/session sync is missing or last failed. The repair path also
     retries checkout-session expiry and logs retry outcomes. Remaining admin
     audit items: #832 audit-log failure semantics, legacy Stripe/Clerk fallback
     races from #834/#242, and #844 batched open-order review updates.
     Guardrails: `tests/ban-side-effect-repair.test.mjs`,
     `tests/ban-side-effect-guardrails.test.mjs`,
     `tests/ban-audit-metadata.test.mjs`, `tests/cron-auth.test.mjs`,
     `tests/cron-run.test.mjs`, and `tests/public-cron-search-hardening.test.mjs`.

227. **Round 9 admin audit durability and legacy BAN undo reduced** —
     code/test fix for #832 and the legacy undo portions of #834/#242. Best-
     effort `logAdminAction()` now returns `string | null` instead of an empty
     string on failure, while `logAdminActionOrThrow({ client: tx, ... })`
     gives mutation code a strict transactional path. Listing removal/review,
     admin order review actions, support/report resolution, admin review
     deletion, blog/broadcast deletes, and Guild verification state changes now
     co-commit their audit row with the state mutation. BAN undo also fails
     closed for legacy/malformed `BAN_USER` logs that lack
     `metadata.appliedBannedAt`; staff must use the explicit unban workflow for
     current-state manual unbans. Remaining admin-adjacent item verified current
     but not fixed in this pass: #844 batched open-order ban review updates.
     Guardrails: `tests/admin-audit-durability.test.mjs`,
     `tests/admin-moderation-observability.test.mjs`,
     `tests/admin-action-guardrails.test.mjs`,
     `tests/admin-audit-undo-state.test.mjs`,
     `tests/ban-side-effect-guardrails.test.mjs`, and
     `tests/ban-audit-metadata.test.mjs`.

228. **Round 9 ban open-order review update batching reduced** — code/test
     fix for #844. `banUser()` no longer performs one sequential
     `tx.order.update()` per open seller order. It now computes the per-order
     review-note values once, then applies them through a chunked
     `UPDATE ... FROM (VALUES ...)` inside the existing ban transaction. The
     update guards on each order's captured `reviewNeeded` and `reviewNote`
     (`IS NOT DISTINCT FROM`) so concurrent staff note changes are not
     overwritten; mismatches fail the ban transaction with a retryable admin
     error. Guardrails: `tests/ban-side-effect-guardrails.test.mjs`,
     `tests/ban-order-review-state.test.mjs`,
     `tests/ban-audit-metadata.test.mjs`, and
     `tests/ban-side-effect-repair.test.mjs`.

229. **Round 11 verification follow-ups reduced** — code/test fix or verified
     closure for #1077, #1078, #1079, #1080, and #1081. Buyer order
     confirmation emails now show the multi-seller "separate order" context
     only when the cart checkout session metadata records multiple sellers;
     single-listing checkout and one-seller carts omit the disclaimer. The
     numeric-guard migration now normalizes malformed historical listing
     processing windows before validating `Listing_processing_days_valid_chk`.
     Stripe `stripePaymentIntentId` and `stripeChargeId` remain raw-managed
     partial unique indexes with an explicit schema warning and guardrail test.
     #1077 was verified false-positive because current `Order` has no persisted
     `platformFeeCents` column to constrain, and #1081 was verified stale
     because `tests/round10-state-machine-guardrails.test.mjs` exists. The
     Round 11 #1075/#1076 claims were also verified already fixed by the prior
     ban side-effect pass and were not double-counted here. Guardrails:
     `tests/email-delivery-guardrails.test.mjs`,
     `tests/schema-numeric-index-guardrails.test.mjs`, and
     `tests/schema-retention-guardrails.test.mjs`.

230. **Anonymous-cart merge durability reduced** — code/test fix for #771 and
     #889. Sign-in merge now uses a tested helper that classifies auth,
     rate-limit, conflict, network, and 5xx add failures as retryable and keeps
     only those failed anonymous-cart lines in browser storage for a later
     retry. Successfully merged lines and terminally rejected lines are removed,
     so a partial server-side merge can no longer clear retryable local cart
     data. Verified stale/false-positive from the same sweep: #902, #903, and
     #906 remained closed by the prior client-session pass. #774 remains a
     performance/bulk-endpoint decision rather than the durability fix in this
     pass. Guardrail: `tests/anonymous-cart-merge.test.mjs`.

231. **AI review outer fail-closed coverage reduced** — code/test fix for
     #887. `reviewListingWithAI()` now has injectable lookup/fetch/sleep
     dependencies for tests while preserving production callers, and the outer
     wrapper is directly covered for missing OpenAI config, malformed model
     content, and transient provider retry exhaustion. Verified current/stale
     from the same AI sweep: #811, #812, #813, #815, #816, #817, #818, and
     #819 were already closed by previous AI hardening passes. #814 remains a
     product-risk design decision because cross-seller fuzzy duplicate
     detection needs thresholds and false-positive handling for generic listing
     titles. Guardrail: `tests/ai-review-outer-failclosed.test.mjs`.

232. **Conversation swapped-pair DB invariant reduced** — code/test fix for
     #982. Normal conversation creation paths already canonicalized participant
     order before create/upsert, but the database only had the ordered
     `@@unique([userAId, userBId])` key. Migration
     `20260524023000_conversation_unordered_pair_index` now adds a raw-managed
     unique expression index on `LEAST(userAId,userBId)` and
     `GREATEST(userAId,userBId)` so future code or manual SQL cannot create
     swapped duplicate threads. The migration raises an explicit duplicate-pair
     error instead of silently merging retained history if production data ever
     contains swapped duplicates. Guardrail:
     `tests/conversation-pair-guardrails.test.mjs`.

233. **Notification preference runtime shape reduced** — code/test fix for
     #256 and partial runtime reduction for #979. `User.notificationPreferences`
     reads now pass through `normalizeNotificationPreferences()`, which keeps
     only known preference keys with boolean values. In-app notification
     delivery, email preference checks, unsubscribe writes, broadcast follower
     filtering, and settings rendering no longer trust raw
     `Record<string, boolean>` casts, so malformed string/number/array values
     do not silently alter delivery behavior. #979 remains open for any
     database-level JSON CHECK, production data scan, and broader JSON/TEXT
     size policy. Guardrails: `tests/notification-preference-keys.test.mjs`,
     `tests/notification-delivery-preferences.test.mjs`, and
     `tests/notification-email-preferences.test.mjs`.

234. **Blog, broadcast, listing-action, and rendering follow-ups reduced** —
     code/test fix for #176, #178, #183, #191, #205, #206, #207, and #269.
     The dead legacy `src/actions/listings.ts` update action was removed so it
     cannot be re-imported without the active edit-page price/rate-limit/AI
     review guardrails. Seller broadcasts now enqueue `EMAIL_SELLER_BROADCAST`
     only for explicit opt-ins, use source-specific notification links, and
     admin broadcast deletion is idempotent while cleaning source-specific
     notifications plus pending/failed broadcast email jobs. Approved blog
     comment notifications link to `#comment-{commentId}` and staff comment
     deletion removes matching source-specific notifications. Blog publish
     moderation now includes normalized tags, listing edit photo cleanup
     failures leave Sentry evidence, and `safeJsonLd()` also escapes `&`.
     Verified stale/current in the same agent-reviewed sweep: #179, #182,
     #190, #192, #196, #228, #229, #301, #325, and #328 were already closed or
     defended by current code. Guardrails:
     `tests/pr-i-media-upload-unsubscribe-followups.test.mjs`,
     `tests/seller-ops-hardening.test.mjs`,
     `tests/blog-action-guardrails.test.mjs`,
     `tests/admin-action-guardrails.test.mjs`,
     `tests/email-delivery-guardrails.test.mjs`,
     `tests/r56-r67-small-fixes.test.mjs`, and
     `tests/rendering-security.test.mjs`.

235. **Refund, money, stock, and helper verification pass reduced** —
     code/test fix for #218, #219, #220, #224, and #225. Refund idempotency
     bases now go through `refundIdempotencyKeyBase()` and include scope,
     target id, resolution, and amount before Stripe suffixes are appended.
     `createMarketplaceRefund()` now separates `usedPlatformOnly` from
     `requiresManualTransferReconciliation`, so tax-only platform-funded
     refunds are not mistaken for disconnected-seller transfer-reconciliation
     work. `formatCurrencyCents()` now returns an explicit invalid-amount
     sentinel for non-finite cents instead of rendering `$0.00`; money input
     parsing documents and tests empty/null versus `"0"` semantics. Manual
     stock writes now share `MAX_MANUAL_STOCK_QUANTITY` and enforce it in the
     stock PATCH API, listing form input, and create/edit/custom listing server
     actions. Verified stale/current in the same agent-reviewed sweep: #283,
     #284, #285, #287, #335, and #336 were already closed or false on current
     `main` through existing Guild metrics, quality-score, reverse-geocode,
     runtime-doc, and CI-audit guardrails. Guardrails:
     `tests/marketplace-refunds.test.mjs`, `tests/money.test.mjs`,
     `tests/stock-mutation-state.test.mjs`,
     `tests/quality-score-state.test.mjs`,
     `tests/guild-metrics-state.test.mjs`,
     `tests/reverse-geocode-throttle.test.mjs`,
     `tests/schema-numeric-index-guardrails.test.mjs`,
     `tests/ban-side-effect-guardrails.test.mjs`,
     `tests/email-delivery-guardrails.test.mjs`, and
     `tests/round10-state-machine-guardrails.test.mjs`.

236. **Analytics, cache, geo, upload, and AI observability pass reduced** —
     code/test fix for #282, #288, #289, #290, and #1095-#1099.
     Analytics user-agent filtering now treats blank/missing UAs and common
     non-browser clients as non-human traffic before listing/seller counters
     increment. Stock-driven visibility flips now call
     `revalidateListingSearchCaches()` after commit from Stripe checkout
     completion, blocked-checkout stock restoration, checkout-expiry stock
     restoration, seller refunds, and case-resolution refunds. Seller rating
     summary refreshes now take a seller-scoped advisory transaction lock
     before aggregate/upsert work, while preserving the review-write
     transaction boundary. Auto-created metros now store bounded reverse-
     geocoded locality coordinates instead of the first caller's precise
     coordinates. Processed image uploads now accept the documented 15MB
     banner path plus multipart overhead, check JPEG/PNG/WebP signatures before
     Sharp, and bound Sharp input pixels. AI review prompts now use
     `formatCurrencyCents()` with listing currency, and the remaining verified
     AI/backfill/seller-analytics console-only failures now leave bounded
     Sentry evidence. Agent re-verification from the same sweep confirmed
     #1075-#1079 were already fixed/stale/false-positive on current main, and
     #1080 already has schema comments plus static guardrail coverage; those
     were not double-counted. Guardrails:
     `tests/bot-user-agent.test.mjs`,
     `tests/cache-invalidation-guardrails.test.mjs`,
     `tests/review-report-observability.test.mjs`,
     `tests/reverse-geocode-throttle.test.mjs`,
     `tests/geo-metro-privacy.test.mjs`,
     `tests/form-data-body-bounds.test.mjs`,
     `tests/ai-review-outer-failclosed.test.mjs`,
     `tests/pr-h-deletion-analytics-email-followups.test.mjs`, and
     `tests/post-launch-ui-followups.test.mjs`.

237. **Checkout privacy, variant price, env, and seller-page perf pass
     reduced** — code/test fix for #903, #945, and #1108-#1111. #903 was
     reclassified from the earlier stale bucket after read-only re-verification
     found the sign-out/user-switch storage cleanup was current but full
     shipping addresses and selected rates were still persisted in
     `sessionStorage`; the cart page now keeps checkout address/rate state
     in memory only, clears legacy cart session storage by default, and drops
     in-memory checkout state when local account state is cleared. Variant
     option adjustments now use shared normalization/range/final-unit-price
     validation, create/edit listing actions reject option sets that can
     produce sub-cent or over-$100,000 final prices, `cart/update` rejects
     negative recalculated variant prices before persisting cart snapshots, and
     a raw DB CHECK bounds stored `ListingVariantOption.priceAdjustCents`.
     Critical production env reads now go through `requiredProductionEnv()` so
     missing production `DATABASE_URL`, R2, Redis, Shippo, and `EMAIL_FROM`
     config fails at module load instead of first user traffic. Seller profile
     metadata/page rendering now shares a React `cache()` seller loader and
     groups independent seller-page queries in one `Promise.all` batch. Read-
     only agent re-verification in the same sweep confirmed #902, #904, #905,
     #942, #943, #962, #965, and #966 were stale/fixed on current `main`; those
     previously closed items were not double-counted. #973 remains a live-data
     audit question, and #974 remains intentionally raw-managed partial-index
     behavior. Guardrails: `tests/local-account-state.test.mjs`,
     `tests/listing-variants.test.mjs`,
     `tests/schema-numeric-index-guardrails.test.mjs`,
     `tests/env-validation.test.mjs`,
     `tests/seller-page-performance.test.mjs`,
     `tests/observability-cleanup-followups.test.mjs`,
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`, and
     `tests/order-seller-route-ownership.test.mjs`.

238. **Residual observability and US-only copy pass reduced** — code/test fix
     for #752, adjacent #756, and residual #1098 subpaths. Terms messaging
     retention copy now defers to the current Privacy Policy instead of a
     nonexistent fixed three-year message-prune workflow, and `/not-available`
     now matches the US-only product/legal boundary instead of saying United
     States and Canada. The Round 13 #1098 observability sweep was re-verified
     read-only: notification, email, AI review main/duplicate-check, Founding
     Maker, photo-alt backfill, vacation, and seller analytics paths already
     had Sentry evidence on current `main`; two narrow residuals remained and
     are now covered. Admin ban undo captures Stripe account verification
     failures with bounded IDs, and the unused `generateAltText()` helper no
     longer has a bare silent catch. Upload findings #1095, #1096, and #1099,
     plus compliance findings #750, #751, #753, and #754, were re-verified
     current/stale or deferred/product-tracked and not double-counted because
     earlier passes already closed or truth-matched them. Guardrails:
     `tests/admin-audit-durability.test.mjs`,
     `tests/review-report-observability.test.mjs`, and
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`.

239. **Stripe webhook side-effect and refund-lock pass reduced** — code/test
     fix for #765, the same-session duplicate side-effect gap adjacent to
     #766, #767, #768, and #770. Stripe completed-checkout order emails now
     reserve deterministic `EmailOutbox` rows before the direct-send fast path;
     outbox reservation failures fail the webhook event instead of marking it
     processed without durable retry state, and direct-send failures leave the
     row retryable. Existing-order side-effect replay now skips orders that
     already have blocking refund state or the blocked-checkout review marker,
     so refunded/held checkouts do not receive normal order-confirmed side
     effects on a later same-session Stripe completion event. Blocked-checkout
     automatic refunds now acquire the shared `sellerRefundId = "pending"`
     sentinel through an atomic `updateMany` that excludes blocking refund and
     open-dispute ledgers before calling Stripe, then record the refund only
     while the sentinel is still held. Terminal dispute events still mark the
     order for review, but they preserve a fresh pending refund lock instead of
     nulling `sellerRefundLockedAt` under an in-flight refund. #766 was
     verified stale/false-positive for exact duplicate Stripe `event.id`
     delivery because `beginStripeWebhookEvent()` already returns early for
     processed duplicates; the real adjacent same-session duplicate path is
     covered by the order-scoped outbox dedup/gates above. #769 remains a
     product/design decision for broad `reviewNeeded` semantics; this pass
     deliberately skips only refund/blocked-checkout markers rather than every
     address/quote-review order. Guardrails:
     `tests/payment-side-effect-observability.test.mjs`.

240. **Client-side persistence and PIN guardrails reduced** — code/test fix for
     #915, #916, and #917. Signed-in checkout address saves now fail visibly
     and stop before advancing if `/api/account/shipping-address` returns a
     non-2xx response or throws; shoppers can explicitly uncheck address saving
     to continue without implying persistence succeeded. Recently-viewed
     cookies now include `Secure` on HTTPS while preserving local HTTP
     development behavior. The admin PIN gate now blocks loading-state
     double-submit paths, rejects too-short Enter submits at the handler
     boundary, and opts the PIN input out of browser autocomplete. Guardrails:
     `tests/client-async-guardrails.test.mjs` and
     `tests/recently-viewed.test.mjs`.

241. **Checkout snapshot and listing visibility follow-ups reduced** —
     code/test fix for #775, #780, #782, and #791, plus verified closure for
     #772, #781, #794, and #773. Embedded Stripe checkout now has a runtime
     missing-key guard instead of a non-null env assertion. Cart and
     single-listing webhook order snapshots now store the Stripe-paid unit
     price, keeping `OrderItem.priceCents` and `listingSnapshot.priceCents`
     aligned when live listing prices drift before webhook finalization.
     Listing detail related-work queries now reuse `publicListingWhere()`, and
     listing-specific rating aggregates now share the same visible-review
     predicate as JSON-LD review snippets. #772 was stale because current cart
     payment state is not restored from session storage after refresh;
     `?step=payment` is forced back out unless fresh in-memory secrets exist.
     #781 was stale because `canBuy` already checks `seller.chargesEnabled`.
     #794 was a stale documentation conflict rather than a code bug: seller
     cart cleanup intentionally runs inside the locked order-creation
     transaction, and `CLAUDE.md` now matches that behavior. #773 remains a
     product/design choice for partial multi-seller checkout continuation
     because current all-or-rollback behavior prevents orphan checkout
     sessions and stock reservations but does not offer a "continue with
     available sellers" flow. #774 was already tracked as a bulk-merge
     performance design decision in pass 230 and was not double-counted here.
     Guardrails: `tests/checkout-script-inventory.test.mjs`,
     `tests/stripe-webhook-cart-finalization.test.mjs`, and
     `tests/public-visibility-followups.test.mjs`.

242. **Client notification, account action, and form recovery guardrails
     reduced** — code/test fix for #918, #919, #920, #922, #924, #925, #926,
     and #929, plus verified stale closure for #923. Notification and unread
     badge polling now waits for Clerk to finish loading before user-specific
     fetches, and the notification dropdown normalizes the response shape,
     filters malformed rows, and caps rendered items/unread count. Header and
     avatar-menu Clerk profile/sign-out actions now catch client errors and
     only clear local signed-out state after `signOut()` succeeds, preserving
     local cart/account state on failed sign-out attempts. Label tracking links
     now URL-encode tracking numbers before carrier URL interpolation.
     Accept-terms redirects are revalidated inside the client form before
     navigation, not only by the parent page. Case-open, helpful-vote, and
     seller-reply forms now recover from network failures with visible
     errors/toasts and loading-state cleanup. #923 was stale because current
     `ThreadMessages` and map fallback blank-target links already include
     `rel="noopener noreferrer"`. Guardrails:
     `tests/client-async-guardrails.test.mjs`,
     `tests/link-security.test.mjs`,
     `tests/terms-acceptance-enforcement.test.mjs`, and
     `tests/verified-audit-followups.test.mjs`.

243. **Case under-review party-message boundary reduced** — code/test fix for
     #300. The case-message state helper now separates buyer/seller reply
     statuses (`OPEN`, `IN_DISCUSSION`, `PENDING_CLOSE`) from staff reply
     statuses, so direct API posts by parties cannot keep adding messages after
     a case enters `UNDER_REVIEW`. Staff can still add review-thread messages
     until the case reaches a terminal state. Guardrails:
     `tests/case-messaging-state.test.mjs` and
     `tests/case-observability-followups.test.mjs`.

244. **Address autocomplete privacy/proxy boundary reduced** — code/test fix
     for #921. `AddressAutocomplete` now calls the first-party
     `/api/address/autocomplete` route instead of sending partial address
     queries directly from the browser to Nominatim. The proxy normalizes and
     bounds query text, applies IP-keyed rate limiting, returns private
     no-store JSON, reuses the shared Nominatim throttle, sets an app
     User-Agent, and keeps US-only upstream parameters server-side. Agent
     re-verification in the same pass confirmed #1095-#1099 are stale on
     current `main` and were already reduced/verified in earlier passes, so
     they were not double-counted. Guardrails:
     `tests/address-autocomplete-state.test.mjs`,
     `tests/public-api-auth-inventory.test.mjs`,
     `tests/post-launch-ui-followups.test.mjs`, and
     `tests/accessibility-followups.test.mjs`.

245. **Round 14 stale/perf and buy-now rollback documentation closure** —
     verified stale or documented closure for #1108, #1109, #1110, #1111,
     and #1120. Env validation now goes through `requiredProductionEnv()` for
     the named database, R2, Redis, Shippo, and email config reads. Seller
     public profile rendering already shares a React `cache()` loader between
     metadata and page rendering and batches the independent seller queries in
     one `Promise.all`; broader React cache work remains profile-driven rather
     than a blanket fix. Buy-now checkout rollback remains best-effort code by
     design, and `CLAUDE.md` now documents that failed browser rollback falls
     back to Stripe expiration/webhook stock restoration within the 31-minute
     session window. Guardrails already covering the verified behavior:
     `tests/env-validation.test.mjs`,
     `tests/seller-page-performance.test.mjs`,
     `tests/client-async-guardrails.test.mjs`, and
     `tests/public-cron-search-hardening.test.mjs`.

246. **Round 14 cron schedule clustering reduced and verified-clean inventory
     closed** — code/test/docs fix for #1103, verified clean closure for
     #1100, #1102, #1104, #1105, #1106, #1107, and #1112-#1119, and manual
     ops-evidence deferral for #1101. Low-frequency maintenance crons are now
     spread across the UTC day in `vercel.json`, and each changed route's
     `withSentryCronMonitor(... { value })` schedule was updated to match.
     `CLAUDE.md` now documents the schedule-spreading contract so future
     changes keep Vercel, Sentry monitors, and route comments aligned. #1100
     was verified clean because all cron routes use shared auth, Sentry
     monitors, cron-run idempotency, and bounded batches where applicable.
     #1102, #1104, #1105, #1106, #1107, and #1112-#1119 were verified clean
     on current `main` for the named money, upload, Stripe webhook, retry,
     sitemap/robots, and accessibility guardrails. #1101 remains a manual
     Stripe Dashboard subscription check rather than a code defect: the route
     safely ignores unhandled valid events, but launch evidence should confirm
     the live endpoint is subscribed only to intended Checkout, charge,
     account, and payout event types. Guardrails:
     `tests/cron-schedule-guardrails.test.mjs`,
     `tests/public-cron-search-hardening.test.mjs`,
     `tests/ban-side-effect-repair.test.mjs`,
     `tests/account-deletion-side-effects.test.mjs`,
     `tests/retention-and-ops-followups.test.mjs`,
     `tests/cron-monitor-state.test.mjs`, `tests/cron-run.test.mjs`, and
     `tests/cron-auth.test.mjs`.

247. **Dependency hygiene and Dependabot visibility reduced** — code/test/docs
     fix for #337, #338, #339, and #340, plus verified stale/false-positive
     closure for #341. Dependabot no longer ignores every semver-major npm
     update; weekly minor/patch updates remain grouped, while major updates
     are grouped separately for manual review so security-relevant majors stay
     visible without scattering many PRs. The CI/production install-script
     difference is now documented as intentional: CI uses
     `npm ci --ignore-scripts` plus explicit `npx prisma generate`, while
     Vercel production keeps normal npm lifecycle behavior before
     `prisma generate && next build`. `@types/marked` was removed because
     `marked` ships its own types, and direct `@types/pg` plus
     `@types/sanitize-html` were moved to dev dependencies. #341 was
     false-positive on current npm resolution: `@hono/node-server` resolves
     to 1.19.13 through the existing override, and the older version string is
     only Prisma dependency metadata in the lockfile. Guardrails:
     `tests/dependency-hygiene.test.mjs`, plus manual verification with
     `npm ls @hono/node-server --depth=10`.

248. **Low-level helper input and copy guardrails reduced** — code/test/docs
     fix for #272, #291, #292, #294, #296, #303, #304, and #306. Image
     re-crop fetches now abort stalled URL loads instead of waiting
     indefinitely. Slugged public routes validate extracted ids before Prisma
     lookups and reject malformed slug-only segments. Seller shop hide actions
     now allow `SOLD_OUT` listings, matching public sold-out detail visibility.
     Tag normalization strips bidi controls after Unicode decomposition, and
     tracking-cookie parsing deduplicates ids before applying the aggregate
     cap. Support request email normalization explicitly rejects control
     characters. Client API error rendering still accepts structured JSON and
     bounded `text/plain` 4xx copy, but no longer surfaces raw 5xx or HTML
     framework error bodies to users. Partial-refund case copy no longer
     renders `$0.00` when older rows lack a refund amount. Guardrails:
     `tests/image-file-from-url.test.mjs`, `tests/public-paths.test.mjs`,
     `tests/listing-action-state.test.mjs`, `tests/tags.test.mjs`,
     `tests/listing-tracking-cookies.test.mjs`, `tests/support-request.test.mjs`,
     `tests/api-error.test.mjs`, and `tests/case-resolution-copy.test.mjs`.

249. **Anonymous-cart merge bulk-performance gap reduced** — code/test/docs fix
     for #774. Sign-in cart restoration still preserves the existing durability
     semantics from #771/#889: successfully merged lines and terminally
     rejected lines leave local storage, while auth/rate-limit/network/5xx
     failures stay retryable. The merge helper now runs add attempts through
     bounded concurrency instead of one long sequential browser loop, preserving
     source order for retryable lines and avoiding unbounded browser request
     fan-out. Read-only agent re-verification in the same pass confirmed #1098
     and #1108-#1111 are stale on current `main`; those were already closed in
     prior entries and were not double-counted. Guardrail:
     `tests/anonymous-cart-merge.test.mjs`.

250. **Listing-detail shared loader cache opportunity reduced** — code/test/docs
     follow-up for the broader React `cache()` category noted after #1110 was
     verified stale for the seller page. Listing detail metadata and page render
     now share `getListingForDetailPage()` for the non-viewer-specific listing
     read, while auth, block-list, favorite, follow, and stock-notification
     reads remain outside the shared cache. This was not double-counted as a new
     numbered Claude finding because #1110 itself was already closed as stale.
     Guardrail: `tests/listing-page-performance.test.mjs`.

251. **Maker follower fanout now respects blocks** — code/test/docs fix for
     #231 plus adjacent blog/broadcast fanout parity. `fanOutListingToFollowers()`
     now resolves the maker's owning user and filters follower pages before both
     in-app notification and email fanout, excluding self-follows plus reciprocal
     `Block` pairs where either the follower blocked the maker or the maker
     blocked the follower. First-publish blog notifications and seller broadcast
     in-app/email recipient lists now apply the same reciprocal block filters.
     Guardrail: `tests/follower-listing-notifications.test.mjs`.

252. **External link fallbacks to production removed** — code/test/docs fix for
     #1005 plus adjacent checkout/Connect/case/admin-email parity. Email
     rendering now resolves links through `resolveEmailAppUrl()`: configured app
     URLs are normalized, production requires `NEXT_PUBLIC_APP_URL`, and
     non-production live email config (`RESEND_API_KEY` plus `EMAIL_FROM`)
     refuses to send without an explicit app URL instead of silently linking to
     production. Non-sending local renders use `http://localhost:3000`. Checkout
     return URLs, Stripe Connect account-link URLs, admin email footer links,
     case-message email links, unsubscribe links, and internal absolute return
     URL defaults now route through `APP_BASE_URL` / `EMAIL_APP_URL` rather than
     hard-coded production fallbacks. Read-only agent re-verification in the same
     pass confirmed #1095-#1099, #1075/#1076, #988-#992, #1045, and #811/#812
     are stale on current `main`; those were already closed in prior entries and
     were not double-counted. Guardrails: `tests/email-base-url.test.mjs` and
     `tests/app-base-url.test.mjs`.

253. **Email outbox template versioning added** — code/test/docs fix for
     #1007. Queued email rows now persist `templateName` and
     `templateVersion`, with a positive-version DB check and a
     `templateName, createdAt` support/debug index. Every current
     `enqueueEmailOutbox()` / `enqueueEmailOutboxOnce()` caller passes a
     stable template name, including welcome, order-confirmed buyer/seller,
     first-sale, first-listing, back-in-stock, followed-maker, and seller
     broadcast jobs. `CLAUDE.md` now requires future queued-email callers to
     keep that metadata populated and to bump the version only for meaningful
     template behavior changes. Guardrail:
     `tests/email-outbox-versioning.test.mjs`. Read-only agent re-verification
     in the same pass confirmed #737-#741, #750-#754, and #764 remain fixed,
     stale, or product/legal-deferred on current `main`; those were already
     closed in prior entries and were not double-counted.

254. **JSON shape and write-size guardrails reduced** — code/test/docs fix or
     reduction for #979, #980, and #983. `User.notificationPreferences` now has
     a raw-managed DB validator that accepts only known preference keys with
     boolean values, and the migration normalizes malformed historical rows
     before validating the shape/size constraints. New writes to bulky JSON
     columns are now capped through raw DB CHECK constraints for notification
     preferences, admin audit metadata, order-item snapshots/variants, label
     rate quotes, order payment metadata, email suppression details, and cron
     result payloads; `EmailOutbox.html` was already bounded by prior schema and
     enqueue caps. `schema.prisma` and `CLAUDE.md` now document the compact
     payload contracts and the future preference-key update requirement. The
     remaining #980 work is a production data scan before globally validating
     the non-preference historical size constraints. Guardrail:
     `tests/json-column-guardrails.test.mjs`.

255. **Custom-listing price cap aligned with public listing cap** — code/test
     fix for the code-fixable subset of #984. Standard listing create/edit
     already capped seller-entered prices at $100,000, and cart quantity caps
     bound normal checkout totals; custom private listings missed that same
     cap. Listing create, edit, and custom-order listing creation now use the
     shared `listingPriceMaxError()` helper, and variant unit-price validation
     derives its cap from the same listing-price constant. The broader
     `Int`-to-`BigInt` money-column change remains a deferred data-model
     decision because it touches persisted order and seller-metrics contracts.
     Guardrail: `tests/listing-price-guardrails.test.mjs`.

256. **Admin PIN cookie session binding tightened** — code/test/docs fix for
     #239. Admin PIN cookies are now v2 HMAC signatures over the local Clerk
     `userId`, the active Clerk `sessionId`, and the expiry timestamp, so a
     copied PIN cookie from one browser session does not verify in another
     Clerk session for the same user. Middleware, the admin layout, and
     `/api/admin/verify-pin` all pass the current session id through the shared
     verifier. Legacy user-only PIN cookie signatures fail closed and require a
     fresh PIN entry. Guardrail: `tests/admin-pin.test.mjs`.

257. **Seller recent-sales refund filtering aligned** — code/test/docs fix for
     #143. `/api/seller/analytics/recent-sales` now excludes refunded orders
     through both local `Order.sellerRefundId` state and durable
     `OrderPaymentEvent` refund ledger rows via `blockingRefundLedgerWhere()`,
     matching the main seller analytics route and keeping refunded buyer/order
     data out of the seller sales widget. `CLAUDE.md` now records the future
     behavior contract for seller analytics refund filters. Guardrail:
     `tests/seller-ops-hardening.test.mjs`.

258. **System audit log added for automated trust/case transitions** —
     code/schema/test/docs fix for #1049, #1050, #1051, and Round 9 #810.
     `SystemAuditLog` now records non-human or staff/system actions without
     overloading undoable `AdminAuditLog.adminId`. Guild Member auto-revokes,
     Guild Master auto-downgrades, case auto-close/escalation cron transitions,
     and staff/cron case bulk escalation now write bounded system audit rows;
     the trust/case state mutations co-commit their audit row inside the same
     transaction. Guild metrics retention cleanup now records a bounded cleanup
     summary when old `ListingViewDaily` rows are pruned. Stripe webhook system
     audit coverage (#1052) remains a separate remaining category because
     payment ledgers exist but are not yet mirrored into `SystemAuditLog`.
     Guardrails: `tests/system-audit-log.test.mjs` and
     `tests/json-column-guardrails.test.mjs`.

259. **Checkout stock reservations made durable across pre-session failures** —
     code/schema/test/docs fix for the verified checkout stock-reservation crash
     window where stock was decremented before a Stripe session id existed.
     `CheckoutStockReservation` now records reserved in-stock checkout items,
     checkout routes create the reservation and decrement stock in one DB
     transaction, Stripe metadata carries `checkoutReservationId`, paid webhooks
     mark reservations `COMPLETED`, and restore paths prefer the durable
     reservation before falling back to legacy line-item/metadata recovery. The
     new `/api/cron/checkout-stock-reservations` job restores old no-session
     `RESERVED` rows so a process death between DB reservation and Stripe
     session creation no longer relies only on an in-process catch block.
     Guardrails: `tests/checkout-stock-reservation-guardrails.test.mjs`,
     `tests/order-state-followups.test.mjs`, and
     `tests/payment-side-effect-observability.test.mjs`.

260. **Support/data-request exports now survive account email changes** —
     code/schema/test/docs fix for the verified account-export portability gap
     in Round 8 #757 / Round 9 #868 follow-up scope. `SupportRequest` rows now
     carry a nullable `userId` relation for signed-in support and privacy-rights
     submissions, the migration backfills rows whose normalized email matches a
     current account, and `/api/account/export` queries support/data-request
     rows by stable account id plus current-email fallback instead of current
     email only. Public support/legal intake remains public and
     suspended-account-allowed. Guardrails: `tests/support-request.test.mjs`,
     `tests/account-export-privacy.test.mjs`, and
     `tests/account-privacy-observability.test.mjs`.

261. **Admin page guards and support status history tightened** —
     code/test/docs fix for #701, #726, and #195. Sensitive admin pages that
     previously relied on the admin layout/middleware now call the shared
     `requireAdminPageAccess()` local guard before page-level Prisma reads.
     Support request status transitions now read current status/`closedAt`
     inside the transaction, reject `CLOSED` -> non-closed reopen attempts,
     preserve terminal close timestamps, and write previous/new status plus
     previous/new `closedAt` into strict admin audit metadata. The support UI no
     longer renders reopen/progress controls for closed requests. Guardrails:
     `tests/admin-action-guardrails.test.mjs` and
     `tests/support-request-state.test.mjs`.

262. **Legal data-request rate limiting made fail-closed** — code/test/docs fix
     for the still-current legal/data-request subset of #156. `/api/support`
     was already fail-closed, but `/api/legal/data-request` still used
     `safeRateLimitOpen()` despite creating durable `SupportRequest` rows and
     sending legal notification email. The legal route now uses
     `safeRateLimit()`, and the fail-open allowlist is limited to telemetry and
     diagnostics routes. Guardrail: `tests/public-cron-search-hardening.test.mjs`.

263. **Account deletion post-Stripe local orderability window reduced** —
     code/test/docs fix for #232. Stripe connected-account rejection already
     used durable side-effect retries, but a successful Stripe reject followed
     by a large anonymization transaction failure could leave local seller
     orderability unchanged until the retry cron. Account deletion now performs
     a small pre-transaction `chargesEnabled = false` / `vacationMode = true`
     update and public-cache revalidation after confirmed Stripe rejection,
     while preserving the full transaction cleanup and retry behavior.
     Verification in the same pass marked #155 stale: current verification
     applications already call fail-closed `safeRateLimit()` with
     `verificationApplyRatelimit`. Guardrail:
     `tests/account-deletion-timeout-fix.test.mjs`.

264. **Support/legal notification ambiguity reduced** — code/test/docs fix for
     #163. Public support and legal data-request rows now start with an
     admin-visible pending-delivery marker before notification email is
     attempted, clear that marker only after `emailSentAt` is persisted, and
     render the marker as "Needs review" in `/admin/support`. If email send
     fails and the follow-up `emailLastError` update also fails, the admin queue
     no longer looks like a normal `null`/`null` pending send. Verification in
     the same pass marked #166 stale: current support/legal Sentry telemetry
     uses hashed email values, and the Sentry filter redacts raw `email` keys.
     Guardrails: `tests/support-request.test.mjs` and
     `tests/account-privacy-observability.test.mjs`.

265. **Stripe webhook system-audit coverage added** — code/test/docs fix for
     #1052. The Stripe webhook already wrote durable payment ledgers for
     refunds and disputes, but order creation/refund/dispute automated state
     transitions were not mirrored into `SystemAuditLog`. Checkout order
     creation, `charge.refunded` refund ledgers, and `charge.dispute.*`
     dispute ledgers now co-commit `SystemAuditLog` rows inside the existing
     webhook transactions with `actorType: "webhook"` and `actorId: event.id`,
     keeping non-human financial state changes separate from undoable human
     admin logs. Guardrail: `tests/system-audit-log.test.mjs`.

266. **Round 13/14 duplicate allegation re-verification completed** — test/docs
     follow-up with no tally increase. Read-only agent and parent verification
     confirmed #1095, #1096, #1097, #1098, #1099, #1108, #1109, #1110, and
     #1111 are already fixed/stale on current `main` and were previously
     counted in entries 236, 237, 238, and 245. This pass added direct source
     guardrails for two already-fixed #1098 observability paths so admin audit
     logging and notification email-preference lookup failures cannot regress to
     console-only evidence. Guardrails: `tests/admin-audit-durability.test.mjs`
     and `tests/pr-h-deletion-analytics-email-followups.test.mjs`.

267. **Featured-maker rating cache invalidation added** — code/test/docs fix for
     #1026, moving it out of the earlier deferred cache bucket. Review create,
     edit, and delete already refreshed the persisted `SellerRatingSummary`, but
     cached homepage featured-maker data could keep old rating/order state until
     the five-minute TTL. These rating-changing review paths now call
     `revalidateFeaturedMakerCaches()` after a successful write, and `CLAUDE.md`
     records the future-agent contract. Guardrail:
     `tests/cache-invalidation-guardrails.test.mjs`.

268. **Pending-review listing withdrawal added** — code/test/docs fix for
     #1055 and #1059, moving them out of the earlier Round 10 deferred
     state-machine bucket. `PENDING_REVIEW` listings still cannot be edited,
     archived, unhidden, or published around moderation, but sellers can now
     explicitly withdraw them back to `DRAFT` from the dashboard and seller shop.
     The withdrawal path uses the shared `withdrawReviewBlockReason()` helper
     and final `updateMany` predicates with owner `sellerId`, current
     `PENDING_REVIEW` status, and `updatedAt` so a stale seller action cannot
     override a concurrent admin decision. Adjacent parent review also tightened
     `publishListingBlockReason()` to reject `PENDING_REVIEW` and other invalid
     start states server-side, so forged publish/resubmit actions cannot advance
     a held listing around admin review. Guardrail:
     `tests/listing-action-state.test.mjs`.

269. **Support/legal residual re-verification completed** — read-only
     verification for #706, #750-#754, #757/#868, #163, and #166. #706 is now
     stale for the raw-error/PII allegation because persisted email send errors
     are sanitized before admin display; the remaining fact that admins see a
     sanitized delivery error is an ops-product choice. #750-#754,
     #757/#868, #163, and #166 remain previously fixed/stale with existing
     tests and no tally increase. #168 remains open as a product/data-shape
     decision about whether the public support "Order/listing" reference should
     stay bounded free text or become structured `orderId` / `listingId`
     fields.

270. **Connect and rate-limit observability residuals tightened** —
     code/test/docs hardening adjacent to #1098, with no duplicate finding
     tally increase because the broader Round 13 observability finding was
     already closed. The Connect login-link route now captures tagged Sentry
     evidence when Stripe cannot create the Express dashboard link, and the
     sibling dashboard route now returns a JSON 500 with matching Sentry
     evidence instead of throwing a raw route error. The shared rate-limit
     failure-policy helper now captures Redis limiter outages with
     fail-open/fail-closed policy context and raw-key-free telemetry, while
     preserving the existing fail-open/fail-closed behavior. Guardrails:
     `tests/stripe-connect-v2.test.mjs` and
     `tests/ratelimit-policy.test.mjs`.

271. **Public security configuration hygiene tightened** — code/test/docs fix
     for #712, #713, #715, and #716. Tracked agent docs no longer carry the
     private founder inbox or residential formation-address note, `robots.txt`
     now also disallows `/account` and `/messages`, `package.json` declares the
     Node 22 runtime expected by CI/production builds, and `next.config.ts`
     explicitly keeps production browser source maps disabled. The adjacent
     #714 `i.postimg.cc` display-only media allowance was not changed because
     current code still uses `isTrustedMediaUrl()` for legacy display reads and
     removing that host needs a production-data scan first. Guardrails:
     `tests/public-security-config.test.mjs` and
     `tests/dependency-hygiene.test.mjs`.

272. **Moderation-record retention disclosure truth-matched** — docs/test fix
     for #579. The Privacy Policy now explicitly discloses that user reports,
     block records, report-resolution notes, and related moderation records may
     be retained after resolution for safety, fraud-prevention, legal, and
     marketplace-integrity purposes, while account deletion removes or
     anonymizes personal data where legally permitted. This pass did not invent
     a fixed three-year purge window because no matching purge job exists.
     Guardrail: `tests/launch-readiness-followups.test.mjs`.

273. **Email outbox status integrity constrained** — code/test/docs fix for
     #727. `EmailOutbox.status` remains a Prisma string for low-risk migration
     compatibility, but the database now raw-constrains it to the six processor
     states: `PENDING`, `PROCESSING`, `SENT`, `FAILED`, `SKIPPED`, and `DEAD`.
     The migration normalizes any historical invalid rows before validation,
     preserving terminal intent from `sentAt` / attempt count where possible and
     leaving sanitized `lastError` evidence on normalized rows. `CLAUDE.md`
     records the status contract for future outbox changes. Guardrail:
     `tests/email-outbox-state.test.mjs`.

274. **Stripe webhook failed-row error persistence sanitized** — code/test/docs
     fix for #221. `markStripeWebhookEventFailed()` no longer stores raw
     `error.message` text in `StripeWebhookEvent.lastError`; it now passes errors
     through `stripeWebhookEventLastError()`, which reuses the shared operational
     error scrubber and also removes card-last4 fragments before applying the
     existing 500-character cap. Guardrail:
     `tests/stripe-webhook-event-state.test.mjs`.

275. **Production Sentry DSN configuration made fail-loud** — code/test/docs fix
     for #318. Server and edge Sentry config now resolve through
     `resolveServerSentryDsn()`, and the browser instrumentation resolves through
     `resolveClientSentryDsn()`. Missing DSNs stay permissive in development/test
     but throw in production instead of falling back to an empty string and
     silently disabling telemetry. Guardrail: `tests/sentry-dsn.test.mjs`.

276. **Internal redirect encoded-prefix guard tightened** — code/test/docs fix
     for #233. `safeInternalPath()` and `safeInternalReturnUrl()` now share a
     path-prefix guard that rejects raw, decoded, and double-decoded
     protocol-relative/backslash prefixes plus path-prefix control characters,
     while preserving encoded slash text inside ordinary query values. Guardrail:
     `tests/internal-return-url.test.mjs`.

277. **Account deletion blog archive slug collision reduced** — code/test/docs
     fix for #827. `archiveBlogPostsForDeletedAccount()` now allocates deleted
     blog slugs by probing `BlogPost.slug @unique` candidates and suffixing on
     collision instead of writing `deleted-${post.id}` directly. This keeps
     account anonymization from failing on a pre-existing colliding blog slug.
     Guardrail: `tests/round9-account-deletion-pii-guardrails.test.mjs`.

278. **Maker-verification portfolio URL host validation tightened** —
     code/test/docs fix for #162. Verification write paths now normalize
     portfolio links through `normalizePublicHttpsUrl()`, which requires
     HTTPS and rejects credentials, localhost, private IPv4 ranges, loopback and
     link-local IPv6 ranges, internal-label hostnames, and common wildcard
     private-IP DNS aliases. The admin verification page re-checks stored
     portfolio URLs before rendering external links, so historical unsafe
     values are shown as text instead of direct links. Guardrails:
     `tests/public-url-validation.test.mjs` and
     `tests/guild-listing-edit-followups.test.mjs`.

279. **UserReport reason categorical guardrail extended** — test/docs
     follow-up for already-closed #828, with no duplicate tally increase
     because entry 209 already counted the stale/false-positive finding.
     `UserReport.reason` remains guarded as a fixed Zod enum
     (`SPAM`, `HARASSMENT`, `FAKE_LISTING`, `INAPPROPRIATE`, `OTHER`), while
     reporter-entered free text lives in `details` and account deletion clears
     that field for reports involving the deleted account. Guardrail:
     `tests/user-report-target-access.test.mjs`.

280. **Stripe dispute-created case thread context surfaced** — code/test/docs
     fix for #722. Stripe `charge.dispute.created` cases still use
     `Case.description` as the system event summary rather than creating a
     falsely buyer- or seller-authored `CaseMessage`, but buyer, seller, and
     admin case-detail views now render that description whenever the thread has
     no messages. This preserves attribution while removing empty under-review
     case threads. Guardrail:
     `tests/round10-state-machine-guardrails.test.mjs`.

281. **Stripe dispute case-promotion behavior documented** — test/docs fix for
     #721. Current code intentionally lets `charge.dispute.created` promote an
     active `PENDING_CLOSE` case to `UNDER_REVIEW` because an external payment
     dispute supersedes the in-app pending-close state, while terminal
     `RESOLVED`/`CLOSED` cases remain untouched. Guardrail:
     `tests/stripe-webhook-state.test.mjs`.

282. **Guild verification stale-transition writes guarded** — code/test/docs
     fix for #724. Guild Master applications, cron Guild Member/Master
     revocations, admin revoke actions, and admin Guild Member reinstatement
     now guard paired `MakerVerification.status` writes with explicit expected
     current-state sets from `guildVerificationState.ts`; if the paired
     `SellerProfile.guildLevel` transition no longer matches, the transaction
     rolls back instead of leaving profile and verification state out of sync.
     Guardrail: `tests/round10-state-machine-guardrails.test.mjs`.

283. **Blog edit and listing-card money guardrails tightened** —
     code/test/docs fix for #725 and #729. Dashboard blog edit saves now claim
     the row with `id`, `authorId`, current `status`, and current `updatedAt`
     before writing status/content changes and follower fanout context, so stale
     edit tabs do not overwrite a newer status transition. `ListingCard` now
     renders prices through `formatCurrencyCents(priceCents, currency)` instead
     of direct `toLocaleString()` with untrusted currency text. Guardrails:
     `tests/blog-action-guardrails.test.mjs` and `tests/money.test.mjs`.

284. **Order tracking-link encoding tightened** — code/test fix for #730.
     `OrderTimeline`, buyer order detail, and seller sales detail tracking-link
     helpers now URL-encode tracking numbers before interpolating them into
     carrier deep links, matching the already-hardened label and email link
     builders. Guardrail: `tests/link-security.test.mjs`.

285. **Client navigation and UI recovery guardrails tightened** — code/test fix
     for #731, #733, #735, and #736, plus verified stale/false-positive closure
     for #732 and #734. Recently viewed listing IDs now travel through
     `URLSearchParams`; search/blog suggestion category and slug routing now
     encodes query/path values before navigation; dismissible-banner localStorage
     state is shape-checked before use; and commission status buttons now show
     server/network failures instead of silently clearing loading state. The
     MapFallback blank-target rel and ImageCropModal body scroll-lock findings
     were stale on current `main`. Guardrails: `tests/link-security.test.mjs`
     and `tests/client-async-guardrails.test.mjs`.

286. **Round 6 public listing privacy/test follow-ups closed** — code/test/docs
     fix for #681 and #682, plus verified stale/product-policy closure for #677
     and #683. Public listing/message display names no longer fall back to email
     on current `main`. The public listing detail loader no longer selects
     seller `User.clerkId`; seller-preview/reply gating now compares the current
     local user id to `SellerProfile.userId` server-side. The Commission Room
     near-me raw SQL path now has a guardrail confirming category input is
     allowlisted and passed as bound positional parameters, and GIF remains
     intentionally unsupported by the upload allowlist/signature checks.
     Guardrails: `tests/round8-fulfillment-privacy-guardrails.test.mjs`,
     `tests/listing-visibility.test.mjs`,
     `tests/verified-audit-followups.test.mjs`, and
     `tests/upload-verification-token.test.mjs`.

287. **Ranking abuse and CSP report backpressure tightened** — code/test/docs
     fix for #742, #743, and #745. The quality-score formula now bounds excess
     view-only traffic before it affects conversion/CTR and reduces favorite-only
     spikes that lack supporting clicks/orders, reducing ranking-manipulation and
     view-bombing risk without removing the existing engagement signals. CSP
     report intake now uses the fail-closed rate-limit helper so Redis/rate-limit
     failures do not open an unbounded Sentry event path. Guardrails:
     `tests/quality-score-state.test.mjs` and
     `tests/public-cron-search-hardening.test.mjs`.

288. **Seller profile public URL rendering revalidated** — code/test fix for
     #788 and #790. Seller profile social links are normalized and host-checked
     again before rendering or entering JSON-LD `sameAs`, so stale stored rows
     cannot bypass the newer profile-write validators. Latest seller-broadcast
     images now render only when the stored URL is still a first-party media URL.
     Guardrail: `tests/round8-fulfillment-privacy-guardrails.test.mjs`.

289. **Seller shipping-speed stat narrowed to recent fulfillment** — code/test
     fix for #787. The public seller page now computes the “Ships in N days”
     summary from the last 30 shipped orders within a 180-day window instead of
     letting stale historical shipments shape current buyer-facing expectations.
     Guardrail: `tests/seller-page-performance.test.mjs`.

290. **Blog material-connection disclosures implemented** — schema/code/test fix
     for #761. `BlogPost` now has a bounded `materialDisclosure` field, the
     dashboard blog create/edit form persists it, publish-time profanity checks
     include it, and public blog posts render the disclosure when present so the
     Terms disclosure requirement has a concrete authoring surface. Migration:
     `20260530061000_add_blog_material_disclosure`. Guardrail:
     `tests/blog-action-guardrails.test.mjs`.

291. **Newsletter double opt-in and customer-photo filter parity tightened** —
     schema/code/test fix for #744, plus adjacent #783 public-gallery parity
     with no duplicate tally increase because #783 was already counted in entry
     205. Public newsletter signup now stores inactive pending subscribers,
     sends a confirmation email, and activates only through
     `POST /api/newsletter/confirm`; the confirmation `GET` renders a form only,
     and unsubscribe/suppression paths clear pending confirmation tokens. The
     seller customer-photos gallery now applies the same banned/deleted reviewer
     and viewer block filters already used on the seller profile customer-photo
     preview. Migration: `20260530190000_newsletter_double_opt_in`.
     Guardrails: `tests/newsletter-double-opt-in.test.mjs`,
     `tests/account-privacy-observability.test.mjs`,
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`, and
     `tests/post-launch-ui-followups.test.mjs`.

292. **Round 10 residual client/cache guardrails tightened** — code/test fix
     for #927, #930, #931, #932, and #1030, plus residual route-cache hardening
     for already-counted #1028/#1035. Account feed pagination now aborts
     in-flight requests on unmount and ignores stale responses, dismissed
     rejection banner ids are capped before writing to localStorage, markdown
     editor image uploads validate the returned URL shape and first-party media
     origin before insertion, and the toast provider memoizes its context value.
     Root-layout footer metro links now read through a tagged 5-minute
     `unstable_cache`; auto-created metros and seller/listing metro assignment
     paths invalidate that tag, moving #1030 out of the earlier deferred cache
     bucket. The private JSON follow-up converted the identified auth mutation
     routes (`cart/add`, favorites, notification read/read-all, and block/unblock)
     to `privateJson()`/`privateResponse()` but did not increase the tally for
     #1028/#1035 because those findings were already counted in entries 216 and
     220. Read-only agent and parent review also verified #895, #896, #900,
     #901, #928, and #934-#939 stale/false-positive on current `main`, and
     classified #899 and #933 as product/design decisions rather than current
     defects. The same sweep re-verified #1014-#1048 against entries 220/221
     with no duplicate tally increase except the #1030 category move above.
     Guardrails: `tests/client-async-guardrails.test.mjs`,
     `tests/private-json-cache-headers.test.mjs`, and
     `tests/verified-audit-followups.test.mjs`.

293. **Agent-reviewed stale Guild/search/AI allegations closed** — docs-only
     verification for #193, #494, #549, and #717 as stale/false-positive on
     current `main`, plus product/design classification for #157, #718, and
     #719. #283 was re-verified in the same Guild sweep, but it was already
     counted in entry 235, so this pass does not double-count it. Guild Member
     reinstatement and maker feature/unfeature actions are ADMIN-only and
     reinstatement now rechecks banned/deleted state, unresolved long-running
     cases, active public listing count, and guarded Guild state transitions.
     Seller metrics count all non-terminal cases instead of narrowing active
     cases to the current metrics window. Saved-search duplicate/cap handling is
     route-mitigated with canonical tags and a Serializable transaction/retry;
     a database-level unique key remains optional defense-in-depth rather than
     a verified current route race. Listing create's AI post-processing writes
     are status-preconditioned on `PENDING_REVIEW` in the normal create path,
     with stricter `updatedAt`/status guards in custom-order create. The
     unsubscribe token remains stateless and replayable inside its 90-day TTL,
     but current public newsletter signup does not clear email suppression or
     reactivate delivery; a persisted consent epoch is a product decision for
     manual/staff resubscribe workflows. `CaseStatus.CLOSED` and
     `CommissionStatus.IN_PROGRESS` remain legacy/reserved enum states handled
     by readers/cleanup paths, with removal or full implementation requiring a
     data check and explicit migration/product decision. Guardrails:
     `tests/security-lifecycle-followups.test.mjs`,
     `tests/guild-listing-edit-followups.test.mjs`,
     `tests/guild-member-revocation-state.test.mjs`,
     `tests/guild-metrics-state.test.mjs`,
     `tests/r49-account-state-routes.test.mjs`,
     `tests/schema-hardening-followups.test.mjs`,
     `tests/server-action-hardening.test.mjs`,
     `tests/newsletter-double-opt-in.test.mjs`,
     `tests/case-messaging-state.test.mjs`, and
     `tests/ban-side-effect-guardrails.test.mjs`.

294. **Listing metadata money formatting aligned with currency minor units** —
     code/test fix for #798, plus verified stale/current-clean closure for
     #785, #786, and #1112-#1119, and product/design classification for #1120.
     Listing Open Graph product price metadata and Product JSON-LD offer price
     now format stored minor units through `formatCurrencyMinorUnitAmount()`
     instead of directly dividing by 100, so future zero-decimal currencies do
     not publish a 100x-smaller structured-data price. The listing detail
     "More from" rail also uses `formatCurrencyCents()` with the listing
     currency. Seller profile `"null banner"` and blank-H1 allegations were
     stale on current `main` because `SellerProfile.displayName` is schema
     non-null and seller auto-creation now falls back to `"Maker"` instead of
     email-derived text. Read-only agent and parent verification also confirmed
     the Round 14 clean inventory remains current for label clawback retry,
     ban-side-effect repair, multi-seller checkout metadata, gift-wrap
     server-side pricing, sitemap chunking, robots AI-bot/private-path blocks,
     critical-form ARIA, and Stripe V2 webhook hardening (#1112-#1119).
     #1095-#1099 and #1108-#1111 were re-verified stale/fixed but were already
     counted in entries 236, 237, and 266, so this pass does not double-count
     them. #1120 remains a documented product/UX tradeoff: Buy Now rollback is
     best-effort browser cleanup, with stock recovery guaranteed by Stripe
     session expiry/webhook if the browser closes first. Guardrails:
     `tests/money.test.mjs`, `tests/round9-public-pii-guardrails.test.mjs`,
     `tests/listing-page-performance.test.mjs`, plus the read-only Round 14
     guardrail sweep covering env, seller-page performance, label clawback,
     ban repair, checkout/email, sitemap/robots, accessibility, and Stripe V2
     webhook tests.

295. **Public seller stats moved off the live render path** — code/test fix
     for #789, docs/test fixes for #800 and #803, verified stale/current-clean
     closure for #747, #748, #749, #760, #792, #793, #801, #802, and #804,
     and product/ops classification for #746, #762, #763, and #1082. The
     public seller page now calls `getCachedPublicSellerStats()` instead of
     issuing order/orderItem sold-count and recent-shipping aggregate queries
     directly during every page render. The helper owns a five-minute
     cross-request cache, preserves the previous 180-day/latest-30 shipped
     order average behavior, and keeps the page component's independent query
     batch focused on page-local data. CLAUDE production env documentation now
     includes the missing required runtime/build/migration names
     (`STRIPE_SECRET_KEY`, `CRON_SECRET`, `SHIPPING_RATE_SECRET`,
     `DIRECT_URL`, and related public keys), and its seller-refund panel note
     now uses the current `orderTotalCents` prop instead of the stale
     `maxRefundCents` name. Read-only agent verification found #747, #748,
     #749, #760, #792, #793, #801, #802, and #804 already clean on current
     `main`; #746 remains an intentional Stripe Connect losses-controller
     ops/legal decision, #762 remote branch pruning and #763 old git author
     metadata remain ops hygiene, and #1082 is process guidance for verifying
     agent work against current `main`/matching worktree HEAD. #1062-#1074 and
     #1083-#1094 were re-verified as already-counted duplicates of earlier
     closed entries, so this pass does not double-count them. Guardrails:
     `tests/seller-page-performance.test.mjs`,
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`, and
     `tests/public-security-config.test.mjs`; read-only agent sweeps also
     reported 40/40 and 98/98 focused tests passing.

296. **Checkout payment-failure allegation constrained to current card-only
     behavior** — verified stale/current-clean closure for #678 with an added
     regression guardrail. Both checkout routes still create embedded Checkout
     Sessions with `payment_method_types: ["card"]`, and the Stripe webhook
     already releases reserved stock on `checkout.session.expired` and
     `checkout.session.async_payment_failed` through
     `restoreUnorderedCheckoutStockOnce()`. Under that current card-only
     design, a separate `payment_intent.payment_failed` handler is not a
     verified missing production path. `CLAUDE.md` now records that delayed or
     asynchronous payment methods and `automatic_payment_methods` must not be
     enabled without adding and testing the corresponding PaymentIntent failure
     lifecycle handling. Guardrail: `tests/checkout-payment-methods.test.mjs`.

297. **Refund recovery, Guild sales, and media URL spoof allegations rechecked** —
     verified stale/false-positive closure for #61, #159, and #545. The case
     resolution orphan-refund recovery path now captures failed reconciliation
     writes to Sentry instead of swallowing the update failure silently. Guild
     verification sales qualification excludes both locally stamped
     `sellerRefundId` orders and `OrderPaymentEvent` refund ledger rows, so
     partially refunded orders no longer count as clean sales toward the
     threshold. The first-party media URL validator uses `new URL()` plus exact
     origin/path-prefix matching; IDN lookalikes normalize to a different
     punycoded origin and fail the allowlist check. Guardrails:
     `tests/case-observability-followups.test.mjs`,
     `tests/guild-listing-edit-followups.test.mjs`, and
     `tests/media-url.test.mjs`.

298. **Retention-sensitive cascade-delete allegations are stale on current
     schema** — verified stale/current-clean closure for #963, #964, #967, #968,
     and #969. `Photo.listing`, `Review.listing`, `OrderPaymentEvent.order`,
     `SellerPayoutEvent.sellerProfile`, and `BlogComment` parent/author/post
     retention links no longer cascade parent hard deletes in the active Prisma
     schema; the retention FK migration installs `ON DELETE RESTRICT` for the
     listing, payment, payout, blog-post, and blog-comment author links, and
     `ON DELETE SET NULL` for blog comment reply parents. Dashboard blog-post
     removal archives posts rather than hard-deleting comment trees. Guardrail:
     `tests/schema-retention-guardrails.test.mjs`.

299. **Support request order/listing context split into structured fields** —
     schema/code/test fix for #168. Public support intake now collects optional
     `orderId` and `listingId` as separate bounded fields instead of one
     ambiguous "Order/listing" value, persists both on `SupportRequest`, renders
     them separately in support-notification email and the admin support queue,
     and includes both fields in account export. Legal data-request submissions
     continue to omit the optional context fields by default. Migration:
     `20260530203000_support_request_listing_reference`. Guardrails:
     `tests/support-request.test.mjs` and
     `tests/account-export-privacy.test.mjs`.

300. **CSP runtime eval allowance removed from enforced script policy** —
     code/test/docs fix for #313. The enforced `script-src` header no longer
     includes `'unsafe-eval'`; Sentry source-map upload remains build-time
     behavior and does not require browser runtime eval. CSP docs and checkout
     script inventory now record the no-runtime-eval contract so third-party
     checkout additions cannot silently reintroduce it. Guardrails:
     `tests/public-security-config.test.mjs` and
     `tests/checkout-script-inventory.test.mjs`.

301. **Account export requires POST and fresh Clerk reverification** —
     code/test fix for Round 32 privacy finding #12. `/api/account/export`
     no longer serves the full portability dump on GET, rejects explicit
     cross-origin POST browser headers before auth/export work, requires a
     fresh first-factor Clerk session before building the payload, and uses
     Clerk's reverification response so the account settings button can prompt
     and retry the POST. Guardrails:
     `tests/account-export-privacy.test.mjs` and
     `tests/account-export-reverification.test.mjs`.

302. **Account deletion scrubs retained seller listing titles** — code/test
     fix for Round 32 privacy finding #10. Seller account deletion already
     hid/private-scoped listings and cleared descriptions, tags, materials,
     SEO copy, media, and review surface fields, but retained
     `Listing.title`. The deletion transaction now replaces the title with a
     neutral placeholder alongside the existing listing redaction fields.
     Guardrail: `tests/round9-account-deletion-pii-guardrails.test.mjs`.

303. **Account deletion resets retained elevated roles** — code/test fix for
     Round 32 privacy finding #17. Deleted admin/employee rows were already
     blocked by `banned` and `deletedAt` checks, but the retained anonymized
     `User` stub kept its old `role`. Account deletion now resets the role to
     `USER` while keeping the deleted account blocked. Guardrail:
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

304. **Email suppression closes Gmail alias bypass for account deletion** —
     code/test/docs fix for Round 32 privacy finding #14. Durable Grainline
     account identity still stores the normalized literal email address, but
     email suppression lookups and account-deletion suppression now also use a
     Gmail/Googlemail alias-insensitive suppression key that removes dots and
     plus tags for those domains only. Account deletion also skips pending
     outbox rows and newsletter subscriptions matching either the literal or
     suppression key, and Clerk same-email re-signup clears account-deletion
     suppression rows for the same key set. Guardrails:
     `tests/email-normalization-followups.test.mjs` and
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

305. **Account deletion scrubs maker-verification residue** — code/test/docs
     fix for Round 32 privacy finding #18. Seller account deletion already
     scrubbed maker-verification narrative fields, portfolio URL, and review
     notes; it now also resets years of experience, clears reviewer linkage and
     review timestamp, normalizes the retained application timestamp to the
     deletion transaction time, and marks the retained row rejected so the
     deleted seller no longer keeps active verification state. Guardrail:
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

306. **Round 32 account-deletion residuals reverified** — test/docs closure for
     #1, #7, #9, #11, #13, #15, #19, and #20. Account deletion intentionally
     preserves conversations for the other participant, but the deleted user's
     sent message bodies are redacted, other-party direct/case messages that
     quote deleted-account identifiers are redacted, and message list/thread UI
     stays off deleted-account email fallbacks. Authored blog comments are
     scrubbed. Clerk-delete ordering now creates a retryable local-anonymize
     side-effect row before deleting the external Clerk user; account export
     writes a non-PII `ACCOUNT_EXPORT` audit row before returning the download;
     block rows are deleted in both directions; the current `Listing` model has
     no slug field and account deletion already scrubs title/metadescription;
     commission reference media is collected for owner-scoped cleanup before
     clearing URL arrays. Stripe Connect account rejection/deauthorization
     semantics remain a product/ops decision rather than an automatic code
     change in this pass. Guardrails:
     `tests/round9-account-deletion-pii-guardrails.test.mjs`,
     `tests/account-deletion-side-effects.test.mjs`, and
     `tests/account-export-privacy.test.mjs`.

307. **Lost-dispute conversion signal removed from quality scoring** —
     code/test/docs hardening adjacent to already-counted #848, with no
     duplicate tally increase. Quality-score listing order counts and the site
     metrics conversion snapshot already excluded refunded orders and open
     Stripe dispute ledger rows; they now also exclude terminal lost disputes
     and unknown dispute statuses, counting only `won` and `warning_closed`
     dispute rows as eligible conversion signal. Guardrail:
     `tests/quality-score-query-guardrails.test.mjs`.

308. **Staff case refund route matched seller refund guardrails** — code/test
     fix from agent-found refund-accounting follow-ups. Staff case full refunds
     now restore stock only before buyer handoff, matching the seller refund
     route's `refundMayRestoreStock()` behavior; staff case refund recording now
     writes the Stripe refund id only while the local refund sentinel is still
     held; and platform-only case refunds now flag the seller profile for manual
     Stripe transfer reconciliation. The same pass also closed the stale
     quality-score doc/test gap for #850 by documenting and testing the 30-day
     zero-review new-seller bonus cap. Guardrails:
     `tests/payment-side-effect-observability.test.mjs` and
     `tests/quality-score-state.test.mjs`.

309. **Listing soft-delete blocks recent terminal orders inside case window** —
     code/test/docs fix for #286. `softDeleteListingWithCleanup()` already
     blocked open fulfillment and active cases; it now also blocks `DELIVERED`
     and `PICKED_UP` orders inside the 30-day buyer case window unless the order
     has been refunded or has a blocking refund ledger event. This keeps seller
     archive/private-scope actions aligned with account-deletion blockers while
     buyers can still open a case. Guardrail:
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`.

310. **Message metadata and commission predicate residuals reduced** —
     code/test/docs fix for #265 and #305, plus source-verified cleanup for the
     adjacent file-message read parser. Message attachment write-path metadata
     and structured file-message read-path metadata now strip C0/DEL control
     characters after the shared dangerous-protocol text sanitizer and before
     length caps. Public commission reads and commission mutation guards now
     compose from `openCommissionBaseWhere()`, removing the duplicate
     open/non-expired/active-buyer predicate between `commissionExpiry.ts` and
     `commissionState.ts`. Read-only agent and parent verification in the same
     pass newly classified #268, #270, #271, #273-#279, #281, #307-#312, #314,
     #316, and #319-#324 as stale, false-positive, or current-clean. #266,
     #267, #315, and #317 remain data-scan/ops decisions; exact duplicates or
     already-counted closures (#269, #272, #280, #300-#304, #306, #313, #318,
     and #325-#328) were not double-counted. Guardrails:
     `tests/message-attachments.test.mjs`, `tests/message-bodies.test.mjs`, and
     `tests/commission-state.test.mjs`.

311. **Client rendering and dependency false-positive slice reverified** —
     source/test/docs closure for #329-#334 and #342-#347. Every current
     `dangerouslySetInnerHTML` sink is either JSON-LD serialized through
     `safeJsonLd()` or blog markdown rendered through `marked` and
     `sanitize-html`; direct `eval` hits are Upstash Redis Lua helpers, with no
     arbitrary `innerHTML`/`new Function` usage found. Current browser storage
     users are anonymous cart, legacy cart-session cleanup keys, recently
     viewed identity transition state, admin lockout timestamps, dismissed
     banner IDs, and avatar draft URLs; the cart page no longer persists
     shipping-address, selected-rate, or Stripe client-secret session data.
     `window.location.href` client navigations route through
     `safeInternalPath()` auth helpers or `safeStripeRedirectUrl()`, seller
     social links require public HTTPS URLs plus host allowlists where
     applicable, and target-blank links are covered by noopener/noreferrer
     guardrails. The dependency review also verified CI secrets use
     GitHub/Vercel secret indirection except fixed non-production CI sentinel
     values, Next resolves to `16.2.6`, Hono/PostCSS/Svix overrides are applied,
     Vercel migrations remain production-only, and CI tests run on Node 22 with
     native strip-types. Previously closed exact findings #335-#341 and
     #325-#328 were not double-counted. Guardrails:
     `tests/rendering-security.test.mjs`, `tests/link-security.test.mjs`,
     `tests/client-async-guardrails.test.mjs`,
     `tests/dependency-hygiene.test.mjs`,
     `tests/internal-return-url.test.mjs`, `tests/stripe-redirect-state.test.mjs`,
     and `tests/local-account-state.test.mjs`.

312. **Round 9 chain, ASVS, and observability slices reverified** —
     source/test/docs closure for #348-#354, #356-#389 except the explicitly
     deferred external-evidence items below. Photo mutation bypass chains are
     stale: the old photo POST route is disabled, listing edit-save validates
     new photo URLs with uploader ownership, and ACTIVE listing edits re-run AI
     review. Similar listings apply reciprocal block seller filtering before raw
     SQL results return. Seller/user text sanitizers now strip HTML with
     `sanitize-html`, while blog markdown remains on its separate
     `sanitize-html` pipeline. Founding Maker numbering is serialized with a
     Postgres advisory transaction lock, blog comment notifications dedupe by
     comment id, republishing no longer looks like first publish, dev order
     fixtures require local development plus an explicit env flag, and saved
     searches sort normalized tags plus rate-limit GET/POST/DELETE. Verification
     applications, support forms, and legal data requests use fail-closed rate
     limits before durable work. Guild metrics/reinstatement count unresolved
     cases without the stale 3-month blind spot, and reinstatement is ADMIN-only
     with fresh eligibility checks. Newsletter/unsubscribe paths normalize email,
     keep public signup responses uniform, and have no active suppression toggle
     to replay against. Ban and account-deletion Stripe races are narrowed by
     local account-state checks in Stripe mirroring plus local orderability
     disable/cleanup during deletion.

     ASVS and observability items in the same slice are also stale or accepted:
     Admin PIN cookies are already `sameSite: "strict"` with guardrails; direct
     upload verification already reads R2 prefix bytes and validates file
     signatures; secret-rotation cadence/procedure, SRI omission for Stripe/Clerk
     style dynamic scripts, and unsubscribe-email-in-query risk are documented;
     broad Prisma `user: true` relation loads are blocked by source tests; Sentry
     `beforeSend()` now scrubs top-level messages, transactions, exception
     values, stack-frame vars, request URLs/query strings, and nested extras;
     checkout capture sites have bounded tags/extras; email and Resend telemetry
     hash or sanitize recipient/error details; CSP report Sentry data redacts
     dynamic IDs and tokens; profanity telemetry sends counts rather than raw
     matched text; ban-audit review-note snapshots store hash/length; favorites
     error logs no longer include Clerk ids; geo-metro logs omit city/state; and
     Stripe webhook outer errors use the shared sanitized error string. Email
     outbox quota-unavailable deferral uses retry cadence, DEAD jobs are surfaced
     in ops-health and pruned after retention, and Resend transient suppression
     counts only `email.failed` with a higher threshold. #355 remains folded into
     the existing refund-accounting runtime-proof bucket and was not
     double-counted. #363, #365, and #368 remain external ops/runtime evidence
     tasks for Clerk staff MFA, HSTS preload acceptance, and Clerk breached
     password protection. Guardrails include:
     `tests/post-launch-ui-followups.test.mjs`,
     `tests/r56-r67-small-fixes.test.mjs`, `tests/media-url.test.mjs`,
     `tests/public-cron-search-hardening.test.mjs`,
     `tests/block-filter-guardrails.test.mjs`, `tests/sanitize-unicode.test.mjs`,
     `tests/blog-markdown-sanitization.test.mjs`,
     `tests/blog-action-guardrails.test.mjs`, `tests/r49-account-state-routes.test.mjs`,
     `tests/schema-hardening-followups.test.mjs`,
     `tests/payment-side-effect-observability.test.mjs`,
     `tests/account-privacy-observability.test.mjs`,
     `tests/sentry-filter.test.mjs`, `tests/csp-report-sanitization.test.mjs`,
     `tests/profanity-telemetry.test.mjs`, `tests/privacy-telemetry.test.mjs`,
     `tests/admin-pin.test.mjs`, `tests/upload-verification-token.test.mjs`,
     `tests/email-outbox-state.test.mjs`, `tests/email-outbox-retention.test.mjs`,
     and `tests/email-outbox-quota.test.mjs`.

313. **Round 2 race, email, test-gap, accessibility, and persona slices
     reverified** — source/test/code closure for #390-#501, with runtime and
     architecture items explicitly left as such. Email/outbox and race findings
     #390-#407 and #410-#427 are stale or current-clean: Resend failure counts
     use atomic upsert logic, admin direct email resolves to existing users
     before send, new-message emails use atomic throttle state, email plaintext
     fallback no longer reintroduces decoded HTML, listing-followed-maker email
     images are first-party only, unsubscribe POST has accepted RFC 8058 behavior
     with origin/referer and per-email rate limits, direct transactional email
     paths have outbox fallback behavior, case-message double submits are
     serialized, EmailOutbox content/error fields are bounded and sanitized,
     Resend webhook in-progress reservations return retryable status, admin
     email audit targets do not store raw external recipient emails, account
     deletion performs seller orderability disablement inside the deletion
     transaction, create-time AI review cannot overwrite admin listing removal,
     Guild threshold sync is centralized in one SQL update, saved-search
     dedupe/cap/create is serializable, custom-order ready links use an advisory
     lock, blog approval side effects run only on first approval, duplicate
     review/case/slug/vote/cart races have friendly idempotent paths, follow vs
     block races re-check after write, photo vanished-row conflicts clean new R2
     URLs, Founding Maker numbering uses an advisory max-number assignment, and
     Stripe/account-deletion in-progress locks return retryable status or lock
     before external side effects.

     Test-gap items #428-#440 were also reverified. JSON-LD escaping,
     reciprocal block-filter helpers, AI-review response normalization,
     rate-limit fail-open/fail-closed policy, quality-score boundary math, blog
     markdown sanitization, reverse-geocode throttling, and admin-audit 24h undo
     windows already had guardrails. This pass added tighter source guards for
     shipping quote fallback/pickup/carrier-preference behavior, dynamic sitemap
     public-visibility predicates, and notification/account-state fail-closed
     behavior. Founding Maker live DB concurrency proof and broader cron
     termination mocks remain test-backlog items rather than closed runtime
     evidence.

     Accessibility findings #441-#481 are now mostly stale or current-clean:
     variant selectors, open-case fields, admin email, image crop modal, maps,
     blog comments, review composer, shipping-rate groups, browse filters,
     variant editor rows, report form, menus, address autocomplete, attachment
     links, character counters, photo alt editors, follow/unread/Guild controls,
     star ratings, StarInput, hero decorative SVG, close glyphs, notification
     icons, and data tables all have source guardrails. This pass fixed the
     remaining source-real items in that slice: newsletter signup now has a
     labelled email input plus linked alert/status regions; listing type radio
     buttons now support roving keyboard behavior with Arrow/Home/End keys;
     footer and small amber text tokens were moved to higher-contrast colors;
     and favorite/save blog icon targets were increased to 44px-plus geometry.
     Homepage heading/contrast confirmation, mobile drawer background
     reachability, and reduced-motion behavior remain runtime axe/browser proof
     tasks.

     Persona findings #482-#501 are stale or false-positive except two deferred
     operational/architecture items. Banned reviewers are redacted in public
     review display, ban/deletion removes seller commission/cache/outbox residue,
     banned/deleted users are blocked from Stripe dashboard, messaging,
     fulfillment, label, and refund actions, saved-search/newsletter/cart spam
     paths are bounded or normalized, sensitive Guild actions are ADMIN-only,
     report resolution requires a reason, staff thread access remains reported
     thread read-only, destructive admin actions are ADMIN-only, deletion-time
     email suppression is cleared on same-email re-signup, seller-authored review
     replies are cleared on deletion, and account deletion sweeps seller metrics,
     rating summaries, commission interest, and unresolved reports. #493 remains
     Clerk dashboard runtime evidence for multi-account spam controls; #495
     remains a separate per-user staff MFA/TOTP architecture project rather than
     a drive-by replacement for the shared admin PIN. Guardrails include:
     `tests/accessibility-followups.test.mjs`,
     `tests/shipping-quote-state.test.mjs`,
     `tests/sitemap-entry-limit.test.mjs`,
     `tests/pr-h-deletion-analytics-email-followups.test.mjs`,
     `tests/account-privacy-observability.test.mjs`,
     `tests/admin-action-guardrails.test.mjs`,
     `tests/custom-order-admin-thread-followups.test.mjs`,
     `tests/case-observability-followups.test.mjs`,
     `tests/post-launch-ui-followups.test.mjs`,
     `tests/user-text-normalization-followups.test.mjs`,
     `tests/email-normalization-followups.test.mjs`,
     `tests/account-state-residue-followups.test.mjs`,
     `tests/r49-account-state-routes.test.mjs`,
     `tests/security-lifecycle-followups.test.mjs`, and
     `tests/newsletter-double-opt-in.test.mjs`.

314. **Round 3 stale Stripe branch and unicode/i18n slices reverified** —
     source/test/docs closure for #502-#547, with current-main behavior
     separated from stale-branch risk. The `feature/stripe-connect-v2` branch is
     verified stale relative to `main`: its account-version predicate rejects
     nullable legacy accounts, its dashboard route lacks the current
     account-state guard, and it is missing current schema/runtime hardening.
     Current `main` has the expected nullable account-version support, split
     `/api/stripe/webhook/v2` thin-event destination, guarded Connect dashboard
     and status routes, whole-order seller refund ownership check, checkout
     completion account-state revalidation, and v2 route tests. `CLAUDE.md` was
     corrected so future agents do not treat that branch as the v2 source of
     truth or merge gate; pruning or rebasing the stale branch remains a branch
     hygiene task rather than a current-main code defect.

     Unicode/email findings #515-#539 and #541-#547 are fixed or current-clean
     in source and tests. Account and newsletter email writers now use NFC
     lowercase normalization through the shared email helpers; unsubscribe and
     Clerk webhook email handling match that behavior. Canonical user-text
     sanitization strips bidi controls including U+061C, zero-width characters,
     null bytes, dangerous protocols, and the current Cyrillic confusable map;
     downstream profanity, AI-review, notification, and tag helpers import the
     canonical normalizer. Message, case, custom-order, commission, gift-note,
     report, fulfillment seller-note, blog, saved-search, seller FAQ, audit-log
     reason, email body/plaintext, shipping-address, message-attachment, avatar
     initial, account-deletion redaction, and Stripe order snapshot paths now
     route through bounded normalization helpers. #544 and #545 are verified
     false positives for locale-invariant JavaScript case conversion and
     byte-exact first-party media-origin comparison. #540 remains a low-priority
     search semantics/product decision for accent/locale-insensitive matching,
     and #543 remains a UI hardening decision for combining-mark density rather
     than a closed security property. Guardrails include:
     `tests/email-normalization-followups.test.mjs`,
     `tests/sanitize-unicode.test.mjs`,
     `tests/user-text-normalization-followups.test.mjs`,
     `tests/email-text.test.mjs`,
     `tests/unicode-boundary-followups.test.mjs`, and
     `tests/stripe-connect-v2.test.mjs`.

315. **Round 3 schema, retention, ops, and time/date slices reverified** —
     source/test/code closure for #548-#609, with current code defects separated
     from production evidence and product-policy decisions. Schema findings
     #548-#552, #555-#559, #561-#564, #570-#578, #580, #582, and #584-#585
     are stale or current-clean: custom-order listings now have a real
     `Conversation` SetNull FK and index; saved-search create/dedupe runs inside
     a Serializable transaction with retry; schema FK onDelete behavior is
     guarded against migration drift; the raw-managed blog tag GIN index was
     restored and tested; listing CHECK constraints were validated; EmailOutbox
     HTML and OrderPaymentEvent descriptions are bounded; Notification dedup
     default is aligned; user email writes are normalized at the app boundary;
     retention-sensitive blog/block/report FKs no longer cascade away
     moderation evidence; processed webhook events, terminal EmailOutbox rows,
     unread notifications, and ListingViewDaily rows have prune coverage; health
     verbose token comparison is constant-time; ops-health surfaces webhook
     failure piles; newsletter signup is double opt-in; and SiteConfig fallback
     seeding/clamping is present. #558, #567, #569, #570, #571, #572, and #587
     are verified false-positive/by-design confirmations rather than current
     defects.

     Time/date findings #588-#609 are likewise mostly stale or false-positive:
     vacation return dates accept native date-input values; Guild Master warning
     grace is a real fixed 30-day window; broadcast cooldowns and vacation return
     displays use client-local formatting; metrics periods and shipping
     estimated days are bounded; public blog visibility excludes future
     `publishedAt`; message `since` params reject non-finite dates; Stripe event
     freshness rejects future-created events; and Terms explicitly define the
     case-response "48 hours" as calendar time including weekends and holidays.
     This pass fixed the remaining low-risk current behavior in that slice:
     seller analytics range labels now state their UTC buckets, upload and
     shipping-rate checkout schemas reject excessive future expiries before HMAC
     work, admin case deadlines render through `LocalDate` instead of server UTC
     `toLocaleString()`, and ListingViewDaily retention uses a fixed 730-day
     cutoff instead of `setFullYear()` rollover. Deferred/manual items left from
     this slice are production-data impact proof for historical text truncation
     and MakerVerification timestamp backfill, query-plan/index validation,
     legacy tax-reversal column cleanup, future BigInt counter migration, nullable
     empty-string cleanup, moderation-report retention policy, Sentry missed-cron
     alert confirmation, R2 write-health versus lightweight health-check policy,
     and R2 public key privacy/ListBucket evidence. Guardrails include:
     `tests/schema-hardening-followups.test.mjs`,
     `tests/schema-drift-followups.test.mjs`,
     `tests/schema-retention-guardrails.test.mjs`,
     `tests/retention-and-ops-followups.test.mjs`,
     `tests/newsletter-double-opt-in.test.mjs`,
     `tests/health-state.test.mjs`, `tests/upload-verification-token.test.mjs`,
     `tests/shipping-token.test.mjs`, `tests/seller-ops-hardening.test.mjs`,
     `tests/case-observability-followups.test.mjs`,
     `tests/checkout-est-days-bounds.test.mjs`,
     `tests/stripe-webhook-state.test.mjs`, and
     `tests/guild-metrics-state.test.mjs`.

316. **Display-name confusable lookup residue reduced** — schema/code/test/docs
     fix for the still-current subset of Round 4 #639, after read-only agent and
     parent re-verification found the original "no write-time normalization"
     severity overstated on current `main`. Seller display names were already
     sanitized before new writes, but historical rows and seller-name search
     still depended on raw `displayName` matching only. `SellerProfile` now has
     a required `displayNameNormalized` lookup column, the migration backfills
     existing rows with the current Cyrillic-confusable/invisible-control
     folding policy, seller creation/profile/onboarding/deletion writes keep the
     lookup key in sync, and global suggestions, blog author suggestions, and
     browse seller-name search check both raw and normalized names. Round 4
     #610-#644 was re-reconciled in the same pass without double-counting the
     already-closed/stale items: #631 tag/author routes and #633 broad raw
     `<img>` migration remain product/refactor backlog, while #637 tax
     monitoring and #641 observability helper/status constants remain ops/refactor
     backlog. Round 8 #737-#741, #750-#754, and #764 were also rechecked before
     this fix and remain previously fixed, stale, or policy-truth-matched on
     current `main`. Guardrails:
     `tests/display-name-normalization-guardrails.test.mjs`,
     `tests/sanitize-unicode.test.mjs`,
     `tests/round9-public-pii-guardrails.test.mjs`,
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`,
     `tests/search-suggestion-state.test.mjs`, and
     `tests/public-cron-search-hardening.test.mjs`.

317. **Category enum drift and Nominatim throttle behavior guardrails reduced** —
     code/test/docs fix for #293 and #439. Category labels now have a
     `satisfies Record<Category, string>` type-level guard so future Prisma enum
     additions require a display label while preserving the current
     string-friendly `CATEGORY_VALUES.includes(raw)` validation contract for
     RSC and URL/form inputs. Nominatim throttling now routes through the pure
     `waitForNominatimSharedThrottle()` helper, with direct behavioral tests for
     the 1.1s Redis lock TTL, immediate acquisition, Redis-error fail-closed
     behavior, and bounded-contention fail-closed behavior. Read-only agents and
     parent verification also confirmed #433/#883, #438, #681, #806, and #809
     are already fixed/stale on current `main`; those previously closed or
     source-guarded items were not double-counted. #436 remains a local
     cron-termination mock coverage backlog item rather than a newly closed
     runtime bug. Guardrails: `tests/categories.test.mjs` and
     `tests/reverse-geocode-throttle.test.mjs`.

318. **Message-start listing context scoped to seller conversations** —
     code/test/docs fix for #297. `/messages/new` already validated current
     user, target user, block state, listing visibility, seller account state,
     and private-reservation participants before attaching `contextListingId`,
     but public listing context could still be attached to a conversation that
     did not include the listing seller. `canAttachConversationContextListing()`
     now requires the listing seller to be one of the conversation participants
     for public and private listing context, while private reserved listings
     still additionally require the reserved buyer participant. Guardrail:
     `tests/conversation-start-state.test.mjs`.

319. **Public path fallback slug hash widened** — code/test/docs fix for #295.
     Public listing/seller routes already preserve the durable database id as
     the route prefix, so fallback slug collisions are cosmetic. The
     non-readable label fallback now uses a stable FNV-64 base36 suffix instead
     of the prior 32-bit FNV value, reducing collision risk for non-Latin titles
     and display names without adding randomness or changing the ID authority
     model. Guardrail: `tests/public-paths.test.mjs`.

320. **Map support no longer rejects slower WebGL devices up front** —
     code/test fix for #299. `maplibreSupported()` now probes MapLibre with
     `failIfMajorPerformanceCaveat: false`, so low-end devices that can still
     render maps get the map experience instead of the fallback solely because
     of a major performance caveat. Explicit unsupported results and thrown
     probes still return `false` for fallback rendering. Guardrail:
     `tests/map-support.test.mjs`.

321. **Cron termination behavior now has direct helper coverage** —
     code/test/docs fix for #436, plus stale/false-positive closure for #298.
     Guild metrics and Guild Member checks now route cursor pagination through
     `runCronCursorPages()`, and listing-view/notification retention deletes
     use `runBoundedDeletionBatches()`. The new tests mock empty pages,
     full-page-then-partial termination, full-page-then-empty termination, zero
     and partial delete completion, and time-budget exhaustion. The
     address-autocomplete street-suffix allegation was stale on current
     `main`: there is no street-suffix rejection regex; the helper forwards
     normalized query text to Nominatim and maps returned structured address
     fields. Guardrail: `tests/cron-termination-state.test.mjs`.

322. **Admin query, staff preview, env, money, and email preference drift
     reduced** — code/test/docs fix for #703, #704, #705, #709, #710, #1102,
     and #1108, stale/false-positive closure for #1095-#1100, #1103-#1107, and
     #1109-#1111, plus deferred/manual closure for #723 and #1101. Admin
     users/audit/broadcast pages now parse page params through
     `parseBoundedPositiveIntParam()` before Prisma `skip` math, and
     admin/message free-text `contains` searches are trimmed and length-bounded
     before query construction. The admin listing-review queue now links pending
     listings through an explicit `?preview=admin` staff-preview mode; the
     public listing page still keeps ordinary public visibility unchanged and
     grants that preview only to active EMPLOYEE/ADMIN accounts. Seller-initiated
     refund emails now respect the visible `EMAIL_REFUND_ISSUED` preference, and
     private-message/review email links use `EMAIL_APP_URL` instead of a
     hard-coded production origin. The remaining env non-null assertions were
     removed from the Clerk provider and metro seed script, and case-resolution
     partial-refund copy now uses shared minor-unit currency formatting. Newest
     raw upload/AI/cron/webhook/seller-cache findings were reverified as already
     fixed or false-positive on current `main`; Stripe webhook subscription
     narrowing remains a dashboard evidence task, and
     `LabelStatus.EXPIRED`/`VOIDED` remain a product/schema lifecycle cleanup
     decision. Guardrails:
     `tests/admin-query-and-email-guardrails.test.mjs`,
     `tests/listing-visibility.test.mjs`, `tests/env-validation.test.mjs`, and
     `tests/case-resolution-copy.test.mjs`.

323. **Blog index bounds and residual money-formatting drift reduced** —
     code/test fix for #697, #698, and the remaining active parts of #707,
     plus verified-current closure for #720. The public blog index now bounds
     `bq`, tag array size/tag text, author filter, and page params before
     building Prisma/raw-search queries. Seller-refund in-app/review-note copy,
     staff case-resolution audit/review notes, and Guild metrics warning labels
     now use shared `formatCurrencyCents()` rather than hand-built USD strings.
     Seller refunds already update associated cases through `updateMany` with
     a `RESOLVED`/`CLOSED` exclusion, matching the race guard alleged missing in
     #720. Parent re-verification also confirmed #692-#696, #699, #700, #702,
     #708, and #728 remain covered by earlier public projection, compliance
     copy, display-name, notification-link, and media-origin fixes. Read-only
     agent verification plus parent spot checks also confirmed #1062-#1115 are
     either already fixed/stale/false-positive on current `main` or already
     deferred as the #1101 manual Stripe Dashboard subscription evidence item;
     these duplicate/prior-closed findings were not double-counted. Additional
     static guardrails now pin the already-correct #1105 charge-webhook
     mutation lock and #1115 server-derived gift-wrap pricing behavior.
     Guardrails: `tests/blog-index-param-guardrails.test.mjs`,
     `tests/currency-format-drift.test.mjs`,
     `tests/stripe-webhook-state.test.mjs`, and
     `tests/checkout-payment-methods.test.mjs`.

324. **Retired third-party display media host removed** — code/test fix for
     #267 and #714 after production data verification. A read-only database
     count scan across media-bearing URL/text/array columns found zero
     `i.postimg.cc` references, so the display-only Postimg allowance could be
     removed without knowingly hiding existing production media. CSP `img-src`
     no longer includes `https://i.postimg.cc`, and `isTrustedMediaUrl()` now
     accepts only Grainline-controlled R2/CDN and documented legacy UploadThing
     origins. Guardrails: `tests/media-url.test.mjs` and
     `tests/public-security-config.test.mjs`.

325. **Seller email preference UI aligned with current senders** — code/test
     fix for #711, plus partial reduction for #1009. Seller settings no longer
     show email toggles for events that currently have only in-app delivery
     (`EMAIL_NEW_FOLLOWER`, listing approval/rejection, low stock, payment
     dispute, account warning, listing report, payout failure, and seller-side
     refund copy). The remaining seller email toggles now correspond to current
     sender paths, and admin Guild approval/rejection/revocation emails now
     check `EMAIL_VERIFICATION_APPROVED` / `EMAIL_VERIFICATION_REJECTED` before
     sending. Cron Guild Member/Guild Master warning/revocation emails use the
     same rejected-verification preference gate, and `CLAUDE.md` records the
     visible-toggle/sender parity contract for future agents. #1009 is not
     fully closed here because hidden legacy valid keys still exist for
     compatibility and unsubscribe normalization; there is no longer a visible
     seller toggle for the no-sender keys. Guardrail:
     `tests/notification-email-preferences.test.mjs`.

326. **Unsupported email preference keys pruned and incoming block retention
     restored** — code/test fix completing #1009 and fixing the Round 18
     GDPR/privacy block-retention mismatch. Runtime and DB validation now
     accept only sender-backed `EMAIL_*` preference keys; unsupported legacy
     hidden keys are pruned before `grainline_notification_preferences_valid()`
     is narrowed, and unknown email preference checks fail closed. Account
     deletion now removes only blocks created by the deleted user and preserves
     incoming block rows created by other users, matching the documented
     retention boundary while block filters continue to ignore deleted-account
     edges. Read-only agent verification in the same pass confirmed #757/#868
     account export scope, order PII pruning, and privacy retention copy are
     current/fixed; unsubscribe re-subscribe semantics and business-transfer
     notice remain product/legal decisions. Guardrails:
     `tests/notification-email-preferences.test.mjs`,
     `tests/notification-preference-keys.test.mjs`,
     `tests/json-column-guardrails.test.mjs`, and
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

327. **FK hygiene indexes added for residual schema-index findings** —
     code/test fix for #954 and the remaining live parts of #956, #957, and
     #958. Added schema-visible concurrent indexes for
     `Listing.reservedForUserId`, `Conversation.contextListingId`,
     `Case.resolvedById`, and `MakerVerification.reviewedById`. These are
     FK/deletion-path hygiene fixes rather than proven hot-path query wins.
     Read-only verification kept #565, #852, #858, and browse geo/rating
     optimization as EXPLAIN-dependent work; do not add broader compound or
     partial indexes without seeded or production query-plan evidence.
     Guardrail: `tests/schema-numeric-index-guardrails.test.mjs`.

328. **Server action observability helper added** — code/test/docs reduction for
     the log-helper subset of #641. Sentry log forwarding remains intentionally
     disabled, but selected admin/seller server-action failure paths no longer
     rely on console-only evidence. `logServerError()` now sanitizes error
     messages, tag values, and extra values before console/Sentry capture, and
     the admin order actions, admin support status action, seller onboarding
     actions, seller listing archive action, seller geo-metro assignment, and
     seller Stripe Connect status-refresh catches use the shared helper with
     bounded internal IDs/statuses only. Residual #641 status-constant,
     Sentry-log-forwarding, and analytics/speed-insights choices remain
     ops/refactor decisions rather than closed here. Guardrail:
     `tests/server-error-logger.test.mjs`.

329. **Production aggregate data scans completed for JSON size and email
     uniqueness residue** — read-only evidence closure for the remaining #980
     production-size scan and live-data verification for #981. Aggregate-only
     Neon queries returned zero rows over the raw-managed JSON/TEXT size caps
     for `User.notificationPreferences`, `AdminAuditLog.metadata`,
     `SystemAuditLog.metadata`, `OrderItem.listingSnapshot`,
     `OrderItem.selectedVariants`, `OrderShippingRateQuote.rates`,
     `OrderPaymentEvent.metadata`, `EmailSuppression.details`, and
     `CronRun.result`; `grainline_notification_preferences_valid()` also
     reported zero invalid live rows. The same read-only pass found zero
     case-insensitive duplicate email groups in `User`, `EmailSuppression`, and
     `NewsletterSubscriber`, plus zero unsupported live `EMAIL_*`
     notification preference keys. This verifies current production data is
     clean for those allegations; a future `LOWER(email)` expression unique
     index remains optional DB-hardening, not an observed live collision.

330. **Production aggregate data scan completed for historical text-bound and
     MakerVerification timestamp allegations** — read-only evidence closure for
     #554 and #560. Aggregate-only Neon queries printed no row-level data and
     found zero rows sitting exactly at the caps applied by
     `20260505173000_schema_text_and_listing_guards` across
     `SellerProfile.bio`, `storyBody`, `returnPolicy`, `customOrderPolicy`,
     `shippingPolicy`, `Listing.description`, `Order.sellerNotes`,
     `Order.reviewNote`, and `BlogPost.body`, reducing the concern that the
     historical `LEFT(...)` precondition updates truncated live production
     content. The same query found zero `MakerVerification` rows, so the
     migration-date `createdAt`/`updatedAt` backfill concern has no current live
     production rows to reconcile. This verifies current production evidence for
     the named allegations; it does not assert that future imports or restored
     backups would have the same shape without re-running the aggregate check.

331. **Radius-protected map fallback no longer exposes exact coordinates** —
     code/test/docs hardening adjacent to the already-closed #740 seller
     location-privacy finding. `MapCard` already jitters/hides exact pins when
     `radiusMeters` is set, but its WebGL-unavailable fallback passed raw
     `lat`/`lng` into `MapFallback`, which printed coordinates and an
     OpenStreetMap link. Radius-protected `MapCard` fallbacks now suppress those
     raw coordinates and use privacy-specific fallback copy while exact-map
     fallbacks keep their coordinate/link behavior. Guardrail:
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`.

332. **Buy Now rollback request survival improved** — code/test/docs reduction
     for #1120, moving the client side of the Buy Now rollback window out of
     the purely documented tradeoff bucket. `BuyNowCheckoutModal` now sends the
     `/api/cart/checkout/rollback` POST with `keepalive: true`, reducing the
     chance that modal close, retry, or page navigation tears down the request
     before the server can expire the Stripe Checkout Session and restore stock.
     This does not make browser rollback guaranteed; if the request is never
     queued or fails, stock still falls back to the `checkout.session.expired`
     webhook and the documented 31-minute session-expiry window. Guardrail:
     `tests/client-async-guardrails.test.mjs`.

333. **Route-level maxDuration coverage verified and guarded** — test/docs
     closure for #317. The raw allegation correctly noted that `vercel.json`
     does not define a broad `functions.*.maxDuration` override, but current
     Next route handlers do not rely on the default 10-second platform window
     for the heavy paths: checkout/session rollback, Stripe webhooks,
     label/refund/fulfillment, case resolution, shipping quotes, image upload,
     message streaming, and every registered cron route all export explicit
     route-level `maxDuration` values. `CLAUDE.md` now records that this
     project prefers route-level duration declarations over a global Vercel
     override. Guardrail: `tests/route-max-duration-guardrails.test.mjs`.

334. **HSTS preload status checked; submission remains an ops/legal decision** —
     live evidence update for #315 with no tally change. `next.config.ts` sends
     `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
     so Grainline serves the opt-in header. A live
     `hstspreload.org/api/v2/status?domain=thegrainline.com` check on
     2026-06-02 returned `status: "unknown"`, so the domain is not currently
     proven submitted or preloaded. `CLAUDE.md` now records that future agents
     must not claim preload status without the live API reporting `pending` or
     `preloaded`, and that actual submission is an ops/legal decision because
     it commits the apex and all subdomains to HTTPS on a long-lived browser
     preload list.

335. **Round 10 email quota/template ledger reconciled** — verification-only
     ledger correction with no tally change. Current `main` keeps the central
     Reply-To, fail-closed one-click unsubscribe, support footer/current-year
     footer, placeholder-only unsubscribe injection, privacy-sensitive preview
     redaction, order/context subject suffixes, strict tracking-carrier URL
     handling, per-recipient queued-email quota, explicit email app URL
     resolution, queued-template metadata, seller broadcast email delivery, and
     atomic new-message email throttle covered by existing guardrails. The
     remaining `email quota policy decisions` category was stale; quota caps are
     documented operational tunables (`EMAIL_OUTBOX_DAILY_LIMIT` and
     `EMAIL_OUTBOX_DAILY_RECIPIENT_LIMIT`) rather than an unclosed code
     allegation. #993 remains a privacy/legal provider-retention decision, not
     an email quota or template implementation gap.

336. **Message custom-order link price formatting aligned** — code/test fix for
     residual #707 money-formatting drift with no tally change because #707 was
     already counted in an earlier currency-formatting pass. `ThreadMessages`
     now renders custom-order link card prices through `formatCurrencyCents()`
     with the stored message currency instead of dividing cents by 100 and
     appending an uppercase currency code. Guardrail:
     `tests/currency-format-drift.test.mjs`.

337. **Mobile drawer background reachability reduced** — code/test fix for
     #469. `Header` already used the shared focus trap and body-scroll lock for
     the mobile navigation drawer; it now also marks `#main-content` inert and
     `aria-hidden` while the drawer dialog is open, then restores the prior
     state on close/unmount so background links and controls are not tab-
     reachable through the modal state. Guardrail:
     `tests/accessibility-followups.test.mjs`.

338. **State-machine follow-up guardrails tightened** — code/test follow-up with
     no tally change because #1055/#1059 were already counted in entry 268 and
     legacy `CaseStatus.CLOSED` enum cleanup remains a data-migration/product
     decision. `caseActionState` tests now explicitly assert that `CLOSED` is
     neither resolvable nor escalatable, and dashboard inventory rows route
     `PENDING_REVIEW` listing titles to owner preview instead of the edit page,
     matching the main dashboard's locked-review affordance. Guardrails:
     `tests/case-action-state.test.mjs` and
     `tests/listing-action-state.test.mjs`.

339. **Notification dedup fallback observability reduced** — code/test
     follow-up adjacent to the residual #1098 observability family. The
     originally alleged console-only notification preference path was stale on
     current `main`, but the dedup-collision recovery path still silently
     returned `null` if the existing notification lookup failed after a
     `P2002`. That fallback remains non-blocking so notifications cannot break
     the main flow, but it now captures warning-level Sentry evidence keyed by
     source, notification type, and bounded booleans rather than raw link or
     body content. Guardrail:
     `tests/pr-h-deletion-analytics-email-followups.test.mjs`.

340. **Tag and blog-author SEO landing routes added** — code/test/docs fix for
     current #631, which had left older #73/#74 as a product/refactor backlog
     item. `/tag/[slug]` now normalizes through `normalizeTag()`, permanently
     redirects stale tag slugs while preserving pagination, and renders
     `ListingCard` results behind `publicListingWhere()` plus signed-in block
     filtering. `/blog/author/[slug]` now extracts the seller profile id with
     `extractRouteId()`, requires an active public seller with published public
     blog posts, applies signed-in block filtering before canonical redirects,
     and paginates maker posts. Homepage/listing tag chips and blog author
     suggestions now point at canonical landing routes, and the base sitemap
     includes only capped tag/author landing sets so the prior sitemap-size
     guard remains intact. Guardrails: `tests/seo-landing-routes.test.mjs`,
     `tests/public-paths.test.mjs`, and `tests/sitemap-entry-limit.test.mjs`.

341. **Back-in-stock fanout rechecks seller visibility before claiming
     subscribers** — code/test/docs fix for #91. The restock route already
     claimed subscribers atomically after a `SOLD_OUT -> ACTIVE` transition,
     but the async claim CTE only rechecked listing status and positive stock.
     It now joins `SellerProfile` and `User` and mirrors public listing
     visibility before deleting `StockNotification` rows or queuing
     `BACK_IN_STOCK` notifications/emails: active, non-private, positive-stock
     listing; seller charges enabled; supported Stripe account version; seller
     not on vacation; seller user not banned or deleted. The same pass corrected
     the stale route comment that implied private restocks are promoted to
     active. Guardrail: `tests/stock-mutation-state.test.mjs`.

342. **Staff partial case refunds can explicitly restore purchased stock** —
     code/test/docs fix for the current #635 adjacent gap. Seller partial
     refunds already accepted bounded `restoreStock`; staff case resolution did
     not. `POST /api/cases/[id]/resolve` now accepts `restoreStock` only for
     `REFUND_PARTIAL`, rejects stock restoration after shipped/delivered/
     picked-up buyer handoff states, validates requested quantities through the
     shared purchased `IN_STOCK` helper, and reuses the existing refund-lock and
     listing reactivation transaction. The admin case detail page now passes
     actual restorable order items into `CaseResolutionPanel`, which exposes
     optional restore quantities for partial refunds. The same pass verified
     Round 14 #1108, #1109, and #1110 stale on current `main`: required envs
     use `requiredProductionEnv()`, seller metadata/page renders share a
     cached seller loader, and React `cache()` is already used on seller and
     listing pages. #1111 is only partially stale and remains a smaller
     performance opportunity rather than a closed finding. Guardrails:
     `tests/payment-side-effect-observability.test.mjs`,
     `tests/refund-route-state.test.mjs`, `tests/env-validation.test.mjs`, and
     `tests/seller-page-performance.test.mjs`.

343. **Listing analytics self-traffic and broad-ID amplification reduced** —
     code/test/docs fix for #93 and #95. Listing view/click routes already
     required public listing visibility, bot filtering, 24h IP+listing dedup,
     and aggregate tracking cookies, but signed-in sellers could still count
     their own public listing views/clicks and accepted traffic could spread
     across many listing IDs. The routes now call optional Clerk auth and add a
     seller-user exclusion to the guarded `publicListingWhere()` update
     predicate, tighten public view/click IP windows from 20/minute to
     10/minute, and check fail-open per-listing daily Redis caps before any
     `Listing` or `ListingViewDaily` writes. Guardrail:
     `tests/listing-analytics-guardrails.test.mjs`.

344. **Homepage reduced-motion source guardrails tightened** — test-only
     closure for the current-code portion of #480, with partial source evidence
     for #447 but no runtime accessibility overclaim. Current `main` keeps a
     single homepage `<h1>` before section `<h2>` headings, avoids h4-h6
     heading skips in the homepage source, gives the animated hero mosaic a
     pause/play button with `aria-pressed`, disables mosaic row animation under
     `motion-reduce`, removes reduced-motion blur/scale transforms, and keeps
     the global reduced-motion media query in place. Full axe/VoiceOver runtime
     proof for the homepage remains a manual verification item. Guardrail:
     `tests/accessibility-followups.test.mjs`.

345. **Stripe webhook subscription evidence contract tightened** — docs/test
     follow-up with no tally change because #1101 was already classified as a
     manual Stripe Dashboard evidence item in entry 246. Parent review of the
     read-only agent result confirmed no current code defect: the legacy
     snapshot webhook is signed with `STRIPE_WEBHOOK_SECRET`, the Connect v2
     thin webhook is separate and signed with `STRIPE_V2_WEBHOOK_SECRET`, and
     current card-only Checkout flows are guarded against unhandled
     `payment_intent.*` assumptions. `docs/launch-checklist.md` and
     `docs/runbook.md` now require exact snapshot event subscriptions, separate
     `v2.core.account` thin-event evidence, and screenshots/dates for launch.
     Guardrails: `tests/stripe-webhook-v2-route.test.mjs` and
     `tests/checkout-payment-methods.test.mjs`.

346. **Processor-side privacy request runbook added** — docs/test fix for
     verified #993. Current account deletion/export code and local outbox
     pruning cover Grainline-owned storage, but they do not prove Resend or
     other processors have deleted/exported provider-held copies. The operations
     runbook now requires provider-side checks or counsel-documented retention
     exceptions before closing relevant `SupportRequest` rows, with explicit
     Resend sent-message/bounce/complaint/suppression/event review and ticket
     evidence. This is an operational-evidence fix, not a claim of automatic
     provider erasure. Guardrail: `tests/support-request.test.mjs`.

347. **Buyer case window now matches seller deletion blockers** — code/test/docs
     fix from the verified #737-#739 fraud-chain review. The manual shipped,
     buyer-delivered, and deletion-blocker fixes were already current, but the
     case creation route and buyer order UI still lacked the same 30-day upper
     case-window guard used by account deletion and listing soft-delete.
     `CASE_WINDOW_DAYS` now lives in `caseCreateState.ts`; `/api/cases`, buyer
     order detail, account deletion, and listing soft-delete share that value.
     Buyer cases close after the delivery reference date (`deliveredAt` or
     `pickedUpAt` for terminal orders, otherwise `estimatedDeliveryDate`), and
     the seller handbook now matches the 30-day policy instead of saying 90
     days. The buyer order page also avoids rendering a case form when the
     server would reject the order for an existing blocking refund. Guardrails:
     `tests/case-create-state.test.mjs`,
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`, and
     `tests/verified-audit-followups.test.mjs`.

348. **Public listing-card and owner-check projections minimized** —
     code/test/docs hardening adjacent to already-closed #764/#792, with no
     duplicate raw tally increase. Parent review confirmed the original
     full-row SellerProfile/User PII allegation remains stale on current
     `main`, but public listing-card queries on browse, listing detail,
     seller profile, and seller shop still fetched broad Listing rows through
     `include: { photos: ... }`. Those card queries now use top-level `select`
     allowlists, and public owner/block/message checks use the already-selected
     local `seller.userId` / `listing.seller.userId` instead of selecting Clerk
     ids or nested user ids. Guardrails:
     `tests/public-visibility-followups.test.mjs`,
     `tests/listing-visibility.test.mjs`, and
     `tests/round8-fulfillment-privacy-guardrails.test.mjs`.

349. **Signed-in email preference opt-in clears one-click suppression only** —
     code/test/docs fix for the current unsubscribe consent/manual-resubscribe
     gap. Current `main` already made the original Round 16 unsubscribe raw
     claims stale or previously closed: unsubscribe tokens use a dedicated
     secret, carry `issuedAt`, expire after 90 days, reject future-dated tokens,
     are IP- and signed-email-rate-limited, and newsletter signup checks
     `EmailSuppression` without disclosing suppression history. The remaining
     current mismatch was that an authenticated user could turn an email
     preference back on in account settings while an old
     `one_click_unsubscribe` `EmailSuppression` row still blocked all outbound
     email. The notification preference route now clears only
     `EmailSuppressionReason.MANUAL` rows with
     `source = "one_click_unsubscribe"` for the signed-in user's suppression
     key set when enabling a valid email preference; bounce, complaint, and
     account-deletion suppressions are untouched. Public newsletter signup
     still does not send confirmation mail to suppressed addresses. Guardrail:
     `tests/account-privacy-observability.test.mjs`.

350. **One-click unsubscribe no longer hard-blocks transactional email** —
     newly found adjacent code/test/docs fix from the email suppression audit,
     not a raw-Claude allegation closure. Current code treated every
     `EmailSuppression` row as a hard delivery block inside the central
     `send()` helper, so a footer/list-unsubscribe action could suppress order,
     case, account, and other transactional emails even though account settings,
     Terms, and Privacy copy say transactional emails continue. Central email
     delivery now uses `isEmailDeliverySuppressed()`, which only treats bounce,
     complaint, and account-deletion suppression rows as hard delivery blocks.
     Broader manual one-click suppressions still disable email preferences and
     newsletter state, and newsletter signup plus admin email recipient checks
     intentionally keep using `isEmailSuppressed()`. Guardrail:
     `tests/account-privacy-observability.test.mjs`.

351. **Hard provider suppressions survive lower-priority manual writes** —
     newly found adjacent code/test/docs fix from the email suppression audit.
     Parent review confirmed `unsubscribeEmail()` could overwrite an existing
     `BOUNCE`/`COMPLAINT` suppression with `source = "one_click_unsubscribe"`,
     and account deletion could overwrite a provider hard-suppression row with
     `source = "account_deletion"`. One-click unsubscribe and account deletion
     now inspect the same exact/canonical suppression-key set before writing:
     bounce and complaint rows are left intact, while account deletion may still
     replace lower-priority manual rows so intentional same-email re-signup can
     clear deletion-only suppression without clearing provider evidence.
     Guardrail: `tests/account-privacy-observability.test.mjs`.

352. **Old unsubscribe links cannot undo later email opt-in evidence** —
     code/test/docs reduction for raw #157/#358 unsubscribe-token replay.
     `User.emailPreferenceOptInAt` now records signed-in email preference
     opt-ins, and `/api/email/unsubscribe` rejects signed unsubscribe tokens
     issued before that later opt-in or before a later newsletter confirmation.
     The token remains stateless inside its 90-day TTL, but replay can no
     longer undo a newer signed-in opt-in/reconfirmation epoch. Public
     newsletter-only self-service resubscribe remains a product/support-policy
     decision because public newsletter signup still does not clear suppression
     rows for suppressed addresses. Guardrail:
     `tests/account-privacy-observability.test.mjs`.

353. **Attachment-only direct messages honor new-message email preference** —
     newly found adjacent code/test fix from the notification preference audit,
     not a raw-Claude allegation closure. Current code created an in-app
     `NEW_MESSAGE` notification for attachment-only messages but skipped the
     `EMAIL_NEW_MESSAGE` path because it gated email on text `body` only. The
     message send action now uses the same `hasMessageContent` predicate for
     in-app and email notification eligibility and sends a safe attachment
     fallback preview when there is no text body. Guardrail:
     `tests/notification-email-preferences.test.mjs`.

354. **Staff case-refund emails use the refund preference key** —
     newly found adjacent code/test fix from the notification preference audit.
     Staff case resolution already created `REFUND_ISSUED` in-app
     notifications when a refund was issued, but the email path checked
     `EMAIL_CASE_RESOLVED` even on refunding resolutions. The staff case
     resolve route now checks `EMAIL_REFUND_ISSUED` for refunding resolutions
     and keeps `EMAIL_CASE_RESOLVED` for dismiss/non-refund resolutions.
     Guardrail: `tests/notification-email-preferences.test.mjs`.

355. **Custom-order email preference surface matches both send paths** —
     newly found adjacent UI/test reduction from the notification preference
     audit. The single `EMAIL_CUSTOM_ORDER` key gates both seller custom-order
     request emails and buyer custom-listing-ready emails, but the settings UI
     only described the seller request meaning. Buyer/account settings now show
     a "Custom order updates" email row for the same key, and seller settings
     use matching "Custom order updates" copy covering both request and ready
     listing emails. Guardrail:
     `tests/notification-email-preferences.test.mjs`.

356. **Explicit email-send failure callers no longer mark skipped delivery as sent** —
     newly found adjacent email observability fix. Central email delivery still
     allows normal fire-and-forget callers to skip invalid, unconfigured,
     suppressed, or inactive-recipient sends without throwing, but
     `sendRenderedEmail(..., { throwOnFailure: true })` now throws on those
     skipped-delivery paths. This prevents email outbox, support, and legal
     direct-send paths from treating non-delivery as successful handoff.
     Guardrail: `tests/email-delivery-guardrails.test.mjs`.

357. **Account export includes canonical email-suppression rows** —
     newly found adjacent privacy/export fix. Account export previously queried
     `EmailSuppression` by exact normalized account email only, while delivery
     and suppression checks use the exact/canonical Gmail/Googlemail suppression
     key set. `/api/account/export` now queries suppressions with
     `emailSuppressionAddressKeys(accountEmail)` so exported suppression state
     matches current delivery behavior. Guardrail:
     `tests/account-export-privacy.test.mjs`.

358. **Direct email routes sanitize duplicate provider-error console logs** —
     newly found adjacent telemetry fix. Newsletter confirmation and admin
     direct-email routes already sent hashed-email Sentry context, but their
     duplicate `console.error` calls re-logged the raw thrown provider/error
     object. Those route-level logs now pass through
     `sanitizeEmailOutboxError()`. Guardrail:
     `tests/account-privacy-observability.test.mjs`.

359. **Sentry filter preserves only valid hashed email correlation** —
     newly found adjacent observability fix. The Sentry scrubber redacted
     `extra.emailHash` because the key contained `email`, which removed the
     intended privacy-preserving correlation value. The filter now preserves
     only values matching `sha256:<24 hex>` for `emailHash`, while raw `email`
     fields and malformed hash values still redact. Guardrail:
     `tests/sentry-filter.test.mjs`.

360. **Ops-health Sentry warning includes webhook-only failure piles** —
     newly found adjacent ops observability fix. `/api/cron/ops-health` already
     counted failed unprocessed Stripe/Resend/Clerk webhook rows and returned an
     unhealthy response when they existed, but webhook-only failures did not
     enter the Sentry warning condition. The warning trigger now includes all
     three webhook failure counts. Guardrail:
     `tests/retention-and-ops-followups.test.mjs`.

361. **Resend webhook failures feed the shared spike detector** —
     code/test fix for the remaining Resend webhook failure-spike aggregation
     gap. Resend config, missing/invalid Svix signature, oversized payload,
     reservation, and processing failures now call `recordWebhookFailureSpike()`
     with bounded provider IDs/event types only. The missing-Svix-header branch
     also emits a direct Sentry message with header-presence booleans so
     low-volume misconfiguration is observable before the spike threshold.
     Guardrail: `tests/r65-observability-guardrails.test.mjs`.

362. **Clerk webhook failures match shared provider-webhook telemetry** —
     newly found adjacent observability fix. Clerk config, missing/invalid Svix
     signature, oversized payload, reservation, and handler failures now record
     webhook failure-spike buckets with bounded Svix/event metadata. In-progress
     Clerk webhook reservations now return retryable 503 + `Retry-After`
     instead of acknowledging as successful duplicate deliveries. Guardrail:
     `tests/r65-observability-guardrails.test.mjs`.

363. **Webhook reservation failures no longer escape unclassified** —
     newly found adjacent observability fix across Stripe snapshot, Stripe v2
     thin, Resend, and Clerk webhooks. Reservation DB failures now capture
     provider-specific Sentry context, feed a `reservation` failure-spike bucket,
     and return retryable 503 before any handler side effects. Guardrail:
     `tests/r65-observability-guardrails.test.mjs`.

364. **Ops-health counts reclaimable stale webhook reservations** —
     newly found adjacent ops fix. `/api/cron/ops-health` now counts failed or
     reclaimable unprocessed Stripe/Resend/Clerk webhook idempotency rows:
     `lastError` piles, null `processingStartedAt`, and rows older than the
     provider reclaim window. A webhook process that dies after reservation but
     before failure marking is now surfaced as actionable instead of looking
     healthy indefinitely. Guardrail:
     `tests/retention-and-ops-followups.test.mjs`.

365. **Ops runbook and launch checklist reflect current monitoring gates** —
     docs/test fix for stale ops evidence wording. The runbook now lists stale
     `RUNNING` cron rows plus failed/stale StripeWebhookEvent,
     ResendWebhookEvent, and ClerkWebhookEvent rows in the ops-health triage
     path. The launch checklist now includes `STRIPE_V2_WEBHOOK_SECRET` and
     `HEALTH_CHECK_TOKEN` in the environment section, and requires evidence for
     Sentry cron monitors, `source=cron_ops_health` warning routing, and webhook
     failure-spike alerts. Guardrail:
     `tests/retention-and-ops-followups.test.mjs`.

366. **Account export includes local email delivery records** —
     newly found adjacent privacy/export fix. `/api/account/export` now exports
     local `EmailOutbox` rows tied to the account by `userId` or recipient
     suppression-key set, and exports `EmailFailureCount` rows for the same
     suppression-key set. This reduces the gap where Grainline-owned email
     delivery records and transient failure counters were retained locally but
     absent from the self-service JSON export. Guardrail:
     `tests/account-export-privacy.test.mjs`.

367. **Account deletion scrubs failed/dead unsent email rows and failure counters** —
     newly found adjacent privacy/deletion refinement. Prior Round 9 work
     already scrubbed queued/processing outbox rows; this pass widened the
     deletion scrub to every unsent outbox state (`PENDING`, `PROCESSING`,
     `FAILED`, and `DEAD`) for the deleted user/email and deletes matching
     `EmailFailureCount` rows. Delivery was already suppressed; this reduces
     retained local email content/counter residue after deletion. Guardrail:
     `tests/round9-account-deletion-pii-guardrails.test.mjs`.

**Running tally after this pass:** verified fixed/reduced: 414 findings;
verified stale/false-positive: 405 findings; product/design/ops decisions
deferred: 70 findings. Entries 361-367 add twelve fixed/reduced current-code
or ops-documentation mismatches across webhook monitoring and email
export/deletion residue. Entry 361 removes the remaining Resend webhook
failure-spike raw category; entries 362-367 were adjacent parent/agent-reviewed
findings or refinements of already-closed categories, so they do not all reduce
the raw-Claude count.
Remaining major
categories: Stripe webhook subscription
narrowing evidence, Stripe Connect v2 loss-liability ops/legal decision, stale
remote branch and old git author hygiene, Round 10 deferred cache/state-machine
product designs, EXPLAIN-dependent query-plan/index validation, refund
accounting runtime proof and refund fee-policy reconciliation, founding-maker
permanence policy, remaining case/message state policy decisions,
remaining privacy/legal retention scope, remaining privacy/export
retention decisions, cross-seller AI
duplicate-detection product design, residual seller-page performance
optimization, public/newsletter-only resubscribe policy if support wants a
self-service path, legacy enum cleanup/data-migration decisions, partial multi-seller
checkout continuation design, deliberate BigInt money-column modeling, live-data
reconciliation for historical seller shipping-rate currency drift, Clerk staff
MFA and breached-password dashboard evidence, Clerk multi-account spam dashboard
evidence, Stripe duplicate-webhook and buyer-deletion runtime replay proof,
Founding Maker live DB concurrency proof, Sentry cron alert/R2 health/ListBucket
ops evidence, HSTS preload submission decision, residual HTTP-status constants
and log-forwarding and analytics observability refactors, remaining homepage
runtime a11y proof, and agent/worktree verification process hygiene.
Approximate raw allegations left to verify from current max #1120: 250.
