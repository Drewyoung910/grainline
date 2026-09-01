# Grainline Strategy and Roadmap

Operational notes and strategic direction. AGENTS.md is the codebase contract (what is built, how it works, what must be preserved). This file is for what hasn't been built yet, why, and in what order. Update at the end of any session that produces strategic decisions.

## Immediate priorities

### Core Order audit and activation sequence (2026-08-31)

The fresh current-source audit is pinned in
`docs/order-core-pre-rls-audit.md`. `Order` is the next RLS table because it
contains the highest-risk remaining combination of buyer PII, shipping address,
provider identifiers, fulfillment, refunds, label state and staff-review data.
Activate it separately, then continue directly with `OrderItem`, then
`OrderShippingRateQuote`; these are separate releases inside one continuous
Order-domain program, not unrelated work saved for later.

The audit confirms that the compatible seller key and payment service-ledger
prerequisites are real progress. The isolated conversion chain has corrected
mutable Listing attribution, historical presentation, export scope, analytics,
pagination, participant-detail behavior and checkout receipts while reducing
the direct Order inventory to 20 source files. The unused local make-order API
was retired instead of preserving generic runtime `Order INSERT`; future paid
fixtures must use disposable databases or provider-backed proof operators.
The fulfillment audit then corrected pickup receipt authority: sellers may
announce `READY_FOR_PICKUP`, but only the buyer may confirm `PICKED_UP`, because
that timestamp starts the buyer's Case window. Buyer receipt confirmation now
also rejects unpaid Orders and open Stripe disputes and records a strict audit.
The fixed-authority conversion must preserve that split and replace the final
best-effort notification/email edge with a co-committed or restart-safe
delivery design.
The shipping-label audit found that this edge cannot reuse the generic
Notification order-family validator unchanged: that historical validator still
derives seller identity through mutable Listing ownership, while Order now
retains the immutable checkout seller in `sellerProfileId`. The label provider-
record operation must therefore own its source-bound `ORDER_SHIPPED`
Notification, preference check and deterministic deduplication in the same
database transaction. The 56-path Notification gate must count that one
database-owned emission explicitly; do not add a synthetic application helper
call merely to satisfy a callsite counter.
Staff, maintenance and write
families still remain. The checkout receipt audit also caught and corrected an
over-narrowed snapshot projection before release. Before RLS, finish actor-specific fixed projections,
keep historical snapshots canonical, convert every write and
maintenance family to a source-validating operation, rerun aggregate-only
legacy inspection, deploy and drain the compatible app, and prove the inventory
has reached zero ordinary-runtime Order access.

The target remains policyless ENABLE plus direct-grant revocation, followed by
a distinct FORCE release. Do not create broad buyer/seller Order policies, a
generic caller-directed update function, or a generic repository wrapper that
merely hides broad runtime CRUD.

### OrderPaymentEvent FORCE acceptance (2026-08-31)

OrderPaymentEvent is accepted in production as policyless ENABLE plus FORCE,
with zero policies, zero direct runtime/PUBLIC table or column authority, and
the exact 16-runtime / 13-private fixed-function partition. PR #369 merged as
exact main `6a20981b0af68f8322b6306715fc117e0826e36e`; CI `33443669979`
passed all 302 steps. Guarded run `33445073482` applied only
`20260831010000_force_order_payment_event_rls`, converged reviewed grants, and
passed migration status, the global grant/RLS audit, and exact FORCE scope.
The distinct actual pooled-runtime postflight passed ten engine-read-only
checks without mutation. Retain sanitized mode-`0600` evidence SHA-256
`d63cea7bd6a95232790aef4ecd4b279ae837bada1bad7cb80ef6aa604671eea1` and
`docs/order-payment-event-force-release.md`.

This active release chain has reached its safe recorded boundary. The deferred
repository/worktree reconciliation below is complete, and the normal root now
tracks exact current `main`. Select the next matrix row only through its fresh
domain audit. Do not infer that OrderPaymentEvent completion authorizes
bundling `Order`, `OrderItem`, or `OrderShippingRateQuote`; their participant,
PII, provider, shipping, retention, and service-write boundaries remain
separate design work.

### Repository reconciliation complete; Preview hygiene deferred (2026-08-31)

The non-destructive reconciliation completed from exact accepted main
`0780317f51504da1a5786134ff40f546e0bca733`. The normal repository root now
tracks that exact clean `main`; only it and the isolated reconciliation
worktree remain registered. Ten obsolete live checkouts were removed only
after their commits were proved main- or remote-contained and every dirty byte
was archived; nine already-missing temporary-directory records were pruned
from Git metadata. VS Code's earlier “106 worktrees” popup was stale UI state,
not deletion authority.

The former root's uncommitted audit/config/evidence material is recoverable
from named stash `64554ce2e4ca7d591a422bb9c558f3d8b0c4a7cd` and from the private mode-`0600`
archive under
`/Users/drewyoung/grainline-rollout-evidence/repository-worktree-reconciliation-20260831`.
Historical branch tips not contained in `main` remain on their exact pushed
branches and were not merged. Retain
`docs/repository-worktree-reconciliation-20260831.md` as the detailed inventory,
hash manifest and removal record.

Ordinary Vercel Preview failures remain expected because Preview has no
`DATABASE_URL`: compilation and TypeScript complete, then the runtime database
isolation guard/page-data collection fails closed. GitHub exact-head CI and its
production build remain the release gate; a red Preview is not accepted as
successful build evidence, but it also does not indicate an application
compile failure in this configuration. After the RLS chain, choose and
document one durable noise reduction path: either disable automatic ordinary
Previews, or provision lifecycle-managed disposable Neon Preview databases
with a restricted non-owner role. Never link a Preview to Production
`DATABASE_URL`, `DIRECT_URL`, an owner credential or shared production state.

### Case FORCE completion and Order/payment/shipping start (2026-08-04)

The Case-family database RLS group is complete. Exact main
`9e5d87f4c5b4a529bc84c6c2cf077778fe553186` passed CI `30951067980`;
guarded Production Migrations run `30953378226` applied only
`20260804191000_force_case_rls`; and the separate actual pooled-runtime
read-only postflight confirmed policyless ENABLE plus FORCE, zero direct
runtime table/column authority and the exact fixed-function partition for
`Case`, `CaseMessage` and `CaseMessageAttachment`. Case evidence enablement,
private R2 route smoke, cleanup scheduling, token retirement and provider
variables remain separate and disabled.

The active sensitive-data program is now Order/payment/shipping. Its audit
contract is `docs/order-payment-shipping-pre-rls-audit.md`. Treat `Order`,
`OrderItem`, `OrderShippingRateQuote`, `OrderPaymentEvent`,
`SellerPayoutEvent` and `CheckoutStockReservation` as one program with
separately sequenced production releases. `StripeWebhookEvent` isolation is a
hard service-ledger prerequisite. Do not fold Cart/CartItem, SellerProfile,
Listing or public analytics into the activation merely because fixed order
operations validate them.

The first two design decisions are pinned: durable seller authority must be
captured at checkout rather than derived from a Listing's mutable current
seller, and mixed-column Order data should use actor-specific fixed projections
instead of broad participant base-table SELECT policies. The target is
policyless ENABLE plus FORCE with zero ordinary runtime/PUBLIC table grants,
source-validating fixed writes and a protected aggregate-only legacy
inspection before any cleanup or activation. Finish the complete group before
moving to the next sensitive-data family.

The webhook prerequisite must replace ID-only stale-lease finalization with a
database-derived claim generation. A reclaimed event may be completed or
failed only by the worker holding the exact current generation; event type is
immutable after the first accepted reservation. This closes the documented
stale-worker ABA race before the webhook ledger becomes authority evidence.

The corrected aggregate-only production inspection is complete. Exact main
`8f22ebe326fa67bc3b71b8998b2f6b440ad7f69b` passed CI `30963597414`, and
protected read-only run `30963859119` reported zero structural/integrity
inconsistencies across the 54-count contract. The seven-table predecessor still
has RLS off, zero policies and broad runtime CRUD, so this is classification
evidence rather than protection. Proceed to compatible seller-key,
webhook-generation and invariant preparation; do not skip the compatible app
deployment/coexistence boundary or bundle later activation releases.

The Stripe webhook prerequisite activation design is now pinned in
`docs/stripe-webhook-event-activation-audit.md`: policyless ENABLE first,
FORCE later, zero runtime/PUBLIC table or column authority and exactly six
generation/maintenance functions. The buyer-deletion launch proof must not
retain direct webhook-table SELECT or motivate a seventh lookup function; it
uses the exact Stripe event plus an always-rollback fixed `begin` probe and
accepts only `processed`. The proof must bind a dedicated restricted-runtime
URL to an explicit non-production target before connection and then obtain
engine-attested runtime role attributes; a confirmation string alone is not a
database identity boundary. Its actual Prisma rollback behavior is covered in
disposable PostgreSQL. Compatible preparation is complete in production. PR
#161, PR #162 and the audit-only PR #163 are merged; exact main
`423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1` passed CI `31284293394`, and
guarded run `31290691183` applied only PR #162's additive
`20260805040000_prepare_stripe_webhook_maintenance_authority` migration. The
maintenance functions are live while RLS, FORCE, policies and predecessor
table grants remain unchanged. Production deployment
`dpl_67W8RkxzdQwbNTy3rmsEL6WK42D3` then promoted the exact compatible app and
passed canonical health, classic signed delivery/retry, ops-health, retention
and legacy stock-restoration smoke without migration, RLS, grant, cleanup or
provider changes.

The next isolated dependency is `CheckoutStockReservation`. Its exact access,
race and retention review is pinned in
`docs/checkout-stock-reservation-rls-audit.md`. The table is a service lifecycle
ledger, not owner CRUD: cart/single creation must derive its items and lock key
from Cart/Listing sources; signed completion must bind the exact webhook
generation and Order; stale/provider work needs a database-selected monotonic
repair claim; and checkout abort, signed expiry, cron repair and account
deletion must not share a generic restore-by-ID function. The audit also found
that an unexpected post-Stripe checkout error can restore stock while a session
remains payable, and that the deployed 32-character base64url replay hash,
64-character column and legacy hex inspector disagreed. The compatible
application now makes unexpected-error restoration contingent on confirmed
Stripe expiry and aligns the inspector to the deployed hash plus deletion
sentinel.

The compatible reservation authority is live. The application uses 15 fixed
operations covering source-derived cart/single creation, exact
bind/completion, unbound abort, signed webhook restore, distinct buyer/seller
confirmed-expiry restore, generation-fenced cron/account repair, prune,
resume, export and terminal account scrub. The database adds immutable bounded
`StripeWebhookEvent.sourceObjectId` authority, compares it to the exact
Checkout Session, locks buyer/seller User lifecycle rows in stable order and
revalidates seller orderability. Account deletion remains intentionally one
bounded batch per attempt and fails closed at scrub if active rows remain.
StripeWebhookEvent FORCE was completed as its separate earlier production
boundary before this compatible reservation release.

The additive source-consistency successor is also live in the database. Exact
main `16239fce2956c6dc726c24ccd7a91d1ea35463bd`, CI `31813433933`, and guarded
run `31814032227` applied only
`20260814053000_prepare_checkout_stock_reservation_source_consistency`,
converged the reviewed fixed-function grants, and passed migration status, the
global grant/RLS audit and the read-only exact-scope proof. This did not deploy
the source-consistent application, enable or FORCE reservation RLS, revoke
predecessor authority, clean data or change provider state. The current release
boundary is therefore app deployment and coexistence drain, followed by
policyless ENABLE with direct-grant revocation and then FORCE as separate
database releases.

The same deep review found an application-level Redis ABA race: a stale worker
could publish or remove a newer identical-payload checkout lock after TTL reuse.
Preparing locks now carry unique acquisition owner tokens, ready publication and
pre-session cleanup require that token, and post-ready cleanup requires the exact
Stripe session. Legacy tokenless preparing locks fail closed until TTL expiry.
Signed reservation completion/restoration also lock the exact active webhook
lease row before session/reservation work; merely reading a matching generation
was insufficient because reclaim or finalization could race after validation.
Lease acquisition and immutable source binding now occur in one three-argument
database call; the lower-level binder is runtime-private, avoiding both a
partial-claim gap and unnecessary generic runtime authority. The existing
two-argument begin remains only for deployment coexistence until the later
drain/revocation boundary.
That coexistence temporarily changes the live StripeWebhookEvent runtime
catalog from six functions to seven, so migration packaging must repin the
global grant/catalog proofs; the private binder must never appear as an eighth
runtime capability. Drain removes the predecessor two-argument begin again.

The provider audit found the predecessor subscription contract mixed platform
events with connected-account events. The pinned replacement has three
source-bound surfaces: platform Checkout/refund/dispute snapshots on
`/api/stripe/webhook`, classic connected-account `payout.failed` on the new
separately signed `/api/stripe/webhook/connect`, and v2 thin account events on
`/api/stripe/webhook/v2`. The compatible implementation must land and deploy
before provider configuration changes. Provider correction, one signed payout
delivery plus retry and the exact three-surface proof are complete. The
predecessor drain and hardened final pooled-runtime proof subsequently passed,
and StripeWebhookEvent policyless ENABLE plus FORCE is live. Phase A landed
from exact main `f987645784a447604fcab2399dc8e7fd7bef9d7c` in run
`31410550315`. Exact main `ea19fa0ace85dd61868667022c45afb3cf3218fa`, CI
`31716577153`, and guarded migration run `31717354633` then applied only
`20260810172000_force_stripe_webhook_event_rls`; migration status, the global
grant/RLS audit and FORCE-only proof passed with zero reservation-successor
rows. The accepted credential recovery replaced both database passwords,
proved superseded-password rejection, redeployed the unchanged application
source with the replacement runtime credential, and passed the exact
pooled-runtime FORCE postflight read-only. Connect v2 signed delivery remains a
mandatory launch/provider gate, but does not block this database-authority
release because all three routes use the same fixed lease functions and have
zero direct table access. Do not broaden the new Connect route with legacy account events
unless current linked-account evidence establishes a real compatibility need.
Human traffic being absent does not remove the old/new boundary because Stripe
retries and cron/maintenance jobs remain active.

Stripe exposes a classic endpoint signing secret only at creation, so the
provider cutover uses a disabled bootstrap rather than an impossible
"secret-before-endpoint" order. Create the Connect endpoint on the deliberately
absent `/api/stripe/webhook/connect-bootstrap-disabled` URL with only
`payout.failed`, capture the secret without logging it, immediately disable and
verify the endpoint, then install the Sensitive production variable and deploy
the compatible route while the endpoint stays disabled. Only after alias,
health and wrong/cross-secret denial proofs pass may the endpoint move to the
canonical URL and be enabled for signed delivery plus retry. If immediate
disable cannot be verified, delete the endpoint and stop. Do not use a random
placeholder secret or expose the creation response in evidence.

The activation migration must also pin the exact PostgreSQL source body of all
six functions, not merely signatures and function attributes, and its
database-first rollback must reject direct PUBLIC table and column grants both
before and after restoration. After activation, run a separate engine-attested
repeatable-read/read-only postflight using the actual pooled production runtime
credential. Keep that credential out of the owner-only GitHub Production
migration environment; local operator execution with sanitized mode-0600
evidence is the deliberate separation boundary.

### CheckoutStockReservation compatible production boundary (2026-08-13)

StripeWebhookEvent FORCE is accepted after the restart-safe database
credential recovery; its recovered pooled-runtime postflight was the
prerequisite for reservation authority. The compatible reservation migration
and fixed-operation application are now live. The shared-credential predecessor
deployment drain later completed with zero predecessors. Direct table grants
were then retired by the accepted policyless Phase-A activation. Reservation
RLS is now enabled with FORCE still pending as a separate release.

The production path is deliberately dedicated rather than reopening the
single-purpose Stripe FORCE runner. It requires successful same-commit main CI
and the corrected aggregate-only inspection, accepts only a clean predecessor
or exact completed-compatible restart state, applies
`20260810190000_prepare_checkout_stock_reservation_authority` only from the
predecessor, and finishes with migration status, global grants/RLS audit and an
exact whole-tree ledger proof. That proof byte-hashes all 194 reviewed
migrations and admits only the already-proved listing-variants alias,
DirectUpload failed-plus-corrected history, and the exact original checksum of
the numeric-guards migration that production applied before the repository
amended that file; another pending, unknown,
duplicated or checksum-drifted migration fails before Prisma can apply it. A
separate pooled-runtime read-only postflight proves the
compatible CRUD coexistence plus exact schema, trigger, index and 20-function
source/ACL catalog.

Review caught that the older inspection assumed StripeWebhookEvent was still
RLS-off with broad CRUD. Waiting run `31734121511` ran no steps and was
cancelled. The corrected gate requires StripeWebhookEvent policyless FORCE and
zero direct runtime CRUD while the six other order/payment predecessors remain
RLS-off broad CRUD; it fails when any of the seven reservation integrity counts
is nonzero. Only a fresh successful inspection from the exact eventual main
release SHA may authorize the compatible migration. After pooled-runtime
acceptance, deploy and smoke the already-merged fixed-operation application,
drain predecessor versions, then prepare reservation ENABLE and FORCE as two
separate releases. Do not bundle Order/OrderItem/payment/payout activation into
this service-ledger boundary.

First application attempt `31745337593` failed safely in the read-only ledger
scope before Prisma generation or mutation. A read-only inspection proved that
production has the exact original one-step checksum for
`20260523223000_schema_numeric_guards_and_indexes`; the file was amended in Git
about 3 hours 13 minutes after production applied it. The isolated correction
accepts only that one named original checksum and exact completed shape, with
unit and disposable PostgreSQL rejection coverage for current/near-match,
duplicate, incomplete, rolled-back and zero-step rows. It does not rewrite the
ledger or migration. Do not resume production preparation until that correction
has separate review and exact-main CI.

### CheckoutStockReservation source-consistency boundary (2026-08-14)

