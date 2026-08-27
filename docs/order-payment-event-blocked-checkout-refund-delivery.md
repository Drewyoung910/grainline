# Blocked-checkout refund participant delivery

Status: isolated compatibility correction and guarded production wiring under
review. Nothing in this document authorizes merge, migration execution,
deployment, a paid Checkout Session, provider changes or `OrderPaymentEvent`
RLS activation.

## Finding

The automatic blocked-checkout full-refund path commits the fixed payment
record and buyer Notification atomically, but it classified that Notification
as `NEW_ORDER` and reserved no refund email. The application settings describe
`NEW_ORDER` as "Order confirmed" and `REFUND_ISSUED` as the refund preference.
Consequences:

- a buyer who disabled order confirmations but retained refund notices could
  miss the in-app refund warning;
- the notification used the package/order-success icon instead of the refund
  warning class; and
- an active buyer had no durable email fallback after a paid checkout was
  immediately returned.

This is a product/delivery defect found by the required pre-RLS domain audit.
It is not caused by RLS and must not be hidden by loosening a policy.

## Compatible target

Migration `20260825010000_prepare_blocked_checkout_refund_delivery` replaces
only the existing owner-private
`grainline_notification_create_core(text,text,"NotificationType",text,text,text)`
body. The builder pins the exact historical Notification migration and changes
one source predicate: the already validated
`BLOCKED_CHECKOUT_REFUND_RECORDED` family temporarily accepts both
`NEW_ORDER` and `REFUND_ISSUED`. The legacy `NEW_ORDER` input is normalized to
`REFUND_ISSUED` before the recipient preference check, replay-key derivation
and insert. Calls from predecessor and corrected deployments therefore resolve
the same canonical row even when a webhook retry crosses the deployment drain.

The compatibility window is deliberately narrow:

- the source must still be one exact local blocked-checkout refund payment row;
- recipient, Order, first item, listing and seller relationships remain
  database-derived;
- the generic core remains denied to `PUBLIC` and
  `grainline_app_runtime`;
- the existing source-specific order wrapper remains the only runtime entry;
- Notification ENABLE/FORCE posture and all table/column grants are unchanged;
  and
- no `OrderPaymentEvent` posture or grants change.

The corrected application then commits all of the following in one Prisma
transaction:

1. the fixed blocked-checkout refund record/finalizer;
2. one source-derived buyer Notification of type `REFUND_ISSUED`; and
3. one deterministic `refund_issued` EmailOutbox reservation using
   `EMAIL_REFUND_ISSUED`.

The request attempts the committed outbox job only after commit. A process exit
or retryable email failure is recoverable by the outbox worker without another
Stripe refund. A buyer who became banned/deleted, disabled refund email or is
suppressed is skipped by the existing worker lifecycle checks.

## Release sequence

1. Prove the migration bytes reproduce from the pinned source; apply the full
   migration tree and Notification family matrix in disposable PostgreSQL.
   The matrix must accept both predecessor `NEW_ORDER` and corrected
   `REFUND_ISSUED` for this one source, prove both call orders resolve one
   stored `REFUND_ISSUED` row, and reject unrelated forgeries.
2. Apply only the byte-pinned compatibility migration through the guarded
   Production Migrations workflow. Verify that the generic core remains
   runtime-private and Notification remains FORCE RLS.
3. Deploy the exact compatible application and verify canonical aliases,
   health, function catalog and the unchanged predecessor behavior.
4. Run the separate restart-safe blocked-checkout provider proof. Create a
   small real Stripe test-mode Checkout Session through the authenticated
   production checkout route, make the disposable seller ineligible only after
   session creation, and complete the hosted test checkout so Stripe—not the
   operator—emits the signed `checkout.session.completed` event. Prove the
   exact full refund/reversal, claim generation, local and signed payment rows,
   stock restoration, `REFUND_ISSUED` Notification, skipped test email outbox,
   signed replay and exact cleanup.
