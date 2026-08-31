# Grainline Architecture

Last updated: 2026-08-30

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
`StripeWebhookEvent`, `CheckoutStockReservation`, `SellerPayoutEvent`,
`OrderRefundReconciliation`, and `OrderPaymentEvent`. Fourteen tables have
production RLS: thirteen have complete retained `FORCE ROW LEVEL SECURITY`
acceptance, while `OrderPaymentEvent` has complete policyless Phase-A
acceptance and awaits its separate posture-only FORCE release. Private
`OrderRefundReconciliation` is FORCE-hardened with zero direct runtime CRUD;
its distinct actual pooled-runtime proof passed from exact main
`5d3b402317084d9d2af6b8bdf52300a800eda0d8` after CI `32795444295` without
mutation. Retain sanitized evidence SHA-256
`ecb1ce1b1f4dd6fa2ad62e23882c16f6021be6ed42698b54a663ca11bd236f10`.
`SellerPayoutEvent` FORCE was
applied by guarded run `32672434812`; exact main
`fb350c31772938ef52ef796c61bf670d9cf0750e` passed CI `32675227286`, and its
distinct actual pooled-runtime FORCE postflight passed all nine checks without
mutating production. Retain sanitized evidence SHA-256
`f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
DirectUpload,
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

Buy Now recovery is buyer/listing-scoped. A response may be lost after the
fixed reservation statement consumes the final unit, so an exact retry checks
the already-published ready Redis lock before treating the resulting zero stock
as a new-attempt rejection. Modal re-entry uses an authenticated private/no-
store resume route that derives the lock key from the current buyer, rechecks
all mutable listing and seller orderability state except the stock held by that
same reservation, retrieves the exact Stripe Session, and returns a client
secret only when lock payload, Session identity, metadata, mode, status and
secret agree. New or payload-different attempts still pass through the normal
stock checks and the database reservation function; this recovery path does not
create, mutate or directly read CheckoutStockReservation rows.

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
separate owner/runtime logins. The first guarded production dispatch,
`32659750056`, failed closed before Prisma because the later SellerPayoutEvent
authority migration was not isolated from the older CheckoutStockReservation
FORCE tree seal. The corrected dependency order merged at exact main
`bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`; exact-main CI `32663849012`
passed. Guarded migration run `32667518275` then applied only
`20260822180000_enable_seller_payout_event_rls`, converged the reviewed grants,
and passed migration status, the global grant/RLS audit, and exact activation
scope. The separate actual pooled-runtime acceptance postflight passed inside
an engine-attested repeatable-read/read-only transaction and records no
production mutation. Its sanitized mode-`0600` evidence SHA-256 is
`01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de`.
SellerPayoutEvent Phase A remains accepted. Exact main
`0eb360b9878698f45288ac3c1649871de9a8a33c` passed CI `32672008187`, and
guarded run `32672434812` applied only the separate posture-only FORCE
migration, converged grants, and passed migration status, the global audit and
exact FORCE scope. The catalog is therefore FORCE-hardened. The separate
postflight package merged at exact main
`fb350c31772938ef52ef796c61bf670d9cf0750e`; CI `32675227286` passed the full
release chain and production build. Its actual pooled-runtime postflight used
the separate `--post-force` mode and passed all nine engine-read-only checks,
including direct denial and the fixed writer's SQLSTATE `25006` fence. It
reported `productionChangedByPostflight=false`; sanitized mode-`0600` evidence
SHA-256 is
`f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
SellerPayoutEvent is accepted `RLS_LIVE_FORCE`. The accepted Phase-A artifact
remains distinct and cannot be reused. See
`docs/seller-payout-event-activation-production-wiring.md` and
`docs/seller-payout-event-force-release.md`.

`OrderPaymentEvent` Phase A is accepted from exact main
`aec47e6a104f1fa54b6ee0e894751850d51390ec`, CI `33361381594` and guarded
migration run `33358695448`. Its distinct pooled-runtime postflight passed
inside an engine-attested repeatable-read/read-only transaction with zero row
export or production mutation. Retain sanitized mode-`0600` evidence SHA-256
`d4acc792856d0a3260cff9d597a27d6335650b2820536175f4f725185e7c7bfd`.

