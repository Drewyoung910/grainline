# Grainline RLS Coverage Matrix

Last updated: 2026-07-19

## Purpose And Scope

This is the schema-complete disposition ledger for Grainline's site-wide
database isolation program. Snapshot scope: 58 Prisma models.

`SavedSearch` is the only table in this snapshot with production RLS. Every
other row is **not active RLS** and remains work to design, prove, and promote.
The target column is a planning disposition, not a claim that the control is
implemented. Re-read the production catalog before making any current-state
claim because this document is a dated source snapshot.

RLS remains defense in depth. Clerk authentication, route and action
authorization, visibility rules, ownership predicates, and safe provider
callbacks remain mandatory after a policy is enabled.

## Status Vocabulary

- `RLS_LIVE_PHASE_A`: production RLS is enabled with retained proof. A later
  hardening phase can still be pending.
- `PLANNED_RLS`: RLS is the expected target shape, but the table-specific
  actor and operation inventory, staging proof, rollback, and monitoring are
  not complete.
- `BLOCKED_DESIGN`: the table contains sensitive or user-linked data, but a
  safe policy requires a named prerequisite such as public/private schema
  separation, participant rules, aggregate preservation, or a service path.
- `ALTERNATIVE_REVIEW`: row ownership is not the natural control for this
  system, reference, or aggregate table. A reviewed database isolation
  alternative such as a dedicated service role, revoked ordinary-runtime
  grants, a narrow RPC, or a read-only view must be chosen and evidenced.

No row is exempt merely because it is public, operational, or currently
protected by application code. `ALTERNATIVE_REVIEW` does not count as a
completed alternative.

## Coverage Matrix