5. Drain the predecessor deployment. Then apply a separate byte-pinned
   retirement that removes `NEW_ORDER` acceptance for the blocked-checkout
   source and repeat the Notification/OrderPaymentEvent dependency proof.

## Guarded production wiring

The isolated release includes a dedicated
`Blocked Checkout Refund Delivery Production Compatibility` workflow. It is
not a generic migration runner. The workflow:

- accepts only a manual run from the exact reviewed `main` commit with one
  successful push-triggered `CI` run for that same commit;
- requires the direct `neondb_owner` migration credential and the existing
  runtime/migration role guard;
- refuses any migration after
  `20260825010000_prepare_blocked_checkout_refund_delivery`;
- byte-verifies the candidate, then reads the live candidate ledger,
  `OrderPaymentEvent` compatible catalog and Notification FORCE authority in
  one engine-attested repeatable-read/read-only transaction;
- accepts only the exact predecessor or exact already-applied restart state;
- temporarily isolates the candidate before verifying the five sealed live
  OrderPaymentEvent predecessors and, for the predecessor state, the clean
  production migration ledger;
- runs exactly one conditional `prisma migrate deploy`, never a provider or
  application deployment; and
- finishes with migration status, the global grant/RLS audit and the same
  exact read-only scope proof in required `after` mode.

The workflow deliberately does not invoke broad runtime-role grant
reprovisioning. This migration changes one source-validating Notification
function body and re-denies its private core; the exact post-application scope
proof is the authority-convergence check. Disposable PostgreSQL CI applies the
candidate after all five predecessors and proves the same combined catalog
reader against PostgreSQL 16.

The first production dispatch, run `32895229230`, failed closed before
`prisma migrate deploy`: after isolating only the candidate, the runner invoked
the oldest predecessor verifier while four later reviewed predecessor
migrations were still visible, so its no-successor invariant rejected the
stack. Production remained unchanged. The corrected runner mirrors CI's
reverse isolation order, verifying and moving aside each newest predecessor
until the oldest becomes the visible leaf, then restores the four isolated
successors in chronological order before migration status or deploy. A
filesystem-level regression executes that exact verifier sequence against a
disposable copy of the migration tree.

The hosted Checkout completion is intentionally a distinct operator stage. A
private mode-0600 recovery file may retain its short-lived client secret; public
logs and sanitized evidence may retain only hashes and counts. No webhook
secret may be used to forge an event as a substitute for provider delivery.

## Restart-safe provider operator

`scripts/order-payment-event-blocked-checkout-production-proof.mjs` implements
seven explicit commands behind one exact-main, successful-CI and READY
production-deployment binding:

1. `prepare` creates one marker-bound, production-aligned Express account. If
   its transfer capability needs Stripe-hosted onboarding, it stops before any
   application fixture and writes only a mode-`0600` Account Link handoff. Once
   active, it fences the operational canary's refund-email preference, creates
   a private reserved $5 listing, authenticates the canary, calls the real quote
   and single-item checkout routes, proves exact route retry, and only then
   flips the synthetic seller to vacation mode. The short-lived Stripe client
   secret is written only to the mode-`0600` recovery state. Before creating or
   recovering the active Session, it classifies the complete fixture-bound
   reservation history: at most five rows may be exact expired, unpaid,
   provider-confirmed Sessions with `RESTORED/stripe_session_expired` database
   evidence, and at most one may be an exact open, unpaid active Session. Any
   other row, provider state, source identity or cardinality fails closed.
2. `onboard` rechecks the exact clean operator commit/CI and private attempt
   binding, then opens the unexpired one-time Account Link without printing it.
   It does not complete onboarding or accept any responsibility for the user.
3. `renew` accepts only an exact expired, unpaid seller-blocked Session and its
   restored reservation. It briefly reopens only the synthetic seller, creates
   or recovers at most one bounded replacement, rebinds the private journal and
   returns the seller to vacation mode before payment handoff.