The current payment-ledger boundary is `OrderPaymentEvent`; see
`docs/order-payment-event-pre-rls-audit.md`. It remains a separately released,
policyless service ledger rather than a participant-readable table. The audit
pins 34 current semantic application surfaces and requires sanitized buyer/seller
projections, generation-fenced seller and blocked-checkout refund operations,
canonical latest-per-dispute ordering, append-only/taxonomy invariants and a
fresh production aggregate inspection before activation design can proceed.
The prepared refund authority now separates database-derived claim acquisition
from one atomic fixed record/finalize operation. A failed webhook retry may
hand an existing claim only to a later active generation for the identical
event, Checkout Session, Order, amount and idempotency scope. See
`docs/order-payment-event-refund-claim-generation.md` and
`docs/order-payment-event-refund-record-authority.md`. The compatible stack is
merged, byte-pinned and accepted in the production database. The signed
refund/dispute, blocked-checkout, seller-refund and staff-Case proof families
are accepted.
Exact main `513053dc6f2f6fb527f85e45fe3a18a8317fa701`, CI
`33295803412`, inspection `33296114340`, invariant run `33296358390` and
read-authority run `33296422900` additionally established the append-only
database invariants and five bounded read projections. Its actual pooled-runtime
postflight passed without mutation. The aggregate-authority migration is also
accepted: its two database-maintained, anti-forgery Order projections replace
all 15 eligibility/aggregate ledger reads and its parent lock fixes the
verified-review/refund race. The aggregate and transition authority migrations,
actual pooled-runtime proofs, converted application release and bounded
authenticated smoke are now accepted. Exact source
`ce7550dae6c417440230f4d596f2239393075f31` is READY as current deployment
`dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc` behind all four canonical aliases; retain
smoke evidence SHA-256
`9d0eacbf1062d8f2b370655d91e1f0e817a4a44edf4456d71a31c578cb07ab11`.
The converted tree has removed all ordinary-runtime base-ledger consumers in
favor of fixed database authority, but that fact remains a separate
zero-direct-access gate rather than a smoke claim. A complete 2026-08-30 Vercel
inventory corrected the earlier single-predecessor assumption: the accepted
credential epoch contained one current plus 11 superseded READY Production
deployments. Exact main `6ce4932adaa4d6b651a2a902d8e731aaad08e259`,
CI `33332817851` and the restart-safe production operator removed all 11 exact
IDs oldest-first and finished with zero shared-credential predecessors while
preserving the current deployment, four aliases and health. Retain sanitized
mode-`0600` evidence SHA-256
`1596ad71479f7a9bda51b00c94b3ac27bea6adf6a5454eb34e03c35618764e5d`. See
`docs/order-payment-event-transition-authority.md` and
`docs/order-payment-event-credential-epoch-drain.md`. Zero-direct-access,
policyless ENABLE and posture-only FORCE remain distinct release boundaries;
the drain does not itself prove ordinary-runtime table isolation.
The zero-direct-access gate is accepted at exact main
`d7bba0ef2a96ea13163e844979107b4bf2779f62` and CI `33336651230`. Its
repository-wide verifier scans all tracked application source and pins the
complete `OrderPaymentEvent` reference inventory: seven fixed-authority
consumers, 12 reference files and five fixed database operations. The
read-only production proof re-attested the drained deployment epoch, aliases
and health and found zero direct table access in both deployed and operator
trees. Retain mode-`0600` evidence SHA-256
`6298a1dc376bec73f2abcb896d54913815e155717cd004596b622b6439208590`.
This is application-authority evidence only; policyless ENABLE/direct-grant
revocation and FORCE remain separate. See
`docs/order-payment-event-zero-direct-access.md`.
The policyless Phase-A activation described in
`docs/order-payment-event-activation-release.md` is accepted production state.
The byte-pinned migration changes no row, creates no policy or function,
enables RLS with explicit `NO FORCE`, revokes ordinary-runtime/PUBLIC table
authority and retires runtime execution of two unused predecessor entry points.
The final source-composed authority catalog has exactly 29 functions: 16
retained runtime operations and 13 private operations after activation. CI
proved direct table denial and rollback/restoration through a distinct
restricted login before merge, and the actual pooled-runtime production
postflight then closed Phase A. The later posture-only FORCE remains separate;
`Order`, `OrderItem` and `OrderShippingRateQuote` are not bundled.
The blocked-checkout finalizer uses one owner-private mutation core with no
runtime or PUBLIC execute. Normal signed delivery reaches it through an exact
active-webhook-lease wrapper. If the webhook failed and released its lease,
only a distinct wrapper bound to one immutable current-ADMIN reconciliation
row may reach the core; that wrapper derives and locks the source event and
generation, requires the failed inactive state, finalizes the refund, and marks
the event processed in the same database transaction. This split avoids both
fabricating a signed lease for staff recovery and granting runtime direct core
authority. Provider refund/reversal fields remain authenticated application
evidence rather than database-cryptographic Stripe proof.
The same reconciliation ledger is also the sole database-derived exception
when a seller becomes banned or soft-deleted after Stripe authorization but
before the first local seller-refund record. The existing seller-record and
Case-apply function identities remain the boundary; callers cannot choose a
reconciliation row or recovery target. The database holds shared locks on the
immutable reconciliation and its current ADMIN author until the atomic
finalizer commits, so an administrator posture change cannot race the gate.
It also records the launch-safe refund contract: seller self-service supports
full cancellation/refund, while partial refunds remain staff Case operations
until the Order model can represent residual line-item fulfillment. Shipping
quotes, Order and OrderItem remain later separate releases. The compatible
seller application boundary and the required future partial-refund feature
model are recorded in `docs/order-payment-event-refund-contract.md`. Current
Stripe dispute consumers share the latest-per-dispute SQL family documented in
`docs/order-payment-event-dispute-state.md`. The isolated signed-webhook
candidate adds the typed provider clock and source-bound refund/dispute
operations; equal-second differences, including signed event-type differences,
retain evidence and mark staff reconciliation without Case or Notification
effects. It is byte-pinned and passes disposable PostgreSQL authority and
concurrency proof. Its database authority, distinct actual pooled-runtime
compatible postflight and converted application are accepted in production,
but live Stripe/refund/Case replay proof is still required and this is not
`OrderPaymentEvent` RLS activation evidence. See
`docs/order-payment-event-signed-authority-design.md`.

