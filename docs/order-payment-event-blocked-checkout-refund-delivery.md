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

The hosted Checkout completion is intentionally a distinct operator stage. A
private mode-0600 recovery file may retain its short-lived client secret; public
logs and sanitized evidence may retain only hashes and counts. No webhook
secret may be used to forge an event as a substitute for provider delivery.

## Restart-safe provider operator

`scripts/order-payment-event-blocked-checkout-production-proof.mjs` implements
four explicit commands behind one exact-main, successful-CI and READY
production-deployment binding:

1. `prepare` creates one marker-bound transfer-only Custom account, fences the
   operational canary's refund-email preference, creates a private reserved
   $5 listing, authenticates the canary, calls the real quote and single-item
   checkout routes, proves exact route retry, and only then flips the synthetic
   seller to vacation mode. The short-lived Stripe client secret is written
   only to the mode-`0600` recovery state.
2. `serve` binds only `127.0.0.1` and serves a no-store Stripe Embedded Checkout
   page after independently rechecking the exact clean main commit and its
   successful CI. Card data stays in Stripe-hosted frames; the page does not
   call a Grainline webhook or know any webhook secret. Closing the server does
   not alter recovery state.
3. `verify` requires a genuinely paid test Checkout Session. It discovers the
   exact provider `checkout.session.completed` and `charge.refunded` events,
   proves the completed reservation, restored listing, source-bound local and
   signed payment rows, claim clearance, full buyer refund, exact seller
   transfer reversal, `REFUND_ISSUED` Notification, skipped deterministic
   refund outbox and absence of all `NEW_ORDER` delivery. It resends both exact
   provider events and requires every application identity and webhook claim
   generation to remain unchanged before cleanup.
4. `cleanup` is an explicit abort path only while the Session is unpaid. It
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
deleting application rows, restores the canary's exact preferences/terms,
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