The first fixed-operation application still assembled checkout creation
evidence across multiple application statements before invoking PostgreSQL.
That was authority-safe but left a time-of-check/time-of-use consistency gap if
Cart, CartItem, Listing, photo or variant sources changed between the reads and
the mutation. The accepted replacement uses one fixed database statement per
checkout path: source rows are locked and validated, the reservation payload
is derived in PostgreSQL, and the application-provided canonical witness is a
rejection condition rather than write authority.

Two fresh provider slots passed through an exact disposable Vercel Preview and
Neon child with zero errors, issues or residue. Target p95 was 161.1 ms and
151.4 ms; burst p95 was 174.5 ms and 185.4 ms; candidate maximum was 187.1 ms.
The existing 750 ms p95 and 3000 ms maximum thresholds were not weakened. The
proof branch and all provider resources were deleted and must never merge.

The additive migration is
`20260814053000_prepare_checkout_stock_reservation_source_consistency` with
SHA-256 `69623f2363c6ae4978ff2cc8a22ccc1b8d9f43d378e01678c2fc6ef6f14b9928`;
the full tree SHA-256 is
`527b93f81e4b74a2cf04218d2d4b53cd8524bbb4fc9b93db6072c387bbb71e54`.
It adds three private helpers and two runtime wrappers, bringing the exact
catalog to 18 runtime operations and seven private helpers. It does not enable
RLS, create policies, revoke predecessor grants or rewrite data. The release
package, fail-closed scope verifier, CI proof and guarded migration wiring are
documented in
`docs/checkout-stock-reservation-source-consistency-release.md`.

Exact main `16239fce2956c6dc726c24ccd7a91d1ea35463bd` passed CI run
`31813433933`; guarded Production Migrations run `31814032227` then applied
only the source-consistency migration and converged the reviewed runtime
function grants. Migration status, the global grant/RLS audit and the
read-only after-scope proof all passed. The resulting state is
`source-consistent` with zero activation and FORCE rows. No application was
deployed, RLS remains off, and predecessor table authority remains available.

The separate actual pooled-runtime postflight subsequently passed from exact
clean main `ac4c9d2139f5294c5e91edd24acb3dbe71b4976c`, bound to exact-main CI
`31819848330`, migration-main CI `31813433933` and migration run `31814032227`.
It proved the compatible 25-function catalog, retained predecessor CRUD,
private-helper denial and the engine read-only write fence as
`grainline_app_runtime`, then rolled back with
`productionChangedByPostflight=false`. The database postflight boundary is
complete.

Keep the remaining boundaries separate: compatible app deployment and checkout
smoke; predecessor drain; policyless ENABLE plus direct-grant revocation; then
FORCE. Do not bundle Order,
OrderItem, payment, payout or shipping activation into this service-ledger
release.

The exact deployment-delta audit subsequently found that a Stripe Session may
be created even when its response never reaches the checkout route. The
predecessor catch treated the absent returned ID as proof that stock could be
released. Hold the compatible deployment until the isolated correction proves
one idempotency key per lock acquisition, pre-call attempt fencing, conservative
retention for unknown provider state, and signed-webhook late binding inside the
Order transaction. Older bound Sessions and made-to-order checkout without a
reservation must remain compatible. The durable decision and smoke matrix are
in `docs/checkout-stock-reservation-app-deployment-audit.md`.

The accepted correction merged through PR #209 as exact main
`84a58f0fc818b502564ef6bcd974ff4af3cc4395`; exact-main CI `31822968848`
passed all 109 gates. Manual Vercel Production deployment
`dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw` is READY on the canonical aliases and its
build guard proved the pooled runtime role. Canonical health returned 200 and
the four unauthenticated checkout/resume/rollback probes returned 401. Those
are deployment and auth-boundary evidence, not authenticated checkout proof.
The production-safe disposable checkout smoke subsequently passed from exact
main `e9d343b6f316ceb1c75553aec77e9f310a12d802`, exact-main CI
`31829740992`. It proved authenticated cart/Buy Now,
in-stock/made-to-order, retry/resume/rollback, stock restoration and three
genuine signed-expiry deliveries, then completed every bounded cleanup. The
sanitized mode-`0600` evidence SHA-256 is
`86b37f18cae8fadb8a126b548455201a7816c74f00731d13fa8a6bf2de8602db`.
Paid completion remains a distinct accounting and durable side-effect
decision and was not claimed. The separate exact-ID predecessor drain is now
complete: exact main `4ff40f22c70072406168c378cdb13860f9de317b`, CI
`31858295911`, and sanitized evidence SHA-256
`5f3b63675bdc84749b5f8fef25086bc42a5dddba5e87f5a46fa7bf6015322141`
prove zero shared-credential predecessors, preserved canonical aliases and
green health. RLS stays off and direct grants stay temporarily compatible
until the separate policyless ENABLE plus direct-grant revocation release.
FORCE remains later and separate.

### CheckoutStockReservation activation refresh boundary (2026-08-15)

All application-compatibility gates and the policyless Phase-A release for this
service ledger are now complete, so the remaining database work is the separate
FORCE posture release. Keep the model
service-only: zero row policies and zero ordinary-runtime/PUBLIC table or
column authority, with access only through the exact activated
16-runtime/9-private function partition. The two legacy creation functions stay
installed for rollback but lose runtime EXECUTE so callers cannot bypass the
source-consistent successors. Do not add buyer or seller policies that
would expose Stripe identifiers, payload hashes, repair state or checkout
locks. Keep FORCE as a later posture-only release.

The earlier production-inert activation scaffold predated the
source-consistency successor and pinned only 20 functions. The refreshed
scaffold must pin all 25 exact functions, distinguish the three SQL witness
helpers from PL/pgSQL functions, preserve database-first rollback, and prove
direct denial plus fixed-operation success in disposable PostgreSQL and again
through the actual pooled runtime after activation. The read-only candidate
builder may report exact proposed bytes but must not create a deploy-discoverable
Prisma migration. Promotion, workflow wiring, production application and FORCE
remain separate reviewed boundaries.

The refreshed candidate was promoted and merged as the exact
`20260815060000_enable_checkout_stock_reservation_rls` migration. Release PR
#218 merged exact head `1dbab12dfe52867f1df5ca8689db2e3f0ae89933` as main
`5817dea6725f7f2eb7fde3da1f546aa75dd449b1`; exact-main CI
`31892857440` passed. Production-wiring PR #219 then merged exact head
`6dec4f84afea9e817a29247f9f57cf5646cc5b8b` as main
`405d6dff327bee76aced17f3876f8f18f29e05db`; exact-main CI
`31894742120` passed. Guarded run `31903152300` applied only Phase A and passed
restart scope, grant convergence, migration/global audit and applied scope.
The separate actual pooled-runtime activation proof passed; sanitized evidence
SHA-256 is
`899679a14590200880e89d983fff70492632de458649316bd69cde9a0027ece0` and
records no production mutation. The separate FORCE boundary is now also
complete from exact main `7c033eac8b18f2c7b6837dc8caafa5d3eda47f76`, CI
`31911640477`, and guarded migration run `31912265711`. The owner workflow
applied only the posture flag and passed grant convergence, migration/global
audit and exact FORCE scope. The independent pooled-runtime FORCE postflight
passed read-only; evidence SHA-256 is
`4534d58c6a7872d7fae6169e12db56aa62414a16a5e71cad3f4e163c83752d51` and
records no production mutation. CheckoutStockReservation is complete through
FORCE; begin the next Order/payment/shipping table only after a fresh domain
logic, actor, route, job and provider-side-effect audit. Retain
`docs/checkout-stock-reservation-force-release.md` and
`docs/checkout-stock-reservation-force-production-wiring.md`.

The fresh next-table audit is now `docs/seller-payout-event-pre-rls-audit.md`.
`SellerPayoutEvent` is the smallest independent remaining service ledger and is
the next bounded release. The audit permits compatible preparation only. It
found that the mutable payout projection lacks Stripe event time, so distinct
out-of-order events can currently overwrite newer evidence; event ordering,
active-lease/source binding, explicit unknown-account results, bounded seller
projections, a fresh aggregate inspection and a linked-seller signed test-mode
proof all precede activation. `OrderPaymentEvent`, shipping quotes, Order and
OrderItem remain separate releases, and live-mode Connect signed delivery
remains a separate launch/provider gate.

The compatible release is tracked in
`docs/seller-payout-event-compatible-authority-release.md`. Exact main
`6bc89c58d7d83509f73206a2f9b4854e3bed476b`, CI `31923317475`, same-commit
read-only inspection `31923608819` and guarded production run `31923767337`
are accepted. Production now has the additive provider-event-time field,
indexes and three fixed functions; SellerPayoutEvent RLS remains off and
predecessor CRUD remains retained. The next boundary is the converted
application review, merge and deployment with old/new coexistence. That
isolated conversion is tracked in
`docs/seller-payout-event-compatible-app-conversion.md`; it replaces all three
direct consumers and makes payout notification failures retryable without
changing existing best-effort notification callers. The linked-seller signed
test-mode proof, predecessor drain, policyless ENABLE and FORCE remain separate
boundaries. Do not reinterpret the compatible preparation or app candidate as
permission to bundle the other four tables.

The converted SellerPayoutEvent application is now live at exact source
`e9239463a71860451191344b26dd20b45298f239`. The corrected linked-seller proof
from main `c221b1871ee73bbce8f092daf49536c4381cf9de`, CI `32537455244`, stopped
before mutation because neither retrievable linked Express seller had Stripe's
payout-failure test bank. Do not change a real seller's external payout account
to satisfy a rollout proof. The selected direction is one release-bound
disposable test-mode Express account plus one deterministic, vacation-mode
production User/SellerProfile canary. Remove the exact temporary rows and
account after proving signed delivery and retry, and retain only the processed
webhook lease. Preparation/proof is a new explicit mutation boundary after the
tooling passes review and exact-main CI. Predecessor drain, policyless ENABLE
and FORCE remain separate after that proof.

That replacement proof is now accepted from exact main
`854233e3b8729da60c0da46ff8af492e53e48438`, CI `32552336641`, deployed
source `e9239463a71860451191344b26dd20b45298f239` and deployment
`dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h`. It proved one real signed test-mode
`payout.failed` mapping to exactly one payout projection and one notification,
proved exact retry stability, removed the temporary User, SellerProfile,
payout, notification and disposable account, and retained only the processed
webhook lease. Sanitized evidence SHA-256 is
`8ff3c342bdc47ea5b8ebe9576c7a4de1253afa36e1a0a40798c0516cc55c3907`.
The predecessor deployment drain and zero-direct-access proof subsequently
passed; policyless ENABLE and posture-only FORCE remain later separate
releases.

The predecessor boundary is recorded in
`docs/seller-payout-event-predecessor-drain.md`. A 2026-08-22 read-only Vercel
inventory found exactly one READY current-credential predecessor:
`dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw`, source
`84a58f0fc818b502564ef6bcd974ff4af3cc4395`. Older READY artifacts predate the
accepted credential recovery and cannot authenticate with their superseded
database password. The tracked-source proof scanned 723 application files,
found the exact three reviewed fixed-authority consumers and zero direct table
access, and is wired into CI. Exact main
`9947a9e485a686dc801befcdea285cddc5b3aff7`, CI `32583228592`, permanently
removed only that predecessor and preserved the current deployment, all four
canonical aliases and health. Accepted sanitized evidence SHA-256 is
`3bb83df87df2cf2571df53ef0021e73886eca5d57140e0e8bc929eac4e2b61b1`. No
grant or RLS state changed. Prepare policyless ENABLE plus direct-grant
revocation next; keep posture-only FORCE separate. The byte-pinned activation
release merged at exact main `570aa8aa2690bcbd341ce08a9cabdcaaa8bcab3d` and
exact-main CI `32608753825` passed the complete PostgreSQL and application
gates. The cross-release Notification payout-fixture correction subsequently
merged at exact main `d9518f5545fac722f208d12fcdc48be41ec89d97`;
exact-main CI `32610218785` and Notification FORCE proof `32610218792` passed.
Restart-safe production wiring first failed closed in dispatch `32659750056`
before Prisma generation or mutation because it verified but did not isolate
the later SellerPayoutEvent authority migration before invoking the strict
CheckoutStockReservation FORCE tree seal. The correction merged at exact main
`bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`; exact-main CI `32663849012`
passed. Guarded migration run `32667518275` applied only the reviewed
policyless activation, converged grants, and passed migration status, global
grant/RLS audit, and exact scope. The distinct pooled-runtime read-only
postflight passed with sanitized evidence SHA-256
`01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de` and
records no production mutation. SellerPayoutEvent Phase A is accepted. Its
posture-only FORCE successor was applied from exact main
`0eb360b9878698f45288ac3c1649871de9a8a33c`, CI `32672008187`, by guarded run
`32672434812`; that run applied only the reviewed migration and passed
migration status, the global audit and exact FORCE scope. Exact main
`fb350c31772938ef52ef796c61bf670d9cf0750e` passed CI `32675227286`; the
distinct actual pooled-runtime FORCE postflight passed all nine engine-read-only
checks and retained evidence SHA-256
`f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e`.
SellerPayoutEvent FORCE is accepted. Begin the next remaining
Order/payment/shipping table with its own fresh domain audit; do not bundle the
tables. Retain
`docs/seller-payout-event-activation-release.md` and
`docs/seller-payout-event-activation-production-wiring.md` as the accepted
Phase-A release records, and
`docs/seller-payout-event-force-release.md` as the FORCE execution and
acceptance record.

The fresh next-table audit is now
`docs/order-payment-event-pre-rls-audit.md`. `OrderPaymentEvent` remains the
next bounded release. The audit identified six domain gaps: raw
payment-provider metadata in buyer/seller exports; seller and blocked-checkout
refund ABA claims; inconsistent latest-dispute predicates; missing
append-only/taxonomy/currency/event-time invariants; and ambiguous seller
self-service partial-refund semantics; plus a post-commit crash gap in refund
participant notification/email delivery. Use the launch-safe constraint:
seller self-service supports full cancellation/refund, while partial refunds
remain staff Case operations until a residual line-item fulfillment model is
designed. The compatible application correction and future feature gate are
recorded in `docs/order-payment-event-refund-contract.md`; it must deploy and
pass route smoke before payment-ledger authority conversion. Canonical
latest-per-dispute application semantics and the remaining typed event-time
gate are recorded in `docs/order-payment-event-dispute-state.md`. Those two
application corrections remain prepared, not live. The distinct refund-only
self-service export boundary is recorded in
`docs/order-payment-event-account-export.md`. Compatible authority design is
now supported by the isolated generation-fenced acquisition work in
`docs/order-payment-event-refund-claim-generation.md`, but that work is not
live. A stacked compatible package adds atomic, source-bound seller and
blocked-checkout provider record/finalize operations plus an exact
later-webhook-generation handoff; see
`docs/order-payment-event-refund-record-authority.md`. It is also not live and
its stacked crash-safety refinement atomically reserves source-validated buyer
notifications and deterministic seller-refund email-outbox work with the fixed
record operation. A further isolated compatible candidate implements the two
source-bound signed platform-webhook families, a typed provider clock and
equal-second dispute reconciliation; see
`docs/order-payment-event-signed-authority-design.md`. Its migration hash and
historical successor allowances are byte-sealed, its disposable PostgreSQL
authority/concurrency proof passes, and the guarded Production Migrations
workflow intentionally cannot dispatch it. It is not merged, deployed or
production-applied. Activation remains blocked on ambiguous provider-effect
reconciliation, staff families, actor projections, remaining invariants, fresh
data classification, converted-deployment signed provider proof and
predecessor drain. Pin all 26 semantic
consumers, require a fresh aggregate-only
production inspection, then use compatible schema/functions, converted app
deployment, signed provider/concurrency proof, predecessor drain, policyless
ENABLE and separate FORCE. Do not bundle shipping quotes, Order or OrderItem.

The current isolated successor is the two-function signed platform-webhook
authority in `docs/order-payment-event-signed-authority-design.md`. Keep signed
`charge.refunded` and dispute application together because they share the
active webhook generation, charge/Order lock order and typed provider clock.
Do not bundle ambiguous local-refund reconciliation, staff Case refunds,
participant projections, RLS or grants. Equal-provider-second conflicts retain
evidence and mark reconciliation without Case, refund-lock or notification
effects; event ID and application arrival time must never choose the winner.
The isolated implementation satisfies that contract locally and remains a
compatible candidate—not permission to skip deployment coexistence, signed
Stripe delivery/retry, production inspection, grant convergence, Phase A or
FORCE.

The next stacked compatible boundary is evidence-bound seller and
blocked-checkout refund reconciliation in
`docs/order-payment-event-refund-reconciliation.md`. It replaces timer/manual
guesswork with a complete bounded Stripe inspection, a 23-hour same-key retry
cutoff, a 25-hour no-effect release floor, provider-searchable claim metadata,
an immutable FORCE-RLS/no-policy evidence ledger and a single Admin-PIN action
whose outcome is derived rather than selected. The pass also fixed the
previously unreachable blocked-checkout generation-resume path and normalized
all still-unapplied refund claim/finalizer clocks to UTC before refreshing their
byte seals. Extra-High review also caught a failed-lease recovery gap: the
webhook correctly cleared its processing lease before staff inspection, but
the original finalizer still required that lease. The isolated correction
keeps the mutation core owner-private and adds an exact immutable-
reconciliation wrapper that co-commits refund finalization with source-event
completion. A further byte-sealed successor closes the inactive-seller first-
record edge without a new runtime operation: the existing seller and Case
functions accept banned/deleted source history only when they derive the exact
same-Order, same-claim, same-generation immutable reconciliation and a current
ADMIN author. The caller supplies no reconciliation ID. This closes the
ambiguous provider-outcome and inactive-seller local-record gaps only. It is
not merged, deployed, production-applied or activation evidence. Keep the
staff Case provider/replay integration proof, remaining invariants, actor
projections/aggregates, fresh production
classification, converted provider proof, predecessor drain, policyless ENABLE
and FORCE as explicit later gates. Do not bundle Order, OrderItem or shipping
quotes.