Provider acceptance is split by authority family: signed Stripe
refund/dispute delivery, seller self-service full refund, blocked-checkout
recovery and staff Case refund each receive an independent restart-safe live
proof. The prepared signed-family operator uses two private disposable Orders,
retains only processed webhook replay leases and removes every temporary
application row under live foreign-key inspection. No single family proof is
activation evidence for the others; see
`docs/order-payment-event-signed-production-proof.md`.

The next compatible database layer is the byte-pinned append-only invariant
release in `docs/order-payment-event-invariants.md`. Six validated constraints
bind taxonomy, amount, currency, bounded text/metadata, signed/local source
families and immutable timestamps. Three fenced triggers bind inserts to a
locked parent Order, prohibit payment-row update/delete and freeze Order
currency after evidence exists. The parent lookup is intentionally `VOLATILE`:
the real PostgreSQL proof makes a currency UPDATE wait on a concurrent insert,
then requires the awakened UPDATE to observe the committed payment and fail.
This release keeps predecessor runtime CRUD and RLS-off posture for deployment
compatibility; actor projections, drain, policyless ENABLE and FORCE remain
separate stages.

The distinct seller-route acceptance contract is recorded in
`docs/order-payment-event-seller-refund-production-proof.md`. It uses the
retained operational Clerk canary with a temporary vacation-mode seller
profile and a disposable Stripe test destination account; no real seller is
impersonated. One full refund must produce both the local source-bound record
and its signed `charge.refunded` confirmation without duplicating stock, Case,
Notification or outbox effects. Cleanup retains only the processed signed
webhook lease and immutable provider/observability evidence.

The distinct staff Case-refund acceptance contract is recorded in
`docs/order-payment-event-case-refund-delivery.md`. It exercises the normal
origin, Clerk session, current staff role, session-bound Admin-PIN, rate-limit,
fixed prepare/provider/finalize and signed-webhook boundaries. Its operational
canary remains an ordinary `USER` except for short, `finally`-guarded windows
around PIN verification and the authenticated API call; the raw PIN is
loopback-only and memory-only. The restart journal, `restore-canary` recovery,
private vacation-hidden fixtures, exact 500-cent refund/475-cent reversal and
cardinality-checked cleanup are independently tested. Merge or preparation is
not provider acceptance and does not authorize `OrderPaymentEvent` RLS.

