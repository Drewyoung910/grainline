# Grainline Architecture

Last updated: 2026-07-22

This document is the human onboarding map for Grainline. `CLAUDE.md` remains the detailed implementation memory and behavior-contract log; this file is the shorter architectural overview a new engineer should read first.

## Product Shape

Grainline is a US-only woodworking marketplace. It supports public browsing, seller shops, listings with variants, anonymous and signed-in carts, Stripe Checkout, Stripe Connect payouts, Shippo labels, custom orders, buyer/seller messaging, reviews, cases/refunds, notifications, blog content, SEO city pages, admin moderation, and operational monitoring.

## Stack

- App: Next.js App Router, React, TypeScript.
- Data: PostgreSQL through Prisma.
- Auth: Clerk, with app-owned middleware responses and database-backed user state.
- Payments: Stripe Checkout and Stripe Connect Accounts v2.
- Shipping: Shippo rates, labels, and tracking metadata.
- Media: Cloudflare R2, first-party URL validation, image processing, upload verification tokens.
- Email: Resend, direct transactional sends for urgent order flows, outbox for non-critical/bulk delivery.
- Cache/rate limits: Upstash Redis where configured, with conservative fallbacks.
- Monitoring: Sentry, request IDs, cron health, webhook idempotency records.

## Source Layout

- `src/app/` contains App Router pages, route handlers, server actions, layouts, and route-specific UI.
- `src/components/` contains reusable client/server UI components.
- `src/lib/` contains domain logic, shared predicates, state helpers, validators, payment/email/upload clients, and testable business rules.
- `prisma/schema.prisma` defines the database schema.
- `tests/*.test.mjs` contains regression and behavior-contract tests. Many tests assert code contracts by source inspection; do not remove these as "brittle" without replacing the protected behavior.
- `docs/` contains operational and planning docs.
- `CLAUDE.md` is the detailed implementation memory for agents and future maintainers.
- `audit_open_findings.md` tracks verified findings, corrected false starts, and historical audit context.

## Request Boundaries

Grainline uses database-level Row Level Security for `SavedSearch`; its Phase B
`FORCE ROW LEVEL SECURITY` rollout is live. The ordinary application runtime
uses a dedicated `NOBYPASSRLS` role, while owner/migration credentials are kept
out of the Vercel runtime. The rest of the schema still relies primarily on
application-layer authorization while independently reviewed RLS or
least-privilege database groups roll out:

- `src/middleware.ts` enforces signed-out redirects, API 401s, terms acceptance, suspended/deleted account blocks, admin role/PIN checks, cron auth, geo-blocking, and request IDs.
- Geo-blocking uses Vercel's `x-vercel-ip-country` header and trusts it only behind Vercel managed ingress. A future hosting or proxy migration must replace that header with a trusted geo source or revisit the US-only gate before accepting traffic.
- Each private route handler or server action must still verify ownership or staff role before reading or mutating data.
- Public routes must use shared visibility predicates (`publicListingWhere`, `publicListingDetailWhere`, `visibleSellerProfileWhere`, `activeSellerProfileWhere`, `publicBlogPostWhere`) rather than ad hoc filters.
- Webhooks and cron routes are middleware-public only because they authenticate with provider signatures or shared secrets inside the route.

`Notification` is the next independent RLS group. Its branch has complete
54-path write-authority coverage, disposable PostgreSQL and provider proof, and
a passed consolidated SQL/application authority review, but it is not merged,
applied, or production-live. Messaging, cases, orders/payment/shipping, and
service/audit ledgers remain separate later activation groups; do not bundle
them into the Notification release.

## Core Lifecycles

### Users And Sellers

Clerk owns identity/session. Grainline stores durable user state in `User`, including role, banned/deleted flags, terms acceptance, and age attestation. `SellerProfile` stores seller-facing shop/profile state, Stripe account state, vacation/orderability controls, pickup/ship-from settings, and profile media. Middleware account-state Redis keys are environment-scoped: production deployments share one namespace so invalidation survives deployment skew, while each Preview branch uses a hashed branch identity so cloned or synthetic Preview state cannot contaminate production decisions.

### Listings

Listing state is controlled by server actions and shared state helpers. Public visibility is not the same as ownership preview. Owners can preview non-public listings through preview routes; public pages must go through public visibility predicates. ACTIVE listing edits are reviewed when the seller explicitly presses Save, not when photo upload helper buttons attach files.

### Public Discovery