The following stacked application-only boundary closes the staff Case
participant-delivery crash gap without changing the already source-bound Case
database functions. Staff finalization, buyer and seller Notifications, and a
claim-deduplicated `case_resolved` EmailOutbox reservation now commit together;
the request then attempts the exact durable job and the worker owns retry. See
`docs/order-payment-event-case-refund-delivery.md`. This is still isolated
preparation, not deployment or RLS evidence. The remaining staff gate is real
provider/replay integration proof, not another generic refund writer.

The next isolated OrderPaymentEvent invariant pass starts by extending the
existing protected production inspection from the historical 54-count shape to
66 aggregate-only fields. It classifies signed/local source families, provider
clock shape, cross-Order object reuse and same-second dispute conflicts before
any legacy validation or immutable trigger is written. See
`docs/order-payment-event-invariant-inspection.md`; preparation is not a
dispatch, migration, cleanup or activation authorization.
Exact-head CI run `32770581896` then failed closed because the first query
assumed the separately staged provider-time column had already been restored.
The corrected inspection is intentionally dual-schema: absent/null provider
time classifies as missing, populated bigint values remain exact, and malformed
values fail the cast. No production state was touched by the failed run.
Corrected exact head `dd790d40f1c7212c31a0953a8386213c686ded31` passed full CI
run `32770970002`, including the predecessor-schema aggregate proof. This is
accepted inspection packaging only; production classification remains a
separate protected read-only gate after the stacked predecessors merge.
The stack subsequently merged through exact main
`d17b0384f2b90b128ba23852a0dedb004ce52739`, whose full CI run `32772585632`
passed. Protected inspection run `32773408735` then failed closed before counts
with `POSTURE_MISMATCH`: the fence still treated the already FORCE-hardened
`SellerPayoutEvent` as a predecessor. The successor must require all three
completed service ledgers to remain policyless FORCE/no-CRUD while preserving
the four remaining Order/payment/shipping predecessors. The failed run produced
no evidence and made no production change.
PR #262 corrected only that posture fence and merged at exact main
`bc64516c6463118012c643806a3f398f2584092c`; exact-main CI `32782625503`
passed. Protected engine-read-only inspection `32783261534` accepted sanitized
production evidence (SHA-256
`2a4e2819efa40acae014521aff141408cef66d468d0f4935c093415416dbbe30`): 2
Orders, 3 OrderItems, 13 StripeWebhookEvents, zero OrderPaymentEvents,
SellerPayoutEvents, CheckoutStockReservations or OrderShippingRateQuotes, and
zero payment/refund/dispute/replay/source/currency/amount defects. The one
nonzero defect is an Order label-state coherence count. Keep it scoped to the
separate Order release; it does not block continued OrderPaymentEvent design.
The isolated 76-field successor classifies that finding with ten aggregate-only
subtype counts before any separate repair decision. It retains no row or
identity and authorizes no cleanup or production mutation.
PR #263 merged that successor at exact main
`3bd0a0f7a11074a323c0d6facdcc08d2aeadc0e1`; exact-main CI `32784976638`
and protected read-only inspection `32785532138` passed. Sanitized evidence
SHA-256 `a4c7d40ac292d1fa4c8e43ad95b47630ac40be9ef7b5553f56e0523894cd0bff`
narrows the broad count to one PURCHASED Order missing both its Shippo
transaction reference and label URL, with every other label subtype clean.
Account deletion deliberately produces this shape when scrubbing buyer or
seller provider/download data. Before any repair, run the isolated 78-field
aggregate successor that distinguishes deletion-marked privacy redaction from
an unexplained missing reference. Never rehydrate provider references erased
for account deletion; continue the separately clean OrderPaymentEvent design.

PR #264 merged the 78-field successor at exact main
`1d5bdf3ffa6b1ab41daf5a1c3e0f341253620dc4`; exact-main CI `32787483409`
passed. Protected engine-read-only inspection `32788031745` accepted sanitized
evidence with SHA-256
`c7c70e68097174182b1aea43420ca1e5ff91c52e670b822f20bcb10db7d2649c`.
The historical broad count and missing-transaction/missing-URL subtype counts
remain one, but
`label_purchased_missing_reference_privacy_redacted_count = 1` and
`label_purchased_missing_reference_unexplained_count = 0`. The finding is
therefore closed as an intentional account-deletion privacy transform. Do not
repair, enumerate or rehydrate it. This classification unblocks continued
OrderPaymentEvent invariant/RLS work; Order, OrderItem and
OrderShippingRateQuote remain separate release boundaries.

The five-migration compatible-production stack is accepted from exact main
`8f4cf2df34a9f700adebc910107ac2dbb878054a`, CI `32792800761`, aggregate
inspection `32793276224`, and guarded run `32793394895`. The engine-read-only
proof confirmed the fully prepared state, exact live function bodies/catalog,
`OrderPaymentEvent` RLS off and broad predecessor CRUD retained. Exact main
`5d3b402317084d9d2af6b8bdf52300a800eda0d8` then passed CI `32795444295`,
and the distinct actual pooled-runtime postflight accepted the 14-function
catalog, compatible predecessor access and private reconciliation/helper
denials inside an engine-read-only transaction. Retain sanitized mode-`0600`
evidence SHA-256
`ecb1ce1b1f4dd6fa2ad62e23882c16f6021be6ed42698b54a663ca11bd236f10`.
PR #270 exact head `b7bd29a4c3957f5234a9cca7290e610dace02d63`
merged as exact main `2820986538c0d64f035defce052ba4ad0de1b3fb`;
exact-main CI `32798835742` passed and production deployment
`dpl_73aR913b9hfgkcdfBv2MwMyypR5a` is `READY` behind all canonical aliases.
The converted application is now live while `OrderPaymentEvent` RLS remains
off and predecessor CRUD remains intact. Next run the real
signed-provider/refund/Case/replay proofs, then drain the predecessor. This is
not `OrderPaymentEvent` activation evidence. See
`docs/order-payment-event-compatible-production-preparation.md`.

The deployment-specific health check exposed a Vercel CLI footgun: `vercel
curl` silently generated a persistent, no-expiry project-wide automation
bypass when none existed. The exact newly-created token was never printed and
was immediately revoked without regeneration; the project now has zero
automation bypass tokens. Prefer public canonical health plus read-only
deployment metadata unless a separately reviewed bypass is intentionally
provisioned.

The compatible OrderPaymentEvent application is live, so production proof is
now split by real authority family rather than one oversized synthetic smoke.
First prove signed Stripe refund/dispute delivery and exact replay with two
separate test charges and exact cleanup; then independently prove seller full
refund, blocked-checkout recovery and staff Case refund. This is a security and
product-correctness boundary, not rollout ceremony: the four paths have
different authentication, provider-call, stock/Case and participant-delivery
semantics. A passing signed-family proof remains explicitly insufficient for
RLS activation. The restart-safe first operator is documented in
`docs/order-payment-event-signed-production-proof.md` and remains unexecuted.

Current acceptance supersedes that earlier execution note: signed refund and
dispute, seller full-refund, fresh automatic blocked-checkout, and staff Case
full-refund families have passed their separately bounded Stripe test-mode
proofs. The staff proof reused its exact existing 500-cent refund and 475-cent
reversal, cleaned all marker-bound fixtures and retained sanitized evidence
SHA-256
`e55993b6e76f11a8aa48b0d5aefde588695944436ec7c5474655e1a43d8f18fb`.
Protected aggregate run `33289217900` found zero `OrderPaymentEvent` rows and
zero payment-specific defects. The next gate is the isolated compatible
invariant release in `docs/order-payment-event-invariants.md`, followed by
actor-safe projections and predecessor drain; policyless ENABLE and FORCE
remain separate. One released synthetic StripeWebhookEvent proof lease is a
separate marker-bound cleanup item and must not weaken the signed Order-source
contract or delay the empty-ledger invariant design.

The first actor-safe projection candidate is now isolated behind that
invariant release. It converts participant order pages, the staff timeline and
account export to five bounded fixed functions; see
`docs/order-payment-event-read-authority.md`. Do not mistake this partial
conversion for the zero-direct-access gate: transition predicates, aggregates,
webhook reads and local evidence writes still need source-specific operations.
Merge/apply/deploy the additive read release only after invariant acceptance,
then drain its predecessor before policyless ENABLE. Keep FORCE separate.

The separate seller full-refund provider boundary is designed in
`docs/order-payment-event-seller-refund-production-proof.md`. Keep it behind
the successful signed-family proof. It must exercise a real authenticated
seller route and disposable test destination charge, prove the local/signed
two-row confirmation model plus atomic Case/stock/delivery effects, and clean
all temporary application identity without authenticating a real seller.

That boundary is now accepted. Exact corrected operator/main
`0c5739e7a48ce361298a6d2af571de093fb2b01b` and exact-main CI
`33265745679` resumed only the original attempt and reused its sole idempotent
500-cent test payment/account. It atomically inserted the Case and buyer
opening message, proved the exact 500-cent refund and 475-cent reversal plus
local/signed evidence, Case, stock, Notification, skipped-email and replay
outcomes, then removed all bounded application/provider identity. Retain
sanitized evidence SHA-256
`35d13b9513e49c2f1ca101a0f9f2a1e5207520e28b845a03b99e2e2d1b76c9d4`.
The failed attempts remain documented because each exposed and closed a real
operator/test-fixture class. They are history, not current restart state.

Proceed next to the separately authenticated staff Case refund live proof.
Do not infer it from seller authority or use the seller proof to skip remaining
invariant/projection work, predecessor drain, policyless ENABLE or posture-only
FORCE.

That next boundary now has an isolated, unexecuted operator candidate. It
re-audits the existing staff Case protocol, adds action-specific confirmation
to the admin panel, and pins the real Clerk/Admin-PIN route, exact test-mode
refund/reversal, source-bound local plus signed evidence, participant delivery,
replay and cleanup. Preserve the operational canary as `USER` except for the
short `finally`-guarded PIN/API windows; retain the separate `restore-canary`
recovery command and never persist the raw PIN. Review/merge still cannot be
treated as provider proof acceptance. After a separately authorized exact-main
execution passes and is documented, continue the remaining invariants,
projections and predecessor drain rather than jumping directly to RLS.

The blocked-checkout product audit found one delivery correction that must land
before its live proof: the automatic refund was classified as `NEW_ORDER` and
had no durable refund-email reservation. Follow
`docs/order-payment-event-blocked-checkout-refund-delivery.md`: widen only the
source-validated Notification function for old/new coexistence, canonicalize
the predecessor type to `REFUND_ISSUED` before preferences and replay identity,
deploy the `REFUND_ISSUED` plus atomic outbox caller, prove both cross-version
call orders resolve one row, drain the predecessor, and then retire the legacy
input. Do not grant generic Notification authority or skip the separate
blocked-checkout provider proof.
The compatibility migration uses its own exact-main, CI-bound, restart-safe
production runner. Keep that runner limited to the byte-pinned function-body
successor and exact before/after catalog proofs; do not use this narrow release
as a reason to rerun broad grant provisioning or to bundle the later
`OrderPaymentEvent` ENABLE/FORCE steps.

The live blocked-checkout acceptance is now a four-command restart-safe
operator rather than a webhook-secret simulation. Keep its payment completion
interactive through a loopback-only Stripe Embedded Checkout page, derive the
tax-inclusive buyer refund from the completed Session, prove the fixed $4.75
seller reversal and zero `NEW_ORDER` side effects, and retain only the two
processed signed webhook leases after exact cleanup. Never use the unpaid
abort command once Stripe reports the Session paid.

The first production-proof attempt on 2026-08-25 failed closed before creating
a Stripe account because its 46-character marker metadata key exceeded Stripe's
40-character limit. Preserve the mode-`0600` `account-create-pending` journal.
Resume only through the isolated short-key correction with both the original
attempt commit/CI and the corrected operator commit/CI bound; do not delete the
journal, create a replacement attempt, or advance to predecessor drain or RLS
activation until hosted payment, signed delivery, exact replay and cleanup pass.

The short-key retry exposed a second fail-closed operator regression at the
same pre-account boundary: its legacy Custom/application-collected identity
shape asked Stripe for responsibilities that do not match Grainline's real
seller onboarding. Do not accept a platform-profile responsibility change for
this proof. Keep the production-aligned Express/Stripe-collected controller,
pause for a private Stripe-hosted test-onboarding handoff, and resume the same
journal only after its transfer capability is active. Never print or commit the
one-time onboarding URL. This provider correction remains prerequisite proof
work; it does not authorize predecessor drain, `OrderPaymentEvent` activation,
or any `Order`/`OrderItem`/shipping RLS bundle.

The first post-onboarding retry exposed a separate disposable-fixture drift:
the proof still labeled its classic-API Express account as `v1/custom`, which
the current checkout eligibility guard correctly rejects. Never relabel a
classic-created proof account as Accounts v2 merely to pass that guard. For
this compatibility proof, retain an honest legacy-null account-version marker
and the exact observed Express controller summary; repair only the marker-bound
temporary seller row from the prior `v1/custom` value. Production seller
onboarding must continue to create real Accounts v2 through `/v2/core/accounts`.

The seller-identity recovery reached the real checkout route: forged origin was
denied, and the authenticated request created one unpaid Session/reservation.
The operator then rejected Stripe's current percent-encoded Embedded Checkout
client secret under an obsolete alphanumeric-only assertion. Resume only after
the validator binds the secret to the exact Session ID, bounds its length and
accepts percent characters solely as complete hexadecimal escapes. Reuse the
existing checkout lock/Session; do not create a replacement attempt or advance
to predecessor drain/RLS activation before genuine payment, signed delivery,
exact replay and cleanup pass.

The encoded-secret restart then exposed a redundant five-level Stripe Session
expansion, which Stripe rejects. Keep Session retrieval limited to the exact
payment-intent, charge and transfer chain; retrieve the durable refund by its
source-bound ID and expand its transfer reversal separately. This preserves the
independent refund/reversal proof instead of weakening provider assertions.

Both pre-payment Sessions expired while their correction PRs and exact-main CI
ran. An aggregate-only production/Stripe inspection proved both attempts are
unpaid, have no PaymentIntent, and are paired with exact
`RESTORED/stripe_session_expired` reservation rows. Recovery must not hide that
history or create unbounded retries. The operator may classify at most five
such exact terminal attempts and at most one exact open active attempt, must
reuse the active attempt when present, and persists the terminal count before
payment. Successful and unpaid-abort cleanup must lock, re-prove and delete the
complete fixture-bound reservation history transactionally before deleting the
listing. The same Session-bound encoded-secret validator must guard both the
route response and the private recovery journal, and secret redaction must
consume complete `%HH` escapes. Any metadata, source, item, repair claim,
provider state or cardinality drift remains a hard stop. Do not advance to
predecessor drain or RLS activation until genuine payment, signed delivery,
exact replay and complete cleanup pass.

The first bounded-history restart created one new open unpaid Session and
reservation, then exposed a real Buy Now last-unit retry gap: the first request
reserved stock to zero before the exact retry reached the ready lock, and modal
re-entry could not obtain a new shipping quote. Do not create another attempt
before shipping the isolated application correction: retain
signed-rate, variant, price, payload and database stock checks for new attempts,
recover an exact ready lock ahead of stock rejection, and let the modal query a
buyer/listing-scoped resume route that independently binds Redis and Stripe
metadata, mode, status and client secret. Only after exact-main CI and a
compatible production deployment may the proof resume that same unpaid Session.
If it expires during review, classify it as the third exact terminal unpaid
attempt and create exactly one bounded replacement after the corrected deploy;
do not erase the history or exceed the existing five-attempt ceiling. Preserve
the original journal binding and attest the corrective application source, CI
and deployment separately. This is product correctness discovered by the
RLS/provider gate, not a reason to weaken reservation authority or skip the
paid signed-delivery proof.

The bounded replacement was genuinely paid on 2026-08-26. The buyer's
tax-inclusive test refund succeeded, but the webhook had observed a null
destination transfer and therefore recorded a platform-funded refund; the
exact 475-cent seller transfer remained unreversed. A later deep provider read
returned that transfer, establishing a transfer-visibility race as the narrow
corrective target. Do not treat the failed run or its manual reconciliation as
acceptance. First ship the additive source/generation-fenced transfer-binding
function and bounded provider reread; separately reverse and clean only the
preserved test fixture with `reconciled-failed-proof` evidence; then run a
fresh automatic paid proof from a new fixture. Predecessor drain and
`OrderPaymentEvent` ENABLE/FORCE remain blocked until the fresh proof passes.
The additive migration must use its dedicated exact-main/CI workflow; the
generic Production Migrations runner must keep conditionally isolating it while
the read-only restart verifier reports the predecessor state. Do not execute
the reconciliation operator merely because its code and tests are ready.
This sequencing is durable even if the current operator branch or local
worktree is later pruned; the detailed state and exact release boundary live in
`docs/order-payment-event-blocked-checkout-refund-delivery.md`.

Do not change the 5% platform-fee rate as a routine configuration edit. The
application now derives checkout and refund expectations through
`calculateCheckoutAmounts()`, but the byte-sealed database refund finalizers
independently reproduce the same launch rate and historical Orders do not store
a checkout-time fee/transfer snapshot. Before any fee change, add and classify
that durable accounting snapshot and release successor fixed functions; a
contract test intentionally blocks rate drift until then.

### SavedSearch Phase-B and runtime-separation completion (2026-07-21)

Bucket A is complete in production. Deployment
`dpl_6nVQx5HBmurzH9iU1vwQLjA6gy2N` promoted exact commit
`17bf93dc8837fd6c5e6988569f993781800b6318`; migration
`20260720060000_force_saved_search_rls` is complete, `SavedSearch` has exact
`ENABLE` plus `FORCE` and three policies, and the accepted private postflight has
SHA-256
`768096b53662ec9e8deaf8a3a63e6021ad755464f48b4b01c02fb339f1c78ea4`.

