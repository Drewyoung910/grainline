# Grainline Architecture

Last updated: 2026-05-13

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

Grainline does not use database-level Row Level Security today. The current security model is application-layer authorization:

- `src/middleware.ts` enforces signed-out redirects, API 401s, terms acceptance, suspended/deleted account blocks, admin role/PIN checks, cron auth, geo-blocking, and request IDs.
- Each private route handler or server action must still verify ownership or staff role before reading or mutating data.
- Public routes must use shared visibility predicates (`publicListingWhere`, `publicListingDetailWhere`, `visibleSellerProfileWhere`, `activeSellerProfileWhere`, `publicBlogPostWhere`) rather than ad hoc filters.
- Webhooks and cron routes are middleware-public only because they authenticate with provider signatures or shared secrets inside the route.

## Core Lifecycles

### Users And Sellers

Clerk owns identity/session. Grainline stores durable user state in `User`, including role, banned/deleted flags, terms acceptance, and age attestation. `SellerProfile` stores seller-facing shop/profile state, Stripe account state, vacation/orderability controls, pickup/ship-from settings, and profile media.

### Listings

Listing state is controlled by server actions and shared state helpers. Public visibility is not the same as ownership preview. Owners can preview non-public listings through preview routes; public pages must go through public visibility predicates. ACTIVE listing edits are reviewed when the seller explicitly presses Save, not when photo upload helper buttons attach files.

### Checkout And Orders

Checkout uses Stripe Checkout Sessions and local lock/idempotency state. Destination-charge accounting keeps platform tax handling and seller transfer math explicit. Order, payment event, refund, dispute, label, and case state transitions must be idempotent and race-aware.

### Messaging

Conversations are participant-scoped, with specific staff/admin exceptions only where intentionally implemented. Listing context attached to conversations must be visible and valid for the parties.

### Uploads

Write paths must persist only first-party Grainline media URLs, and new user-submitted upload URLs must be scoped to the current uploader's R2 key segment and expected endpoint. Edit paths may preserve existing DB-owned media rows/fields for legacy compatibility, but hidden fields must not let one signed-in user attach another user's public Grainline media URL. Image upload routes validate MIME/size/count rules, strip image metadata where applicable, verify object availability, and clean up failed writes. Chat/file upload paths have different friction than profile/listing image paths.

### Email And Notifications

Notifications respect preference keys and deduplication helpers. Time-critical transactional emails are direct sends; bulk/non-critical sends use the email outbox.

## Operational References

- `docs/runbook.md`: production incidents, rollback, webhook recovery, restore drills, secret rotation.
- `docs/launch-checklist.md`: launch env/vendor/smoke-test checklist.
- `docs/security-hardening-plan.md`: adversarial security audit process.
- `docs/maintainability-plan.md`: codebase stabilization and bug-resistance plan.
- `docs/legal-risk-register.md`: legal/compliance issue tracker for attorney review.

## Engineering Rule Of Thumb

Prefer boring, testable changes. Marketplace bugs usually come from state mismatches, missing ownership checks, webhook replay assumptions, and optimistic UI that disagrees with server behavior. Every high-risk behavior should have one shared helper, at least one regression test, and a short documentation note.
