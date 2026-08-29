# OrderPaymentEvent seller full-refund production proof

Status: second execution attempt failed closed before provider-object creation;
an isolated production-aligned Express/Stripe-collected onboarding correction
and the preserved restart journal are under review. Review or merge does not
authorize execution or retry.
`OrderPaymentEvent` RLS remains off and predecessor CRUD must remain available
throughout this proof.

Audited: 2026-08-25 after the signed refund/dispute proof package was prepared.

## Purpose

Prove the real authenticated seller full-refund route against the compatible
production application, PostgreSQL authority, Stripe test mode, Clerk and the
active signed platform webhook. This proof is deliberately separate from the
signed-webhook proof: a successful provider webhook does not prove that the
seller route derives the correct actor, amount, transfer reversal, stock,
Case, notification and email-outbox effects.

The proof is required before `OrderPaymentEvent` direct runtime CRUD can be
removed. It is not RLS activation evidence by itself.

## Identity and provider boundary

- Reuse only the retained non-customer Clerk operational canary. It must have
  no active Clerk session, no SellerProfile and no marketplace activity that
  overlaps the fixture.
- Add one temporary vacation-mode SellerProfile to that canary. Never
  authenticate or modify a real seller.
- Create one synthetic production buyer row with
  `EMAIL_REFUND_ISSUED=false`. The refund email outbox row must therefore
  commit atomically and finish as `SKIPPED`; the proof sends no email.
- Create one disposable Stripe **test-mode** platform-controlled connected
  account with only the `transfers` capability needed by a destination charge.
  Use the same Express controller and Stripe-collected responsibility boundary
  as Grainline's accepted blocked-checkout proof. Do not change the Stripe
  platform profile to accommodate the proof and do not submit legacy Custom,
  application-collected identity or direct TOS fields.
  This proof does not represent production seller onboarding or a live-mode
  account. The account must be marker-bound, receive exactly one 475-cent
  destination transfer, return to zero after reversal and be deleted during
  cleanup.
- Create one 500-cent test PaymentIntent with a 475-cent destination transfer.
  The 25-cent difference is the exact 5% product fee derived by production
  accounting. The authenticated route must refund 500 cents and Stripe must
  reverse exactly 475 cents.

Provider-created PaymentIntent, charge, refund, transfer, reversal, Event and
ordinary observability records are immutable external test evidence. They are
not application cleanup residue. The disposable connected account is removed.

## Application fixture

The owner-only fixture is marker-bound and must be revalidated immediately
before deletion:

- retained operational canary User plus one temporary vacation-mode
  SellerProfile linked to the disposable Stripe account;
- one synthetic buyer User with email refund delivery disabled;
- one non-private `IN_STOCK` Listing in `SOLD_OUT` with stock zero. Vacation
  mode keeps it absent from public inventory while allowing the fixed refund
  function to prove stock restoration and status reactivation;
- one paid Order and one same-seller OrderItem bound to the real test
  PaymentIntent, charge and transfer;
- one OPEN Case for the exact buyer, seller and Order.

No fixture is inferred from broad time ranges during cleanup. Identifiers,
provider object IDs and fixture markers remain only in a mode-0600 restart
state file and are hashed or omitted from sanitized evidence.

## Required assertions

The operator must fail closed unless all of these hold:

1. exact clean reviewed commit, successful exact-main CI, compatible deployed
   source, Vercel deployment identity, aliases and health;
2. successful signed refund/dispute predecessor evidence for the same deployed
   source and active stage-4 platform endpoint;
3. production owner and pooled runtime identities plus RLS-off predecessor
   `OrderPaymentEvent` grants and exact fixed-function catalog;
4. explicit cross-origin POST returns 403 before mutation;
5. authenticated `POST /api/orders/:id/refund` with `{ "type": "FULL" }`
   returns one provider refund and the database-derived 500-cent amount;
6. Stripe refund succeeds and exposes the exact 475-cent transfer reversal;
7. one local `local:seller_refund_recorded:<refund>` payment row and one signed
   `charge.refunded` payment row exist for the same refund and Order;
8. the signed confirmation is classified `local_refund_confirmed` when local
   finalization wins the race, or `local_refund_pending_confirmation` when the
   signed webhook wins it. Both orders must preserve the final local refund ID
   and must not apply a second stock or Case transition;
9. the Order claim is cleared, terminal refund fields are exact, stock is one,
   the vacation-hidden Listing is ACTIVE, the Case is `RESOLVED` /
   `REFUND_FULL`, and exactly one CaseSellerRefundApplication exists;
10. exactly one source-bound buyer Notification, one `SKIPPED` refund outbox
    row, one seller-refund audit, one Case-application audit and one signed
    confirmation audit exist;
11. an exact authenticated retry is rejected as already refunded and changes
    no provider or application identity;
12. exact signed event resend is idempotent; and
13. cleanup revokes every canary Clerk session, removes the refund rate-limit
    keys, deletes the disposable connected account and all temporary
    application rows, and retains only the processed signed webhook replay
    lease plus provider/observability evidence.