4. `serve` binds only `127.0.0.1` and serves a no-store Stripe Embedded Checkout
   page after independently rechecking the exact clean main commit and its
   successful CI. Card data stays in Stripe-hosted frames; the page does not
   call a Grainline webhook or know any webhook secret. Closing the server does
   not alter recovery state.
5. `verify` requires a genuinely paid test Checkout Session. It discovers the
   exact provider `checkout.session.completed` and `charge.refunded` events,
   proves the completed reservation, restored listing, source-bound local and
   signed payment rows, claim clearance, full buyer refund, exact seller
   transfer reversal, `REFUND_ISSUED` Notification, skipped deterministic
   refund outbox and absence of all `NEW_ORDER` delivery. It resends both exact
   provider events and requires every application identity and webhook claim
   generation to remain unchanged before cleanup.
6. `reconcile` is disabled without a second exact confirmation and accepts only
   the documented failed paid checkpoint. It manually balances that one
   Stripe test-mode transfer and emits failure-recovery evidence; it can never
   emit automatic-proof success.
7. `cleanup` is an explicit abort path only while the Session is unpaid. It
   expires that exact Session, waits for signed stock restoration, then removes
   the marker-bound fixture. A paid Session cannot enter abort cleanup and must
   resume through `verify`.

Crash recovery is stage-aware. `account-create-pending`,
`fixtures-create-pending`, `fixtures-created`, `checkout-create-pending` and
`checkout-created` can each straddle an external provider or database
transition, so `cleanup` refuses those ambiguous journal stages. The operator
persists `fixtures-create-pending` before touching the canary or inserting any
database fixture, which makes `account-created` an actual pre-fixture abort
checkpoint. Rerun `prepare` with the same mode-`0600` state first: Stripe/app
idempotency and exact marker checks converge ambiguous states to
`account-created` (before fixtures) or `seller-blocked` (one known unpaid
Session). The seller-block
transition itself is an exact-row idempotent update, so a crash after the
database commit but before journal persistence also converges. Both are
explicit abort-cleanup checkpoints. Never delete the recovery journal to skip
that convergence.

Successful cleanup performs live foreign-key dependent inspection before
deleting application rows. It transactionally locks, revalidates and deletes
the current reservation plus every classified expired-attempt reservation so
an interrupted prior `prepare` cannot leave a foreign-key dependent behind.
Both the paid-success and unpaid-abort paths require the exact persisted
history count and roll back every deletion on drift. Cleanup then restores the
canary's exact preferences/terms,
revokes its sessions, removes only exact Redis keys and deletes the zero-balance
disposable connected account. The two processed webhook leases and immutable
Stripe test objects remain as the documented evidence boundary. Automatic tax
may make the buyer refund exceed $5; the proof derives that amount from the
completed Session while requiring the seller transfer and reversal to remain
exactly $4.75.

The canary mutation is generation-fenced rather than a blind save/restore.
Fixture creation locks the exact canary row and requires its persisted fields
to equal the private original snapshot before applying the proof fence. Resume
requires the exact proof-fenced preference/terms state, and both successful and
unpaid cleanup lock and re-prove that same state before deleting fixtures or
restoring the original snapshot. Concurrent preference or terms drift therefore
fails closed without clobbering the external change or partially deleting the
fixture.
The two PostgreSQL `timestamp without time zone` snapshots are projected as
lossless six-digit database text and cast back only inside PostgreSQL; they are
never round-tripped through the workstation's local `Date` timezone.

Two pre-payment retries on 2026-08-25 created Sessions before their local
operators failed closed: the first exposed the percent-encoded client-secret
validator defect and the second exposed the over-deep Stripe expansion. A
read-only production/Stripe inspection later proved both Sessions expired and
unpaid, both reservations are `RESTORED` with exact
`stripe_session_expired` evidence, neither has a PaymentIntent, and all source,
metadata, repair-claim and item bindings match the disposable fixture. They
are retained only until the same proof completes or takes its explicit unpaid
abort path; the bounded history contract above prevents silently ignoring or
leaking either row.

