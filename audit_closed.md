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

Last updated: 2026-05-21

- Raw Claude/new-audit candidate total: pending triage.
- Verified hardening/doc commits since 2026-05-13: 174.
- Verified code/feature fix commits since 2026-05-13: 150.
- Verified docs/audit-only commits since 2026-05-13: 9.
- Most recent reported pass total: 134 verified closed items in the 2026-05-14
  active tracker below, plus forty-seven stale/false-positive claims verified
  clean.

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