| Prisma model | Target | Activation owner/group | Data and actors | Blocking prerequisite or next proof |
|---|---|---|---|---|
| `User` | `BLOCKED_DESIGN` | Identity and account core | Account identity, contact and shipping PII; self, staff, Clerk lifecycle and deletion jobs | Separate public identity projections from private account columns; design self, staff and provider operations |
| `UserEmailAddress` | `PLANNED_RLS` | Identity and account core | Email history; account owner, Clerk lifecycle, export and deletion | Direct-owner read policy plus explicit provider write and cleanup path |
| `SellerProfile` | `BLOCKED_DESIGN` | Seller public-private split | Public shop profile mixed with Stripe, ship-from address and moderation state; public, seller, staff, Stripe and cron | Split private operational fields or expose reviewed public views before restricting base rows |
| `SellerFaq` | `BLOCKED_DESIGN` | Seller public-private split | Public shop content with seller-owned writes | Parent-seller write policy and public-read design tied to visible profiles |
| `FoundingMakerGrant` | `ALTERNATIVE_REVIEW` | Service and allocation ledgers | System allocation and badge state; allocation job, staff and public badge consumers | Revoke ordinary writes and choose service-only mutation plus minimal read projection |
| `Listing` | `BLOCKED_DESIGN` | Catalog public-private split | Public inventory mixed with drafts, private reservations and review state; public, seller, reserved buyer, staff and cron | Model visibility states, participant access and private moderation fields before base-table RLS |
| `Photo` | `BLOCKED_DESIGN` | Catalog public-private split | Listing media; public readers, listing owner and cleanup jobs | Parent listing visibility and seller ownership policy with cleanup path |
| `Favorite` | `BLOCKED_DESIGN` | Aggregate and fanout | Owner save history plus cross-user ranking and seller analytics | Denormalize or explicitly serve public aggregates before owner-scoped reads |
| `Review` | `BLOCKED_DESIGN` | Review and UGC | Public review, reviewer content, seller reply and staff moderation | Actor-specific read and write rules that preserve public approved content and moderation |
| `Conversation` | `BLOCKED_DESIGN` | Conversation and message | Private participant thread state; two participants, staff exceptions and deletion flows | Participant policy, reported-thread staff path, archive semantics and account lifecycle proof |
| `Message` | `BLOCKED_DESIGN` | Conversation and message | Private message bodies and attachments; sender, recipient, staff exceptions and system messages | Parent-participant policy plus send, mark-read, system-message, export and deletion inventory |
| `ReviewPhoto` | `BLOCKED_DESIGN` | Review and UGC | Review media; public readers, reviewer and moderation cleanup | Parent review visibility and author-control policy |
| `ReviewVote` | `BLOCKED_DESIGN` | Review and UGC | User vote history plus public helpful counts | Preserve aggregate counts while restricting per-user rows and writes |
| `Order` | `BLOCKED_DESIGN` | Order, payment and shipping | Buyer PII, addresses, provider IDs, fulfillment and refunds; buyer, item sellers, staff, Stripe, Shippo and jobs | Full actor-operation inventory, seller-through-item policy, service writes, retention and rollback proof |
| `OrderShippingRateQuote` | `BLOCKED_DESIGN` | Order, payment and shipping | Shipping quote snapshots; buyer, relevant seller, Shippo and cleanup jobs | Parent-order participant rules and service re-quote cleanup path |
| `OrderPaymentEvent` | `BLOCKED_DESIGN` | Order, payment and shipping | Payment and dispute ledger; buyer, relevant seller, staff and Stripe | Decide user-visible projection versus service-only fields and immutable webhook writes |
| `SellerPayoutEvent` | `BLOCKED_DESIGN` | Order, payment and shipping | Seller payout status and failure data; seller, staff and Stripe | Seller ownership through profile plus webhook-only mutation and support access |
| `OrderItem` | `BLOCKED_DESIGN` | Order, payment and shipping | Purchased items and snapshots; buyer, listing seller, staff and provider workflows | Parent-order buyer rule plus seller-through-listing rule and immutable checkout writes |
| `Cart` | `PLANNED_RLS` | Cart and cart item | Direct user-owned cart; owner, checkout, webhook and deletion | Direct-owner policies plus explicit checkout and cleanup service behavior |
| `CartItem` | `PLANNED_RLS` | Cart and cart item | Items owned through parent cart; owner, checkout, webhook and listing cleanup | Parent-join policies tested with Cart RLS and cross-user cleanup bypass |
| `CheckoutStockReservation` | `BLOCKED_DESIGN` | Order, payment and shipping | Reservation payload and buyer or seller identifiers; checkout, Stripe and expiry repair | Service-owned mutation model and bounded participant observability decision |
| `ListingVariantGroup` | `BLOCKED_DESIGN` | Catalog public-private split | Public listing options with seller writes | Parent listing visibility and ownership policy |
| `ListingVariantOption` | `BLOCKED_DESIGN` | Catalog public-private split | Public option price and stock data with seller writes | Parent group and listing visibility plus ownership policy |
| `SiteConfig` | `ALTERNATIVE_REVIEW` | Reference and configuration | Singleton operational configuration; public-runtime readers and staff or deployment writers | Make ordinary runtime read-only and choose audited administrative mutation path |
| `Case` | `BLOCKED_DESIGN` | Case and case message | Dispute narrative, status and refund identifiers; buyer, seller, staff and cron | Participant and staff policies, escalation jobs, resolution and refund transaction proof |
| `CaseMessage` | `BLOCKED_DESIGN` | Case and case message | Private dispute discussion; buyer, seller and staff | Parent-case participant and staff policy plus closed-state write rules |
| `SavedSearch` | `RLS_LIVE_PHASE_A` | Bucket A SavedSearch | Direct user-owned search criteria; owner and bounded canary | Complete the separately gated Phase B FORCE release; retain exact policies, grants, canary and rollback proof |
| `StockNotification` | `PLANNED_RLS` | Stock notification | Direct user subscription with listing-wide notification fanout and cleanup | Owner reads and writes plus explicit service fanout and listing cleanup path; do not fold silently into Bucket B |
| `MakerVerification` | `BLOCKED_DESIGN` | Verification | Seller application evidence and staff review notes; applicant, employee and admin | Applicant projection, staff review path, decision writes and notification side effects |
| `BlogPost` | `BLOCKED_DESIGN` | Blog public-private split | Public posts mixed with drafts and staff or seller authoring | Public published view plus author and staff controls for draft, publish and archive states |
| `BlogComment` | `BLOCKED_DESIGN` | Blog public-private split | Public approved comments mixed with pending moderation; author, public and staff | Approved-public read path plus author create and staff moderation policy |
| `NewsletterSubscriber` | `ALTERNATIVE_REVIEW` | Newsletter service | Subscriber email and confirmation token state; anonymous signup, email service and staff | Narrow subscribe and confirm RPC or service role; no ordinary broad reads of subscriber rows |
| `EmailSuppression` | `ALTERNATIVE_REVIEW` | Email service ledgers | Suppressed email addresses and delivery context; Resend webhook, mail sender and staff | Dedicated service access with ordinary user runtime denied and audited support lookup |
| `ResendWebhookEvent` | `ALTERNATIVE_REVIEW` | Provider event ledgers | Webhook idempotency and errors; Resend handler and operations | Service-only grants or narrow RPCs with no ordinary request reads |
| `ClerkWebhookEvent` | `ALTERNATIVE_REVIEW` | Provider event ledgers | Identity webhook idempotency and errors; Clerk handler and operations | Service-only grants or narrow RPCs with no ordinary request reads |
| `CronRun` | `ALTERNATIVE_REVIEW` | Cron and operations ledgers | Job status and bounded result metadata; cron workers and operations | Cron service role or narrow job RPCs plus read-only ops visibility |
| `DirectUpload` | `PLANNED_RLS` | Direct upload | User-owned upload claim state with cleanup jobs | Owner policies plus explicit verifier and cleanup service operations |
| `SystemAuditLog` | `ALTERNATIVE_REVIEW` | Audit ledgers | Cross-system action evidence; provider, cron, staff and operations | Append-only service path, denied ordinary mutation and reviewed staff read access |
| `EmailFailureCount` | `ALTERNATIVE_REVIEW` | Email service ledgers | Delivery failure counters keyed by email; Resend handler and mail service | Service-only mutation and no ordinary request enumeration |
| `EmailOutbox` | `ALTERNATIVE_REVIEW` | Email service ledgers | Recipient PII and rendered email content; producers, sender cron and operations | Dedicated producer and worker operations, least-privilege reads and retention proof |
| `AccountDeletionSideEffect` | `ALTERNATIVE_REVIEW` | Account lifecycle service | Deletion payloads and retry state; account deletion, worker and operations | Service-only durable queue with target-user cleanup semantics and ordinary runtime denial |
| `SupportRequest` | `BLOCKED_DESIGN` | Support | User or anonymous contact PII and case text; requester and staff | Authenticated-owner versus anonymous submission design, staff queue and retention rules |
| `StripeWebhookEvent` | `ALTERNATIVE_REVIEW` | Provider event ledgers | Stripe idempotency and errors; webhook handler and operations | Service-only grants or narrow RPCs with no ordinary request reads |
| `SellerMetrics` | `BLOCKED_DESIGN` | Seller analytics | Seller performance and sales totals; seller, staff, guild logic and jobs | Separate seller-private metrics from any public eligibility projection; service-only calculation writes |
| `SellerRatingSummary` | `ALTERNATIVE_REVIEW` | Public aggregate projections | Derived public rating summary; public readers and calculation jobs | Read-only ordinary runtime plus service-only refresh and integrity proof |
| `SiteMetricsSnapshot` | `ALTERNATIVE_REVIEW` | Public aggregate projections | Derived site metrics; public readers and calculation jobs | Read-only ordinary runtime plus service-only singleton refresh |
| `Notification` | `PLANNED_RLS` | Bucket B Notification | Direct user-owned reads and mark-read updates with cross-user and system creation | Eleven emission paths have family validation drafts; narrow the remaining 43, resolve legacy cleanup and social/message concurrency, and choose the recipient hot-read design before staging |
| `ListingViewDaily` | `BLOCKED_DESIGN` | Seller analytics | Seller-private listing analytics with public event ingestion and aggregation jobs | Seller-through-profile reads plus service-only counter writes and hot-path plan review |
| `SellerProfileViewDaily` | `BLOCKED_DESIGN` | Seller analytics | Seller-private profile analytics with public event ingestion and aggregation jobs | Seller ownership reads plus service-only counter writes and hot-path plan review |
| `Follow` | `BLOCKED_DESIGN` | Aggregate and fanout | Owner relationship plus public follower counts and cross-user fanout | Denormalized count and explicit fanout service path before owner-row policies |
| `SavedBlogPost` | `PLANNED_RLS` | Saved blog post | Direct user-owned saved state across account and public blog rendering | Wrap all saved-state reads, export and deletion paths; retain route happy-path proof |
| `SellerBroadcast` | `BLOCKED_DESIGN` | Aggregate and fanout | Seller-authored broadcast and recipient fanout metadata | Seller ownership, follower fanout service path and recipient visibility decision |
| `CommissionRequest` | `BLOCKED_DESIGN` | Commission | Buyer request and location or reference media mixed with seller discovery | Public discovery projection, buyer ownership, location privacy and lifecycle states |
| `CommissionInterest` | `BLOCKED_DESIGN` | Commission | Seller interest connected to buyer request and optional conversation | Buyer and interested-seller participant rules plus conversation and fanout side effects |
| `Metro` | `ALTERNATIVE_REVIEW` | Reference and configuration | Public geographic reference data; public readers and administrative loaders | Read-only ordinary runtime and controlled loader or migration writes |
| `AdminAuditLog` | `BLOCKED_DESIGN` | Admin security | Sensitive immutable admin actions and undo evidence; admins and audit operations | Staff context or dedicated admin role, append and undo constraints, no ordinary user visibility |
| `Block` | `BLOCKED_DESIGN` | Aggregate and fanout | Bidirectional safety relationship; blocker, blocked user and fanout filters | Bidirectional read policy and service filtering without revealing unsafe detail |
| `UserReport` | `BLOCKED_DESIGN` | Admin security | Reporter details, target and resolution notes; reporter and staff | Reporter submission or status projection, staff-only investigation fields and retention rules |

