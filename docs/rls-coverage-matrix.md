# Grainline RLS Coverage Matrix

Last updated: 2026-08-27

## Purpose And Scope

This is the schema-complete disposition ledger for Grainline's site-wide
database isolation program. Snapshot scope: 65 Prisma models.

`SavedSearch`, `Notification`, `Conversation`, `Message`, `DirectUpload`,
`DirectUploadReference`, `Case`, `CaseMessage`, `CaseMessageAttachment`,
`StripeWebhookEvent`, `CheckoutStockReservation`, `SellerPayoutEvent`, and
`OrderRefundReconciliation` have complete retained FORCE acceptance. These are
all thirteen tables in this snapshot with completed production RLS acceptance.
SellerPayoutEvent closed its distinct actual
pooled-runtime FORCE postflight from exact main
`fb350c31772938ef52ef796c61bf670d9cf0750e` after CI `32675227286` passed;
sanitized evidence SHA-256 is
`f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
`OrderRefundReconciliation` closed its distinct actual pooled-runtime proof
from exact main `5d3b402317084d9d2af6b8bdf52300a800eda0d8` after CI
`32795444295`; sanitized evidence SHA-256 is
`ecb1ce1b1f4dd6fa2ad62e23882c16f6021be6ed42698b54a663ca11bd236f10`.
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
| `OrderPaymentEvent` | `COMPATIBLE_PREPARATION_LIVE` | Order, payment and shipping | Append-only payment/refund/dispute service evidence; signed Stripe, seller/staff refund authorities, bounded buyer/seller/staff projections and aggregate jobs | Dedicated audit pins 26 semantic application surfaces and selects policyless ENABLE then FORCE with zero direct table authority. The compatible production stack now covers launch-safe full-refund semantics, canonical dispute consumers, refund-only export projections, UTC generation-fenced claims, restart-safe blocked-checkout handoff, atomic record/finalize plus participant delivery, two source-bound signed refund/dispute operations, evidence-bound ambiguous provider reconciliation, database-derived first-write recovery if the original seller becomes banned/deleted, and atomic staff Case finalization with durable buyer/seller Notification plus email-outbox reservation. Recovery reuses exact source-validating functions and adds no caller-controlled target or generic runtime operation. Exact main `8f4cf2df34a9f700adebc910107ac2dbb878054a`, CI `32792800761`, inspection `32793276224` and guarded run `32793394895` applied all five migrations and proved RLS remains off with predecessor CRUD retained. Exact main `5d3b402317084d9d2af6b8bdf52300a800eda0d8`, CI `32795444295`, and its actual pooled-runtime postflight accepted the prepared catalog and boundaries without mutation. Exact main `a09827e0a641ec2f7e228520661cd7e74625bb0d` is deployed as `dpl_8FMq11zfZT166Dve7Vf6sTJTXFzX`; blocked-checkout delivery and transfer-binding compatibility are live while RLS remains off. The first genuine paid automatic proof exposed a destination-transfer visibility race and was not accepted. Its exact 541-cent refund and 475-cent transfer were reconciled once, all temporary fixtures were removed, and sanitized evidence at SHA-256 `d3a6ab9a109de1d607920e72ec92ba8811c3971104f079cde7e8525c504ba4f7` explicitly records `automaticProductionProofPassed=false`. Guarded run `33176428000` applied the exact signed-refund omitted-identity successor; its original final scope failed only on obsolete predecessor-body proof composition. PR #303 merged as exact main `4ea201c411afd5e065200f81dbbf18d9dd5044d1` with CI `33190374131`; restart-safe run `33194758799` skipped migration replay and passed status, the global audit and corrected final scope. The distinct pooled-runtime postflight passed with sanitized evidence SHA-256 `7849c8383164ae46d94bd8522710c8dbfdd1037da1e23281db1c3ef3e5b9e477`, so signed-refund compatibility is accepted with RLS off and predecessor CRUD retained. The first genuine signed-dispute delivery then failed closed before side effects because the predecessor admitted synthetic `dp_` identifiers while Stripe uses canonical `du_`; the exact journal is preserved, success evidence is absent, and the isolated byte-pinned correction changes only that predicate with grants and RLS posture unchanged. Remaining gates are applying and accepting that correction, resuming the same signed-dispute proof, a completely fresh automatic paid blocked-checkout proof, the other authority-family live proofs, append-only/taxonomy/currency/source invariants, actor-safe projections/aggregates, predecessor drain and separate ENABLE/FORCE releases. Do not bundle quote, Order or OrderItem activation. See `docs/order-payment-event-pre-rls-audit.md`, `docs/order-payment-event-compatible-production-preparation.md`, `docs/order-payment-event-refund-contract.md`, `docs/order-payment-event-dispute-state.md`, `docs/order-payment-event-account-export.md`, `docs/order-payment-event-refund-claim-generation.md`, `docs/order-payment-event-refund-record-authority.md`, `docs/order-payment-event-blocked-checkout-refund-delivery.md`, `docs/order-payment-event-case-refund-delivery.md`, `docs/order-payment-event-signed-authority-design.md`, `docs/order-payment-event-signed-refund-identity.md`, `docs/order-payment-event-signed-dispute-identity.md` and `docs/order-payment-event-refund-reconciliation.md` |
| `OrderRefundReconciliation` | `RLS_LIVE_FORCE` | Order, payment and shipping | Immutable private evidence for manual classification of generation-fenced ambiguous refunds; current ADMIN plus fixed service functions only | Guarded run `32793394895` created the table as policyless ENABLE plus FORCE with zero direct runtime/PUBLIC CRUD and one immutable trigger. Four source-bound runtime operations derive the active claim, constrain the 23/25-hour provider evidence window, co-commit the exact Admin audit, and let only an exact immutable reconciliation finalize a failed blocked-checkout event after its lease is cleared. A byte-sealed successor also lets the existing seller-record and Case-apply functions derive the same exact authority when the original seller became inactive before the first local commit; no reconciliation identity is caller-supplied. Exact main `5d3b402317084d9d2af6b8bdf52300a800eda0d8` passed CI `32795444295`; its distinct actual pooled-runtime postflight proved policyless ENABLE plus FORCE, zero direct runtime/PUBLIC authority, the exact 14-function ACL/body catalog and direct private-table/helper denial without mutation. Retain sanitized mode-`0600` evidence SHA-256 `ecb1ce1b1f4dd6fa2ad62e23882c16f6021be6ed42698b54a663ca11bd236f10`. See `docs/order-payment-event-refund-reconciliation.md` |
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

The dated `OrderPaymentEvent` updates below are the authoritative current gate
state and supersede earlier inline chronology in its matrix summary.

> **OrderPaymentEvent superseding gate update (2026-08-26):** the
> blocked-checkout delivery compatibility migration and corrected application
> are live, and the real authenticated provider proof reached a genuine paid
> test Session. That run failed acceptance because the buyer refund succeeded
> before Stripe's destination transfer became visible to the webhook, leaving
> the exact 475-cent test transfer unreversed and the Order transfer field null.
> The failed fixture and private journal are preserved. The additive
> transfer-binding correction, separately classified test-fixture
> reconciliation and a completely fresh automatic proof now precede
> predecessor drain or `OrderPaymentEvent` ENABLE/FORCE. Manual reconciliation
> is cleanup evidence, never activation evidence. See
> `docs/order-payment-event-blocked-checkout-refund-delivery.md`.
> The correction is now byte-pinned and guarded by a dedicated exact-main/CI
> production runner plus an engine-read-only absent/exact-applied restart
> verifier. The generic migration runner conditionally isolates it while
> unapplied. Final head `a092e4a4bf1608ab1e7231633db3da36d2fbd391`
> passed exact-head CI `33046657108` and merged as exact main
> `ea12d220b9809ac113e9d79c7e8996e103d8d641`, whose CI `33088415834`
> also passed. At that checkpoint the migration remained unapplied, the
> corrected app remained undeployed, and the preserved failed-proof fixture
> remained unchanged. Guarded run `33106083900`
> subsequently applied only the transfer-binding migration; migration status
> and the global grant/RLS audit passed. Its final read-only proof exposed a
> verifier-only dollar-quote boundary-newline mismatch after all security-
> relevant catalog fields matched. Correction head `8bd52c006a8637d6bf6009eb38212154541ab91d`
> merged as exact main `9736957e0700e1c41e3319148daa63a1d8f17602`;
> exact-main CI `33108121631` and restart-safe guarded production run
> `33109482365` passed. The restart classified exactly
> `transfer-binding-compatible`, skipped migration deployment, and passed final
> migration status, the global grant/RLS audit and corrected engine-read-only
> scope proof. The migration is accepted. Deployment, preserved-fixture
> reconciliation, predecessor drain and `OrderPaymentEvent` ENABLE/FORCE remain
> separate later gates. PR #292 merged the accepted record as exact main
> `a09827e0a641ec2f7e228520661cd7e74625bb0d`; CI `33110954923` passed and
> deployment `dpl_8FMq11zfZT166Dve7Vf6sTJTXFzX` reached `READY` with exact
> source metadata, canonical aliases and healthy runtime status. The post-
> deployment engine-read-only proof remained `transfer-binding-compatible`,
> while predecessor deployment `dpl_AJanN3zfnubB39Aj14NFziHAhfeB` remains
> `READY`. Preserved-fixture reconciliation, predecessor drain and
> `OrderPaymentEvent` ENABLE/FORCE remain separate gates.
> The first authorized reconciliation invocation from exact main
> `bfcd1ce44e66e9d68e7db498901bc513ae76dc72` / CI `33113589947`
> then failed closed before reversal, cleanup or journal mutation because its
> event rediscovery assumed Clover's `charge.refunded` charge object retained
> an embedded refund list. It does not. Read-only cross-provider proof found
> one exact signed charge event, one exact refund-created event, the durable
> 541-cent refund and the unreversed 475-cent transfer. The correction binds
> charge and refund identities independently and rejects mismatch or duplicate
> events. The fixture remains unreconciled, so fresh correction CI, separately
> reviewed reconciliation, a completely fresh automatic provider proof and
> predecessor drain still precede `OrderPaymentEvent` ENABLE/FORCE.
> PR #294 merged the event correction as exact main
> `3b11d8f95f402675bed0446cf32dd2db374603bb`; CI `33117395241`
> passed. The authorized reconciliation rerun failed closed before reversal or
> cleanup because its manual-only database predicate expected the normal
> automatic-success representation. Read-only proof found the exact preserved
> shape instead: `additional_external_refund`, null signed `latestRefundId`,
> the exact preserved-local-audit review note, and private-listing `SOLD_OUT`
> with stock one. All other checks passed and the 475-cent transfer still has
> zero reversals. The narrow correction accepts only that exact historical
> shape; automatic-proof verification stays strict. A final cleanup-path audit
> also found and corrected the shared cleanup fence: normal proof cleanup still
> defaults to exact `ACTIVE`, while only manual reconciliation requires exact
> `SOLD_OUT`; every other status fails before transaction start. Reconciliation
> remains a later separately authorized boundary after fresh correction CI.
> PR #295 then merged the correction as exact main
> `350133a9e67295e09a9238df09444326442b6585`; CI `33120674371`
> passed. Its authorized reconciliation failed before checkpoint or mutation
> because the proof required a `livemode` field that Stripe's current Refund
> object does not contain. Read-only proof confirmed the exact test Refund and
> zero reversals. The isolated class-wide correction pins `object='refund'`
> plus the exact refund ID, rejects explicit live-mode drift, and retains test
> mode through the validated test credential and surrounding Session, Charge,
> Transfer and signed Events. Fresh correction CI and authorization still
> precede reconciliation.
> PR #296 merged that correction as exact main
> `c0f706e8d92087dc51da8b1fefba976bc867296b`; CI `33127595577`
> passed. Its authorized reconciliation created exactly one idempotent
> 475-cent test transfer reversal, then failed closed before cleanup/evidence
> on the same nonexistent-field assumption for `TransferReversal.livemode`.
> Read-only proof found exactly one fully bound reversal, intact application
> rows and a mode-`0600` `reversal-pending` journal. The isolated correction
> pins the real transfer-reversal object discriminator and identity; fresh CI
> and a separate restart authorization still precede cleanup.
> PR #297 merged that proof correction as exact main
> `ad2a8546e9799a25bd77ae0dfae662da6ec2823f`; CI `33132430080`
> passed. The subsequent local restart preflight correctly refused to treat
> the prior operator-bound journal as current. The isolated restart correction
> requires the exact prior commit/CI, re-verifies old and new CI, accepts only
> `reversal-pending` with no persisted reversal identity, and requires exactly
> one existing marker-bound reversal before atomically advancing the journal
> to the current operator plus `reversal-confirmed`. It cannot create another
> reversal during rebind. Production remains unchanged; corrected restart,
> exact cleanup evidence, a fresh automatic proof and predecessor drain still
> precede `OrderPaymentEvent` ENABLE/FORCE.
> PR #298 merged that restart correction as exact main
> `c19be00957555ba09251b9a7369ba4ec11fcf431`; CI `33134429864`
> passed. The restart proved the existing reversal and advanced the private
> journal to `cleanup-started`, but the serializable deletion transaction
> rolled back after node-postgres returned `array_agg(name)` in a non-array
> representation. Read-only proof confirmed the fixture and disposable
> account remain intact and no evidence exists. The isolated correction casts
> the foreign-key catalog identifiers to `text[]`; engine-read-only production
> proof through node-postgres confirmed array decoding across all four cleanup
> roots. The same latent proof-only defect is corrected class-wide in the
> seller-refund and signed-payment operators. The restart accepts a prior-bound
> `reversal-confirmed` or `cleanup-started` journal only with the stored exact
> reversal ID; it re-proves provider and database state before atomically
> rebinding cleanup. Exact cleanup, a fresh automatic provider proof and
> predecessor drain still precede `OrderPaymentEvent` ENABLE/FORCE.
> PR #299 merged the catalog/restart correction as exact main
> `61ea7c0156838599d39ab621cdd4d93373c3c3ba`; CI `33135791154`
> passed. Its authorized restart committed the exact marker-bound database
> cleanup, restored the canary, retained both processed leases and removed the
> exact Redis keys. Stripe deleted the disposable test account, then the
> operator's redundant follow-up GET returned exact
> `StripePermissionError/account_invalid/403`; the complete test-mode account
> listing excludes the target. No evidence was written and the mode-`0600`
> journal remains `cleanup-started`. The isolated correction trusts only the
> exact successful DELETE response for the normal path and accepts restart
> absence only under the exact error plus complete-list exclusion. It re-proves
> the sole transfer reversal and accepts only the fully intact or fully cleaned
> database snapshot. Finalized reconciliation evidence, a completely fresh
> automatic provider proof and predecessor drain still precede
> `OrderPaymentEvent` ENABLE/FORCE.
> PR #300 merged that correction as exact main
> `8f31857bc6ca0f26c4965dfaae64f85089c0ede3`; exact-main CI
> `33137658339` passed. The authorized restart, also bound to prior cleanup
> journal `61ea7c0156838599d39ab621cdd4d93373c3c3ba` / CI
> `33135791154`, re-proved the exact Session, 541-cent Refund, 475-cent Transfer
> and sole reversal; accepted only zero temporary application rows, two
> processed leases and one restored canary; rechecked exact Redis cleanup and
> the reviewed deleted-account absence predicate; wrote mode-`0600`
> `reconciled-failed-proof` evidence; and removed both restart journals. Retain
> evidence SHA-256
> `d3a6ab9a109de1d607920e72ec92ba8811c3971104f079cde7e8525c504ba4f7`.
> The distinct automatic-success evidence remains absent and the evidence pins
> `automaticProductionProofPassed=false` plus
> `freshAutomaticProofRequired=true`. Therefore reconciliation is complete but
> the activation gate is not: a completely fresh automatic paid proof and
> predecessor drain still precede `OrderPaymentEvent` ENABLE/FORCE.
>
> PR #302 merged its signed-refund omitted-identity correction as exact main
> `f7491bf109a79ac7f34c29c604763c38396a7340`; CI `33149665189`
> passed. Guarded run `33176428000` applied only the reviewed migration, then
> passed migration status and the global grant/RLS audit. Its final read-only
> scope failed because the recursive predecessor proof still required the old
> signed-refund function body after the successor replaced it. Production has
> the compatible function with RLS off and predecessor CRUD retained, but the
> release is not accepted. Corrected exact-main CI, a restart-safe no-replay
> scope pass and the separate pooled-runtime postflight remain mandatory before
> a fresh automatic paid proof.
>
> PR #303 code head `55a4efe6e40dae9ea09be9146aa53d77ed723e65`
> passed exact-head CI `33178566813`, including the corrected successor-aware
> scope tests, the full disposable PostgreSQL chain, ordinary tests and build.
> Its expected Vercel Preview failure was caused only by the intentionally
> absent Preview `DATABASE_URL`. Exact reviewed merge, exact-main CI,
> restart-safe no-replay final scope and the distinct pooled-runtime postflight
> remain required; no production state changed from this validation.
>
> PR #303 merged as exact main
> `4ea201c411afd5e065200f81dbbf18d9dd5044d1`; CI `33190374131`
> passed. Restart-safe run `33194758799` classified the exact already-applied
> state, skipped migration deployment, and passed status, global audit and the
> corrected engine-read-only scope. The distinct pooled-runtime postflight
> passed from the same clean commit with sanitized mode-`0600` evidence SHA-256
> `7849c8383164ae46d94bd8522710c8dbfdd1037da1e23281db1c3ef3e5b9e477`.
> Signed-refund compatibility is accepted with `OrderPaymentEvent` RLS still
> off and predecessor CRUD retained. Fresh automatic provider proof,
> predecessor drain, remaining invariants and separate ENABLE/FORCE releases
> remain open.
>
> **Fresh automatic-proof update (2026-08-28):** exact deployed source
> `3431bb83fa16fabb9b9e18a729a7d138d48764d9`, CI `33211840251` and
> deployment `dpl_CcwbUVcaEsiVU1yscDT5fxX72P8S` completed a genuine Stripe
> test-mode payment and correct signed refund/reversal delivery. Verification
> failed closed before replay or cleanup because it still expected the old
> pre-payment hold note and `ACTIVE` status; the fixed authority correctly
> writes the canonical refund note and retains a private restored listing as
> `SOLD_OUT` with stock one. The preserved journal remains at
> `payment-completed`, automatic-success evidence is absent and production is
> unchanged. An isolated correction now pins the canonical/private outcome and
> all refund-accounting fields. Exact merge, exact-main CI and restart-safe
> resumption of this same journal remain required; no second payment is needed.
>
> PR #306 merged that correction as exact main
> `b3d11828e80723858c1e7ce59e90307f2615379f`; CI `33218192414` passed. The
> restart accepted delivery and both exact replays, then failed closed at
> `cleanup-started`: the automatic call site still inherited the cleanup
> helper's legacy `ACTIVE` default instead of explicitly requiring the private
> listing's `SOLD_OUT` status. Its serializable transaction rolled back before
> application-row deletion, Redis/account cleanup was not reached, success
> evidence is absent and the journal remains restartable. The isolated fix
> makes the automatic status explicit and adds a scoped regression so the
> separate reconciliation call cannot mask this omission. Exact merge/main CI
> and restart-safe completion remain required; no second payment is needed.
>
> **Signed-family proof update (2026-08-28):** the first signed
> refund/dispute proof ran from exact operator main
> `2836e51d0ceb91ce05756dc5138e7c337e02a503`, CI `33220013251`, against
> deployed source `3431bb83fa16fabb9b9e18a729a7d138d48764d9` and deployment
> `dpl_CcwbUVcaEsiVU1yscDT5fxX72P8S`. The genuine $5 test refund processed
> cleanly, but verification failed at `refund-event-ready` because the proof
> demanded the separately created `re_` ID even though the signed event omitted
> its nested refund list. With no prior fixed local refund evidence, production
> correctly used `external:<event-id>` under the accepted compatibility design.
> No dispute charge was created, success evidence is absent and the exact
> mode-`0600` journal is preserved. The isolated correction derives identity
> from the immutable source event and separates corrected operator/CI binding
> from the original journal/idempotency binding. Merge, exact-main CI and an
> exact restart remain required; this is not signed-family acceptance or RLS
> activation evidence.
>
> **Signed-dispute compatibility acceptance (2026-08-28):** PR #310 merged
> corrected head `d9a8069bf7422f68d01fb7499dcbfc3fe66d3da7` as exact main
> `72cac67e2b375f065a36821dcdccd76836b515df`; exact-main CI
> `33225769878` passed. Guarded production run `33227729046` started from the
> exact signed-refund-compatible predecessor, applied only
> `20260828020000_correct_order_payment_signed_dispute_identity`, and passed
> migration status, the global 65-table/179-function grant and RLS audit, and
> the final engine-read-only `signed-dispute-identity-compatible` scope.
> Runtime-only execute, predecessor CRUD and RLS-off posture are unchanged.
> Resume only the preserved `dispute-delivery-resend-pending` journal; do not
> create another payment, refund or dispute. Signed delivery/replay, bounded
> cleanup, a fresh automatic paid proof, remaining invariants/projections,
> predecessor drain and separate ENABLE/FORCE releases remain open.
>
> **Signed-provider proof acceptance (2026-08-28):** exact operator/main
> `b37246d06e65a37fd163484f07390b9044689379`, CI `33228466974`, resumed only
> the original `dispute-delivery-resend-pending` journal after compatibility
> run `33227729046`. The existing genuine `du_` event delivered, its exact
> retry was idempotent, both signed payment families verified and all bounded
> temporary application fixtures were removed. Exactly two processed webhook
> leases plus immutable Stripe test objects remain intentionally. The restart
> journal is gone; sanitized mode-`0600` evidence SHA-256 is
> `fda2a7570525fbd927498439f527584cf7724b32c075edc0136d8260290cdfaa`.
> No live money, deployment, provider configuration, grants or RLS posture
> changed. This closes the signed-provider gate only; other family proofs,
> invariants/projections, predecessor drain and separate ENABLE/FORCE remain.
>
> **Fresh automatic blocked-checkout acceptance (2026-08-28):** the distinct
> paid proof against exact deployed source
> `3431bb83fa16fabb9b9e18a729a7d138d48764d9`, CI `33211840251` and deployment
> `dpl_CcwbUVcaEsiVU1yscDT5fxX72P8S` passed the full automatic path: genuine
> Stripe test payment, 541-cent buyer refund, exact 475-cent seller transfer
> reversal, stock restoration, `REFUND_ISSUED` delivery, skipped test email and
> exact replay. Cleanup removed only marker-bound rows, Redis keys and the
> disposable account; restored the canary; revoked temporary sessions; and
> intentionally retained two processed leases. Sanitized mode-`0600` evidence
> SHA-256 is
> `dafb43dbe1de3e0b65da8a3554b465b1aaa74282ee56779f3fb34b209a6c27a7`.
> This supersedes the earlier failed-proof state as the automatic-provider gate
> result; it does not convert the historical reconciliation into success or
> authorize predecessor drain, remaining invariant/projection work, ENABLE or
> FORCE.
>
> **Seller full-refund proof correction gate (2026-08-29):** the separate
> authenticated seller authority proof remains unaccepted. Original attempt
> main `877610cbb12491d8e788e6948a3c9c31aced1e70` / CI `33231868504`
> failed before account creation on the Stripe metadata-key limit. The sole
> preserved journal then resumed through corrected operator/main
> `232f4b6f725caa193af51f214395f6019cddde63` / CI `33233774693` and
> failed at the same pre-account boundary because its legacy
> Custom/application-collected responsibility request does not match the
> platform profile. Complete read-only scans exhausted all 13 test accounts
> and found zero attempt markers after each failure; no payment or application
> fixture exists. Keep the journal at `account-create-pending`, change no
> Stripe platform setting, and resume only after the production-aligned
> Express/Stripe-collected controller plus private hosted-onboarding correction
> merges and passes exact-main CI. This does not authorize provider execution,
> predecessor drain, ENABLE or FORCE.

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
   `OrderPaymentEvent` is now the active next table. Its compatibility stack is
   live with RLS still off. The first paid blocked-checkout proof failed on a
   destination-transfer visibility race; that fixture is fully reconciled and
   removed, but its evidence explicitly remains a failed proof. The mandatory
   pre-RLS/domain audit then found that pinned `charge.refunded` payloads can
   omit the nested refund identity, causing the live signed function to
   misclassify an exact local confirmation. The isolated fail-closed successor
   is documented in
   `docs/order-payment-event-signed-refund-identity.md`. It must merge, apply
   and pass its pooled-runtime postflight before a new automatic paid proof.
   Only a completely fresh proof, predecessor drain and the remaining
   invariant/projection gates may lead to separate ENABLE and FORCE releases.
7. Continue the remaining matrix groups separately. Order/payment/shipping
   retains high sensitive-data priority; Cart/CartItem,
   SavedBlogPost, aggregate/fanout, public/private split and service-ledger
   groups remain required and must not be silently dropped or bundled into the
   messaging activation.
