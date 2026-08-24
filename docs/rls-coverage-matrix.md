# Grainline RLS Coverage Matrix

Last updated: 2026-08-23

## Purpose And Scope

This is the schema-complete disposition ledger for Grainline's site-wide
database isolation program. Snapshot scope: 65 Prisma models.

`SavedSearch`, `Notification`, `Conversation`, `Message`, `DirectUpload`,
`DirectUploadReference`, `Case`, `CaseMessage`, `CaseMessageAttachment`,
`StripeWebhookEvent`, `CheckoutStockReservation`, and `SellerPayoutEvent` have
complete retained FORCE acceptance. These are all twelve tables in this
snapshot with production RLS. SellerPayoutEvent closed its distinct actual
pooled-runtime FORCE postflight from exact main
`fb350c31772938ef52ef796c61bf670d9cf0750e` after CI `32675227286` passed;
sanitized evidence SHA-256 is
`f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
Every other row is **not active RLS** and remains work to design, prove, and
promote.
The target column is a planning disposition, not a claim that the control is
implemented. Re-read the production catalog before making any current-state
claim because this document is a dated source snapshot.

RLS remains defense in depth. Clerk authentication, route and action
authorization, visibility rules, ownership predicates, and safe provider
callbacks remain mandatory after a policy is enabled.

Before any table or group advances from planning into policy, fixed-function,
grant or migration design, it must satisfy the separate domain-audit gate in
`docs/rls-feasibility-plan.md` and link a durable group audit. A target
disposition by itself is not approval to implement RLS. Findings must be
classified as `BLOCKS_RLS_DESIGN`, `FIX_BEFORE_ACTIVATION`, or
`DEFERRED_PRODUCT_WORK`; only the last category may remain open at activation
when its future authority implications and closure criteria are recorded.

## Status Vocabulary

- `RLS_LIVE_PHASE_A`: production RLS is enabled with retained proof. A later
  hardening phase can still be pending.
- `RLS_LIVE_PHASE_B`: production RLS is enabled and FORCE-hardened with retained
  runtime-role and maintenance proof.
- `RLS_LIVE_FORCE`: production RLS is enabled and FORCE-hardened with retained
  proof outside the historical SavedSearch/Notification A/B labels.
- `RLS_LIVE_FORCE_PENDING_POSTFLIGHT`: production RLS and FORCE are applied and
  guarded owner-side scope proofs passed, but the distinct actual pooled-runtime
  FORCE postflight and retained evidence are still pending. This is a temporary
  fail-closed release state, not completed acceptance.
- `COMPATIBLE_PREPARATION_LIVE`: reviewed fixed-operation authority is live,
  while RLS remains off and predecessor direct grants are retained only for a
  separately drained compatibility window.
- `ACTIVATION_RELEASE_MERGED_UNAPPLIED`: the reviewed activation migration and
  proof package are merged and CI-proven, but production still has the prior
  posture because the guarded migration and pooled-runtime postflight have not
  run.
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
| `Conversation` | `RLS_LIVE_FORCE` | Conversation and message | Private participant thread state; two participants, exact reported-staff exception and deletion flows | ENABLE plus FORCE, one participant/reported-staff SELECT policy, SELECT-only runtime grant and fixed write authority are live. Retain protected run `30207825683`, actual pooled-runtime postflight and `docs/rls-conversation-message-plan.md` |
| `Message` | `RLS_LIVE_FORCE` | Conversation and message | Private message bodies and attachment references; sender, recipient, exact reported-staff exception and structured service messages. Ordinary attachment bytes currently remain public bearer-link objects outside PostgreSQL | ENABLE plus FORCE, one parent-derived SELECT policy, SELECT-only runtime grant and fixed write authority are live with the Conversation release and retained pooled-runtime proof. CM-A20 separately requires private object storage, participant-authorized reads and legacy-object classification before claiming byte confidentiality |
| `ReviewPhoto` | `BLOCKED_DESIGN` | Review and UGC | Review media; public readers, reviewer and moderation cleanup | Parent review visibility and author-control policy |
| `ReviewVote` | `BLOCKED_DESIGN` | Review and UGC | User vote history plus public helpful counts | Preserve aggregate counts while restricting per-user rows and writes |
| `Order` | `BLOCKED_DESIGN` | Order, payment and shipping | Buyer PII, addresses, provider IDs, fulfillment and refunds; buyer, item sellers, staff, Stripe, Shippo and jobs | Full actor-operation inventory, seller-through-item policy, service writes, retention and rollback proof |
| `OrderShippingRateQuote` | `BLOCKED_DESIGN` | Order, payment and shipping | Shipping quote snapshots; buyer, relevant seller, Shippo and cleanup jobs | Parent-order participant rules and service re-quote cleanup path |
| `OrderPaymentEvent` | `BLOCKED_DESIGN` | Order, payment and shipping | Append-only payment/refund/dispute service evidence; signed Stripe, seller/staff refund authorities, bounded buyer/seller/staff projections and aggregate jobs | Dedicated audit pins 26 semantic application surfaces and selects policyless ENABLE then FORCE with zero direct table authority. The isolated compatible stack now covers launch-safe full-refund semantics, canonical dispute consumers, refund-only export projections, UTC generation-fenced claims, restart-safe blocked-checkout handoff, atomic record/finalize plus participant delivery, two source-bound signed refund/dispute operations, evidence-bound ambiguous provider reconciliation, database-derived first-write recovery if the original seller becomes banned/deleted, and atomic staff Case finalization with durable buyer/seller Notification plus email-outbox reservation. Recovery reuses exact source-validating functions and adds no caller-controlled target or generic runtime operation. None of the stack is merged, deployed, production-applied or activation evidence. Remaining gates are staff Case provider/replay integration proof, append-only/taxonomy/currency/source invariants, actor-safe projections/aggregates, fresh aggregate-only production inspection, converted signed provider/retry proof, predecessor drain and separate ENABLE/FORCE releases. Do not bundle quote, Order or OrderItem activation. See `docs/order-payment-event-pre-rls-audit.md`, `docs/order-payment-event-refund-contract.md`, `docs/order-payment-event-dispute-state.md`, `docs/order-payment-event-account-export.md`, `docs/order-payment-event-refund-claim-generation.md`, `docs/order-payment-event-refund-record-authority.md`, `docs/order-payment-event-case-refund-delivery.md`, `docs/order-payment-event-signed-authority-design.md` and `docs/order-payment-event-refund-reconciliation.md` |
| `OrderRefundReconciliation` | `COMPATIBLE_CANDIDATE` | Order, payment and shipping | Immutable private evidence for manual classification of generation-fenced ambiguous refunds; current ADMIN plus fixed service functions only | The isolated compatible migration creates the table as policyless ENABLE plus FORCE with zero direct runtime/PUBLIC authority and one immutable trigger. Four source-bound runtime operations derive the active claim, constrain the 23/25-hour provider evidence window, co-commit the exact Admin audit, and let only an exact immutable reconciliation finalize a failed blocked-checkout event after its lease is cleared. A byte-sealed successor also lets the existing seller-record and Case-apply functions derive the same exact authority when the original seller became inactive before the first local commit; no reconciliation identity is caller-supplied. Static predecessor proofs pass and distinct real PostgreSQL 16 rollback proofs are wired for CI. No migration, deployment or production state has changed. See `docs/order-payment-event-refund-reconciliation.md` |
| `SellerPayoutEvent` | `RLS_LIVE_FORCE` | Order, payment and shipping | Retained payout-failure projection; seller, separately signed Stripe service and future audited staff support | Policyless Phase A remains accepted with exact main `bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`, CI `32663849012`, migration run `32667518275`, and retained pooled-runtime evidence SHA-256 `01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de`. Exact main `0eb360b9878698f45288ac3c1649871de9a8a33c`, CI `32672008187`, and guarded run `32672434812` then applied only `20260823220000_force_seller_payout_event_rls`, converged grants, and passed migration status, the global grant/RLS audit and exact FORCE scope. Exact main `fb350c31772938ef52ef796c61bf670d9cf0750e` passed CI `32675227286`; its distinct actual pooled-runtime FORCE postflight passed all nine checks inside an engine-attested repeatable-read/read-only transaction and recorded no mutation. Retain sanitized mode-`0600` evidence SHA-256 `f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`. Production is policyless ENABLE plus FORCE with zero direct runtime/PUBLIC authority and exactly three source-bound fixed operations. Do not reuse Phase-A evidence or bundle `OrderPaymentEvent`, `OrderShippingRateQuote`, `Order`, or `OrderItem`. See `docs/seller-payout-event-compatible-authority-release.md`, `docs/seller-payout-event-compatible-app-conversion.md`, `docs/seller-payout-event-linked-production-proof.md`, `docs/seller-payout-event-predecessor-drain.md`, `docs/seller-payout-event-activation-release.md`, `docs/seller-payout-event-activation-production-wiring.md` and `docs/seller-payout-event-force-release.md` |
| `OrderItem` | `BLOCKED_DESIGN` | Order, payment and shipping | Purchased items and snapshots; buyer, listing seller, staff and provider workflows | Parent-order buyer rule plus seller-through-listing rule and immutable checkout writes |
| `Cart` | `PLANNED_RLS` | Cart and cart item | Direct user-owned cart; owner, checkout, webhook and deletion | Direct-owner policies plus explicit checkout and cleanup service behavior |
| `CartItem` | `PLANNED_RLS` | Cart and cart item | Items owned through parent cart; owner, checkout, webhook and listing cleanup | Parent-join policies tested with Cart RLS and cross-user cleanup bypass |
| `CheckoutStockReservation` | `RLS_LIVE_FORCE` | Order, payment and shipping | Reservation payload and buyer or seller identifiers; checkout, Stripe and expiry repair | Policyless ENABLE plus FORCE, zero policies, zero direct runtime/PUBLIC table or column authority, and the exact 16-runtime/9-private fixed-operation partition are live. Exact main `7c033eac8b18f2c7b6837dc8caafa5d3eda47f76`, CI `31911640477`, guarded migration run `31912265711`, and the separate pooled-runtime FORCE postflight are accepted. FORCE evidence SHA-256 is `4534d58c6a7872d7fae6169e12db56aa62414a16a5e71cad3f4e163c83752d51`. Retain `docs/checkout-stock-reservation-activation-plan.md`, `docs/checkout-stock-reservation-activation-release.md`, `docs/checkout-stock-reservation-activation-production-wiring.md`, `docs/checkout-stock-reservation-force-release.md`, and `docs/checkout-stock-reservation-force-production-wiring.md` |
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
| `StripeWebhookEvent` | `RLS_LIVE_FORCE` | Provider event ledgers | Six source-pinned fixed lease/maintenance functions; direct ordinary source removed | Policyless ENABLE plus FORCE, zero policies, zero runtime/PUBLIC table or column authority, and exactly six fixed functions are live. Exact main `ea19fa0ace85dd61868667022c45afb3cf3218fa`, CI `31716577153`, and guarded migration run `31717354633` applied only `20260810172000_force_stripe_webhook_event_rls`; migration status, global grant/RLS audit and FORCE-only ledger proof passed with zero reservation-successor rows. After the accepted credential recovery sealed at `7bf07801152962eca4d3e5e3a0cfe9cb5b88ba89`, the final exact pooled-runtime postflight passed read-only with `productionChangedByPostflight=false`. Retain `docs/database-credential-exposure-recovery-20260813.md`. Connect v2 signed delivery and live-mode provider proof remain mandatory launch gates, not database-authority gaps |
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
   CheckoutStockReservation compatible authority, source-consistency
   successor, app deployment/smoke, predecessor drain, policyless Phase A,
   posture-only FORCE and both actual pooled-runtime proofs are complete. Then
   continue `SellerPayoutEvent` as the next separately reviewed service-ledger
   activation. Its domain audit, compatible candidate and zero-row/zero-anomaly
   production inspection and compatible production preparation are complete;
   the converted app is deployed with predecessor CRUD retained. The
   disposable linked-seller proof is accepted from exact main
   `854233e3b8729da60c0da46ff8af492e53e48438`, CI `32552336641`, with exact
   retry stability, complete temporary-row/account cleanup and only the
   processed test-mode webhook lease retained. The zero-direct-access proof is
   CI-enforced and the exact-ID predecessor drain passed from exact main
   `9947a9e485a686dc801befcdea285cddc5b3aff7`, CI `32583228592`, preserving the
   current deployment, aliases and health. The byte-pinned, restart-scoped
   activation release passed exact-main CI `32608753825`. The stale
   Notification cross-release payout fixture
   exposed by run `32608753821` was corrected at exact main
   `d9518f5545fac722f208d12fcdc48be41ec89d97`; exact-main CI `32610218785` and
   Notification FORCE proof `32610218792` passed. Restart-safe Production
   Migrations wiring merged at exact main
   `af56bf99c4eac4366b6bcecbabaabd84992f0e62`; CI `32611954204` passed.
   Dispatch `32659750056` failed closed before Prisma or mutation because the
   SellerPayoutEvent authority successor remained visible to the strict older
   reservation FORCE tree seal. The ordering correction merged at exact main
   `bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`; exact-main CI `32663849012`
   passed. Guarded migration run `32667518275` applied only the reviewed
   activation, converged grants, and passed migration/global audit plus exact
   scope. The separate actual pooled-runtime read-only postflight passed with
   evidence SHA-256
   `01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de`.
   SellerPayoutEvent Phase A is complete. Exact main
   `0eb360b9878698f45288ac3c1649871de9a8a33c`, CI `32672008187`, and guarded
   run `32672434812` applied its posture-only FORCE successor and passed the
   owner-side migration/global/exact-scope proofs. Exact main
   `fb350c31772938ef52ef796c61bf670d9cf0750e` then passed CI `32675227286`,
   and its distinct actual pooled-runtime FORCE postflight passed all nine
   engine-read-only checks with evidence SHA-256
   `f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
   SellerPayoutEvent is accepted `RLS_LIVE_FORCE`; begin the next remaining
   table only after its own fresh domain audit.
   See
   `docs/seller-payout-event-pre-rls-audit.md`,
   `docs/seller-payout-event-compatible-authority-release.md` and
   `docs/seller-payout-event-compatible-app-conversion.md` plus
   `docs/seller-payout-event-predecessor-drain.md`,
   `docs/seller-payout-event-activation-release.md` and
   `docs/seller-payout-event-activation-production-wiring.md`; keep Order,
   OrderItem, quote and payment as later separate audits. Keep Connect v2 plus
   live-mode provider topology and
   signed delivery as distinct mandatory launch gates; the v2 route shares the
   fixed lease functions and does not reopen the Phase-A database boundary.
7. Continue the remaining matrix groups separately. Order/payment/shipping
   retains high sensitive-data priority; Cart/CartItem,
   SavedBlogPost, aggregate/fanout, public/private split and service-ledger
   groups remain required and must not be silently dropped or bundled into the
   messaging activation.
