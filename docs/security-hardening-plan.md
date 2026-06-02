# Grainline Security Hardening Plan

Last updated: 2026-06-02

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

## External Marketplace Benchmarks

This section records the public, source-backed controls used by mature marketplaces and commerce platforms. It is a benchmark, not a requirement list. Grainline should copy the controls that reduce real risk at this stage, and defer controls that create launch friction without proportional benefit.

Sources reviewed 2026-05-13:

- Etsy requires two-factor authentication during shop opening and supports authenticator app, SMS, or phone verification: https://help.etsy.com/hc/en-us/articles/115015672808
- Etsy uses Persona for seller identity verification and government-ID/selfie checks: https://help.etsy.com/hc/en-us/articles/22504854625815-Identity-Verification-with-Persona-on-Etsy
- Etsy documents INFORM Consumers Act seller-info collection and disclosure thresholds: https://help.etsy.com/hc/en-us/articles/14553858116759-Etsy-Asked-Me-to-Confirm-My-Seller-Info
- FTC INFORM guidance confirms high-volume marketplace seller collection/verification/disclosure duties: https://www.ftc.gov/business-guidance/resources/what-third-party-sellers-need-know-about-inform-consumers-act
- Etsy Purchase Protection may cover eligible refunds up to $250 and depends on seller standards such as shipping, tracking, policies, and response time: https://help.etsy.com/hc/en-us/articles/5850122619287-What-is-Etsy-s-Purchase-Protection-for-Sellers
- Etsy publishes a security-bug reporting process and requires proof-of-concept/impact details: https://help.etsy.com/hc/en-us/articles/115015650468-Reporting-Security-Bugs
- Shopify publishes PCI compliance evidence, including annual PCI AoC and quarterly ASV scan attestations: https://www.shopify.com/legal/compliance/reports
- Stripe Checkout qualifies for the lightest PCI validation path, SAQ A, because card data is collected in Stripe-hosted fields/iframes: https://stripe.com/en-th/guides/pci-compliance
- Stripe requires Stripe.js to be loaded directly from `https://js.stripe.com` and not bundled/self-hosted to remain PCI compliant: https://docs.stripe.com/payments/accept-a-payment
- PostgreSQL Row Level Security restricts returned or modified rows through table policies, but table owners and `BYPASSRLS` roles can bypass it: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Cloudflare Bot Fight Mode is a free domain-wide bot mitigation toggle, but it cannot be customized or skipped with WAF custom rules: https://developers.cloudflare.com/bots/get-started/free/
- GitHub security features include Dependabot, secret scanning/push protection, and CodeQL/code scanning depending on repository visibility and plan: https://docs.github.com/en/code-security/getting-started/github-security-features
- RFC 9116 defines `/.well-known/security.txt` with required `Contact` and `Expires` fields: https://www.rfc-editor.org/rfc/rfc9116

Controls to copy before or near launch:

- Require hardware MFA for Grainline owner/admin credentials at Stripe, Vercel, GitHub, Clerk, Neon, Cloudflare, Resend, Sentry, Shippo, OpenAI, and domain registrar accounts.
- Require seller MFA before or immediately after a seller completes payout onboarding. Etsy requires 2FA at shop opening; Grainline should match that trust boundary before public seller activity scales.
- Publish a vulnerability disclosure channel: `security@thegrainline.com`, `/security`, and `/.well-known/security.txt`.
- Complete Stripe PCI SAQ A self-attestation and keep evidence with launch records.
- Maintain a checkout-page third-party script inventory and monitor checkout security headers/CSP. Do not blindly add SRI to Stripe.js; Stripe requires direct loading from `js.stripe.com`, and the correct PCI v4 approach is inventory, authorization, integrity/change monitoring, CSP, and evidence.
- Turn on GitHub repository protections that are available for the repo plan: branch protection, required CI, Dependabot alerts/updates, secret scanning, push protection where available, and CodeQL/code scanning where available.
- Turn on Cloudflare baseline protections deliberately: WAF managed rules, Bot Fight Mode or Super Bot Fight Mode, rate limiting for high-risk paths, and Security Events review. Bot Fight Mode can challenge API/monitoring/provider traffic and cannot be skipped, so verify Stripe, Clerk, Resend, Shippo, Vercel, and uptime checks after enabling.
- Run and record SSL Labs, securityheaders.com, HSTS preload, and Cloudflare TLS settings evidence.
- Add incident-response appendices for breach-notification clocks and vendor security contact paths.
- Consider a public transparency report later. Etsy has long used transparency reporting as a marketplace trust signal; Grainline already has the underlying case/report/admin-audit data.

Implemented 2026-05-13:

- Public disclosure page: `/security`.
- RFC 9116 metadata: `/.well-known/security.txt`.
- Both routes are middleware-public, terms-gate-exempt, suspended-account-exempt, and geo-block-exempt. Keep `security@thegrainline.com` mailbox routing verified before launch.
- CSP reports are sanitized through `src/lib/cspReport.ts`; cart/checkout document violations are tagged with `checkout_surface=true` in Sentry for payment-page monitoring evidence without retaining checkout query strings.

