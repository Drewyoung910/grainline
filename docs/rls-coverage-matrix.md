# Grainline RLS Coverage Matrix

Last updated: 2026-08-13

## Purpose And Scope

This is the schema-complete disposition ledger for Grainline's site-wide
database isolation program. Snapshot scope: 64 Prisma models.

`SavedSearch`, `Notification`, `Conversation`, `Message`, `DirectUpload`,
`DirectUploadReference`, `Case`, `CaseMessage`, `CaseMessageAttachment`, and
`StripeWebhookEvent` are the ten tables in this snapshot with production RLS.
Every other row is **not active RLS** and remains work to design, prove, and
promote.
The target column is a planning disposition, not a claim that the control is
implemented. Re-read the production catalog before making any current-state
claim because this document is a dated source snapshot.

RLS remains defense in depth. Clerk authentication, route and action
authorization, visibility rules, ownership predicates, and safe provider
callbacks remain mandatory after a policy is enabled.

## Status Vocabulary

- `RLS_LIVE_PHASE_A`: production RLS is enabled with retained proof. A later
  hardening phase can still be pending.
- `RLS_LIVE_PHASE_B`: production RLS is enabled and FORCE-hardened with retained
  runtime-role and maintenance proof.
- `RLS_LIVE_FORCE`: production RLS is enabled and FORCE-hardened with retained
  proof outside the historical SavedSearch/Notification A/B labels.
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
| `SellerProfile` | `BLOCKED_DESIGN` | Seller public-private split | Public shop profile mixed with Stripe, ship-from address and moderation state; public, seller, staff, Stripe and cron | Split private operational fields or expose reviewed public views before restricting base rows. The CheckoutStockReservation source-consistency transaction currently locks and re-reads this base row; migrate that dependency to a reviewed projection or narrow fixed operation before SellerProfile RLS/revocation, never a broad compatibility grant |
| `SellerFaq` | `BLOCKED_DESIGN` | Seller public-private split | Public shop content with seller-owned writes | Parent-seller write policy and public-read design tied to visible profiles |
| `FoundingMakerGrant` | `ALTERNATIVE_REVIEW` | Service and allocation ledgers | System allocation and badge state; allocation job, staff and public badge consumers | Revoke ordinary writes and choose service-only mutation plus minimal read projection |
| `Listing` | `BLOCKED_DESIGN` | Catalog public-private split | Public inventory mixed with drafts, private reservations and review state; public, seller, reserved buyer, staff and cron | Model visibility states, participant access and private moderation fields before base-table RLS |
| `Photo` | `BLOCKED_DESIGN` | Catalog public-private split | Listing media; public readers, listing owner and cleanup jobs | Parent listing visibility and seller ownership policy with cleanup path |
| `Favorite` | `BLOCKED_DESIGN` | Aggregate and fanout | Owner save history plus cross-user ranking and seller analytics | Denormalize or explicitly serve public aggregates before owner-scoped reads |
| `Review` | `BLOCKED_DESIGN` | Review and UGC | Public review, reviewer content, seller reply and staff moderation | Actor-specific read and write rules that preserve public approved content and moderation |
| `Conversation` | `RLS_LIVE_FORCE` | Conversation and message | Private participant thread state; two participants, exact reported-staff exception and deletion flows | ENABLE plus FORCE, one participant/reported-staff SELECT policy, SELECT-only runtime grant and fixed write authority are live. Retain protected run `30207825683`, actual pooled-runtime postflight and `docs/rls-conversation-message-plan.md` |
| `Message` | `RLS_LIVE_FORCE` | Conversation and message | Private message bodies and attachment references; sender, recipient, exact reported-staff exception and structured service messages. Ordinary attachment bytes currently remain public bearer-link objects outside PostgreSQL | ENABLE plus FORCE, one parent-derived SELECT policy, SELECT-only runtime grant and fixed write authority are live with the Conversation release and retained pooled-runtime proof. CM-A20 separately requires private object storage, participant-authorized reads and legacy-object classification before claiming byte confidentiality |
| `ReviewPhoto` | `BLOCKED_DESIGN` | Review and UGC | Review media; public readers, reviewer and moderation cleanup | Parent review visibility and author-control policy |
| `ReviewVote` | `BLOCKED_DESIGN` | Review and UGC | User vote history plus public helpful counts | Preserve aggregate counts while restricting per-user rows and writes |
| `Order` | `BLOCKED_DESIGN` | Order, payment and shipping | Buyer PII, addresses, provider IDs, fulfillment and refunds; buyer, item sellers, staff, Stripe, Shippo and jobs | Full actor-operation inventory, seller-through-item policy, service writes, retention and rollback proof |
| `OrderShippingRateQuote` | `BLOCKED_DESIGN` | Order, payment and shipping | Shipping quote snapshots; buyer, relevant seller, Shippo and cleanup jobs | Parent-order participant rules and service re-quote cleanup path |
| `OrderPaymentEvent` | `BLOCKED_DESIGN` | Order, payment and shipping | Payment and dispute ledger; buyer, relevant seller, staff and Stripe | Decide user-visible projection versus service-only fields and immutable webhook writes |
| `SellerPayoutEvent` | `BLOCKED_DESIGN` | Order, payment and shipping | Seller payout status and failure data; seller, staff and Stripe | Seller ownership through profile plus webhook-only mutation and support access |
| `OrderItem` | `BLOCKED_DESIGN` | Order, payment and shipping | Purchased items and snapshots; buyer, listing seller, staff and provider workflows | Parent-order buyer rule plus seller-through-listing rule and immutable checkout writes |
| `Cart` | `PLANNED_RLS` | Cart and cart item | Direct user-owned cart; owner, checkout, webhook and deletion | Direct-owner policies plus explicit checkout and cleanup service behavior |
| `CartItem` | `PLANNED_RLS` | Cart and cart item | Items owned through parent cart; owner, checkout, webhook and listing cleanup | Parent-join policies tested with Cart RLS and cross-user cleanup bypass |
| `CheckoutStockReservation` | `COMPATIBLE_CANDIDATE` | Order, payment and shipping | Reservation payload and buyer or seller identifiers; checkout, Stripe and expiry repair | The compatible migration is live from exact main `77fc45fe`, CI `31752628832`, inspection `31753838550` and guarded run `31754431910`. The actual pooled-runtime postflight accepted RLS/FORCE off, zero policies, predecessor CRUD retained, the exact 20-function catalog and zero reservation rows. Zero direct reservation delegates remain under merged `src`, but production app source is still `69c14c06`. Pre-deploy review found `CSR-A23`: exact Stripe-bound source and returned Listing-level inventory must be re-read under the fixed function's locks in one short rollback-safe transaction. Complete full/PG/provider proof and merge for that isolated fix, deploy/smoke/drain only the exact successor, prove zero direct access, then separate ENABLE and FORCE. Exact findings remain in `docs/checkout-stock-reservation-rls-audit.md` |
| `ListingVariantGroup` | `BLOCKED_DESIGN` | Catalog public-private split | Public listing options with seller writes | Parent listing visibility and ownership policy |
| `ListingVariantOption` | `BLOCKED_DESIGN` | Catalog public-private split | Public option price and stock data with seller writes | Parent group and listing visibility plus ownership policy |
| `SiteConfig` | `ALTERNATIVE_REVIEW` | Reference and configuration | Singleton operational configuration; public-runtime readers and staff or deployment writers | Make ordinary runtime read-only and choose audited administrative mutation path |
| `Case` | `RLS_LIVE_FORCE` | Case and case message | Dispute narrative, status and refund identifiers; buyer, seller, staff, cron and Stripe | Policyless ENABLE plus FORCE, zero policies, zero direct runtime table/column authority and the exact fixed-operation partition are live. Exact main `9e5d87f4c5b4a529bc84c6c2cf077778fe553186`, CI `30951067980`, migration run `30953378226`, and the separate pooled-runtime read-only postflight are accepted |
| `CaseResolutionClaim` | `PLANNED_RLS` | Case resolution service ledger | Private staff/provider handshake, refund intent, local payment evidence and reconciliation state; no ordinary participant table access | Candidate preparation creates it ENABLE plus FORCE with zero policies and zero runtime/PUBLIC table grants; prove only reviewed source-validating fixed operations can prepare, record, reconcile and finalize claims |
| `CaseStripeDisputeApplication` | `PLANNED_RLS` | Case Stripe-dispute service ledger | Immutable exact payment-event-to-Case replay authority; no ordinary participant table access | Candidate creates it ENABLE plus FORCE with zero policies and zero runtime/PUBLIC table grants; prove only `grainline_case_stripe_dispute_apply` can create or read exact replay evidence |
| `CaseSellerRefundApplication` | `PLANNED_RLS` | Case seller-refund service ledger | Immutable exact local-refund-event-to-Case replay authority; no ordinary participant table access | Candidate creates it ENABLE plus FORCE with zero policies and zero runtime/PUBLIC table grants; prove only `grainline_case_seller_refund_apply` can create or read exact replay evidence |
| `CaseOpenApplication` | `PLANNED_RLS` | Case buyer-open service ledger | Immutable exact Order-to-Case opening replay authority; no ordinary participant table access | Candidate creates it ENABLE plus FORCE with zero policies and zero runtime/PUBLIC table grants; prove only `grainline_case_open` can create or validate exact replay evidence |
| `CaseMessage` | `RLS_LIVE_FORCE` | Case and case message | Private dispute discussion; buyer, seller and staff | Policyless ENABLE plus FORCE and zero direct runtime table/column authority are live with parent-bound fixed reads/writes, invariant triggers and pooled-runtime denial proof in the accepted Case-family release |
| `CaseMessageAttachment` | `RLS_LIVE_FORCE` | Case and case message | Private dispute image evidence; inherits exact parent Case visibility | Policyless ENABLE plus FORCE and zero direct runtime table/column authority are live with the Case family. Case evidence stays disabled; signed-read promotion and cleanup scheduling remain separate operational releases rather than RLS gaps |
| `SavedSearch` | `RLS_LIVE_PHASE_B` | Bucket A SavedSearch | Direct user-owned search criteria; owner and bounded canary | Phase B FORCE is live; retain exact policies, grants, canary, rollback, and maintenance proof |
| `StockNotification` | `PLANNED_RLS` | Stock notification | Direct user subscription with listing-wide notification fanout and cleanup | Owner reads and writes plus explicit service fanout and listing cleanup path; do not fold silently into Bucket B |
| `MakerVerification` | `BLOCKED_DESIGN` | Verification | Seller application evidence and staff review notes; applicant, employee and admin | Applicant projection, staff review path, decision writes and notification side effects |
| `BlogPost` | `BLOCKED_DESIGN` | Blog public-private split | Public posts mixed with drafts and staff or seller authoring | Public published view plus author and staff controls for draft, publish and archive states |
| `BlogComment` | `BLOCKED_DESIGN` | Blog public-private split | Public approved comments mixed with pending moderation; author, public and staff | Approved-public read path plus author create and staff moderation policy |
| `NewsletterSubscriber` | `ALTERNATIVE_REVIEW` | Newsletter service | Subscriber email and confirmation token state; anonymous signup, email service and staff | Narrow subscribe and confirm RPC or service role; no ordinary broad reads of subscriber rows |
| `EmailSuppression` | `ALTERNATIVE_REVIEW` | Email service ledgers | Suppressed email addresses and delivery context; Resend webhook, mail sender and staff | Dedicated service access with ordinary user runtime denied and audited support lookup |
| `ResendWebhookEvent` | `ALTERNATIVE_REVIEW` | Provider event ledgers | Webhook idempotency and errors; Resend handler and operations | Service-only grants or narrow RPCs with no ordinary request reads |
| `ClerkWebhookEvent` | `ALTERNATIVE_REVIEW` | Provider event ledgers | Identity webhook idempotency and errors; Clerk handler and operations | Service-only grants or narrow RPCs with no ordinary request reads |
| `CronRun` | `ALTERNATIVE_REVIEW` | Cron and operations ledgers | Job status and bounded result metadata; cron workers and operations | Cron service role or narrow job RPCs plus read-only ops visibility |
| `DirectUpload` | `RLS_LIVE_FORCE` | Direct upload | User-owned upload claim state with cleanup jobs; the compatible private-object schema can also retain non-public Case/Message keys | Policyless ENABLE plus FORCE, zero runtime/cleanup table CRUD, the 35-function partition, exact migration status and owner proof are live in recovery run `30877508811`. Exact-main pooled-runtime and protected cleanup-role postflights passed read-only in run `30924905247` |
| `DirectUploadReference` | `RLS_LIVE_FORCE` | Direct upload service ledger | Normalized shared-public and exclusive-private durable references; ordinary application SQL has no legitimate table-level access | Policyless ENABLE plus FORCE with zero runtime/PUBLIC/cleanup table grants is live and accepted with DirectUpload. Pooled-runtime and cleanup-role acceptance passed read-only; cleanup scheduling and private Case evidence remain separate releases |
| `SystemAuditLog` | `ALTERNATIVE_REVIEW` | Audit ledgers | Cross-system action evidence; provider, cron, staff and operations | Append-only service path, denied ordinary mutation and reviewed staff read access |
| `EmailFailureCount` | `ALTERNATIVE_REVIEW` | Email service ledgers | Delivery failure counters keyed by email; Resend handler and mail service | Service-only mutation and no ordinary request enumeration |
| `EmailOutbox` | `ALTERNATIVE_REVIEW` | Email service ledgers | Recipient PII and rendered email content; producers, sender cron and operations | Dedicated producer and worker operations, least-privilege reads and retention proof |
| `AccountDeletionSideEffect` | `ALTERNATIVE_REVIEW` | Account lifecycle service | Deletion payloads and retry state; account deletion, worker and operations | Service-only durable queue with target-user cleanup semantics and ordinary runtime denial |
| `SupportRequest` | `BLOCKED_DESIGN` | Support | User or anonymous contact PII and case text; requester and staff | Authenticated-owner versus anonymous submission design, staff queue and retention rules |
| `StripeWebhookEvent` | `RLS_LIVE_PHASE_A` | Provider event ledgers | Six source-pinned fixed lease/maintenance functions; direct ordinary source removed | Policyless ENABLE/NO-FORCE, zero policies, zero runtime/PUBLIC table or column authority, and exactly six fixed functions are live. Exact main `f987645784a447604fcab2399dc8e7fd7bef9d7c`, CI `31408797498`, migration run `31410550315`, global grant/RLS audit and the separate actual pooled-runtime read-only postflight are accepted. The FORCE preparation is merged at main `6d448bce38bed2aa54bf4ce7ae8e5f8a4ba73186` with CI `31419148169`, but remains unapplied; this row must stay Phase A until a separate guarded migration and pooled-runtime postflight pass. Connect v2 signed delivery and live-mode provider proof remain mandatory launch gates, not Phase-A database-authority gaps |
| `SellerMetrics` | `BLOCKED_DESIGN` | Seller analytics | Seller performance and sales totals; seller, staff, guild logic and jobs | Separate seller-private metrics from any public eligibility projection; service-only calculation writes |
| `SellerRatingSummary` | `ALTERNATIVE_REVIEW` | Public aggregate projections | Derived public rating summary; public readers and calculation jobs | Read-only ordinary runtime plus service-only refresh and integrity proof |
| `SiteMetricsSnapshot` | `ALTERNATIVE_REVIEW` | Public aggregate projections | Derived site metrics; public readers and calculation jobs | Read-only ordinary runtime plus service-only singleton refresh |
| `Notification` | `RLS_LIVE_PHASE_B` | Bucket B Notification | Direct user-owned reads and mark-read updates with cross-user and system creation | `ENABLE` plus `FORCE`, two policies, narrow runtime grants, production catalog/direct-denial proof, and authenticated route postflight are live and retained. Preserve the policy, RPC, and grant contract; retain protected backup `br-hidden-tree-aa337i8v` through the rollback window |
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
default to ordinary Prisma access. Notification prelaunch inspection and the
atomic activation purge,
recipient RPC real-table/provider proof, policy/grant activation, and every later group's
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