## Proof fixture boundary

Use only the retained operational Clerk canary as the temporary buyer actor.
Record and restore its exact notification preferences, force
`EMAIL_REFUND_ISSUED=false` for the proof, and revoke all proof sessions. Create
a synthetic seller User/Profile, hidden disposable listing/cart/reservation,
and one disposable transfer-capable Stripe test account. The seller is never
authenticated and no real seller or buyer is impersonated.

On success remove every temporary application row, Redis lock/rate-limit key,
session and disposable connected account. Retain only immutable Stripe test
objects, the processed `checkout.session.completed` and `charge.refunded`
webhook leases, ordinary provider/observability telemetry and sanitized
mode-0600 evidence. On any uncertainty preserve restart state and stop.

## Separate boundaries

This correction and its eventual proof do not establish the signed-family,
seller-refund or staff-Case proof, and none of those proves this path. They also
do not authorize predecessor table-grant revocation, policyless ENABLE, FORCE,
or activation of `Order`, `OrderItem` or `OrderShippingRateQuote`.

## First production-proof attempt and restart correction (2026-08-25)

The compatible database and application release completed before the provider
proof. Exact main `a6593516be9fd5531e867aea43b4bbf6319f3094` passed CI
`32900648444`; guarded run `32902265239` applied only
`20260825010000_prepare_blocked_checkout_refund_delivery`; and production
deployment `dpl_JCmwmKQVwTnvMB2nk7XwYFvQR5xA` reached `READY` on the
canonical aliases. The separate pooled-runtime postflight passed from the same
source with `productionChangedByPostflight=false`.

The first authorized test-mode provider attempt stopped at
`account-create-pending` before Stripe created an account. Stripe rejected the
46-character connected-account marker key because metadata keys are limited to
40 characters. No Checkout Session, payment, application fixture, signed
delivery or proof evidence was created. The mode-`0600` journal remains at the
exact ambiguous restart boundary and must not be deleted or bypassed.

The correction shortens only that marker key and enforces the provider limit
in the parameter builder. Recovery keeps the original attempt commit, CI,
marker, idempotency and evidence filename while separately binding the clean
corrected operator commit and its successful CI. Both historical and corrected
CI runs must validate on every resumed command. Recovery mode refuses to start
without the preserved journal. This is an operator defect and does not change
the compatible application, migration, grants, RLS posture or provider
configuration.

Local correction validation passes the 30-test focused migration, scope,
operator, disposable-PostgreSQL and atomic refund-side-effect suite, all 3,421
repository tests with 3,414 passes and seven documented skips, TypeScript,
lint, syntax and diff checks. PR #279 merged the short-key correction as exact main
`ed80ecc3401ec9b1b95724978beccb85e0d8f9b0`; exact-main CI `32907978390`
passed every PostgreSQL proof, TypeScript, lint, all repository tests, the
security audit and production build.

The resumed attempt then stopped at the same `account-create-pending` boundary
because the disposable builder still used a legacy top-level Custom account,
application-collected identity data and direct service-agreement acceptance.
Stripe correctly required Grainline to review platform requirement-collection
responsibilities before accepting that account shape. No acknowledgment was
submitted. No account, application row, Checkout Session, payment, signed
event or success evidence was created. The seller/listing IDs visible in the
journal are reserved deterministic identifiers; `createFixtures()` is ordered
strictly after the persisted `account-created` checkpoint.

That provider error is an operator-design regression, not a reason to change
Grainline's business responsibilities. Production seller onboarding uses an
Express dashboard with Stripe-collected identity requirements and
application-paid fees/losses. The recovery successor must use that same
controller, omit top-level `type`, `business_type`, `individual` and
`tos_acceptance`, attest the returned controller, and pause at a mode-`0600`
Stripe-hosted onboarding record until the transfer capability is active. The
one-time onboarding URL may be opened locally but must never be printed,
committed or retained in sanitized evidence. Use a new versioned account-create
idempotency operation under the same preserved attempt so prior failed
validation requests cannot alias the corrected parameter shape.