Controls to design, not rush:

- RLS on high-risk private tables. It is useful defense in depth, but Prisma plus pooled connections require careful request context and bypass-role design.
- Platform-funded buyer purchase protection. Etsy uses it as a trust product, but Grainline must decide refund-pool economics, seller eligibility, and legal wording first.
- Third-party identity verification for higher-trust seller programs. Stripe Identity or a comparable IDV provider fits naturally before Guild Member approval, but it adds biometric/privacy/legal obligations.
- Paid penetration testing or managed VDP. Do after known launch blockers are closed so the tester is not spending time on issues we already know.

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
- Refund inventory restoration is explicit and state-gated: full refunds restore eligible in-stock items before buyer handoff, while partial refunds must validate bounded requested quantities against purchased in-stock order items and must not restore stock after shipped, delivered, or picked-up states.

Runtime evidence is required for major Stripe/Shippo changes.

## PCI And Payment-Page Controls

Current checkout architecture:

- Grainline uses Stripe Checkout/embedded Checkout and does not collect raw card numbers in Grainline forms or store raw card data in the database.
- Stripe documentation maps Checkout/Elements to SAQ A for Level 2-4 merchants because card data is collected in Stripe-hosted iframes/fields.
- Stripe.js must remain loaded from `https://js.stripe.com`; do not self-host, bundle, or pin it in a way that conflicts with Stripe's compliance guidance.

Required operational controls before live card volume:

- Complete Stripe Dashboard PCI SAQ A and store the completion date/evidence in launch records.
- Inventory scripts that execute on cart/checkout/payment pages: source, owner, business justification, and whether the script is required for payment, auth, monitoring, fraud prevention, or UI. Current launch inventory lives in `docs/checkout-script-inventory.md`.
- Monitor payment-page security-impacting headers and script changes. For launch, the minimum acceptable implementation is strict CSP plus `/api/csp-report`, Sentry alerting on checkout-page script/frame violations, and a documented weekly review. A dedicated PCI v4 client-side monitoring vendor can be evaluated later if volume or acquirer requirements demand it.
- Keep checkout CSP as narrow as possible. Add providers only with a source-backed need and a regression test or manual checkout smoke.
- Record Stripe's PCI responsibilities and Grainline's remaining responsibilities in the launch checklist.

Explicit anti-pattern:

- Do not add Subresource Integrity to Stripe.js unless Stripe officially supports the exact versioned URL and update behavior being used. A stale or incorrect SRI hash can break checkout and can create false confidence because Stripe's script is intentionally delivered from Stripe's domain for compliance and fraud-detection updates.

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
- PII is not sent to Sentry except explicitly permitted identifiers. Email correlation uses deterministic hashes through `hashEmailForTelemetry()` rather than raw addresses in Sentry extras/tags/contexts.
- Legal/support requests remain available to users who cannot sign in.
- Retention jobs are idempotent and reversible enough for incident triage.

## Phase 6: RLS Feasibility

Detailed design lives in `docs/rls-feasibility-plan.md`. That document is the source of truth for RLS staging, role separation, transaction-local request context, candidate-table ordering, and rollback requirements.

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

- Can runtime connections reliably set authenticated user context for every request without leaking it through pooled connections?
- Can Prisma queries that need RLS be wrapped in transaction-local context, for example `set_config('app.user_id', ..., true)`, without breaking normal helpers?
- Which tables benefit from RLS without breaking admin/staff/cron/webhook/public-read paths?
- Which dedicated database roles are needed: runtime app, migration owner, admin/cron/webhook bypass, read-only reporting?
- Which policies need `SELECT`, `INSERT`, `UPDATE`, and `DELETE` separation instead of a broad `ALL` policy?
- Can tests prove both app-layer and DB-layer denial by attempting direct queries under the runtime role?
- What is the rollback plan if RLS blocks production traffic?

Implementation sequence:

1. Inventory every private table and its owner model. Record owner columns, participant columns, staff/admin exceptions, and public visibility exceptions.
2. Split runtime and migration privileges. The runtime role should not own tables if RLS is meant to protect runtime queries; table owners usually bypass RLS unless forced.
3. Prototype on a staging clone with one low-blast-radius table such as `Notification` or `SavedSearch`.
4. Add policy tests that run as the restricted runtime role and verify cross-user rows are invisible or unmodifiable.
5. Add helper tests proving request context is transaction-local and cleared after the query.
6. Expand to messages/cases/orders only after the prototype survives real route tests.
7. Keep admin, cron, and webhook bypass paths explicit and audited.
8. Do not enable RLS on public marketplace discovery tables until public visibility helper behavior has a separate design. Public listings and seller profiles have mixed public/private semantics that are easier to break.

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