Runtime database credential separation is also complete. Production source
`b4f14beaff06831ed2e8d7a35578226b756c1a61` passed exact clean postflight
operator `8438ece93ff93572a015dd674f152c830cb5a52e`; the canonical record is
`docs/runtime-db-credential-separation.md`. Production Functions retain only
the constrained `grainline_app_runtime`; the rotated `NOSUPERUSER BYPASSRLS`
owner remains outside Vercel. This prerequisite subsequently enabled the
separately proven Notification rollout, which is now complete through FORCE.
It does not authorize bundling later sensitive tables or putting an owner
credential back into an application environment.

### Site-wide RLS expansion decision (2026-07-19)

SavedSearch is the first production RLS pattern, not the final scope. Its Phase-B
FORCE release and runtime credential separation are complete. Continue expanding
RLS across user-owned and sensitive data
in the reviewed sequence documented in the RLS feasibility and defense-in-depth
plans, with priority on notifications, carts, conversations and messages,
orders and payment/shipping records, and cases. Each table or tightly coupled
table group requires its own actor/read/write/cleanup inventory,
service/admin/cron/webhook design, staging proof, phased production activation,
rollback proof, and monitoring. Do not enable broad RLS mechanically or copy the
SavedSearch policy/RPC pattern onto tables with asymmetric, participant,
aggregate, public-read, or system-write behavior. Application authorization
remains primary; RLS is required defense in depth for the eventual sensitive
data posture.

Treat this as one site-wide sensitive-data RLS program for planning and status,
but not as one migration or production activation. Preserve the established
meaning of Bucket B as `Notification` so historical rollout evidence stays
unambiguous. Prepare shared inventories and infrastructure across later tables
where useful, then activate independently reviewed, tightly coupled groups.
`Notification` and `Conversation` + `Message` are complete in production
through FORCE and actual pooled-runtime proof. `Case` + `CaseMessage` +
`CaseMessageAttachment` is the active tightly coupled group. Its protected
Phase 2 aggregate-only production inspection completed with zero Cases,
CaseMessages, attachments or anomaly counts, so no legacy cleanup/backfill is
needed. Phase 3 invariant and authority-catalog proof is complete. The Phase 4
database-first compatible preparation is complete in production at exact main
commit `4728f673fdf0a11d38aaac384f3d9afe2cf86117`, while all three Case-family
tables remain RLS-off with predecessor CRUD. Protected Production Migrations
run `30511805499` applied only the committed preparation tree. The
engine-attested repeatable-read/read-only pooled-runtime postflight then proved
the four private ledgers are policyless ENABLE plus FORCE with no runtime table
access, the exact 26 runtime-executable plus three runtime-private function
ACLs are intact, and PostgreSQL `PUBLIC` can execute none of them.

The compatible application package converts all 79 ordinary direct, nested and
raw Case-family references across the 29-source baseline to 27 purpose-bound
operations. Its machine-checked ledger retains every conversion; a separate
retired ledger preserves the one unused historical helper reference, so the
80-reference baseline resolves to zero ordinary direct Case-family access
without creating fictional database authority. The operations reject
caller-asserted staff-PIN flags, generic provider results, free
account-deletion targets and caller-selected cron rows; application
PIN/provider verification remain explicit external trust boundaries. External
refund resolution uses the private, FORCE-RLS, zero-policy
`CaseResolutionClaim` service ledger so provider idempotency, recovery and
finalization are database-bound rather than caller-asserted. An audited
administrator finding of no provider effect uses a distinct
`RELEASED_NO_PROVIDER_EFFECT` terminal state instead of falsely recording the
claim as finalized.

Stripe-dispute-created Cases record their exact durable payment-event source
rather than fabricating a buyer-authored message, and dispute reopen clears the
complete stale Case-level resolution/refund snapshot while retaining the Order
payment/audit history. Its replay identity belongs in the private, FORCE-RLS,
zero-policy `CaseStripeDisputeApplication` ledger because broadly writable
`SystemAuditLog` is evidence/observability rather than security authority. The
fixed operation also rejects valid but superseded Stripe events; signed
delivery does not imply event ordering.

The seller-refund application operation accepts only the authenticated seller
actor and one exact committed local refund event, derives the Case resolution
and stores immutable replay authority in the private zero-policy
`CaseSellerRefundApplication` ledger. The compatible app conversion preserves
the shared User then Order then Case lock order, validates the complete
database-derived result and leaves no direct Case access in that route. This
does not pull Order/payment into the Case activation:
`Order`/`OrderPaymentEvent` direct-write hardening remains a named dependency
of that later independent sensitive group. The completed database preparation
and compatible application package do not authorize the later invariant,
read-mode, ENABLE or FORCE releases.

The compatible application is now live at exact merge
`f2f6861b177a47d22ed304714372584b79a0a0b0`, exact-main CI run
`30512956823` (job `90776727905`) and production deployment
`dpl_Gvsge8MWYW8DfDRSom34YPwsY8rH`. Case evidence remains disabled by an
absent `CASE_EVIDENCE_ATTACHMENTS_ENABLED` variable. The next release is the
invariant-only migration
`20260730010000_enforce_case_message_invariants`; it must change no RLS flag,
policy or Case-family table grant. After accepted production postflight,
promote read-mode, policyless ENABLE and posture-only FORCE as three separate
releases. Do not skip directly from compatible application to ENABLE or
bundle any of those releases with the later order/payment/shipping group.
`Cart` + `CartItem`;
`SavedBlogPost`; aggregate/fanout tables; and the order/payment/shipping group
remain later independent groups. Each group must be independently deployable,
observable, and reversible before the next group begins. Never combine
notification fanout, messaging, checkout/payment, fulfillment, and dispute
policy activation into a single release.

Conversation and Message may be designed and activated together because
Message visibility and write validity depend on its parent Conversation. Pin
the complete participant, unresolved-report staff, structured system-message,
custom-order, commission, export, deletion and seller-metrics surface before
drafting authority SQL. The baseline and rollout contract live in
`docs/conversation-message-authority-inventory.md` and
`docs/rls-conversation-message-plan.md`. Direct runtime DML must not survive
activation; user-authored content may be caller input, but recipient, structured
kind, system status and thread side effects must be derived from validated
state.

This program scope is approved, not a menu to narrow silently. Every sensitive
or user-owned table discovered by the coverage inventory must end in one of
three explicit states: production RLS with retained proof; a reviewed database
isolation alternative with rationale; or a named, blocking deferral with owner
and prerequisites. Public catalog data, cross-user aggregates, and internal
service ledgers still require review and may need different database controls;
do not force an owner-policy shape where it is incorrect. Maintain the
schema-complete [`docs/rls-coverage-matrix.md`](docs/rls-coverage-matrix.md)
and never claim that all user data is protected by RLS until every table has an
evidenced disposition.

Before drafting RLS for each sensitive group, complete a table-specific
behavior and security audit. Confirm current product semantics, actor
authorization, integrity constraints, provider/background operations,
retention/export/deletion, concurrency, indexes and test coverage; fix
load-bearing defects first so policies do not encode them. Conversation and
Message are complete; their retained record is
`docs/conversation-message-pre-rls-audit.md`. The active
Case/CaseMessage/CaseMessageAttachment record is
`docs/case-case-message-pre-rls-audit.md`.

Case message/upload preflight must remain a narrow source-validating database
operation rather than depend on broad runtime visibility of the
counterparty's `User` row. A self-only User RLS rollout would otherwise hide
the suspended/deleted state that Case messaging must derive. Keep the fixed
preflight output free of User profile/contact data, retain route-side Clerk and
staff-PIN verification, and keep the final locked reply operation authoritative
for every write and race.

The compatible Case-message preflight application conversion must use one
strict typed result in both the reply and private-evidence upload routes. Keep
missing and unauthorized rows non-enumerating, preserve the route-side staff
PIN and external evidence checks, and never let preflight replace the final
locked reply authority. At that preflight checkpoint the Case inventory was 52
references across 23 files, with twenty-eight of the 80-reference baseline
retained in the converted ledger. This remains preparation, not production
activation.

The bounded interactive Case-message history is also a narrow source-validating
database projection, not a generic INVOKER read. It crosses exact
Case/CaseMessage/attachment rows for both participants and PIN-verified staff,
so broad runtime table/User visibility is the wrong prerequisite. Keep its
SECURITY DEFINER output limited to message fields, durable or
relationship-derived author kind, and attachment id/content type/size/time;
never return User profile/contact fields, DirectUpload ids or object keys.
Retain the 51-row hard cap and stable `(createdAt,id)` cursor. Unknown legacy
non-party authors remain unlabeled rather than being inferred as staff from
mutable current role.

The compatible Case-message page application candidate uses this operation for
buyer, seller and staff detail pages through one strict typed validator. It
removes mutable User-name joins from message labels and moves the direct
message plus nested attachment reads to the converted ledger. The grouped
recipient-read conversion also moves staff Case detail, the PIN-gated active
count and three Order-to-Case relations behind fixed typed projections.

Keep the PII-free Case-detail projections separate from the cross-user staff
queue. One Case by id, one Case by Order and the staff active count were
prepared as SECURITY INVOKER operations while direct table reads still
coexisted. The completed zero-direct-access inventory changes the activation
decision: converge those three plus the bounded account-export projection to
SECURITY DEFINER before activation, preserving the same actor validation and
bounded outputs. This permits a policyless, zero-table-grant Case boundary and
avoids a broad staff-visible policy that cannot attest the session-bound PIN.
Their fixed result must not expose the raw Stripe refund id, User
contact/profile fields, payment-source provenance or attachment/object
identifiers, and UTC database timestamps must cross the SQL boundary as
`timestamptz`.

The staff Case queue is not one of those ordinary reads. It needs minimal
buyer/seller contact fields for PIN-verified staff, which future self-only User
RLS should hide from the runtime role. Keep it as a separate, narrow
source-validating SECURITY DEFINER projection rather than granting broad User
visibility or adding PII to the shared participant Case result. That projection
and its strict typed application wrapper are now prepared in isolation. Count
and page share one database snapshot; UTC timestamps, message counts, safe
page and blank-name email fallback are database-derived; the result excludes
User ids, Clerk ids, Case narrative, payment/refund evidence and object
identifiers. At the staff-queue checkpoint, the Case-family inventory was 42
references across 16 files, with thirty-eight of the 80-reference baseline
retained in the converted ledger.

Case-aware Order checks must remain purpose-bound. Do not grant one generic
`orderId -> active Case` runtime predicate. Buyer delivery confirmation uses an
actor-bound buyer predicate; seller fulfillment and label purchase use an
actor-bound complete-seller-ownership predicate. Each route repeats the check
after taking the Order lock so Case opening cannot race the transition. The
predicates must not change transaction-local RLS context; their actor input is
validated against the purpose-bound relationship without adding a context
side effect. The
retention cron uses a separate fixed 90-day database prune batch: its cutoff,
eligible locked Orders, active-Case exclusion and exact PII targets are
database-derived, and callers cannot choose Order ids or shorten the window.
Re-review that shared lifecycle function when Order and
OrderShippingRateQuote enter their own RLS group.

Seller verification, Guild enforcement and seller metrics must not share a
generic seller-to-dispute oracle. Keep three minimal Case aggregate
operations: active count for the fixed metrics computation; an actor-bound
seller/staff verification count with a database-derived 60-day cutoff; and a
Guild-state-bound predicate with a database-derived 90-day cutoff and a lock
on the exact blocking Case. Do not return cutoff timestamps, Case ids,
participants or narratives. Admin verification mutations must repeat the
session-bound staff PIN check inside the server action, even when the enclosing
page already passed the admin layout gate.

Account export must page Case rows and reuse the bounded Case-message
projection rather than restore an unbounded nested Case read. Preserve complete
export semantics and stable ordering; if real histories outgrow a materialized
JSON response, move the entire multi-model export to a streaming archive
instead of silently capping Case history. Private evidence download should
reuse the existing participant/staff Case projection for staff-PIN mode and
the existing source-bound DirectUpload reader for object authority.

The current Case-family preparation inventory has zero ordinary application
references: seventy-nine of the 80-reference baseline are retained in the
converted ledger, while the unused historical `lockCaseForLifecycle` reference
is removed from production source and retained in a separate retired ledger.
Interactive escalation now requires a real authenticated actor and
keeps non-party staff behind the session-bound PIN; the obsolete
`CRON_SECRET`/`id="all"` arbitrary-target surface is removed. Scheduled Case
transitions accept only one of three fixed families and a bounded limit.
PostgreSQL derives due rows, cutoffs, targets, audit evidence, recipients and
notification payload authority under User -> Order -> Case locks, with the
primary notifications atomic to the transition and application calls retained
only as deduplicated recovery replays. State-specific partial indexes keep the
three due scans bounded as terminal Case history grows. Account deletion now
uses a narrow blocker count and a side-effect-bound redaction function that
derives its User, sensitive values and Case/message targets, while rechecking
active Cases after the User lock. Its saved disposable proof requires forced
direct denial, exact source validation, a real User-lock wait, rollback,
idempotent redaction, collision-safe historical-email handling and zero
residue. This remains preparation only; production Case-family RLS is still
off. Exact escalation/cron head `71320931` passed
GitHub Actions run `30496775294` (job `90727343830`), including the disposable
PostgreSQL authority/concurrency/rollback proof and every repository gate.

The invariant re-audit exact head
`7543d84cd041b89580c988666b0522cddee73dad` passed GitHub Actions run
`30500866299` (job `90740015271`), including the corrected legacy preflight,
write freeze, source binding and race proof plus every repository gate. The
draft activation destination is now explicit: policyless ENABLE RLS and zero
runtime/PUBLIC table or column privileges for Case, CaseMessage and
CaseMessageAttachment, followed later by a separate posture-only FORCE
release. The compatible read-mode convergence, invariant promotion,
activation, rollback and FORCE candidates remain unapplied until their
separate engine and release gates pass.

Case/CaseMessage Phase 2 may proceed while the DirectUpload cleanup-only R2
credential is created because the Case inspection is owner-only, read-only and
aggregate-only. The two tracks rejoin before activation: DirectUpload must
complete its cleanup credential proof, activation and pooled-runtime postflight
before private Case evidence is enabled or Case policy activation is claimed.
The saved Case inspector must run before the staged DirectUpload
compatibility-key retirement because it pins the current dual-column
compatibility posture. Production inspection results authorize classification
only; any cleanup/backfill or invariant mutation waits for the actual counts.

Case photo evidence is a launch requirement, not a later generic messaging
feature. Before Case policy SQL, add private-object-backed processed image
evidence tied to CaseMessage, with server-verified object ownership/metadata,
authenticated short-lived retrieval, and explicit participant visibility,
export, deletion, and retention behavior. Do not use the public R2 message
attachment path, accept arbitrary external URLs, or activate the attachment
table separately from its parent Case boundary. PDF evidence remains prohibited
until a reviewed malware-scan/quarantine pipeline exists.

Keep the private Case path fail-closed during its compatibility rollout.
`CASE_EVIDENCE_ATTACHMENTS_ENABLED` is absent or exact `false` while the
schema/fixed-operation app deploys and drains. Only the exact lowercase `true`
may be promoted after DirectUpload activation and pooled-runtime postflight,
private-bucket isolation/credential proof, and authenticated
participant/staff-versus-foreign-user route smoke all pass. This breaks the
otherwise circular dependency between deploying compatible code before RLS
activation and withholding sensitive private-object access until that boundary
is proven.

The Case evidence review exposed a separate pre-launch privacy requirement:
ordinary Message attachment bytes currently use public R2 bearer URLs even
though their Message rows and attachment references are protected by FORCE
RLS. Complete the current Case lifecycle proof checkpoint first, then run a
separately reviewed Message private-object compatibility and legacy
classification pass before Case policy activation. Reuse private-bucket
primitives where appropriate, but do not bundle ordinary Message attachment
authority, legacy object mutation or proof claims into the Case activation.
Keep new private direct-message uploads image-only unless malware scanning and
quarantine for PDFs are explicitly designed and proven.

For the active Case lifecycle checkpoint, proof fidelity is part of the gate:
the first accepted 14-ordering PostgreSQL run remains valid only for its modeled
subset because its mark-resolved/cron helpers used stronger post-lock time
semantics than the corresponding application routes and did not contend staff
resolution against replies. Exact hardening head `4dc57266` passed all 21
corrected two-session orderings in disposable PostgreSQL run `30218521286`
after the final private-lifecycle review changed the migration bytes; exact
general CI `30218522907` also passed. The run used the real refund sentinel,
Order-then-Case locks and post-wait PostgreSQL timestamps. Preserve that
expanded proof as the compatible-integrity baseline; later database invariants
and fixed RLS authority still require their own review and proof.

The ordinary Message private-object pass has its own execution contract in
`docs/message-private-object-remediation-plan.md`. Preserve one Message per
attachment for the first release, store new object identity in a private
one-to-one child that references rather than duplicates the `DirectUpload`
key, keep new sends image-only, and classify legacy public URLs before
separately approved copy/rewrite/deletion. Legacy UploadThing/UTFS URLs are a
separate allowlisted provider class, not R2 keys; copy and retirement need
their own bounded fetch/delete evidence. Fixed database operations constrain
behavior but do not authenticate their asserted participant ids; Clerk,
server-side actor resolution and exact call-site guards remain load-bearing.
`DirectUpload` remains a separate shared lifecycle RLS group (CM-A21); do not
silently bundle its cross-product authority into Message or Case. Complete
that separate rollout before production promotion of either private-object
path.

The CM-A21 execution contract lives in `docs/direct-upload-rls-audit.md`.
Public media needs a normalized multi-reference ledger because seller-owned
images may validly appear in more than one Listing/Profile/Blog/Broadcast
source; private Case/Message objects stay single-reference. The target posture
is FORCE RLS with no direct runtime table access and only fixed
record/verify/reference/release/export operations. Cleanup lease/complete/fail
must use a dedicated NOBYPASSRLS worker role rather than the ordinary request
runtime because the worker necessarily receives bounded cross-user object
keys. Refactor private
attachment children to reference the lifecycle row rather than duplicate its
key. Production promotion waits for aggregate legacy inspection, reference
backfill, exact PostgreSQL proof and pooled-runtime postflight.