After hosted onboarding completed, the same journal advanced through exact
fixture creation and stopped fail closed at `checkout-create-pending`: the
shipping-quote route correctly rejected the temporary seller because the old
operator labeled it `stripeAccountVersion='v1'` and
`stripeControllerType='custom'`. No Checkout Session, reservation, payment or
signed event existed. This is fixture drift, not a quote/checkout regression.
The account was created by the classic Accounts API with the reviewed Express
controller, so the honest compatible marker is legacy-null plus the exact
controller summary, not a false `v2` label. The restart-safe successor permits
only the exact marker-bound temporary row to converge from the known
`v1/custom` state to that honest representation before retrying the quote.
Local validation passes the 31-test focused migration, scope, disposable-
PostgreSQL and operator suite; all 3,422 repository tests complete with 3,415
passes, seven documented skips and zero failures. TypeScript, lint, syntax and
diff checks also pass.

The next restart reached the real checkout route. The forged cross-origin call
returned `403`, while the authenticated call returned `200` and created exactly
one open, unpaid Embedded Checkout Session plus one `SESSION_CREATED`
reservation. The operator then stopped at `checkout-create-pending` because its
client-secret validator assumed the older alphanumeric-only suffix; Stripe's
current test-mode response is longer and contains valid percent escapes. The
restart-safe correction still requires the exact `cs_test_...` Session ID,
binds the client secret to that exact ID plus `_secret_`, caps it at 1,024
characters and permits percent characters only as complete hexadecimal escape
triplets. Cross-session values, malformed escapes, whitespace/control
characters and oversized values remain fail closed. No payment or signed event
exists at this checkpoint; the same persisted Session must be recovered through
the checkout lock rather than replaced.

After the percent-encoding correction passed exact-main CI, the next restart
again recovered the existing checkout response and then stopped before journal
advancement because the operator requested
`payment_intent.latest_charge.refunds.data.transfer_reversal` as a Session
expansion. Stripe rejects property expansion beyond four levels. The refund is
already discovered from the durable local refund identity and retrieved through
a separate exact `refunds.retrieve(..., { expand: ["transfer_reversal"] })`
call during verification, so the deep Session expansion was redundant. The
restart-safe correction limits Session retrieval to
`payment_intent.latest_charge.transfer` and pins that exact three-level set in
tests. Refund and reversal authority remain separately retrieved and asserted;
no Session, payment, signed event, migration, grant, RLS or provider
configuration is added or changed by this correction.

The bounded-history successor merged as exact main
`0a77c695a079568ac4eb16d91d16da1406e39b07`; exact-main CI `32922211178`
passed. Its first authorized restart classified the two terminal attempts and
created one new exact open, unpaid Session plus one `SESSION_CREATED`
reservation. The immediate exact POST retry then failed closed because the
single-checkout route checked the now-zero last-unit stock before consulting
the buyer/listing-scoped ready lock. A later restart independently confirmed
the same application defect when shipping quote returned `400` out of stock.
The new Session, reservation and ready Redis lock agree on source, payload,
Session and encoded-secret identity; there is no PaymentIntent, payment or
signed completion event.

This is a buyer-visible idempotency defect, not permission to weaken stock
authority. The application correction keeps complete price, variant, signed-
rate and payload validation, but checks an exact ready lock before rejecting
newly unavailable stock. A dedicated authenticated single-checkout resume route
derives the lock key from the current buyer and requested listing, retrieves
the exact Stripe Session, and returns a secret only when buyer, listing, lock,
payload, Session mode/status and the Redis/Stripe client secrets all agree.
The Buy Now modal consults that route before requesting a fresh shipping quote.
New or payload-different attempts still fail the authoritative stock check and
cannot oversell. The production proof must not create another attempt before
the correction is reviewed, merged, deployed and attested. After that release,
it must resume the existing attempt if Stripe still reports it open and unpaid.
If the short-lived Session has expired normally during review, it must first
classify all three attempts as exact terminal unpaid history and may then create
exactly one bounded replacement under the existing five-attempt ceiling.