1. SavedSearch Phase B is complete in production.
2. Runtime/migration credential separation and superseded owner-credential
   invalidation are complete.
3. Bucket B Notification `ENABLE` plus `FORCE` is complete in production.
4. Conversation plus Message ENABLE/FORCE and the actual pooled-runtime
   postflight are complete in production.
5. Case-family FORCE and the exact pooled-runtime postflight are complete.
   Keep Case evidence enablement, cleanup scheduling and provider/token changes
   outside that database boundary.
6. Continue the Order/payment/shipping program: StripeWebhookEvent policyless
   FORCE and its recovered actual pooled-runtime postflight are complete.
   CheckoutStockReservation compatible migration and pooled-runtime proof are
   complete; deploy, smoke and drain the fixed-operation app before separate
   policyless ENABLE and FORCE. Then
   continue the remaining Order,
   OrderItem, quote, payment, payout and reservation tables as separately
   reviewed activations. Keep Connect v2 plus live-mode provider topology and
   signed delivery as distinct mandatory launch gates; the v2 route shares the
   fixed lease functions and does not reopen the Phase-A database boundary.
7. Continue the remaining matrix groups separately. Order/payment/shipping
   retains high sensitive-data priority; Cart/CartItem,
   SavedBlogPost, aggregate/fanout, public/private split and service-ledger
   groups remain required and must not be silently dropped or bundled into the
   messaging activation.