CM-A21 preparation now uses a service-only reference ledger plus
source-derived public family operations; the generic application claim API is
removed in the draft. Public reuse is reference-counted, source deletion
releases references through database triggers, and Listing/Review mutation
paths defer object deletion to the fenced cleanup worker after the last
reference. This is still compatible preparation only: DirectUpload RLS remains
off and its old table grants remain until the reviewed activation/drain split.
Production now has the four PR #58 Case/CaseMessage preparation migrations and
compatible app at exact commit
`da4489ace5a592880a325c3e6f90bad7ded8ee37`, with Case evidence disabled at
build and runtime. It does not yet have the DirectUpload reference-ledger,
authority or public-reference preparation migrations.
The earlier exact preparation tree passed PostgreSQL 16.14
authority/concurrency proof in run `30225445722`; retain that evidence without
treating it as activation. A later Extra-High review correctly superseded it:
the Case child conversion must retain `objectKey` temporarily, database-derive
and validate `directUploadId` for old writers, dual-write from the new app, and
create/release normalized references through triggers. After compatible app
deployment and old-instance drain, separately prove equality and drop the
duplicate key before DirectUpload activation. The amended exact tree requires a
fresh disposable PostgreSQL proof. That proof is now accepted at exact commit
`6c1dba12`: PostgreSQL 16.14 run `30226543504` applied all 166 migrations and
passed the global grant/RLS audit plus six authority/concurrency checks,
including old/new Case attachment binding and release. It recorded no
persistent-staging or production change. Treat it as compatible-preparation
evidence only, not activation. A subsequent exact-old-writer review found that
the Case route fills legacy `claimedById` after its attachment insert; the
insert reference trigger therefore must be deferred until transaction commit,
not immediate. The corrected harness executes that full old transaction and
the new dual-write transaction. This supersedes the run for release
compatibility. The corrected exact tree passed GitHub Actions run `30226904740`
(job `89858487348`) at commit `ce4a914b` on PostgreSQL 16.14: all 166
migrations, runtime-grant convergence, global grant/RLS audit and all six live
authority/concurrency checks passed, including both full old/new writer
transactions. It recorded no persistent-staging or production change. Treat
this as compatible-preparation evidence only, not DirectUpload activation.

Do not activate DirectUpload or enable either private-object surface until
aggregate legacy classification/backfill, the dedicated cleanup-worker role,
rollback and pooled-runtime postflight gates are complete. The compatible
schema/application checkpoint may be promoted first only with
`CASE_EVIDENCE_ATTACHMENTS_ENABLED=false`; that disabled release is what makes
the required old/new application drain possible. Withhold the unused future
private-message recorder from ordinary-runtime activation until CM-A20's
compatible application release consumes it.

The DirectUpload aggregate-only legacy inspector and its protected serialized
workflow are now saved. Exact disposable PostgreSQL 16.14 run `30228466175`
(job `89862786290`) at `c748758e` passed all migrations, grant convergence,
global catalog audit, the six retained authority/concurrency checks and the
seventh `aggregate_only_legacy_query` check, with no persistent-staging or
production change. This proves the count query executes against the compatible
schema; it does not classify production and does not authorize backfill,
constraint validation, object mutation or activation.

The final 2026-07-27 Extra-High authority review then found two
pre-production gaps: the new SellerBroadcast image path did not fail closed on
an `untracked=1` cleanup race, and account-deletion media functions rejected
already-banned accounts because they reused interactive actor validity. The
broadcast create now requires every selected image to be tracked inside its
serializable transaction. Account URL collection/release now allows an
existing, not-yet-deleted banned account while ordinary upload/export
operations remain denied. The proof harness adds an eighth
`banned_account_lifecycle_cleanup` check. This migration edit supersedes
`30228466175` for release. Fresh exact-tree PostgreSQL 16.14 run
`30327497254` (job `90175815165`) passed at executable commit `546c112f`: all
166 migrations, production-style grant convergence, migration status, the
global grant/RLS audit, static contracts and all eight live checks passed. It
recorded no persistent-staging or production change. Treat it as compatible
preparation evidence only, not DirectUpload activation.

The cleanup credential must not be added to the main Vercel project. The
existing runtime isolation guard intentionally rejects every PostgreSQL URL
outside `DATABASE_URL`, and co-locating a worker URL would expose it to the
same application-compromise boundary it is meant to escape. The accepted
activation design uses a separate protected GitHub environment,
`Production DirectUpload Cleanup`, with the dedicated direct Neon worker URL
and a cleanup-only R2 credential scoped to the two exact buckets. The worker is
bounded, non-overlapping, does no bucket listing, verifies FORCE/ACL posture
before leasing, and retains only sanitized mode-0600 count/hash evidence.
Provisioning creates no role or password; the external LOGIN and secrets
require their own reviewed provider step. This scaffold remains manual-only.
Add its hourly schedule in the activation release that removes the Vercel
cleanup schedule, after the external worker boundary and failure notifications
are proven.

Provider preparation began on 2026-07-28 without activating cleanup. The
main-only protected `Production DirectUpload Cleanup` GitHub environment now
exists, and the dedicated direct Neon LOGIN
`grainline_direct_upload_cleanup` was created on the production branch. Its
connection URL is stored only in that environment, alongside its SHA-256
digest; it was not copied into Vercel or the ordinary Production environment.
The role must be converged and proved through the exact-main owner-only
`DirectUpload Cleanup Role Provision` workflow before it is usable. That
operator preserves compatible runtime authority and proves in a read-only
postflight that DirectUpload RLS is still off.

The first provider role was created through the Neon API and was correctly
rejected before receiving any cleanup grant: Neon API roles inherit
`neon_superuser`-class attributes and membership. Replace that unused role
through the guarded SQL-role provider-remediation operator, rotate the
protected cleanup URL, then rerun the exact-main role-provision workflow.
Do not weaken the cleanup-role posture to accommodate provider defaults.
PostgreSQL 16 does force one narrowly reviewed reverse bootstrap edge when
`neondb_owner` creates the replacement through SQL: `neondb_owner` is a member
of the cleanup role with ADMIN only, INHERIT/SET disabled, granted by
`cloud_admin`. This cannot be removed by the non-superuser creator. Accept only
that exact non-effective edge (or zero edges if a provider superuser removes
it); continue requiring zero cleanup-role parent memberships and no other
direct or transitive members.

The first actual replacement attempt at exact main `f66aa92f` safely crossed
only the provider-delete boundary, then failed before the SQL replacement
committed. The cleanup role is absent and the protected secret/digest remain
the rejected, now-unusable values; RLS, grants, data, deployment, cleanup and
R2 are unchanged. Resume only through the explicit already-deleted-role path:
prove provider and catalog absence, prove the exact-name ordinary replacement
inside rollback, create it once, authenticate directly, then rotate only the
protected cleanup secret and digest. The normal path must also wait for
database-catalog absence after Neon reports deletion complete so this
non-replayable boundary cannot recur.

The first guarded already-deleted-role recovery at exact main `1d4c5fe2`
passed every rollback-only check, then failed inside the committed
replacement-create step. Reconciliation again found the role absent and the
protected secret/digest unchanged. Preserve the safe absent-role state while a
bounded SQLSTATE-only diagnostic is reviewed; do not print raw database errors
or weaken the replacement posture to make the create pass.

The SQLSTATE diagnostic classified the repeated exact-name commit as
PostgreSQL `XX000`, while both rollback probes passed and every failed
transaction left the role absent. Retire that provider-tombstoned identity.
Use `grainline_direct_upload_cleanup_v2` as the cleanup principal, keep the old
name separately forbidden, and remove the provider-delete path entirely.
Because the principal is embedded in generated activation ACLs, a fresh full
disposable activation plus database-first rollback proof is required before
creating the versioned production login.

That fresh versioned proof passed, but the first exact-main `v2` production
creation also failed at commit with PostgreSQL `XX000` and left both role names
absent. This disproves the narrower assumption that only the deleted name was
blocked. The remaining shared operation is supplying a client-built SCRAM
verifier to Neon SQL, the same credential path already retired for the owner
rotation after `XX000`. The next guarded candidate must instead pin
`password_encryption=scram-sha-256` and pass the generated password only
through process memory/`psql` stdin so PostgreSQL performs the hash. Never put
the password in argv, logs, evidence or git, and retain every existing
attribute, membership, target and direct-authentication assertion.

Exact main `9c853676` proved this correction in production: the v2 ordinary
login committed, authenticated directly, retained only the reviewed
non-effective reverse bootstrap edge, and rotated only the protected cleanup
URL/digest. The first three-function provision run then failed before grants
because the older global migration-owner guard had not incorporated that
already-reviewed third membership row. Keep the edge accepted only as
`ADMIN=true`, `INHERIT=false`, `SET=false`; update every shared owner-posture
contract together, and rerun the protected provision workflow from fresh exact
main. Do not broaden the acceptance to arbitrary child roles or options.

That correction merged as exact main `4f859fc8`, and protected run
`30409531954` (job `90442358212`) passed the exact-main preflight,
three-function cleanup grant, read-only postflight and sanitized artifact
upload. The v2 role now has only the reviewed cleanup functions and no
relation, column, sequence, default, create, parent-role or unexpected
DEFINER authority; compatible runtime access remains intact and DirectUpload
RLS remains off. The next gate is the cleanup-only, bucket-scoped R2 deletion
credential plus disposable-object delete proof. Do not reuse application R2
credentials or promote/schedule DirectUpload activation before that gate.

The cleanup-only R2 deletion credential is still absent because no signed-in
Cloudflare control surface was available. Do not substitute the application's
R2 credential. Keep the worker, hourly scheduler and DirectUpload activation
blocked until a cleanup-only key is scoped to the exact public/private buckets
and its provider deletion behavior is proved.

The retained proof path is deliberately independent of the cleanup worker:
the worker must fail closed until DirectUpload is FORCE-protected, while the
credential must be proved before activation. A manual-only protected GitHub
workflow therefore writes, heads, deletes and re-heads one random disposable
object in each exact bucket, receives no database or application R2
credential, performs no bucket listing, and records only sanitized hashes and
bounded outcomes. Any possible residual object fails the gate.

The 2026-07-28 Extra-High review also widened the cleanup-role invariant from
the DirectUpload function namespace to every accessible public
`SECURITY DEFINER` function, both role-membership directions, column-only and
table-like relation grants, default grants, and exact DirectUpload function
security posture. Pure public `SECURITY INVOKER` validators remain callable but
carry no owner authority and the cleanup role has no underlying relation
privileges. The older seven-check cleanup-role proof is superseded. Exact-tree
disposable PostgreSQL 16.14 run `30329597171` (job `90181797774`) passed at
executable commit `e407271e891f59330b20fb50a127b21f2a598364`: all 166
migrations, runtime and cleanup-role convergence, migration status, the global
grant/RLS audit, static contracts and all eight live authority/lifecycle checks
passed, with no persistent-staging or production change. This accepts the
scaffold's hardened database authority partition only; live provider
credentials, R2 deletion, scheduling and DirectUpload activation remain
separate gates.

The compatibility-key retirement and DirectUpload activation releases are now
live in production. The activation recovery accepted the exact policyless
`ENABLE` plus `FORCE` posture and the 17 runtime / 3 cleanup / 15 private
function partition. The dedicated cleanup worker remains unscheduled and Case
evidence remains disabled until the restricted-role activation postflights are
accepted.
The retirement boundary drops only the duplicate Case attachment key after
exact legacy/reference proof; the disabled app persists only
`directUploadId`. Activation retains zero policies and zero direct table
authority, partitions the 35 reviewed functions as 17 runtime / 3 cleanup /
15 private, and withholds the unused private-message recorder. A
database-first compatibility rollback is part of the activation gate and
restores the exact activated state afterward without recreating the retired
duplicate key.

A 2026-08-01 pre-merge audit found one additional compatibility prerequisite:
the live Vercel cron still calls cleanup functions through the ordinary runtime
role, which activation intentionally revokes. Prepare, merge and deploy the
separate ordinary-runtime cleanup-retirement release first; verify the Vercel
schedule and route are absent and drained; then rebase and re-review activation.
Keep the dedicated GitHub worker manual-only during this bounded gap. Its hourly
schedule is a separate post-activation release, not part of either the
compatibility deploy or FORCE migration.

The first combined disposable run (`30232279615`, commit `af4d0f8e`) stopped
fail-closed while applying activation after retirement; Prisma surfaced only
the secondary aborted-transaction message. It is not activation evidence and
changed no persistent environment. Preserve the failed record and require a
fresh PostgreSQL 16 run with exact statement diagnostics, live activated
authority, rollback and zero-residue restoration before promotion. This does
not change production sequencing: compatible disabled app and drain,
aggregate-only production inspection, separately approved repair/backfill,
provider/worker proof, activation, pooled-runtime postflight, then a separate
Case private-evidence release.

Diagnostic run `30232434982` exposed the underlying failure as one missing
parenthesis between two activation postflight ACL predicates. The activation
transaction had reached its final audit after applying its revokes, grants and
RLS flags, so PostgreSQL's transaction rollback prevented any partial state.
The syntax and class-specific regression contract are corrected; the run
remains failed evidence and a fresh exact PostgreSQL pass is mandatory.

Run `30232549766` subsequently proved the corrected activation SQL applies and
both roles reconverge, but the global audit stopped on its older expectation
that all four compatibility/cleanup functions stay runtime-executable. Keep
the least-privilege design; the audit now derives the activated private set
from the exact 35-function catalog. This run also remains failed disposable
evidence and does not satisfy the live-authority or rollback gate.

Run `30232738558` passed the activated global audit and migration status but
then reran an unstaged-tree cardinality test after intentionally adding both
disposable candidates. Keep that source-inventory contract before staging;
post-staging, run only state-independent harness contracts. The run remains
failed evidence because live activated authority and rollback did not execute.

Run `30232827314` reached live activated catalog proof after every preceding
gate passed, then stopped because its identity comparison used PostgreSQL's
named-argument display against a type-only callable catalog. Use
`oidvectortypes(proargtypes)` in both live proofs; do not weaken the exact
identity comparison. Behavioral authority and rollback still require a fresh
pass.

Exact commit `7de1b836` passed the complete disposable CM-A21
retirement/activation program in PostgreSQL 16.14 run `30232923132` (job
`89875033710`): 166 committed plus 2 staged migrations, compatible and
activated global audits, exact 17/3/15 function partition, direct table
denials, fixed runtime behavior, cleanup lease fencing, database-first
old-app-compatible rollback and exact activation restoration. Both proof
payloads recorded no persistent-staging or production change. Treat this as
accepted disposable-engine evidence only; all production/provider/legacy
inspection and feature-release gates above remain mandatory and separately
approved.

Final proof commit `6449d722` passed PostgreSQL 16.14 run `30233243581` (job
`89875935635`) after adding explicit foreign Case-attachment denial and
post-rollback `objectKey`-absence checks. That run remains useful design
evidence but is superseded for release by the later cleanup-role hardening and
integrated SQL review. Both generated candidates must take their fixed-order
exclusive table locks before inspecting mutable state; activation must reject
both role-membership directions and any non-ordinary DirectUpload catalog
entry. A fresh exact-tree disposable activation and database-first rollback
pass is required. These corrections do not change any production gate or
authorize promotion.

The corrected exact-tree PostgreSQL 16.14 run `30330329787` (job
`90183904860`) passed at executable commit
`b843e21e88bfa79f4951e2e18329408671b9f49a`. It repeated the 166-migration
compatible authority program, staged the reviewed retirement and activation
candidates (SHA-256 `adbad525ca29a6ea42227d3b196659a04b8a39daf0dbb06a859ba3b5dca3a9d6`
and `fe4da53160f2add8a7303bcca0a6bc310b07cdb02e16c39213cabf63a56cec21`),
then passed activated role convergence/global audit, the four live authority
checks and database-first rollback/exact restoration with no
persistent-staging or production change. This accepts disposable database
evidence only; every production/provider/legacy/drain/private-feature gate
remains separate and explicitly approved.

The promoted production activation later failed at exact run `30729632410`
with zero applied steps. Read-only inspectors proved the full transaction
rolled back and isolated the cause to an over-broad membership preflight: Neon
records one exact non-effective cleanup-role-to-`neondb_owner` edge granted by
`cloud_admin` with ADMIN true and INHERIT/SET false. The corrected migration
accepts only that tuple while continuing to reject every runtime edge, cleanup
parent edge, other direct member and transitive member. Disposable PostgreSQL
16 recovery run `30734098369` reproduced the original checksum failure,
resolved only that loopback ledger row, replayed the corrected checksum and
passed activated authority, migration status, global grants and rollback.

Production DirectUpload activation recovery completed successfully in run
`30877508811` from activation commit
`64409058d0023a434b36f1af31655caeb4915ac3`. It found no pending or incomplete
migrations, skipped ledger resolution and migration replay, converged the
reviewed grants, passed the global grant/RLS audit, and accepted the activated
owner proof. The original failed activation row is rolled back, the corrected
row is applied, and the historical listing-variants alias remains an exact
zero-step rolled-back row; there is no remaining production ledger repair.

Cleanup-role postflight run `30877717135` then failed safely because the
restricted cleanup role correctly cannot read `public._prisma_migrations`.
Do not grant either restricted role ledger access. Bind the corrected
postflights to the successful recovery run and accepted activation commit,
verify those workflow runs through the GitHub API, and prove the exact runtime
and cleanup postflight code in disposable PostgreSQL sessions where direct
ledger reads fail with `42501`. Case evidence, cleanup scheduling, token
retirement and provider-variable changes remain later, independent releases.

### Messaging architecture decision (2026-07-22)

Keep one ordinary Conversation per unordered participant pair. Do not create a
new inbox thread for every listing: that fragments the relationship, duplicates
blocking/reporting state and becomes noisy for active buyers and shops. Preserve
the listing that prompted a message on the individual Message instead. The
nullable, source-validated Message Listing context is a pre-RLS compatibility
requirement, not permission for callers to select arbitrary private listings.

`isSystemMessage` means server-generated structured presentation, not database
authority. Commission-interest and custom-order-ready cards use it; a
buyer-authored custom-order request does not. Authorization always comes from
the durable source relationship and fixed operation.