Automatic blocked-checkout refunds use the same durable participant-delivery
class as other refunds: one `REFUND_ISSUED` in-app row plus one deterministic
`refund_issued` EmailOutbox reservation commit with the fixed payment
finalizer. The source-bound Notification owner function temporarily accepts
the predecessor `NEW_ORDER` spelling only for mixed-deployment compatibility,
but canonicalizes that input to `REFUND_ISSUED` before preferences, replay-key
derivation and storage so a retry crossing deployments cannot create a second
row. The retirement migration follows predecessor drain. See
`docs/order-payment-event-blocked-checkout-refund-delivery.md`.
Its production compatibility runner reads the five-migration
`OrderPaymentEvent` prefix, the candidate ledger, Notification FORCE
table/policy grants and the exact private-core/order-wrapper bodies in one
repeatable-read/read-only snapshot. It accepts only absent-candidate or exact
applied-candidate restart state and does not reuse the broad runtime-role
provisioner for this function-body-only successor.

The distinct live acceptance operator is
`scripts/order-payment-event-blocked-checkout-production-proof.mjs`: it creates
the Session through the authenticated production checkout route, moves only a
synthetic seller into vacation mode after Session creation, and requires real
Stripe Embedded Checkout plus signed completion/refund delivery. Its private
restart journal separates `prepare`, hosted `onboard`, expired-attempt `renew`,
loopback-only `serve`, automatic `verify`, failed-proof `reconcile` and unpaid
`cleanup`; a paid attempt cannot be discarded through the abort path, and
manual reconciliation cannot emit acceptance evidence.
The operational canary preference/terms mutation uses an exact row lock and
original/proof-fenced snapshot checks so cleanup cannot overwrite concurrent
account changes. Timestamp-without-time-zone fields remain lossless database
text until PostgreSQL performs the exact comparison and restoration.

Destination-transfer identity is a required refund-authority input, not an
optional observability field. Stripe may make a paid PaymentIntent and Charge
visible before the destination transfer appears on an expanded response. The
checkout webhook therefore performs only a short bounded reread; if the exact
transfer remains absent, it fails the signed event for provider retry instead
of classifying the refund as platform-funded. Before the blocked-checkout
refund claim, the provider-derived transfer is durably bound by
`grainline_blocked_checkout_transfer_bind` under the exact active
`StripeWebhookEvent` generation and paid Order/Session/PaymentIntent/Charge.
The function cannot first-bind after any refund claim or record. The failed
test-mode acceptance run and its separately fenced reconciliation cannot
substitute for the required fresh automatic proof; see
`docs/order-payment-event-blocked-checkout-refund-delivery.md`.
The additive binding migration has its own exact-main/CI guarded runner and
read-only restart verifier. Until that dedicated release applies it, the
generic Production Migrations runner removes it from the filesystem before
`migrate deploy` and restores it only after status and global grant auditing.
Once applied, the same verifier requires its exact ledger checksum and exact
runtime-only function catalog. This prevents migration visibility from
silently broadening authorization.

Signed refund identity is likewise provider-optional but not
caller-authoritative. Under the pinned Stripe shape, `charge.refunded` may omit
the nested refund collection while still signing the charge and cumulative
refunded amount. When that occurs, the fixed refund function may derive the
refund ID only from exactly one co-committed local refund ledger and audit that
agree with the locked Order, amount, currency and one of the seller, staff-Case
or blocked-checkout actions. Missing, duplicate or mismatched evidence remains
external; historical fallback rows are replayable but never rewritten. This
compatible successor is documented in
`docs/order-payment-event-signed-refund-identity.md` and must precede another
automatic paid proof. It changes no function signature, RLS posture or table
grant.

Self-service
account exports use the distinct refund-only buyer/seller projections recorded
in `docs/order-payment-event-account-export.md`; raw provider and reconciliation
fields remain private service evidence.

The compatible fixed-read successor is defined in
`docs/order-payment-event-read-authority.md`. Participant pages batch at most
100 Order ids into buyer- or durable-seller-bound refund outcomes; account
exports use distinct immutable keyset pages; staff receives a 25-row timeline
with four selected accounting fields rather than arbitrary metadata. UTC epoch
millisecond cursors cross the PostgreSQL/Node boundary. These are additive
owner-executed fixed projections with pinned search paths and runtime-only
EXECUTE; the server-resolved Clerk actor remains an explicit application trust
boundary. No generic event lookup is introduced. Exact main
`07eb9fc57bcec4d2fbac4d9ffc58b814ff78f5a8` is live as READY deployment
`dpl_7UeENeZebXL9yL481DWrXkDpWd4R`; predecessor table CRUD and the prior
READY deployment remain until the remaining semantic consumers convert and a
separate drain is accepted.

