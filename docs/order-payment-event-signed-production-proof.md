# OrderPaymentEvent signed production proof

Status: restart-safe operator implemented and locally proven; not executed.
Reviewing or merging this package does not authorize Stripe or production
database mutations. `OrderPaymentEvent` RLS remains off with predecessor CRUD
until every activation gate is accepted.

The compatible application is live from exact source
`2820986538c0d64f035defce052ba4ad0de1b3fb` in production deployment
`dpl_73aR913b9hfgkcdfBv2MwMyypR5a`. This proof must run from a later exact-main
operator commit with its own successful exact-main CI binding.

## Why this is a separate proof

Disposable PostgreSQL proves function authority, lock order, replay equality
and database rollback. It cannot prove that Stripe signs and delivers the real
event shape, that Vercel's deployed webhook reaches the prepared fixed
functions through the pooled runtime credential, or that Stripe's exact retry
is idempotent across the deployed application. This operator closes only that
provider/application boundary for the signed families:

- `charge.refunded`; and
- `charge.dispute.created`, including its Case and seller Notification effects.

It deliberately does not claim the other money-moving families are proven.
Seller full refund, blocked-checkout refund recovery and staff Case refund each
have different authentication, provider-call and participant-delivery
boundaries and remain separate live proofs before activation. A successful
signed proof is therefore necessary but explicitly insufficient evidence for
policyless RLS activation.

## Exact proof shape

The operator is `scripts/order-payment-event-signed-production-proof.mjs`.
It requires:

- an explicit confirmation string;
- an exact clean `main` operator commit and successful exact-main CI run;
- the exact compatible deployed source and Vercel Production deployment;
- canonical alias and health attestation without `vercel curl`;
- the expected Grainline Vercel project identity;
- a Stripe `sk_test_` secret and pinned Stripe CLI 1.39.0;
- exact enabled Stripe provider stage 4 with the canonical platform webhook;
- direct `neondb_owner` and pooled `grainline_app_runtime` production identity;
  and
- the still-compatible `OrderPaymentEvent` RLS-off/broad-CRUD posture.

It creates two independent Stripe test-mode PaymentIntents. The refund family
uses `pm_card_visa`, inserts a private disposable Order bound to its resulting
charge, and creates one exact full refund. The dispute family uses Stripe's
`pm_card_createDispute`, then inserts a separate private Order bound to that
charge. Because the special test payment may emit its dispute before the Order
fixture exists, the operator always sends an exact CLI resend after inserting
the fixture; a later second resend proves processed-event replay. The refund
event receives its own post-success exact resend. A durable pending stage is
written before each required resend. If the process stops after Stripe accepts
a resend but before the next state write, an exact rerun may safely resend the
same event again; evidence records completion of the three required resend
transitions and never claims an unknowable exactly-once provider call count.

Every application target is derived by the deployed source from the signed
provider object and durable Order relationship. The operator verifies exactly:

- one processed, error-free webhook lease per event;
- one source-bound `OrderPaymentEvent` row per event;
- the refund's canonical Order update and audit row;
- the dispute's canonical Order update, Case, immutable
  `CaseStripeDisputeApplication`, seller Notification and two audit rows; and
- unchanged webhook generation/timestamp and all side-effect identities after
  each post-success exact replay.

The proof never creates, updates, enables, disables or deletes a Stripe
webhook endpoint or v2 destination. It never touches Stripe live mode and does
not move live money.

## Restart and cleanup contract

Raw provider and fixture identifiers exist only in a commit-bound mode-`0600`
recovery state file. Every Stripe mutation uses an attempt- and commit-bound
idempotency key. Each database fixture insert accepts only an exact prior row
or an entirely absent identity set. The state machine resumes from the last
durable stage; no generic cleanup or guessed recovery is allowed. If a machine
crash leaves the atomic state-update `.next` file behind, a rerun promotes it
only when both files are private, it advances exactly one reviewed stage and
every previously sealed field is byte-equivalent. Orphans, stage skips and
identity drift fail closed.

After both replay proofs, cleanup runs in one serializable transaction. It
re-verifies every synthetic User, SellerProfile, Listing, Order and OrderItem
marker plus the exact source relationships, then removes the one dispute
Notification, Case application, Case, three audit rows, two payment rows, two
OrderItems, two Orders, two private Listings, one SellerProfile and two Users.
Before removing each parent, it inspects every live foreign key—including
composite keys—and refuses any unexpected dependent rather than relying on a
cascade. The two processed `StripeWebhookEvent` rows are intentionally
retained so any future Stripe retry is absorbed without recreating side
effects. Stripe test-mode PaymentIntent, charge, refund and dispute objects are
provider records and are not deletable. Stripe, Vercel and Sentry may retain
their ordinary signed-delivery/request/expected-dispute telemetry. Sanitized
operator evidence records only hashes and states this external residue
separately from the exact database cleanup.

If an error occurs, the operator fails closed and retains its private recovery
state for an exact rerun. It does not attempt speculative cleanup. Once exact
cleanup and evidence writing succeed, the recovery file is removed. The final
cleanup stages never require already-deleted application rows to reappear: a
restart reuses only the delivery identities sealed before cleanup and proves
the exact zero-residue snapshot before writing evidence. The final
mode-`0600` evidence contains hashes, counts, release bindings and explicit
residual gates; it contains no database URL, secret or raw identifier.

## Local proof coverage

- `tests/order-payment-event-signed-production-operator.test.mjs` covers exact
  configuration, deterministic identities, restart stages, delivery/replay
  snapshots, cleanup posture, redaction and the no-provider-configuration
  mutation contract.
- `tests/order-payment-event-signed-production-fixture-postgres.test.mjs`
  creates both families twice in disposable PostgreSQL, proves exact delivery
  and cleanup, rejects a colliding charge relationship, and proves that an
  unexpected cascading dependent aborts the whole cleanup transaction.
- The already accepted signed-authority PostgreSQL suite remains the source of
  truth for function source binding, ordering, replay and concurrency. This
  operator does not weaken or replace it.

## Reviewed execution template

Execution values must be filled only after this package is merged and its
exact-main CI succeeds:

```bash
ORDER_PAYMENT_SIGNED_PROOF_CONFIRM=reviewed-order-payment-signed-production-proof \
ORDER_PAYMENT_SIGNED_PROOF_EXPECTED_COMMIT=<exact-main-operator-commit> \
ORDER_PAYMENT_SIGNED_PROOF_DEPLOYED_SOURCE_COMMIT=2820986538c0d64f035defce052ba4ad0de1b3fb \
ORDER_PAYMENT_SIGNED_PROOF_CI_RUN_ID=<successful-exact-main-ci-run> \
ORDER_PAYMENT_SIGNED_PROOF_DEPLOYMENT_ID=dpl_73aR913b9hfgkcdfBv2MwMyypR5a \
ORDER_PAYMENT_SIGNED_PROOF_EVIDENCE_PATH=/Users/drewyoung/grainline-rollout-evidence/order-payment-event-signed-production-proof-<exact-main-operator-commit>.json \
ORDER_PAYMENT_SIGNED_PROOF_VERCEL_PROJECT_DIRECTORY=/private/tmp/<clean-exact-main-worktree> \
npm run ops:order-payment-event-signed-production-proof
```

The next boundary after successful evidence is not RLS activation. Continue
with the seller-refund, blocked-checkout and staff Case refund live proofs,
then participant/staff projection and inventory gates, predecessor drain,
fresh aggregate inspection, invariant release, policyless ENABLE and separate
FORCE.
