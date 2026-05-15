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

Last updated: 2026-05-14

- Raw Claude/new-audit candidate total: pending triage.
- Verified hardening/doc commits since 2026-05-13: 61.
- Verified code/feature fix commits since 2026-05-13: 53.
- Verified docs/audit-only commits since 2026-05-13: 8.
- Most recent reported pass total: 13 verified closed items in the 2026-05-14
  active tracker below, plus one stale report-route claim verified clean.

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

## Verified Stale / Not Fixed

1. **Report target access gap** — stale claim. Current `main` already requires
   reporter access for private order/message/thread/listing report targets and
   has guardrail coverage in `tests/user-report-target-access.test.mjs`.
