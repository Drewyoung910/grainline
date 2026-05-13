# Grainline Security Hardening Plan

Last updated: 2026-05-13

This document defines the adversarial security process for Grainline. It is intentionally evidence-first: no AI-generated claim should become a finding or a fix until it is verified against code, data flow, and an exploit path.

## Goals

- Find vulnerabilities before attackers do.
- Avoid false confidence from AI-generated audits.
- Preserve commercial launch velocity without broad rewrites.
- Prefer small, test-backed hardening changes over speculative churn.

## Current Security Model

Grainline currently relies on application-layer authorization, not database Row Level Security.

- Clerk handles identity and session issuance.
- `src/middleware.ts` enforces signed-out route behavior, terms acceptance, suspended/deleted account blocks, admin role/PIN checks, cron authorization, geo-blocking, and request IDs.
- Route handlers and server actions must enforce record ownership or staff/admin authority before reading or mutating private data.
- Provider endpoints authenticate inside the route via webhook signatures or shared secrets.

RLS is a possible defense-in-depth project, not an emergency switch. With Prisma and pooled Neon connections, RLS must be designed around connection roles/session context. A broad last-minute RLS rollout could break production or create false security. The recommended path is targeted RLS feasibility after the application-layer authorization audit is complete.

## Anti-False-Confidence Rules

Every security finding must include:

1. **Evidence**: exact file/line references or query path.
2. **Exploit shape**: what an attacker changes or sends.
3. **Preconditions**: signed out, signed in as buyer, signed in as seller, staff, admin, webhook secret holder, etc.
4. **Impact**: data read, data write, money movement, account takeover, moderation bypass, spam/cost amplification.
5. **Verification status**: `VERIFIED`, `NEEDS RUNTIME PROOF`, `SPECULATIVE`, or `FALSE POSITIVE`.
6. **Fix scope**: smallest code path that closes the bug.
7. **Regression test**: test name or reason a test is not practical.

Rules for AI-assisted review:

- Do not accept "critical" or "high" severity without a concrete exploit path.
- Do not fix speculative findings unless the code proves the path exists.
- Do not rewrite broad modules during security audit unless the bug cannot be fixed locally.
- Do not weaken product behavior to satisfy an abstract security pattern.
- Do not treat middleware as sufficient for record-level authorization.
- Do not treat passing tests as proof that untested authorization paths are safe.
- Re-read the cited code before acting on any AI or agent finding.

## Phase 1: Authorization And IDOR Audit

Scope:

- All `src/app/api/**/route.ts` files.
- All server actions containing `"use server"`.
- All pages that fetch private data server-side.

Checklist:

- Does the route require auth where expected?
- Does it resolve the Clerk user to a local `User` row?
- Does it block banned/deleted users?
- Does it enforce terms acceptance when not public?
- Does every `id` param or body id include ownership or role checks?
- Does staff/admin access have a documented exception?
- Are public reads using shared visibility helpers?
- Are write routes protected against cross-account mutation?
- Are private messages, orders, cases, refunds, notifications, saved searches, carts, and profile settings owner-scoped?

Deliverable:

- `audit_open_findings.md` entries only for verified issues.
- Regression tests for each fixed IDOR.

## Phase 2: Payment, Webhook, And Shipping Audit

Scope:

- Stripe Checkout creation and success flows.
- Stripe snapshot webhook.
- Stripe Connect v2 thin webhook.
- Refund routes and marketplace refund helpers.
- Shippo quote and label purchase routes.
- Label clawback and admin reconciliation.

Checklist:

- Webhook signatures are verified with the correct secret.
- Snapshot and v2 thin webhook destinations remain separate.
- Webhook event IDs are idempotent.
- Money amounts are computed from server-side records, not client input.
- Refund totals cannot exceed order totals.
- Transfer reversals and label clawbacks have durable recovery paths.
- Checkout stock/reservation paths are race-safe.
- Staff/admin refund and case resolution paths are atomic.

Runtime evidence is required for major Stripe/Shippo changes.

## Phase 3: Upload, Media, XSS, And Content Audit

Scope:

- R2 upload routes.
- Presigned uploads.
- Image processing and availability checks.
- Message attachments.
- Blog markdown/rich text rendering.
- Custom order text.
- Reviews, replies, profile text, listing descriptions.
- CSP and CSP report handling.

Checklist:

- Write paths accept only first-party media URLs.
- SVG/HTML/script uploads cannot be persisted as images.
- JPEG/PNG/WebP metadata stripping remains active where promised.
- File size/type/count validation runs client and server side.
- Failed uploads are cleaned up when availability checks fail.
- User-generated HTML/Markdown is sanitized or rendered safely.
- External links use safe schemes and appropriate `rel`.
- CSP does not use wildcards or `unsafe-inline`/`unsafe-eval` expansions unless documented and unavoidable.

## Phase 4: Abuse And Cost Controls

Scope:

- AI review and alt text.
- Search/autocomplete.
- Messaging.
- Newsletter/support/legal request forms.
- Uploads.
- Checkout attempts and shipping quotes.
- Follow/favorite/review voting.

Checklist:

- Expensive routes are rate-limited by user/IP/context.
- Public anonymous routes cannot amplify third-party API spend.
- Bot guards are consistent on analytics endpoints.
- Repeated invalid requests return bounded work and structured errors.
- Email sends respect suppression and preference failure policy.

## Phase 5: Privacy, Legal-Data, And Account Lifecycle Audit

Scope:

- Account deletion.
- Account export.
- Support/legal requests.
- Email suppression/unsubscribe.
- Deleted/banned user behavior.
- Order PII retention.
- Audit logs and Sentry tags.

Checklist:

- Deleted users cannot continue sessions.
- Deletion leaves no half-deleted local/Stripe state.
- Exports include intended data and audit the request.
- PII is not sent to Sentry except explicitly permitted identifiers.
- Legal/support requests remain available to users who cannot sign in.
- Retention jobs are idempotent and reversible enough for incident triage.

## Phase 6: RLS Feasibility

Candidate tables for targeted RLS evaluation:

- `User`
- `SellerProfile`
- `Conversation`
- `Message`
- `Order`
- `OrderItem`
- `Case`
- `Notification`
- `Cart`
- `SavedSearch`

Questions before implementation:

- Can runtime connections reliably set authenticated user context for every request?
- Can Prisma pooled connections avoid leaking context between requests?
- Which tables benefit from RLS without breaking admin/staff/cron/webhook paths?
- Can tests exercise both app-layer and DB-layer denial?
- What is the rollback plan if RLS blocks production traffic?

Until those are answered, strengthen app-layer authorization and add regression tests first.

## Standard Security Verification

Run before merging security fixes:

```bash
npx tsc --noEmit
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
git diff --check
```

For payment/webhook changes, add provider test-mode evidence. For authorization changes, add tests that prove both allowed and denied access.