Do not give staff a general read/write bypass into ordinary buyer-shop threads.
Exact unresolved-report review remains read-only. `/support` already provides a
reference-numbered request and staff queue, while Case/CaseMessage provides
staff-visible dispute discussion. If Grainline later needs Etsy-style in-product
staff outreach, build visibly branded SupportThread/SupportMessage records with
assignment, audit, retention and separate RLS rather than impersonating a user
or reusing ordinary Conversation.

The Conversation/Message relational shape, bounded keyset windows and compound
indexes are intended to support 50,000-plus registered accounts. That is not a
50,000-concurrent-stream promise. The current SSE endpoint holds a serverless
response and polls PostgreSQL every 3–10 seconds per open thread; move delivery
to managed realtime/fanout before sustained high concurrent messaging while
retaining the same participant-scoped database read contract.

Deploy the nullable Message listing-context relation and read indexes as an
additive compatibility release before the application checkpoint. Its exact
migration phase is `conversation-message-compatibility-reviewed`; it does not
enable RLS, narrow grants or authorize the later authority migration.

The following messaging product work is intentionally after ordinary
Conversation/Message RLS and is not an activation prerequisite:

- visibly branded `SupportThread`/`SupportMessage` staff outreach, followed by
  an optional customer-visible history for existing `/support` requests;
- managed realtime/fanout once sustained concurrent open threads make the
  current SSE database polling inappropriate;
- convenience features such as typing indicators, reactions, editing/deleting
  user messages or richer delivery/read receipts, each with its own retention
  and abuse semantics;
- Case/CaseMessage product upgrades such as evidence attachments, staff
  assignment/SLA tooling and a deliberate appeal/reopen policy. Evaluate these
  during the separate Case pre-RLS audit rather than coupling them to ordinary
  messaging activation.

These are named deferrals, not forgotten work. Per-listing ordinary threads are
not deferred: that alternative was reviewed and rejected in favor of one pair
thread plus per-Message listing context. Attachment kind normalization,
message-search indexing, long-history pagination, timestamp correctness and
mobile horizontal-overflow repair remain in the current pre-RLS scope.

Durable scale review triggers and the reasoning behind these deferrals live in
`docs/scaling-decisions/`. Update the relevant record when production evidence
changes a threshold or architecture decision so deferred work is not mistaken
for forgotten work.

### Prelaunch RLS rollout proportionality (2026-07-22)

The confirmed prelaunch/no-dependent-users state permits shorter operating
windows, not weaker policy or compatibility proof. Do not impose a fixed
12-hour drain or repeat an unrelated provider benchmark solely for ceremony
when there are no customer requests to drain. Before compressing a wait,
reconfirm that no customer traffic, webhook, cron, queue, or administrator flow
can still use the superseded shape. Preserve the evidence explaining why the
shorter window was safe.

Keep the controls that catch correctness and release-shape defects even before
launch: ephemeral PostgreSQL authority/direct-denial/race proof; exact grants
and function ACLs; legacy-data inspection and backup before destructive
cleanup; atomic purge/backfill decisions; old/new application and database
compatibility; authenticated route smoke; and database-first rollback
semantics. Use separate preparation and activation migrations whenever an old
application build cannot safely coexist with the narrowed grants or new policy
surface. The absence of users does not stop Vercel build overlap, cron, or
webhook execution by itself.

Provider performance/locality proof is risk-triggered after Bucket B rather
than automatic for every table. Require it for a new hot path, interactive
transaction or pooling design, lock/concurrency behavior, cross-region change,
or material source-validation joins. Ordinary direct-owner tables may rely on
ephemeral PostgreSQL plus authenticated application smoke when review shows no
new provider/runtime performance question. Notification still requires a fresh
successful provider run because its real one-statement recipient RPC and
source-validation workload have not yet completed once in Vercel. Continue to
activate Notification, messaging, orders/payment/shipping, and cases as
separate tightly coupled groups; prelaunch is not permission to combine their
authority boundaries into one release.

### Runtime owner-credential separation result (updated 2026-07-21)

The release is complete and accepted in production; retain the exact contract,
failed-attempt history, evidence hashes, rollback posture, and operator rules in
`docs/runtime-db-credential-separation.md`. Vercel application builds must never
run owner migrations or receive an owner/admin database variable. Production
migrations run only from the manually approved, main-only GitHub `Production`
environment, and automatic Vercel production deployment from `main` remains off
so migrations and application promotion cannot race. The owner credential lives
only in that protected environment and ignored mode-0600
`.env.migration-owner.local`; `.env.local` is runtime-only. Any ambiguous future
control-plane reset must use reveal-based recovery and must never blindly issue
a second reset. Do not weaken the production-equivalent `LOGIN NOINHERIT`
runtime role fixture or the Vercel privileged-variable guard.

### Bucket B Notification design decision (2026-07-19)

Bucket B Notification RLS is complete in production from merged main commit
`213f2f1d036967cacae4ac217307376efbd7c812`: Notification has exact
`ENABLE` plus `FORCE`, two recipient policies, and narrowed runtime grants.
The compatible application remains live as Vercel deployment
`dpl_92rXcp1PqmoMPtgtAswbecAKWEt2`. The full operating record remains in
`docs/rls-bucket-b-notification-plan.md`. The
verified surface has simple recipient reads/mark-read operations but asymmetric
cross-user creation, dedup recovery, global retention, staff source cleanup,
and account-deletion cleanup. Use recipient SELECT/RLS plus
column-level `UPDATE (read)`, with no direct runtime INSERT/DELETE. Cross-user
creation and cleanup require separate fixed-purpose owner-backed RPCs; never
put a second owner/service credential into Vercel. The guarded prelaunch
Notification inspection, atomic activation-time purge, PostgreSQL proof, and
two fresh real-table Notification passes under the reviewed candidate-aligned
provider/route gate were activation requirements and passed. The unchanged
transaction-wrapper limits
remain blocking for any later release that actually uses that architecture.
Activation used separate ENABLE/NO FORCE and FORCE releases after SavedSearch
Phase B and runtime credential separation were live. Preserve that
compatibility-first release pattern for later sensitive groups; do not treat
Notification's completion as authority to bundle Conversation, Message,
Order, payment, or shipping tables into one activation.

The isolated branch contains both recipient candidates. Fixed
`SECURITY INVOKER` recipient RPCs cover bell, page, unread count, mark-one,
mark-many, conversation mark-read, export, and recent low-stock lookup in one
database round trip per application operation; the prior interactive-transaction
bell/page wrapper is retained only in Git/evidence history after its executable
candidate file was removed. The
2026-07-22 provider attempt selected the one-statement RPC direction: its
target/burst candidate comparisons passed with zero request or isolation errors,
while the generic wrapper crossed seven unchanged 2x adoption/hold thresholds.
The run consumed slot 1 and failed the existing generic gate, so it is not
promotion evidence and slot 2 was not called. Do not weaken the thresholds or
rerun for a favorable boundary sample. Before a fresh provider proof, review a
candidate-aligned gate that keeps wrapper limits blocking for releases that use
interactive transactions and requires two fresh real Notification RPC/route
passes for this release. The invoker draft now has disposable PostgreSQL
parse/apply, own/foreign/direct-denial, and context-reset proof; final SQL
authority review, real-table route proof, and authenticated runtime-credential
evidence remain open. Cross-user
creation and cleanup use separate service authority and must not be conflated
with recipient RPCs.

The later real-table provider attempt at commit
`aef7ef2686a0432529a2d17291e2ca04b2fa0714` is failed, consumed evidence too.
Its deployment and exact isolated runtime/database attestation passed, but slot
1 returned HTTP 500 immediately after durable claim because the candidate gate
used invalid `pg_catalog.current_user` SQL. Slot 2 was not called; all provider
resources were abort-cleaned; production was unchanged. `CURRENT_USER` and the
opaque Vercel environment-id validator now have regressions, but no successful
real Notification workload was produced. A fresh provider run remains required
before activation; do not reinterpret the infrastructure attestation as a
runtime pass.

The fresh follow-up at commit
`b295116a27401433e717e5022238c4006fb871c6` also failed after durable slot-1
claim and was not replayed. Its independent deployment attestation passed, but
the real source baseline used invalid `pg_catalog.exists(...)` syntax. The
correct `EXISTS (...)` expression is now guarded, all disposable resources were
again removed, and production remained unchanged. Before another provider
deployment, a reduced real-query local preflight must complete against fresh
fixtures and owner-reset/reseed them; environment configuration is mechanically
blocked until that preflight is recorded. A later successful local diagnostic
does not retroactively accept either consumed Vercel slot.

A third predeployment-only attempt consumed no Vercel slot: its mandatory local
preflight exited before JSON. A direct invocation later reproduced the exact
pre-main defect: unsupported top-level `await` in the standalone TSX CommonJS
output. The attempt was fully abort-cleaned with production unchanged. The
script now uses a CommonJS-compatible invocation with a regression, and the
operator directly invokes a package-metadata-verified, pinned local TSX
`4.21.0` binary instead of relying on `npm exec`; a fresh database/preflight
remains required.

The fourth attempt passed the mandatory local preflight and provider slot 1,
then failed slot 2 only on the fixed per-slot 2x bell p95 ratio. Correctness and
all request error counts remained green. The reversed slots exposed a symmetric
first-measured-workload ramp (`149.1ms` first baseline in slot 1; `147.2ms`
first candidate in slot 2) while the later workloads were `26.8ms` and
`22.9ms`. Do not retroactively accept the failed gate. The harness now primes
each side at full measured concurrency immediately before measurement and must
pass a fresh two-slot proof. The failed environment was fully removed and
production remained unchanged.

The fifth fresh attempt validated the priming correction and completed the
Notification provider gate. Its local preflight and both non-replayable,
order-reversed Vercel slots passed exact correctness, zero errors, the fixed 2x
ratio, and the 250ms candidate ceiling without exception. The bell target,
burst, and service p95s stayed between `21.7ms` and `39.9ms` across both slots.
Success cleanup removed every disposable resource and production remained
unchanged. Treat provider performance/locality as complete for this exact
Notification design. The consolidated Extra High SQL/application authority
review passed at `ab2d08a6` with no new blocker; authenticated route smoke,
activation packaging, full release CI, and production evidence remain open.

Two authenticated route attempts then failed closed before any ordinary user
was impersonated. The first exposed a Preview/production Redis cache namespace
collision; the second proved that email-pattern selection saw only synthetic
provider actors while every Clerk-backed account was unmarked. All disposable
resources were removed after each attempt. Drew explicitly authorized Codex to
create the missing identity. Use one permanent, non-customer, no-password Clerk
operational canary with external id
`grainline-notification-rls-operational-canary-v1`, current legal metadata, one
normal webhook-created production row, zero marketplace activity, and hashed
private evidence. Because live Clerk requires email, derive the canary's
`+grainline-notification-canary` Gmail alias in memory from the sole active
production admin, allow the one normal welcome email to that controlled inbox,
and never print or commit the raw address. Do not create/delete a disposable
live Clerk user:
those webhooks would leave avoidable production creation/anonymization residue.
Authenticated smoke must resolve this exact external id, never an email pattern
or an unmarked account.

The operational canary was created and independently rechecked on 2026-07-22:
one Clerk identity, one signed-webhook production row, no password, current
legal state, zero marketplace activity, and no welcome fallback-outbox row.
Retain it for authenticated preflight/postflight checks. The isolated
authenticated Notification route smoke passed on 2026-07-22 and all disposable
provider resources were removed; next is legacy aggregate/backup inspection
and clean release packaging, not another provider run.

The production legacy inspection must not weaken the owner-credential boundary
to run early from a feature branch. Package its read-only workflow with the
preparation release, merge through normal review, apply the compatible
preparation migration, and then dispatch the exact clean `main` SHA through the
main-only GitHub `Production` environment. The operator must verify the
protected credential digest and prepared/no-policy/legacy-CRUD posture, run one
repeatable-read read-only transaction, and retain aggregate counts only. The
activation purge remains a later locked transaction; the inspection itself may
never delete or export rows.

The first production package carries only the compatible preparation migration;
the activation migration must remain absent. The promoted preparation artifact
is byte-pinned separately, with a verifier proving its executable body matches
the disposable PostgreSQL candidate and that the only differences are
promotion comments/terminal whitespace. Re-run the disposable PostgreSQL
compatibility and rollback workflow against that committed preparation file,
then exclude all endpoint-specific Preview runners and exceptions before clean
release review.

The clean release derivative keeps the generic/context PostgreSQL harness and
the Notification provider measurement implementation as non-runtime scripts,
but ships no `/api/internal/rls-context-gate` route, middleware exemption, or
runner-only test. The branch-scoped Vercel deployment-disable entries and the
temporary duplicate-database-URL build exception are also removed; only the
standing `main: false` deployment interlock remains. Historical authenticated
smoke/operator sources are retained as reproducibility records without an
active package command. Production promotion is guarded by the exact
preparation migration/tree verifier rather than by the former broad
"draft file exists" Vercel build prohibition.

Live Clerk does not permit backend `sessions.createSession` for this production
instance. Authenticated operational proofs must use a short-lived one-use Clerk
sign-in token consumed by the production Frontend API `ticket` strategy, then
revoke every resulting canary session and any unconsumed token in mandatory
cleanup. Do not loosen this into password login, ordinary-user impersonation,
or a retained browser session.

The isolated service-authority draft now uses seventeen owner-backed functions:
one runtime-ungranted fixed-column core, ten granted creation families, one
dedicated back-in-stock claim/create/consume operation, three exact cleanup
operations, and two fixed retention batches. Runtime receives exact execute
privileges only on the sixteen fixed-purpose entry points;
direct Notification insert/delete and the default public function privilege
remain revoked. The application paths are wired to the draft and broad legacy
Notification cleanup fallbacks have been removed from runtime code. Because the
site remains prelaunch with no users relying on notifications, a guarded
owner-only operator may inspect legacy aggregate counts. The purge must be the
first locked step inside the same transaction that activates Notification RLS;
a standalone reset would leave a recreation race. If the no-users premise
changes, the purge is
prohibited and a backfill must be designed. Application-asserted `app.user_id` is
not database-authenticated identity and a compromised runtime can forge it;
fixed-purpose constraints limit that residual without eliminating it.
In addition, most durable source/audit tables remain ordinary runtime-CRUD
tables until their later independent RLS or database-isolation groups. A fully
compromised runtime may therefore fabricate upstream evidence before invoking a
narrow Notification wrapper. Bucket B still removes direct arbitrary
Notification writes and caller-controlled payload/target identity, but it is
not a complete arbitrary-runtime-compromise boundary on its own. Close that
dependency through the site-wide program; do not activate orders, messages,
cases, and audit ledgers in the same Notification release merely to make a
broader claim.

The existing site-wide runtime-role tooling is part of the Bucket B security
boundary, not a later cleanup. It now runs provisioning mutations
transactionally, aborts on partial Notification RLS state, and converges an
activated Notification table back to `SELECT` plus column-only `UPDATE(read)`.
It also converges all 25 Notification RPC ACLs while keeping the private create
core runtime-ungranted. The grant audit derives FORCE expectations from ordered
migration history and checks the exact Notification policies, column grants,
function owner/mode/search path/overload shape, PUBLIC revokes, and runtime
execute split. The release topology is explicitly split: a preparation
migration installs the schema/RPC surface while retaining disabled RLS, zero
policies, and legacy table CRUD; the RPC application deploys and is verified;
only then may a locked activation migration purge pre-authority rows, install
the policies, enable initial `NO FORCE`, and narrow table grants. Keep three
evidence layers distinct:
the AST gate covers all 55 application emission paths; disposable PostgreSQL
run `29893071538` at exact source
`187ac2fa5a5b7c08a3889b27ef57c873ee7a79ea` executes all 26 family-dispatched
private-core source-validation branches plus the dedicated back-in-stock claim
with valid creation, stable replay, and forged-recipient or mismatched-evidence
rejection. Its 59 creation cases cover all 38 successful source/type pairs and
the security-relevant action, status, and recipient-direction variants within
those source types. The accepted run also proves post-draft role
provisioning reconvergence and the catalog proof on fresh PostgreSQL 16. The
generic grant audit's Notification migration-inventory branch is now exercised
by the later split-migration proof described in the Bucket B operating record;
do not retroactively count the earlier draft run as that proof.

Extra-high review accepts the current source-derived shared create function and
split migration topology for continued proof, not production activation. The
original 54/54 and 55/55 callsite results, current 56/56 result, and 59-case live result
validate the architecture, the
granted boundary, every top-level private-core source branch, every successful
source/type pair, and the security-relevant action/recipient variants.
The latest isolated PostgreSQL proof is green and also passes catalog/grant,
direct-denial, recipient context reset, service replay, the one-shot stock
claim, and both two-session block-race checks. The byte-pinned split migration
and database-first rollback have passed disposable PostgreSQL proof. Provider
route/authentication and application-deployment rollback evidence remain
separate. This narrows the remaining work; it does
not by itself select the recipient architecture, replace provider/performance
proof, prove the production authentication path, authorize merge, or activate
any persistent database. The later 2026-07-22 provider result above selects the
RPC direction without converting either proof into activation evidence.
Do not deploy the long-lived Notification branch for the remaining real-table
provider proof. Its unapplied SQL drafts deliberately make every
Vercel build fail closed, and automatic deployment is disabled for that exact
branch. Use a freshly reviewed disposable proof branch with only the exact
candidate and temporary Preview runner artifacts needed for the next proof.
The runner branch and all branch-scoped provider credentials/resources must be
deleted after sanitized evidence and teardown proof are retained; the generic
harness, regression tests, and operating record remain durable.
The granted wrappers no longer accept notification title, body, link, or dedup
identity. The private core derives all four inside owner authority from the
validated recipient, type, source row, related actor, and source-specific
columns. App-level title/body copies are non-authoritative compatibility
evidence; link and dedup scope are telemetry only. Social/content/message/commission
absence-of-block checks now share a deterministic lock protocol with every
ordinary block/unblock writer: notification creation takes sorted-pair
`FOR SHARE`, while block mutation takes sorted-pair `FOR UPDATE`. Account
deletion retains its earlier conflicting lifecycle lock before block cleanup.
The owner core rejects isolation other than `READ COMMITTED`, and ordinary
block mutations request it explicitly, so a stale transaction snapshot cannot
silently weaken the absence check. This is statically guarded but still needs
two-session PostgreSQL race proof.
Retain provider performance proof for the source-validation joins.