The OPE-A03 concurrency correction is prepared in
`docs/order-payment-event-refund-claim-generation.md`. It adds an Order-owned,
database-derived claim ID/generation/source/idempotency tuple for seller and
blocked-checkout full refunds. The exact active tuple fences success, orphan
and ambiguous writes; stale-lock cleanup, signed `charge.refunded` handling and
terminal dispute handling cannot detach it by elapsed time. The real migration
runs in disposable PostgreSQL and is byte-pinned after the SellerPayoutEvent
FORCE predecessor. It is merged, production-applied and used by the compatible
production application, but is not RLS activation evidence. The restart-safe
compatible runner checks every applied prefix,
live function-body hash and catalog boundary before applying the missing suffix;
see `docs/order-payment-event-compatible-production-preparation.md`. `Order`
and `OrderPaymentEvent` retain predecessor direct runtime CRUD throughout this
preparation.

The completed activation design used policyless ENABLE first and FORCE later.
Phase A removes all ordinary-runtime and PUBLIC table/column authority while
retaining only the exact source-consistent fixed-operation catalog. The final
29-function catalog contains 16 runtime-callable and 13 runtime-private
functions; the latter includes two unused legacy creation functions that
remain installed for database-first rollback with ordinary-runtime EXECUTE
revoked. The accepted rollback application uses their source-consistent
successors. The global
grant-audit disposition, database-first rollback, direct-denial proof and
actual pooled-runtime read-only postflight are accepted production evidence.
Retain Phase-A evidence SHA-256
`d4acc792856d0a3260cff9d597a27d6335650b2820536175f4f725185e7c7bfd`;
the separate FORCE release must generate its own evidence.
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

Checkout uses Stripe Checkout Sessions and local lock/idempotency state. Destination-charge accounting keeps platform tax handling and seller transfer math explicit. Order, payment event, refund, dispute, label, and case state transitions must be idempotent and race-aware. Full refunds restore eligible in-stock inventory automatically before buyer handoff; seller and staff partial refunds restore inventory only through explicit bounded quantities validated against purchased in-stock order items. The launch fee is 5% of item subtotal; application callers share `calculateCheckoutAmounts()`, while the prepared database refund finalizers independently validate that same frozen contract. Because historical Orders do not yet persist their checkout-time fee/transfer snapshot, changing the fee requires that snapshot plus successor fixed functions before the rate changes; applied migrations remain immutable.

### Messaging

Conversations are participant-scoped, with specific staff/admin exceptions only where intentionally implemented. Listing context attached to conversations must be visible and valid for the parties.

### Uploads

Write paths must persist only first-party Grainline media URLs, and new user-submitted upload URLs must be scoped to the current uploader's R2 key segment and expected endpoint. Edit paths may preserve existing DB-owned media rows/fields for legacy compatibility, but hidden fields must not let one signed-in user attach another user's public Grainline media URL. Image upload routes validate MIME/size/count rules, strip image metadata where applicable, verify object availability, and clean up failed writes. Direct-to-R2 PDF/video uploads are tracked in `DirectUpload` from presign through verify, claim, and cleanup so abandoned successful uploads can be deleted without bucket listing. DirectUpload cleanup is isolated from the ordinary Vercel runtime: the compatible retirement removed its route and schedule before FORCE RLS, and the dedicated GitHub worker remains unscheduled until the restricted cleanup-role postflight is accepted. Chat/file upload paths have different friction than profile/listing image paths.

### Email And Notifications

Notifications respect preference keys and deduplication helpers. Time-critical transactional emails reserve deterministic email-outbox rows before the direct-send fast path, and retryable provider sends use the outbox dedup key as the provider idempotency key. Refund finalizers co-commit their source-validating participant Notifications and deterministic email reservation with the local financial/Case transition; Stripe remains outside PostgreSQL and the outbox worker is the recoverable delivery boundary. Bulk/non-critical sends use the email outbox directly.

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

- 114 API route files and 65 Prisma models create a broad authorization and
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
