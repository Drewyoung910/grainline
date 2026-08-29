# OrderPaymentEvent seller full-refund production proof

Status: first execution attempt failed closed before provider-object creation;
an isolated metadata-limit correction and the preserved restart journal are
under review. Review or merge does not authorize execution or retry.
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

Exact main `877610cbb12491d8e788e6948a3c9c31aced1e70` and CI
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

## Sequencing

1. Retain the accepted distinct signed refund/dispute proof.
2. Merge this reviewed operator from an exact main commit and require exact-main CI.
3. Resume the exact preserved first attempt only after the metadata correction
   merges and its exact-main CI passes.
4. Record sanitized evidence and cleanup outcome.
5. Continue with the still-separate staff Case refund live proof. Do not
   bundle those authorities or infer them from this seller proof.