The message family uses `Message.id` as its durable source. For custom-order
ready links, the private core extracts the listing id from the structured
message, checks the reserved buyer, seller, conversation and listing status,
and derives the canonical route. It is not stored as a second
Notification source field.

The inventory family is complete in the isolated draft. Checkout low-stock binds the
exact order item to a paid order, completed stock reservation, listing owner and
current low-stock state, then derives payload, route and replay identity inside
owner authority. Manual low-stock now writes durable audit evidence atomically
with the row-locked listing update and derives its payload, route and identity
from that event. Back-in-stock writes durable restock-transition evidence with
the stock mutation, then atomically validates that audit and the locked
subscription, creates the preference-gated Notification, consumes the one-shot
subscription, and exposes only the winning claim to email fanout.

The verification/Guild family now binds seven staff transitions to the exact
durable, non-undone AdminAuditLog row co-committed with the state change and binds three
cron transitions to fixed-job SystemAuditLog evidence. The first metrics warning
was moved into an audited transaction; the owner wrapper derives payload and
route only after validating actor, recipient, verification status, and Guild
level.

The listing-moderation and account-warning families are also complete in the
isolated draft. Listing approval/rejection returns the exact staff audit written
with the transition; listing reports use the durable `UserReport`. A successful
admin email writes bounded notification content into a strict post-send audit
before attempting the in-app row. Banned-seller buyer warnings use a compound
ban-audit/order event, validate that the order is listed in the ban snapshot,
and retain the banned seller as exact related-user lifecycle metadata.

The order/payment/fulfillment family completes creation coverage. Checkout
buyer/seller notifications bind the atomic checkout-order audit; three seller
fulfillment transitions co-commit a user-attributed system audit; seller and
blocked-checkout refunds plus Stripe disputes bind `OrderPaymentEvent`; payout
failure binds `SellerPayoutEvent`. The owner wrapper derives the recipient,
counterparty, payload, route, and replay identity from those ledgers and exact
order relationships.

Production activation also has a permanent completeness gate:
`npm run audit:rls-notification-readiness`. It inventories the real TypeScript
emission paths, requires the exact 56-path contract, and fails on dynamic calls,
missing source pairs, or source constants that do not dispatch through a
reviewed service family whose draft SQL function, `PUBLIC` execute revoke, and
runtime grant are present. Its current 56/56 result passes the
creation-authority gate; ordinary tests retain the exact count and authority
surface tripwires so new or dynamic paths cannot disappear silently. This green
gate is only one activation prerequisite.

Use a hybrid rather than either extreme. Do not grant runtime the current
generic arbitrary-type/arbitrary-recipient creator, and do not collapse the
completed paths into identical lifecycle metadata. Keep the
fixed-column insert primitive private to the function owner and expose only
family-specific operations keyed by stable domain ids and small event
discriminators. The ten-family inventory and implementation order live in
`docs/notification-create-authority-inventory.md`. This preserves meaningful
write-side defense in depth while keeping database validation proportional to
what each application, staff, cron, or provider flow can actually prove.

Notification initial production activation completed on 2026-07-22. Protected
production inspection found 58 legacy rows; all 58 lacked
the new source and related-user authority fields. The sanitized aggregate-only
evidence is retained outside the repository with SHA-256
`89664c97252c2ec8528cb0b58da422f6eb003c5d2c37d232f7ae9eefd6372d0b`.
Neon branch `br-hidden-tree-aa337i8v` is a protected, no-compute backup of the
production parent at LSN `0/4A7E8628`; retain it through the activation rollback
window. The activation purge is deliberate because the pre-authority rows
cannot be made source-valid, but the backup preserves their exact database
state if forensic recovery is needed.

The compatible application rollback rehearsal passed before activation:
`thegrainline.com` moved from new deployment
`dpl_92rXcp1PqmoMPtgtAswbecAKWEt2` to known-good prior deployment
`dpl_6Y6C3NT81zbhLc6eHJAveCH1Ave8`, both `/` and `/api/health` stayed HTTP 200
with health `ok`, and the new deployment was restored and re-attested. The
activation release branch `codex/rls-notification-activation-20260722` promotes
only migration `20260722052000_enable_notification_rls`; promoted SHA-256 is
`f4b475d5f7c071011e35425b68bc26738bae8696c658457d8ed55ebffc8ddc92`,
and its executable body matches accepted disposable candidate SHA-256
`e40994886a143101141c7114ed8ea2f92917ccdd349fe96a0874a2cb79561329`.
PR `#34` merged the activation package at
`aa3f2c3640c2cb62200c1d660a08ac217271a037`. Main CI `29952665651`, committed
PostgreSQL proof `29952665786`, and protected production migration
`29952892477` passed. Mode-0600 production postflight evidence
`notification-production-postflight-aa3f2c3640c2.json` has SHA-256
`06b635c8249cfdc864a5e133d6edcd2e0805b57537903c4ef13b337057a6463e`.
It proves exact live catalog/grants, zero rows visible without context, own-row
visibility with transaction-local context, denial of direct insert/delete/title
update, no context leakage after rollback, authenticated bell/page isolation,
non-enumerating foreign mark-read behavior, own/read-all mutation, HTTP 401/403
boundaries, and complete fixture/session/token/cache cleanup. That initial
activation remains the preserved compatibility and rollback baseline for the
completed FORCE release recorded below.

Notification FORCE hardening completed on 2026-07-22. PR `#36` merged exact
FORCE head `b7873218f7929f791b6d5e422e647e1598421c91` to main as
`213f2f1d036967cacae4ac217307376efbd7c812`. Migration
`20260722053000_force_notification_rls` changes only the table FORCE flag;
it does not alter rows, policies, grants, functions, or app code. It fails
closed unless the live initial catalog, runtime/owner role posture, exact policy
pair, ownership, and narrow grants match the accepted Phase-A state. Its
reviewed SHA-256 is
`f5e0f906671d21ec7d249e05be681753a81700cfe82a265f37bb4754e315f774`.
PR FORCE proof `29955500231`, PR CI `29955527920`, main FORCE proof
`29956127053`, and main CI `29956127009` passed. Protected production migration
run `29956750176` passed the exact source/owner/role preflight, artifact and
activation-equivalence guards, committed FORCE apply, migration status, and
live catalog/grant audit.

Fresh FORCE production postflight used operator commit
`74da7a2099d1289b0735091f52712af3607ad151` against exact release main
`213f2f1d036967cacae4ac217307376efbd7c812`. It re-proved `rlsEnabled=true`,
`rlsForced=true`, two policies, narrow runtime grants, no-context zero-row
visibility, own-row isolation, denial of direct insert/delete/title update,
transaction-local context cleanup, authenticated bell/page projection,
cross-origin and unauthenticated boundaries, non-enumerating foreign mutation,
own/read-all mutation, and complete fixture/session/token/cache cleanup.
Sanitized mode-0600 evidence
`notification-production-postflight-213f2f1d0369.json` has SHA-256
`637d85180b6b78f0e3edd9da911dcf906f8edcd9eaaf3a4888c5ae432b592bad` and
retains no raw identifier or credential. Bucket B is complete; retain the
protected preactivation backup through the rollback window. Conversation plus
Message subsequently completed as the next separate production group;
Case/CaseMessage/CaseMessageAttachment is now the active compatible authority
conversion, with policy activation still separate.

Account-deletion redaction has one shared database invariant across sensitive
text tables: a redaction result must never be longer than its original input.
The Case conversion exposed that the existing fixed replacement marker could
expand a maximum-length Message, CaseMessage or Case description when the
derived sensitive value was short. Keep the shared core private, redact first,
then cap only the already-redacted output to its original character length.
Every future retained-text deletion path must prove its maximum-length and
shortest-needle boundary in disposable PostgreSQL before activation.

Case invariant promotion must validate preexisting trigger-only relationships
under a write freeze; installing a trigger and then testing only newly seeded
rows is not legacy proof. Retain the rollout advisory lock, bounded timeouts,
target-table lock, collision-intolerant function creation and pre-install
invalid-row PostgreSQL cases when the draft is promoted. Provider-backed Case
openings must use the same exact Order-charge/event identity in both the fixed
operation and the trigger defense.

Do not flatten Case invariant triggers into one privilege mode. Five
relationship/source functions cross protected tables and require the reviewed
owner-mode boundary; three immutable/status validators inspect only the
trigger row and remain INVOKER. Exact run `30502489130` failed closed before
activation when the first preflight incorrectly demanded eight DEFINER
functions. Pin the 5/3 name and mode partition in both ENABLE and FORCE
preflights instead of widening the three row-local validators.

Do not create catalog authority merely to preserve a historical scanner
count. Exact run `30502852059` passed the corrected invariant partition, then
failed closed before activation because the preflight expected 28 fixed
functions while only 27 real operations exist. The supposed
`grainline_case_lock_core` was never a database function; its TypeScript
counterpart had no application caller and survived only because an older
disposable race harness imported it. Remove the helper from production source,
keep the proof-only lock local to that harness, and retain the historical
reference in a machine-checked retired ledger. Production remained unchanged.

Treat PostgreSQL `PUBLIC` as ACL grantee OID zero, not as a named role.
Exact run `30503586032` passed the corrected 27-function catalog and then
failed inside the disposable activation transaction because
`has_table_privilege('PUBLIC', ...)` raised “role PUBLIC does not exist.”
Inspect direct table and column ACLs through `aclexplode(...).grantee = 0`.
When a predecessor contract requires every CRUD privilege, check SELECT,
INSERT, UPDATE and DELETE separately; PostgreSQL comma-list privilege helpers
answer whether any listed privilege is held. The failed proof rolled back and
production remained unchanged.

When a rollback-only proof models activation and a later FORCE migration in
one outer transaction, flush deferred invariant triggers before the simulated
release boundary. Exact run `30503946659` passed policyless activation and
runtime authority, then PostgreSQL refused the FORCE `ALTER TABLE` because the
proof transaction still had pending trigger events. Production uses separate
committed migrations; the harness must model that with
`SET CONSTRAINTS ALL IMMEDIATE`, not by weakening FORCE or removing deferred
integrity checks. The failed proof rolled back and production remained
unchanged.

Exact Case draft head `b9f2e40c530c06787afee1cb776010f853f5f7d4`
passed run `30504119117` (job `90750043124`): all 54 PostgreSQL
invariant/ENABLE/direct-denial/fixed-function/FORCE/rollback checks, every
predecessor authority proof, migration/grant audits, TypeScript, lint, the
complete repository suite, dependency audit and production build succeeded.
This closes the draft authority gate and moves Case-family work to compatible
release packaging; production Case-family RLS remains off.

The prerequisite chain is complete through DirectUpload restricted-role
acceptance. Recovery run `30877508811`, exact-main CI `30881395864`, and
read-only restricted-role postflight run `30924905247` accepted the shared
private-object lifecycle boundary. The byte-pinned policyless Case-family
ENABLE migration `20260804160000_enable_case_rls` is now live from exact main
`a9abaec057ab80a455a81503080bcd3b9027c4be`: main CI `30937766824`, protected
migration run `30939836526`, and the real pooled-runtime read-only postflight
all passed. Its durable evidence and exact catalog are recorded in
`docs/case-activation-production-release.md`. Keep FORCE, Case-evidence
enablement, cleanup scheduling, provider/token changes, deployment and the
Order/payment/shipping group separate.

The next database boundary is now prepared, not live: posture-only Case FORCE
migration `20260804191000_force_case_rls` is reconstructed from the reviewed
historical draft plus a separately pinned correction for Neon's proven
non-effective runtime bootstrap edge, pins the accepted Phase A catalog, and
changes only the FORCE flag on the same three tables. Every other direct or
transitive runtime membership still fails closed. Its release contract is
`docs/case-force-production-release.md`. Complete guarded FORCE plus a fresh
pooled-runtime read-only postflight before enabling Case evidence or beginning
the separate Order/payment/shipping activation program.

Release packaging preserves a strict two-step coexistence boundary. The
database-only package installs the additive schema, private ledgers and 27
fixed operations without converted app source or promoted activation SQL.
Only after that exact migration package is applied may the compatible
application conversion deploy. Invariants/read mode, DirectUpload activation,
Case ENABLE and Case FORCE remain later separate releases. The exact package
inventory, proof references and release order live in
`docs/case-compatible-database-preparation-release.md`.

Temporary provider mechanics are intentionally absent from the production
artifact: the internal context-gate route, its runner-only test, branch-scoped
Vercel/database exceptions, disposable secrets, and provider resources were
removed after sanitized proof and teardown. Their durable value remains in Git
history, the non-runtime operator/harness scripts, regression tests, evidence,
and this operating record. The provider measurement implementation was moved
from a runtime library into `scripts/notification-provider-gate.ts`; it was not
discarded. Do not reintroduce endpoint-specific proof routes or credentials
merely to preserve scaffolding.

### Homepage discovery hierarchy decision (2026-07-15)

Keep the local-maker map directly beneath the hero and floating marketplace stats. It is Grainline's clearest marketplace differentiator, but it should remain a compact discovery band so inventory appears after a short scroll rather than becoming a second full-screen gate.

Preserve this homepage order: hero → stats → local-maker map → Top Picks → Shop by Category → New Arrivals → Makers You Follow → In the Workshop → From the Blog. Do not put a large editorial feature ahead of the first listing row.

### Brand terminology decision (2026-07-15)

Do not globally rename makers to shops. Preserve a three-part vocabulary:

- **Maker** means the person and their craft identity. Use it for community, trust, local discovery, commissions, Guild/Founding recognition, stories, following, and messaging.
- **Shop** means the maker's storefront or a commercial destination/action. Use it for "Visit Shop," profile/settings language, opening a shop, and search copy such as "Search pieces, shops, and more…".
- **Seller** means the transactional/legal role. Keep it in payments, refunds, disputes, staff tooling, schema, APIs, and internal code; avoid it in ordinary buyer discovery copy.

Use "Find Shops Near You" for the homepage hero CTA and local-map heading, where the buyer is choosing a commercial destination. Keep the supporting copy centered on independent woodworkers and do not imply that map pins are guaranteed walk-in retail locations. Internal `SellerProfile` naming and `/makers/...` SEO routes stay unchanged.

### Compliance systems to build before scale

Do not market these as fully implemented until the workflows exist in code and have attorney review.

- **INFORM Consumers Act high-volume seller workflow.** Current Stripe Connect onboarding collects baseline identity and payout information, but Grainline has not built a dedicated high-volume seller threshold tracker, 10-day verification queue, annual recertification flow, or buyer-facing disclosure/reporting workflow. Build before marketplace volume makes the INFORM workflow legally operationally relevant.
- **Privacy-control expansion.** Current product does not sell/share personal information or run third-party behavioral advertising, so GPC does not change current behavior. If that changes, add first-class `Sec-GPC` handling and persistence before enabling the feature.

### `/why-grainline` and `/why-sell-on-grainline` SHIPPED (2026-05-12)

Both landing pages are live.

- `/why-grainline` (buyer) lives in `src/app/why-grainline/page.tsx`. Sections: hero, handmade-trust problem with two-column comparison, four trust-mechanism cards, badge ladder (Founding/Guild Member/Guild Master with live counts), American-made stat bar with map link, buyer protection step-by-step, espresso final CTA.
- `/why-sell-on-grainline` (seller) lives in `src/app/why-sell-on-grainline/page.tsx`. Sections: hero, four-platform fee comparison table (Grainline/Etsy/Faire/Amazon Handmade), Etsy take-rate trap deep dive, Founding Maker scarcity counter, what-we-dont-do, what-you-get six-card grid, risk reversal, espresso final CTA. CTA links use Clerk auth state to send signed-in users straight to `/dashboard` and signed-out users to `/sign-up?redirect_url=/dashboard`.

Both are wired into the Shop and Sell footer columns respectively, added to `middleware.ts` `isPublic`, and added to `sitemap.ts` at priority 0.8 monthly. Live `prisma.sellerProfile.count({ where: { isFoundingMaker: true } })` reads power the "X of 250 spots left" counter on the seller page and the "X of 250 granted" pill on the buyer page.

Revisit when: catalog hits ~75 listings (refresh stats and screenshots), Etsy fees change (refresh comparison table), or Drew wants to test conversion variants on the seller landing.

### Reddit launch posts

Post to: r/EtsySellers, r/woodworking, r/SmallBusiness. NOT r/Etsy main (mods nuke competitor posts).

Each post should:

- Open with "I'm not selling anything" disclaimer.
- Lead with the Etsy fee math problem (specific numbers, including Offsite Ads on shipping).
- Ask for the first 10 sellers + critics + collaborators, not for signups.
- Include concrete technical specifics (Stripe Connect, Texas marketplace facilitator law) that defuse vibe-coding suspicion.
- Drop the URL once, near the bottom.

Be ready in the comment thread to answer specifics about Stripe Connect refund accounting, AI moderation pipeline, dispute escalation, and shipping rate sourcing. Those answers are the real credibility-builder.

### llms.txt is live at `/public/llms.txt`

Already shipped. Revisit if the canonical pitch changes or scope expands beyond woodworking.

## First 10 sellers playbook

The only number that matters for the next 60 days. Do not try to scale recruitment until 10 active sellers are posting.

1. **Etsy poaching, gentle.** Search Etsy for "Austin TX walnut", "Houston handmade cutting board", etc. Filter to 4.8+ rating, 100+ sales, photos that don't look stock. Pull 50 shops. Find their off-Etsy presence (Instagram bio link to personal site is the usual path). Send a personal note about a specific piece of theirs. Offer Founding Maker status + white-glove migration.

2. **Pitch the badge, not the platform.** "Founding Maker #7" is more meaningful than "join my new website". Status + scarcity + permanence does the work.