## Crash and cleanup rules

The operator writes every externally visible transition to a private state
file before advancing. Recovery accepts only the reviewed adjacent stages and
revalidates provider and database identity; it never guesses that an HTTP or
Stripe call failed from the absence of a local response.

Once the refund exists, cleanup must first wait for the signed
`charge.refunded` lease, because deleting the Order first could make a delayed
signed event fail and retry forever. It then removes dependent rows under a
serializable owner transaction after live foreign-key discovery and exact
marker checks. The permanent operational canary User and the processed webhook
lease are retained. A failed cleanup preserves the private state file and
prints only redacted diagnostics.

The pre-execution hard review found and corrected two operator-only defects:
database catalog reads no longer issue concurrent queries through one
`node-postgres` client, and deleted connected-account recovery no longer
assumes `accounts.retrieve` returns a deleted object. Stripe can instead return
the exact `StripePermissionError` / `account_invalid` / HTTP 403 / `api_error`
tuple after deletion. That tuple proves deletion only when an explicitly
paginated, bounded account listing is well formed, reaches `has_more=false`
and excludes the exact marker-bound account; reaching the bound before provider
exhaustion fails closed instead of silently accepting a truncated listing.
Every other error or listing shape fails closed, including restart from either
`cleanup-started` or `cleaned`.

## First execution attempt failed closed (2026-08-28)

Exact main `877610cbb12491d6ae67e56ddb745ace146e1ed3` and CI
`33231868504` passed every repository gate, but Stripe rejected the first
account-create request before object creation because the proof metadata key
was 43 characters and Stripe permits at most 40. The private mode-`0600`
journal stopped at `account-create-pending`; no payment or application fixture
was created. A complete read-only test-account scan reached provider
`has_more=false` after 13 accounts and found zero accounts with the attempt
marker.

The correction uses the shorter `grainline_seller_refund_proof` key for both
the disposable account and PaymentIntent and validates every emitted Stripe
metadata key against the provider limit before any request. The preserved
journal remains the only valid retry identity. No deployment, migration,
grant, RLS or provider configuration changed.

The post-merge restart review then found that the first operator version used
one commit/CI pair for two distinct identities: the preserved attempt and the
currently executing corrected code. Requiring the corrected checkout while
also requiring the journal's original commit was impossible without rewriting
the journal, which is forbidden. Retry configuration now keeps
`EXPECTED_COMMIT` / `MAIN_CI_RUN_ID` bound to the original attempt and adds a
paired `OPERATOR_COMMIT` / `OPERATOR_CI_RUN_ID` bound to the clean corrected
main checkout. Both successful exact-main CI records are verified, operator
metadata and sanitized evidence retain both identities, and the original
journal, marker and Stripe idempotency namespace remain unchanged. The two
operator variables must be supplied together or the retry fails closed.

## Second execution attempt failed closed (2026-08-29)

The preserved attempt resumed from corrected operator/main
`232f4b6f725caa193af51f214395f6019cddde63` and CI `33233774693`, while
retaining original attempt main `877610cbb12491d6ae67e56ddb745ace146e1ed3`
and CI `33231868504`. Stripe rejected account creation because the operator's
legacy Custom/application-collected responsibility fields conflict with the
platform's current Connect responsibility profile. The journal remained at
`account-create-pending`. A complete read-only test-account scan again reached
provider `has_more=false` after 13 accounts and found zero accounts with the
attempt marker. No account, PaymentIntent, application fixture, provider
configuration, deployment, migration, grant or RLS change was created.

The correction deliberately changes the operator rather than the Stripe
platform profile. Account creation now uses the already-proven
application-fee/application-loss, Stripe-collected, Express-dashboard
controller, requests only transfers and omits `type`, `business_type`,
`individual` and `tos_acceptance`. A versioned account idempotency suffix
distinguishes this corrected request while the original attempt, journal,
marker and overall idempotency namespace remain unchanged.

If Stripe requires onboarding, the operator persists the marker-bound account
first, creates one expiring Stripe-hosted link, stores it only in a fixed
mode-`0600` file and returns a sanitized `onboarding-required` result without
an account ID, URL or secret. A separate `onboard` command re-verifies both
commit/CI bindings, predecessor evidence, the exact journal and link binding,
then opens the URL without printing it. The normal command will advance to
payment creation only after the exact account's transfers capability is
active. Expired links are replaced only for the same preserved account; the
private handoff record is removed after capability activation and during
cleanup.

## Sequencing

1. Retain the accepted distinct signed refund/dispute proof.
2. Merge this reviewed operator from an exact main commit and require exact-main CI.
3. Merge the production-aligned Express/hosted-onboarding correction and pass
   its exact-main CI.
4. Resume the exact preserved first attempt. If it pauses for hosted
   onboarding, open only the private marker-bound link, complete Stripe's test
   onboarding, and resume the same account and journal.
5. Record sanitized evidence and cleanup outcome.
6. Continue with the still-separate staff Case refund live proof. Do not
   bundle those authorities or infer them from this seller proof.
