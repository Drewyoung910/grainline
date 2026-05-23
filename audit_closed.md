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

Last updated: 2026-05-23

- Raw Claude/new-audit candidate total: pending triage.
- Verified hardening/doc commits since 2026-05-13: 206.
- Verified code/feature fix commits since 2026-05-13: 182.
- Verified docs/audit-only commits since 2026-05-13: 9.
- Most recent reported pass total: 166 verified closed items in the 2026-05-14
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
     Still-open high-risk items from this slice are legacy conversation
     response backfill/performance (#855/#858), account export/deletion privacy
     scope (#873-#879), AI fail-closed integration regression coverage (#887),
     checkout concurrency integration coverage (#888), and anonymous-cart merge
     loss behavior (#889).

**Running tally after this pass:** verified fixed/reduced: 37 findings; verified
stale/false-positive: 31 findings; product/design decisions deferred: 14
findings. Remaining major categories: durable account-deletion/Stripe and audit
redaction retry design, admin undo/ban side-effect retryability, account export
scope, legacy message-response metrics/backfill, AI semantic invariant and
integration-test coverage, anonymous-cart merge durability, checkout concurrency
integration evidence, and remaining privacy/export omissions.
