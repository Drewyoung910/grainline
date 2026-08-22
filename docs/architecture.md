# Grainline Architecture

Last updated: 2026-08-15

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

Grainline uses database-level Row Level Security for `SavedSearch`,
`Notification`, `Conversation`, `Message`, `DirectUpload`,
`DirectUploadReference`, `Case`, `CaseMessage`, `CaseMessageAttachment`,
`StripeWebhookEvent`, and `CheckoutStockReservation`; all eleven tables are
`FORCE ROW LEVEL SECURITY` hardened in production. DirectUpload,
StripeWebhookEvent, the Case family, and
CheckoutStockReservation intentionally use
policyless RLS with no direct ordinary-runtime table or column authority: all
permitted behavior goes through reviewed fixed functions. DirectUpload's
owner, pooled-runtime, and cleanup-role proofs are accepted; its dedicated
cleanup job remains unscheduled as a separate operational release. The
ordinary application runtime uses a dedicated `NOBYPASSRLS` role, while
owner/migration credentials are kept out of the Vercel runtime. The rest of
the schema still relies primarily on
application-layer authorization while independently reviewed RLS or
least-privilege database groups roll out:

- `src/middleware.ts` enforces signed-out redirects, API 401s, terms acceptance, suspended/deleted account blocks, admin role/PIN checks, cron auth, geo-blocking, and request IDs.
- Geo-blocking uses Vercel's `x-vercel-ip-country` header and trusts it only behind Vercel managed ingress. A future hosting or proxy migration must replace that header with a trusted geo source or revisit the US-only gate before accepting traffic.
- Each private route handler or server action must still verify ownership or staff role before reading or mutating data.
- Public routes must use shared visibility predicates (`publicListingWhere`, `publicListingDetailWhere`, `visibleSellerProfileWhere`, `activeSellerProfileWhere`, `publicBlogPostWhere`) rather than ad hoc filters.
- Webhooks and cron routes are middleware-public only because they authenticate with provider signatures or shared secrets inside the route.

Notification, Conversation/Message, DirectUpload, and the Case family are
independent completed production database groups. The Case source inventory,
fixed-operation catalog, policyless ENABLE/FORCE posture, and pooled-runtime
proof remain retained in the Case rollout records. Case evidence UI/API
enablement, private-R2 route smoke, cleanup scheduling, token retirement, and
provider variables remain disabled separate releases; they are not evidence
that Case database RLS is incomplete. Order/payment/shipping is the active
sensitive-data program. User, public/private catalog data, carts, and other
service/audit ledgers remain separately reviewed later groups; do not bundle
their policies or grants.

The first Order/payment/shipping database boundary is the service-owned
`StripeWebhookEvent` ledger. Policyless ENABLE plus FORCE, zero
ordinary-runtime/PUBLIC table or column authority, exactly six source-pinned
fixed functions and the recovered actual pooled-runtime read-only postflight
are live. Do not add the runtime URL to the owner-only GitHub Production
migration environment; owner migration and actual-runtime proof remain
separate credential boundaries.

`CheckoutStockReservation` is a completed service-ledger boundary. Its compatible
authority and additive source-consistency migrations, compatible application,
authenticated production checkout smoke, shared-credential predecessor
deployment drain, and policyless ENABLE/grant-revocation release are complete.
Direct ordinary-runtime and PUBLIC table/column authority is now zero.
Signed completion and restore bind an immutable Stripe source object plus
claim generation; repair workers use monotonic claims; Redis checkout
publication uses unique owner tokens. Each checkout path now calls one fixed
PostgreSQL statement that locks Cart, CartItem, Listing, variant and photo
sources, derives the reservation payload in the database and treats the
application's canonical witness only as a rejection condition. Two fresh
provider slots passed without weaker thresholds or residue. Exact main
`16239fce2956c6dc726c24ccd7a91d1ea35463bd` and production migration run
`31814032227` applied the additive migration with the global audit and exact
scope proof green. The pooled-runtime postflight, application deployment,
authenticated smoke and exact-ID predecessor drain are accepted; no superseded
deployment can authenticate with the current runtime credential.