Public discovery routes are split by purpose. `/browse` remains the full filter UI, `/tag/[slug]` is the canonical SEO landing page for listing tags, `/seller/[id]` and `/seller/[id]/shop` are seller storefront routes, `/blog` and `/blog/[slug]` cover editorial content, and `/blog/author/[slug]` is the canonical maker-author archive. Tag and author sitemap entries are capped in the base sitemap so they do not become unbounded sitemap sources.

### Checkout And Orders

Checkout uses Stripe Checkout Sessions and local lock/idempotency state. Destination-charge accounting keeps platform tax handling and seller transfer math explicit. Order, payment event, refund, dispute, label, and case state transitions must be idempotent and race-aware. Full refunds restore eligible in-stock inventory automatically before buyer handoff; seller and staff partial refunds restore inventory only through explicit bounded quantities validated against purchased in-stock order items.

### Messaging

Conversations are participant-scoped, with specific staff/admin exceptions only where intentionally implemented. Listing context attached to conversations must be visible and valid for the parties.

### Uploads

Write paths must persist only first-party Grainline media URLs, and new user-submitted upload URLs must be scoped to the current uploader's R2 key segment and expected endpoint. Edit paths may preserve existing DB-owned media rows/fields for legacy compatibility, but hidden fields must not let one signed-in user attach another user's public Grainline media URL. Image upload routes validate MIME/size/count rules, strip image metadata where applicable, verify object availability, and clean up failed writes. Direct-to-R2 PDF/video uploads are tracked in `DirectUpload` from presign through verify, claim, and cleanup so abandoned successful uploads can be deleted without bucket listing. Chat/file upload paths have different friction than profile/listing image paths.

### Email And Notifications

Notifications respect preference keys and deduplication helpers. Time-critical transactional emails reserve deterministic email-outbox rows before the direct-send fast path, and retryable provider sends use the outbox dedup key as the provider idempotency key. Bulk/non-critical sends use the email outbox directly.

`UserEmailAddress` stores exact-normalized account email history captured during Clerk/user refreshes. Account export and deletion use current `User.email` plus this user-owned history for support/data-request and local email-record coverage after excluding historical emails currently assigned to another non-deleted user, expanding to Gmail/Googlemail suppression keys only when querying suppression, outbox, failure-count, or newsletter tables.

## Operational References

- `docs/runbook.md`: production incidents, rollback, webhook recovery, restore drills, secret rotation.
- `docs/launch-checklist.md`: launch env/vendor/smoke-test checklist.
- `docs/security-hardening-plan.md`: adversarial security audit process.
- `docs/maintainability-plan.md`: codebase stabilization and bug-resistance plan.
- `docs/legal-risk-register.md`: legal/compliance issue tracker for attorney review.

## Current Architecture Health And Deliberate Debt

The foundation is sound for a prelaunch marketplace: authentication and
visibility boundaries are explicit, provider side effects are generally
idempotent, runtime and migration database authority are separated, and risky
behavior is backed by an unusually broad regression/evidence suite. The code is
not an unstructured mess, but it is a large modular monolith whose complexity is
now concentrated in several hotspots:

- 112 API route files and 58 Prisma models create a broad authorization and
  lifecycle surface.
- The Stripe webhook (2,717 lines) and account-deletion coordinator (2,007
  lines) are high-change, cross-domain orchestration files that deserve staged
  extraction after the current RLS release rather than an incidental rewrite
  during it.
- Notification creation historically spans 54 emission paths. The Bucket B
  family wrappers and completeness gate control that distribution, but future
  notification types must enter through the same source-bound registry.
- The long-lived Notification branch is a large integration unit (111 files
  changed from `main` at the 2026-07-22 review). Release it through a clean PR,
  full CI, explicit migration/app compatibility sequence, and postflight; do
  not treat green branch-only database proof as a substitute for release CI.
- `package.json` currently permits automatic Node major upgrades (`>=22`), so
  Vercel may build on Node 24 while GitHub CI uses Node 22. Align the supported
  major explicitly before launch in a separate compatibility change.

These are maintainability and integration risks, not evidence that the core
architecture needs a rewrite. Prefer bounded extractions and independently
activated data-security groups over a broad refactor.

## Engineering Rule Of Thumb

Prefer boring, testable changes. Marketplace bugs usually come from state mismatches, missing ownership checks, webhook replay assumptions, and optimistic UI that disagrees with server behavior. Every high-risk behavior should have one shared helper, at least one regression test, and a short documentation note.