The private journal remains bound to the original application source, CI run
and deployment that created the fixtures. A restart on the corrective release
must additionally supply an all-or-none recovery application source, exact-main
CI run and production deployment ID. Both original and replacement CI bindings
are revalidated, the canonical aliases must serve the replacement deployment,
and final sanitized evidence retains the initial binding alongside the actual
application binding. Never rewrite or delete the journal to make the new
deployment appear to be the original one.

The corrective application was deployed as exact main
`5ef81acca6f8e302830b983a614432094cfa2458` after exact-main CI
`32926506350`; Vercel deployment `dpl_AJanN3zfnubB39Aj14NFziHAhfeB` is READY,
serves all canonical aliases and reports healthy pooled-runtime identity. The
authorized restart recovered or boundedly replaced the exact unpaid attempt,
advanced the private mode-0600 journal to `seller-blocked`, and retained three
exact expired/restored attempts. The first local `serve` handoff then stopped
before opening a browser or accepting payment: the recovery validator correctly
accepted the current percent-escaped, Session-bound Stripe client secret, while
the HTML payment-page builder still required the obsolete alphanumeric-only
shape. This is an operator-contract mismatch; it did not charge a card, deliver
an event, change provider configuration or mutate RLS/grants. The correction
passes the exact journal Session ID into the page builder and reuses the same
1,024-character, complete-percent-triplet, exact-Session binding used by prepare
and the application resume path. Cross-Session, malformed-escape and oversized
secrets remain fail closed, and the secret remains only in the private journal
and generated loopback response.

Exact-main CI `32934907379` passed for operator/main
`8be59704d91951dd2cf72a6c6db0de824b373ab6`. The repaired loopback page served
successfully, but the retained Checkout Session had expired before human
payment. Stripe's page therefore showed its intentionally ambiguous completed-
or-timed-out terminal message. The authorized verifier and a separate
sanitized, read-only provider lookup established the exact state: test mode,
`expired`, `unpaid`, no PaymentIntent and no client secret. Verification stopped
before retry, refund, reversal or cleanup; the mode-0600 journal and exact
fixtures remain preserved at `seller-blocked`.

This exposed a distinct restart boundary: bounded expiration recovery existed
before `seller-blocked`, but not after the operator deliberately made the
synthetic seller ineligible. The successor adds a separate `renew` command; it
does not relax `prepare`, `serve` or `verify`. Renewal accepts only the exact
journaled Session/reservation transitioning into the next
`stripe_session_expired` terminal pair. It locks the marker-bound disposable
seller user, seller, private reserved listing and complete Checkout reservation
history in a serializable transaction; requires restored stock one, zero Orders,
the exact canary/source identities and no unclassified row; and reopens only
that synthetic seller. It then creates or recovers at most one active bounded
replacement, rebinds the private journal to its exact Session/secret/lock/
reservation, and returns the seller to vacation mode before another payment
handoff. Crashes before creation, after creation or after journal rebinding are
all restart-classified. The failure path also reblocks the synthetic seller and
fails loudly if that safety convergence cannot be completed. An already-created
replacement can therefore resume whether the crash happened before or after
that reblock. Cross-source, paid, ambiguous, excessive-history and non-restored
states remain fail closed. `renew` is a separately authorized production
mutation and review/merge alone must never execute it.

## Paid proof failed on transfer visibility; recovery is not acceptance (2026-08-26)

Exact operator/main `71197a539e2eb2e476dce3fc0c4ae2b11315032b`
passed CI `32988148978`. The bounded `renew` command created one final exact
replacement, returned the disposable seller to vacation mode and handed the
Session to the loopback Stripe frame. A human completed the genuine Stripe
test-mode payment. The preserved journal advanced to `payment-completed`.