The exact policyless Phase-A migration is live from exact main
`405d6dff327bee76aced17f3876f8f18f29e05db`, CI `31894742120`, and guarded
migration run `31903152300`. The restart-safe scope accepted the exact
source-consistent predecessor, Prisma applied only the activation, and grant
convergence plus migration/global audit and after-scope proof passed. The
separate actual pooled-runtime postflight passed read-only; evidence SHA-256 is
`899679a14590200880e89d983fff70492632de458649316bd69cde9a0027ece0`.

The posture-only FORCE successor is also complete from exact main
`7c033eac8b18f2c7b6837dc8caafa5d3eda47f76`, CI `31911640477`, and guarded
migration run `31912265711`. The migration changed only the FORCE flag; grant
convergence, migration status, the global grant/RLS audit and exact FORCE scope
all passed. The distinct actual pooled-runtime proof passed inside an
engine-attested repeatable-read/read-only transaction. Its sanitized evidence
SHA-256 is
`4534d58c6a7872d7fae6169e12db56aa62414a16a5e71cad3f4e163c83752d51` and
records no production mutation. The next Order/payment/shipping work must begin
with a fresh domain audit of the remaining Order, OrderItem, quote, payment and
payout surfaces rather than extending this reservation authority implicitly.

That fresh audit selected `SellerPayoutEvent` as the next bounded table. The
current system has one signed-provider write family, a seller banner and seller
account export, but the mutable projection lacks durable Stripe event ordering.
The compatible successor must bind an active webhook generation and immutable
payout source, derive the seller from the unique Stripe-account mapping, store
provider event time, expose only bounded seller projections and report unknown
account mappings explicitly. RLS activation remains blocked until the
converted app, linked-seller signed test-mode proof, Notification source path
and predecessor drain pass. See
`docs/seller-payout-event-pre-rls-audit.md`.

The additive SellerPayoutEvent authority preparation is documented separately in
`docs/seller-payout-event-compatible-authority-release.md`. It introduces
provider-event ordering, a source-bound writer and bounded seller projections
while intentionally leaving RLS off and predecessor table grants intact. A
transaction-scoped payout-identity advisory lock covers concurrent first
writes, where a row lock cannot yet exist. Compatible preparation is accepted
in production from exact main
`6bc89c58d7d83509f73206a2f9b4854e3bed476b`: exact-main CI `31923317475`,
protected read-only inspection `31923608819`, and guarded migration run
`31923767337` all passed. Only the additive migration was applied; RLS remains
off and predecessor table CRUD remains available. The application conversion
documented in `docs/seller-payout-event-compatible-app-conversion.md` is live
from exact source `e9239463a71860451191344b26dd20b45298f239`; it removes all
three direct application consumers and gives this payout path strict,
retryable notification semantics without changing existing best-effort
callers. The linked-seller signed test-mode proof is accepted from exact main
`854233e3b8729da60c0da46ff8af492e53e48438` with exact retry stability and
complete temporary-row/account cleanup. The next boundary is the exact-ID
predecessor drain recorded in
`docs/seller-payout-event-predecessor-drain.md`. Exact main
`9947a9e485a686dc801befcdea285cddc5b3aff7`, CI `32583228592`, removed the sole
current-credential predecessor and preserved the current deployment, all four
canonical aliases and health; accepted evidence SHA-256 is
`3bb83df87df2cf2571df53ef0021e73886eca5d57140e0e8bc929eac4e2b61b1`. Its
CI-enforced source proof finds the exact three fixed-authority consumers and
zero direct table access. The next separate boundary is policyless ENABLE plus
direct-grant revocation. These releases do not change the later separate
activation order for payment events, shipping quotes or Order/OrderItem.

The isolated activation design is recorded in
`docs/seller-payout-event-activation-release.md`. It uses policyless ENABLE,
zero direct runtime/PUBLIC table or column authority, and retains only the
three source-pinned fixed operations. Provider event time becomes required only
after an exclusive-lock preflight proves every retained row has valid time and
the converted application's current-credential predecessor is absent. The
candidate and database-first rollback are byte-pinned and CI proves them with
separate owner/runtime logins. Restart-safe guarded production wiring is
prepared separately in
`docs/seller-payout-event-activation-production-wiring.md`; its merge,
production migration, actual pooled-runtime acceptance postflight and the later
posture-only FORCE release remain separate boundaries.

