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

Last updated: 2026-05-18

- Raw Claude/new-audit candidate total: pending triage.
- Verified hardening/doc commits since 2026-05-13: 101.
- Verified code/feature fix commits since 2026-05-13: 92.
- Verified docs/audit-only commits since 2026-05-13: 9.
- Most recent reported pass total: 53 verified closed items in the 2026-05-14
  active tracker below, plus two stale/false-positive claims verified clean.

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

## Verified Stale / Not Fixed

1. **Report target access gap** — stale claim. Current `main` already requires
   reporter access for private order/message/thread/listing report targets and
   has guardrail coverage in `tests/user-report-target-access.test.mjs`.
2. **Active-listing photo POST AI-review bypass chain** — stale claim. Current
   `main` disables `POST /api/listings/[id]/photos` with HTTP 410; edit-page
   photo changes are staged through `photoManifestJson` and reviewed only when
   the seller presses Save.