## Program Rules

1. A row can move to `RLS_LIVE_PHASE_A` or a later live status only with exact
   catalog, policy, runtime-role denial, route happy-path, service-path,
   rollback, monitoring, and production-deployment evidence.
2. An `ALTERNATIVE_REVIEW` row is incomplete until the chosen database control
   is documented, tested against the exact runtime and service roles, and
   promoted with evidence. Application authorization alone is not that
   alternative.
3. Each activation group gets an exact actor/read/write/update/delete/cleanup
   inventory. Schema inference in this baseline does not satisfy that gate.
4. Public or aggregate reads must be preserved deliberately. Do not weaken a
   policy to `USING (true)` without documenting what confidentiality and
   mutation protections remain.
5. Provider callbacks, cron, fanout, account deletion, retention, and staff
   workflows require explicit service or staff paths. Do not reuse an owner
   credential in application Functions.
6. Tightly coupled parent-child tables can share design and staging, but every
   production activation remains independently reversible and observable from
   unrelated groups.
7. The matrix must be updated in the same change as every Prisma model add,
   rename, or removal. Its regression test intentionally fails otherwise.

## Verified Source Preparation

The current source already centralizes ordinary owner operations for three
future groups:

- `Notification` owner reads and mark-read updates use
  `src/lib/notificationOwnerAccess.ts`.