The completed activation design used policyless ENABLE first and FORCE later.
Phase A removes all ordinary-runtime and PUBLIC table/column authority while
retaining only the exact source-consistent fixed-operation catalog. It verifies
the live 18-runtime/7-private predecessor, then retires EXECUTE on the two
unused legacy creation functions for a 16-runtime/9-private activated
partition. The functions remain installed for rollback, but the accepted
rollback application uses their source-consistent successors. The global
grant-audit disposition, database-first rollback, direct-denial proof and
actual pooled-runtime read-only postflight are accepted production evidence.
The byte-pinned candidate builder only reports deterministic
proposed migration bytes and hashes; it cannot create a Prisma migration
directory or execute a database change. Exact source-consistency bytes,
evidence hashes and rollback limits remain in
`docs/checkout-stock-reservation-source-consistency-release.md`,
`docs/checkout-stock-reservation-production-smoke.md`, and
`docs/checkout-stock-reservation-predecessor-drain.md`. The activation release
and guarded workflow contract are in
`docs/checkout-stock-reservation-activation-release.md` and
`docs/checkout-stock-reservation-activation-production-wiring.md`. The
posture-only FORCE release and its restart-safe production wiring are in
`docs/checkout-stock-reservation-force-release.md` and
`docs/checkout-stock-reservation-force-production-wiring.md`; the latter also
owns the distinct actual pooled-runtime FORCE postflight contract.

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

Write paths must persist only first-party Grainline media URLs, and new user-submitted upload URLs must be scoped to the current uploader's R2 key segment and expected endpoint. Edit paths may preserve existing DB-owned media rows/fields for legacy compatibility, but hidden fields must not let one signed-in user attach another user's public Grainline media URL. Image upload routes validate MIME/size/count rules, strip image metadata where applicable, verify object availability, and clean up failed writes. Direct-to-R2 PDF/video uploads are tracked in `DirectUpload` from presign through verify, claim, and cleanup so abandoned successful uploads can be deleted without bucket listing. DirectUpload cleanup is isolated from the ordinary Vercel runtime: the compatible retirement removed its route and schedule before FORCE RLS, and the dedicated GitHub worker remains unscheduled until the restricted cleanup-role postflight is accepted. Chat/file upload paths have different friction than profile/listing image paths.

### Email And Notifications

Notifications respect preference keys and deduplication helpers. Time-critical transactional emails reserve deterministic email-outbox rows before the direct-send fast path, and retryable provider sends use the outbox dedup key as the provider idempotency key. Bulk/non-critical sends use the email outbox directly.

`UserEmailAddress` stores exact-normalized account email history captured during Clerk/user refreshes. Account export and deletion use current `User.email` plus this user-owned history for support/data-request and local email-record coverage after excluding historical emails currently assigned to another non-deleted user, expanding to Gmail/Googlemail suppression keys only when querying suppression, outbox, failure-count, or newsletter tables.

## Operational References

- `docs/rls-coverage-matrix.md`: schema-complete database-isolation status and
  the next proof for every Prisma model.
- `docs/rls-operator-guide.md`: shared RLS release and evidence conventions.
- `STRATEGY.md`: current sensitive-data rollout order and exact accepted
  production boundary.
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

- 114 API route files and 60 Prisma models create a broad authorization and
  lifecycle surface.
- The Stripe webhook (2,717 lines) and account-deletion coordinator (2,007
  lines) are high-change, cross-domain orchestration files that deserve staged
  extraction after the current RLS release rather than an incidental rewrite
  during it.
- Notification creation originally spanned 54 emission paths and now spans 55
  after the compatible Case seller-decision addition. The Bucket B
  family wrappers and completeness gate control that distribution, but future
  notification types must enter through the same source-bound registry.
- Notification and Conversation/Message were deliberately released through
  separate clean PRs, protected migrations, full CI and pooled-runtime
  postflights. Reuse those operating controls without copying their table
  authority shapes onto Case or Order.
- `package.json` currently permits automatic Node major upgrades (`>=22`), so
  Vercel may build on Node 24 while GitHub CI uses Node 22. Align the supported
  major explicitly before launch in a separate compatibility change.

These are maintainability and integration risks, not evidence that the core
architecture needs a rewrite. Prefer bounded extractions and independently
activated data-security groups over a broad refactor.

## Engineering Rule Of Thumb

Prefer boring, testable changes. Marketplace bugs usually come from state mismatches, missing ownership checks, webhook replay assumptions, and optimistic UI that disagrees with server behavior. Every high-risk behavior should have one shared helper, at least one regression test, and a short documentation note.