`verify` then failed closed before replay or cleanup with
`blocked-checkout Stripe refund evidence drifted`. Engine-enforced read-only
database inspection and read-only Stripe retrieval established one exact
state without exporting row contents:

- the tax-inclusive buyer refund succeeded for 541 cents;
- the destination transfer exists for the expected 475 cents and exact
  disposable account;
- neither the refund nor the transfer has a transfer reversal;
- the Order persisted the PaymentIntent and Charge but a null
  `stripeTransferId`; and
- the local refund ledger honestly classified a 541-cent platform-funded
  refund with `requiresManualTransferReconciliation=true`.

A later deep retrieval of the same PaymentIntent/Charge returned the exact
transfer. The evidence therefore supports a provider-consistency race during
the original signed completion handler, not a permanently absent transfer.
This is a real accounting defect even though it occurred only in Stripe test
mode: the buyer was made whole, but Grainline funded the refund while the
temporary seller retained the 475-cent transfer. No success evidence was
written. The paid fixture, processed signed leases and mode-`0600` journal
remain preserved until exact reconciliation; this run must never be relabeled
as a passed automatic proof.

The isolated correction has two distinct boundaries:

1. Application release migration
   `20260826010000_prepare_blocked_checkout_transfer_binding` (generated
   SHA-256
   `95fcb6a8dceeb116b96f4f6f3dc18ada055c91a931a88b0d22672ea2ed027e09`)
   adds one runtime-callable, owner-executed transfer-binding function. It
   locks the active signed `StripeWebhookEvent` generation and exact paid
   Order/Session/PaymentIntent/Charge, derives no target from an untrusted
   caller, rejects conflicts and refuses a first binding after refund
   authority exists. The webhook uses a short bounded Stripe reread, fails the
   signed event for retry while the destination transfer remains unavailable,
   and binds the provider-derived transfer before claiming refund authority.
   The locked check and the final UPDATE independently refuse a seller-refund
   lock, refund claim or refund ledger row. The dedicated
   `blocked-checkout-transfer-binding-production.yml` runner binds exact main
   plus successful CI, accepts only absent or exact-applied restart state in an
   engine-enforced repeatable-read/read-only snapshot, isolates the candidate
   while proving the sealed predecessor, and applies only this migration. The
   generic Production Migrations runner conditionally isolates the candidate
   whenever production is still on its predecessor, so a broad migration
   dispatch cannot apply this release accidentally.
2. The separately confirmed `reconcile` operator accepts only this exact
   failed `payment-completed` journal. It proves the platform-funded refund,
   null durable transfer and zero existing reversals; writes a private restart
   checkpoint; creates one exact 475-cent test-mode reversal behind a
   deterministic idempotency key; proves exact retry and one-reversal
   cardinality; and then performs the already-reviewed exact fixture cleanup.
   Sanitized evidence is status `reconciled-failed-proof` with
   `automaticProductionProofPassed=false` and
   `freshAutomaticProofRequired=true`.

Required sequence is: review and merge the isolated correction; apply only the
additive transfer-binding migration; deploy and attest the corrected
application; separately authorize reconciliation of the preserved test
fixture; then run a completely fresh blocked-checkout provider proof. Only the
fresh run may satisfy this acceptance gate. `OrderPaymentEvent` predecessor
drain or RLS activation remains blocked until that automatic proof passes.

The production-inert release checkpoint passes 44 focused authority,
operator, workflow and disposable-PostgreSQL tests; the full repository suite
passes 3,451 tests with zero failures and seven intentional skips. TypeScript,
lint and diff checks pass. The isolated Webpack build compiled and completed
its TypeScript phase, then correctly stopped during page-data collection
because this worktree has no production Redis environment. That is
environment-limited validation, not a green deploy build. Production and the
preserved failed-proof fixture are unchanged.