- `Cart` and `CartItem` owner reads and mutations use
  `src/lib/cartOwnerAccess.ts`.
- `SavedBlogPost` owner reads and mutations use
  `src/lib/savedBlogPostOwnerAccess.ts`.

`tests/rls-feasibility-plan.test.mjs` rejects new direct owner-style access
outside those helpers. This reduces later callsite refactoring. The isolated
Notification helper now requires branded transaction-local user context, and
its cross-user create, exact lifecycle cleanup, and retention paths target
fixed-purpose unapplied service functions. Cart and SavedBlogPost helpers still
default to ordinary Prisma access. Notification legacy cleanup, recipient
hot-read architecture, policy/grant activation, and every later group's
service paths remain explicit work. Centralization and draft wiring are
preparation, not active RLS or staging proof.

## Future Saved-Search Match Alerts

The requested feature can build on the current `SavedSearch`, `Notification`,
and `EmailOutbox` systems, but it is not implemented today.

Verified current state:

- `SavedSearch` already stores the filters needed for matching and has
  `notifyEmail Boolean @default(true)`.
- The saved-search POST schema does not accept `notifyEmail`, and no current UI
  or route changes that field after creation.
- Phase A deliberately gives the runtime role no `UPDATE` on `SavedSearch` and
  has no UPDATE policy. A future notification toggle therefore requires a
  separately reviewed narrow update design; do not widen the current grants as
  an incidental feature change.
- There is no saved-search matcher, delivery ledger, matching notification
  type, or alert job in current source.

Required design before implementation:

1. Define the availability event precisely: newly created active listing,
   transition into public `ACTIVE`, and optionally restock from unavailable to
   available. Cache revalidation is not a durable delivery queue.
2. Reuse the canonical browse-filter semantics for query, category, listing
   type, shipping days, rating, location radius, price, and tags so alerts do
   not disagree with the saved browse URL.
3. Add a durable unique delivery ledger keyed by saved search and listing, or
   an equivalent idempotency key, so retries and repeated listing transitions
   cannot spam users.
4. Add an explicit notification type and email preference key, then enqueue
   in-app notifications and email outbox jobs through bounded, idempotent
   fanout.
5. Give the matcher an audited service path for cross-user `SavedSearch` reads
   and `Notification` or `EmailOutbox` writes. Ordinary end-user context cannot
   perform this fanout once those tables are protected.
6. If users can toggle email alerts after saving, choose a column-limited RPC
   or another narrowly reviewed owner update path and extend the exact grant,
   policy, audit, static-guard, staging, rollback, and canary contracts.
7. Prove new-listing, publish, approval, restock, retry, duplicate suppression,
   opt-out, account deletion, and high-fanout behavior before production.

This feature should be designed after Bucket B establishes the Notification
service-write model. It should not delay the already sealed SavedSearch Phase B
FORCE release because Phase B changes ownership-drift behavior only and does not
preclude a later reviewed policy or grant migration.

## Immediate Sequence

1. Complete SavedSearch Phase B after its time and canary gates.
2. Externalize `DIRECT_URL` and `MIGRATION_DB_ROLE`, invalidate credentials
   retained by superseded deployments, drain owner sessions, and establish the
   migration and service release path.
3. Design and independently activate Bucket B as `Notification` only.
4. Continue with `Cart` and `CartItem`, then `SavedBlogPost`, while preparing
   the shared aggregate, participant, service-role, and public/private split
   infrastructure needed by the more sensitive groups.
5. Prioritize `Conversation` and `Message`, order/payment/shipping, and cases as
   the sensitive clusters after their service and rollback designs are proven.