3. **White-glove migration.** Offer to import their best 5 listings yourself. You type, they review and click publish. Stripe Connect is the only manual step on their end. This kills the #1 friction (re-uploading photos and descriptions).

4. **Be visible in the maker world.** r/woodworking Show-Off Sunday. Texas Woodworkers Guild meetups. Austin/Houston/Dallas local woodworking groups. Don't promote. Be present.

5. **Texas first.** Drew is in Texas. Regional density is more credible than scattered national sellers. "10 Texas makers, 0% commission for 3 months, here's the URL" is a coherent story.

6. **Skip influencer marketing.** Wrong stage, wrong margin. Real makers don't follow influencers, they follow other makers.

Success criteria: 10 makers, 5+ listings each, 3+ have made their first sale by end of month 1. The catalog crosses ~75 listings. Blog content writes itself from maker stories. From there, network effects start.

## Referral system (build later, in phases)

Do not build until there are 50+ active sellers (real referral potential).

**Phase 1 (when ready): Founding Maker referral pass.**
Each of the first 250 Founding Makers can grant one "Founding Maker referral pass" that fast-tracks a referee through the Guild Member criteria. Referee earns a "Founding Maker referred by #N" subtle badge on their profile. Caps gaming because each maker has exactly one pass.

**Phase 2: Fee discount for new sellers via referral code.**
New seller signs up with a referral code, gets 0% Grainline fee for first 3 months or first $500 of sales. Referring seller gets 1% reduction on their own fee for the same period. Gameable in theory (fake accounts) but defended by Stripe Connect verification + first-listing-required-for-payout. Net cost per real referral: $50-150. Net cost per fake referral: $0 (fakes never reach payout).

**Phase 3 (2027+): Percentage-of-sale referral.**
Referrer earns 1% of every sale the referee makes for 12 months, paid by Grainline (not deducted from referee). Powerful but expensive on P&L. Hold until margin allows.

**Explicitly skip:**

- Cash signing bonuses (gameable).
- Per-listing payouts (rewards stuffing the catalog with junk).
- Buyer-side referee discounts (wrong audience, won't move the needle at this stage).

## White-glove migration tool

A "paste Etsy URL" import flow. Public Etsy listing pages render server-side, so a simple fetch + parse can pull title, description, price, photos. Drew (or admin) pastes the URL, the tool drafts a Grainline listing with photos pre-uploaded to R2, seller reviews and edits, then publishes.

Build this only after 5 sellers are confirmed interested. Otherwise it's a feature without a market.

Tech notes:

- Etsy's robots.txt allows public listing page fetches.
- Photos need to be re-downloaded and uploaded to R2 (don't hot-link).
- Categorize via existing AI review pipeline.
- Mark as "Imported from Etsy" in admin notes for traceability.

## LLM-search positioning

### Current state (right move for next 12 months)

- robots.txt blocks GPTBot, ClaudeBot, CCBot, Google-Extended, anthropic-ai for training scraping. This is intentional and stays.
- llms.txt published at root for canonical-pitch consumption.
- Sitemap with rich Product / LocalBusiness / Article / Service JSON-LD. Already shipped.

### Revisit at ~500 listings

At catalog density, consider allowing AI bots for browse-tool / on-demand fetch (not training). The mechanism: keep the broad disallow but add specific allows for AI browse-tool user agents that respect non-training intent. OpenAI's `ChatGPT-User`, Anthropic's `Claude-User`, Google's `Google-Extended-User` (these are the live-browse agents, separate from training agents).

### Long term (3+ years)

LLMs will increasingly act as buyer intent resolvers. Marketplaces will compete to be the system the LLM calls via tool-use to fulfill an order. Grainline's existing Stripe Checkout API is already shaped correctly to be a backend for this. Direction: keep API endpoints clean and well-documented in case OpenAI Operator / Anthropic Computer Use / similar emerges as a buyer channel.

## Things explicitly NOT to do right now

### Core Order historical authority decision (2026-08-31)

Do not derive retained Order ownership or purchase history from the current
Listing row. The Order-domain sequence is `Order`, then `OrderItem`, then
`OrderShippingRateQuote`, as separate releases in one continuous program.
Before Order activation, seller consumers must use the checkout-bound
`Order.sellerProfileId`, historical screens must use a strict bounded
`OrderItem.listingSnapshot` reader, and malformed or predecessor snapshots
must render generic retained facts rather than mutable catalog content. Keep
current Listing reads optional and catalog-only. Account-export shipping quote
material, seller-key nullability, staff/aggregate projections and every write
state machine remain explicit later gates; do not hide them inside this UI
compatibility change. See `docs/order-core-pre-rls-audit.md` and
`docs/order-core-history-compatibility.md`.

### Core Order participant list authority decision (2026-08-31)

The first fixed-operation slice is buyer/seller Order counts and keyset list
pages. The four additive SECURITY DEFINER projections bind the actor inside
PostgreSQL, route seller rows through the durable Order seller key, cap pages
at 100, expose fixed columns and cross timestamps as UTC epoch milliseconds.
They deliberately exclude Order items, addresses, provider identifiers,
staff-review bodies and seller-note bodies. Detail, staff, export, aggregate
and write families remain in the same continuous Order program; this slice is
not permission to stop after list conversion. See
`docs/order-participant-list-authority.md`.

### Core Order participant detail authority decision (2026-08-31)

Buyer and seller detail reads use separate one-statement fixed projections
that bind actor plus Order ID in PostgreSQL and return bounded historical item
JSON with exact keys. Participant projections derive refund state and the
seller deauthorization hold instead of exposing raw Stripe refund IDs or staff
review bodies; the seller UI also stops rendering provider refund IDs. PII,
gift and address fields are suppressed after buyer-data purge, and current
Listing data is reduced to a link-eligibility boolean. The candidate remains
compatible and unapplied; page conversion, pooled-runtime proof, staff/export/
aggregate projections and every write family remain required before Order RLS.
See `docs/order-participant-detail-authority.md`.

### Core Order participant detail projection decision (2026-09-01)

Do not freeze dead messaging actions or over-broad historical payloads merely
because the first detail authority was already byte-sealed. Preserve the v1
migration and add a v2 successor that requires an active actor in PostgreSQL,
returns a nullable counterparty contact target, suppresses seller notes after
buyer-data purge, withholds label download material unless the label is
`PURCHASED`, and exposes only snapshot keys used by the receipt. Buyer and
seller detail pages must consume only v2; ordinary runtime execution of v1
stays revoked. This conversion reduces direct Order sources from 24 to 22 but
does not authorize activation. See
`docs/order-participant-detail-projection.md`.

### Core Order staff-read credential decision (2026-08-31)

Do not grant staff Order queue/detail projections to the shared
`grainline_app_runtime` role. These views contain buyer PII, addresses,
internal review notes and limited provider reconciliation identity, so a
caller-supplied staff ID is not a sufficient database capability. The dormant
candidate requires exact `grainline_staff_read_runtime` session identity plus
a live EMPLOYEE/ADMIN row, grants neither PUBLIC nor ordinary-runtime
execution, and has no default ordinary Prisma client. Provisioning the
membership-free NOBYPASSRLS login, isolating its credential, proving zero base
table access and then granting only the reviewed functions are separate gates
before app conversion. See `docs/order-staff-read-authority.md`.

### Core Order participant export decision (2026-08-31)

Account export must use bounded actor-scoped Order projections before
policyless Order RLS. Keep buyer and seller export shapes distinct, bind seller
authority to the durable Order seller key, strip unrecognized snapshot keys,
and exclude raw shipping-quote/provider retry material. Export derived refund
state and amount; keep user-facing refund event history in the separately
protected OrderPaymentEvent export rather than disclosing provider refund IDs.

### Core Order eligibility authority decision (2026-08-31)

Review eligibility, Order-report access, maker-verification sales and listing
archive blocking must remain distinct fixed operations, not a generic Order
repository. Bind every operation to the authenticated participant inside
PostgreSQL; return only the required boolean, aggregate cents or one review
source pair. Keep the review function volatile and lock the parent Order in the
same transaction as review creation. Keep seller-private analytics, public
aggregates and maintenance scoring in later separate authority families. See
`docs/order-eligibility-authority.md`.

### Core Order public aggregate authority decision (2026-09-01)

Public marketplace, seller and listing counters must not preserve broad Order
or OrderItem reads merely because their outputs are public. Use separate fixed
aggregate-only functions that derive current public seller/listing visibility
and paid/refund/dispute eligibility inside PostgreSQL, revoke default PUBLIC
execution, and return no row or participant identity. Preserve the existing
homepage fulfilled and public seller-history semantics where their result is
already an aggregate; apply the stricter public-catalog and conversion-dispute
filters to listing quality and marketplace conversion metrics. Keep
seller-private analytics, maintenance scoring and mutation state machines in
later independent authority families. See
`docs/order-public-aggregate-authority.md`.

### Core Order seller analytics authority decision (2026-09-01)

Do not treat RLS conversion as permission to freeze current dashboard behavior
without a product audit. Seller Order analytics must use actor-bound aggregate
or bounded projection functions keyed through the durable Order seller, never
generic Order reads. Keep refunded Orders excluded until a deliberate net
partial-refund metric is designed. Define current cart abandonment as an
unpurchased item aged at least 24 hours, require purchase evidence to postdate
the cart addition, select recent-sale item context deterministically, and
aggregate repeat buyers inside PostgreSQL without returning buyer IDs. Label
Favorite and StockNotification range counts as surviving subscriptions; a
future immutable engagement ledger is required for complete event-history
claims. Keep Guild/service scoring and its SellerMetrics write in a later
maintenance authority family. See `docs/order-seller-analytics-authority.md`.

### Core Order Guild/service metrics authority decision (2026-09-01)

Audit trust metrics as product logic before moving their Order queries behind
RLS. Preserve the published Guild thresholds and existing completed/refunded
definitions, but bind historical sales and shipping facts to checkout-time
`Order.sellerProfileId` and `OrderItem.sellerProfileId`; mutable Listing
ownership must never rewrite a seller's qualification history. Use one bounded
aggregate-only service function because cron and staff verification recalculate
arbitrary sellers, return no Order or buyer identity, and keep PUBLIC execution
revoked. This service exception does not authorize generic Order access. Keep
the `SellerMetrics` cache upsert as its own later RLS/maintenance-write
boundary. See `docs/order-seller-metrics-authority.md`.

### Core Order participant-summary authority decision (2026-09-01)

Do not convert participant Order lists to a scalar-only projection when the
product still renders historical item cards. Equally, do not restore broad
OrderItem reads or add an N+1 detail call. Use one actor-scoped keyset page
that returns the complete item count and at most five fixed checkout-time item
summaries. Show a remaining-item count on list surfaces and reserve the full
item set for Order detail. Convert numbered offset pagination deliberately;
do not emulate arbitrary page numbers by reading and discarding unbounded
cursor pages. The selected successor uses strictly parsed opaque tokens and
separate older/newer keyset functions, retaining Previous/Next without OFFSET.
Seller totals must use the full durable Order subtotal rather than the five
displayed summaries. See `docs/order-participant-summary-authority.md` and
`docs/order-participant-cursor-authority.md`.

### Core Order fulfillment and receipt decision (2026-09-01)

Do not preserve seller-controlled pickup completion merely because it was the
historical UI. `PICKED_UP` starts the buyer's 30-day Case window, so the seller
may only move a paid pickup Order to `READY_FOR_PICKUP`; the buyer alone moves
it to `PICKED_UP`. The same buyer receipt operation owns
`SHIPPED -> DELIVERED`. Both paths must reject active Cases, retained refund
evidence and open Stripe disputes under the shared Order lock. Seller shipping
remains `PENDING -> SHIPPED` with bounded carrier/tracking, and seller notes
remain a separate scratch-note operation rather than fulfillment authority.
Before Order RLS, use family-specific fixed functions and make fulfillment
Notification/email delivery co-committed or explicitly restart-safe. See
`docs/order-fulfillment-receipt-product-audit.md`.

The compatible fixed-authority implementation now exists on the isolated
Order branch: seller fulfillment, buyer receipt and seller-note operations
derive participant authority and audit evidence in PostgreSQL, and the
application co-commits transition Notifications plus deterministic email
outbox reservations. Disposable PostgreSQL proof covers the corrected state
machine, forged actors, Case fencing and direct runtime write denial. This is
an unapplied compatibility checkpoint, not permission to deploy it or activate
Order RLS; remaining direct Order write families and production sequencing are
still separate gates. See `docs/order-fulfillment-authority.md`.

### Core Order shipping-label authority decision (2026-09-01)

Do not carry the current label route unchanged behind Order RLS. Its strongest
idea—a pre-provider mutual-exclusion fence—is currently encoded as terminal
`LabelStatus.PURCHASED`, so an ambiguous Shippo response can appear to the
seller as a completed label. Separate the database-derived claim/generation
from the completed label outcome, derive the selected rate/amount/currency
inside PostgreSQL, attach the claim as Shippo metadata rather than inventing an
unsupported provider idempotency key, and require exact provider identity and
money agreement before any automatic seller-transfer deduction.

Retain checkout-time package facts on new OrderItems; legacy nulls require a
fresh aggregate inspection and an explicit fallback classification. Remove
raw, expiring label URLs from seller projections and resolve fresh downloads
through a seller-authorized provider route. Label purchase continues to mean
`SHIPPED` in the current product, but must co-commit the same buyer Notification
and email-outbox reservation as manual shipment. Multi-parcel packing and
seller self-service carrier voids remain separate product enhancements; they
must not be used to justify broad Order/Listing table access. See
`docs/order-label-product-authority-audit.md`.

The isolated compatible candidate is now implemented locally as
`20260901140000_prepare_order_label_authority`; application conversion removes
the label route and clawback worker from direct Order access. Do not release it
until duplicate provider-transaction and legacy-package aggregate inspection
and the post-deploy/drain raw seller-projection URL grant retirement are
complete. The exact ambiguous-claim operator is now implemented locally:
ordinary runtime cannot clear an ambiguous fence; an owner-only,
staff-authorized release requires exact provider `ERROR` evidence, while exact
SUCCESS returns through the normal email/clawback finalizer. Provider absence
never releases: it remains fenced for provider escalation because external
absence is not a terminal or account-bound fact. A transaction-ID hint cannot
bypass exhaustive same-rate uniqueness proof. This is still part of finishing
Order, not a reason to skip ahead to another RLS family.

### OrderPaymentEvent credential-epoch drain correction (2026-08-30)

Do not treat the current OrderPaymentEvent deployment boundary as a single
immediate-predecessor deletion. The accepted replacement-deployment timestamp
`1786644755419` plus a complete 2026-08-30 Vercel inventory identified one
current and 11 superseded callable READY Production deployments in the same
credential epoch. The correction required all 11 reviewed exact IDs to drain
restart-safely, oldest-first, before changing direct table grants. Exact main
`6ce4932adaa4d6b651a2a902d8e731aaad08e259`, CI `33332817851` and the
accepted restart-safe production run completed that drain with zero
shared-credential predecessors while preserving the current deployment,
aliases and health. Retain evidence SHA-256
`1596ad71479f7a9bda51b00c94b3ac27bea6adf6a5454eb34e03c35618764e5d`.
The next gate is zero-direct-access; policyless ENABLE and FORCE remain later
separate gates. This correction replaces the earlier one-predecessor
assumption and does not reorder other table groups. See
`docs/order-payment-event-credential-epoch-drain.md`.

The subsequent zero-direct-access gate is accepted at exact main
`d7bba0ef2a96ea13163e844979107b4bf2779f62` and CI `33336651230`. Its
read-only production proof re-attested zero shared-credential predecessors,
the current deployment, four aliases and health, then independently found zero
direct base-table access in both the deployed and operator trees across the
same seven consumers, 12 reference files and five fixed operations. Retain
mode-`0600` evidence SHA-256
`6298a1dc376bec73f2abcb896d54913815e155717cd004596b622b6439208590`.
Prepare the separate policyless ENABLE/direct-grant-revocation release next;
FORCE remains later. See `docs/order-payment-event-zero-direct-access.md`.

- Don't run paid ads. CAC will be brutal at $0 GMV.
- Don't redesign. The product works. Ship sellers, not features.
- Don't add Canada. Terms already declines it. Revisit at $250K GMV.
- Don't build the percentage-of-sale referral. Margin trap.
- Don't add subscription tiers. Etsy did this. Sellers hate it.
- Don't build a mobile app. PWA is sufficient. Real mobile app is post-$1M ARR territory.
- Don't broaden scope to general handmade. The woodworking-only focus is the differentiator.

## Recurring observations on Etsy 10K (for refresh each year)

Etsy's recent annual reports surface the same pain points that Grainline is positioned against. Worth re-reading when each new 10K drops:

- GMS flat-to-declining since 2021. Documented "marketplace revitalization" theme in MD&A.
- Take rate creep, particularly through Offsite Ads expansion.
- Explicit risk-factor language about counterfeits and AI-generated content eroding buyer trust.
- AI search as a documented existential risk factor.
- Star Sellers + Etsy Plus + subscription monetization push (universally unpopular with sellers).

Each year's 10K refresh is free competitive intel. Pull the relevant quotes into recruiting copy.

## Geographic expansion plan

1. **Phase 1 (now through ~50 sellers):** Texas-first. Density story. Recruitment in r/Austin, r/Houston, r/Dallas, Texas Woodworkers Guild.
2. **Phase 2 (50 to 500 sellers):** Major US metros (NYC, Bay Area, Chicago, LA, PNW). City landing pages already exist as SEO surface area for this expansion.
3. **Phase 3 (500+ sellers):** Full national rollout.
4. **Canada (2027+):** Re-enable only after attorney review of Quebec Bill 96, PIPEDA cookie consent, GST/HST registration, and cross-border carrier considerations. Code change is one line in middleware; legal work is the bulk.

## When to revisit this file

- After every session that produces a strategic decision.
- Before any commit that changes scope, fee structure, or geography.
- When a referenced item ships (move from "to build" to a brief note that it shipped, then delete after 60 days).