Draft release head `a403e3c947a7f5f7728fa384b2c397e9694e50f8`
then failed exact-head CI `33045363294` in the direct-runtime PostgreSQL proof.
The full historical migration tree correctly rejected the proof's synthetic
Order as missing its durable seller key and matching OrderItem. The smaller
PGlite fixture did not model that predecessor invariant, so this is a proof-
fixture defect rather than evidence that the transfer-binding function should
be weakened. The corrected real-PostgreSQL proof transactionally creates a
complete disposable User, SellerProfile, Listing, Order and OrderItem chain,
then removes that exact chain during cleanup. A structural regression test
pins the full seller chain and reverse-order cleanup. The failed CI run changed
no production or provider state and cannot support migration or deployment;
the corrected exact head requires a fresh complete CI pass.
After the correction, the focused transfer-binding suite passes 17/17 and the
full repository suite passes 3,452 tests with zero failures and seven
intentional skips; TypeScript, lint and diff checks also pass.

Correction head `f456d912d24f8c7c8096adce8f77248c0ac2a664` then reached the
same direct-runtime proof in exact-head CI `33046021218` and exposed a distinct
candidate defect: the transfer-binding UPDATE referenced `Order.updatedAt`,
but the production Prisma model and historical table do not have that column.
The migration-only PGlite schema had incorrectly invented the column, masking
the error. No migration was applied outside disposable CI. The candidate now
updates only the durable `stripeTransferId`; its PGlite Order schema matches the
real column boundary, the static contract rejects any `updatedAt` reference,
and the migration is repinned to the SHA-256 above. This second failed run is
also non-release evidence and requires another fresh exact-head CI pass.

Final correction head `a092e4a4bf1608ab1e7231633db3da36d2fbd391`
passed exact-head CI `33046657108`, including the full historical migration
tree, disposable PostgreSQL proof, direct `grainline_app_runtime` login proof,
TypeScript, lint, dependency audit, production build and the complete test
suite (3,452 passed, zero failed, seven intentional skips). PR #289 merged as
exact main `ea12d220b9809ac113e9d79c7e8996e103d8d641`; exact-main CI
`33088415834` and the standing Conversation/Message and Notification FORCE
proof workflows `33088415885` and `33088415831` also passed. These results
validate the production-inert release bytes only. The migration remains
unapplied, the corrected application remains undeployed, the preserved failed
fixture remains unreconciled and `OrderPaymentEvent` RLS remains off. The next
boundary is the dedicated guarded application of only
`20260826010000_prepare_blocked_checkout_transfer_binding`; deployment,
fixture reconciliation, a fresh automatic paid proof, predecessor drain and
RLS activation remain later separate boundaries in that order.

Guarded production run `33106083900`, bound to exact main
`855118f36d0a98d1bc376d35101f50e21e87d184` and CI `33096249263`,
applied only `20260826010000_prepare_blocked_checkout_transfer_binding`.
Migration status and the global grant/RLS audit passed. The final engine-read-
only scope proof then failed closed because its extractor removed the newline
immediately inside each dollar-quote delimiter, while PostgreSQL correctly
retained both newlines in `pg_proc.prosrc`. A sanitized read-only comparison
proved every security-relevant catalog field exact—the migration checksum and
step count, function identity and owner, `SECURITY DEFINER`, pinned search
path, language, volatility, parallel/leakproof posture, runtime-only EXECUTE
and PUBLIC denial—and proved that adding exactly the two delimiter newlines
makes the stored source hash equal the sealed function body. This is a
postflight extraction defect, not function drift. The migration remains
applied, but acceptance stays open until a corrected exact-main, CI-bound,
restart-safe read-only rerun passes. No app deployment, fixture reconciliation,
RLS activation, predecessor drain or provider change occurred.

The corrected local owner-credential rerun then passed the same engine-enforced
repeatable-read/read-only proof with state `transfer-binding-compatible`, both
compatible migrations applied, runtime EXECUTE only, `OrderPaymentEvent` RLS
still off, predecessor CRUD retained and `productionChangedByProof=false`.
That confirms the diagnosis without mutation, but it does not replace the
required exact-main/CI-bound GitHub restart proof.
