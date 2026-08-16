# SellerPayoutEvent linked-seller production proof

Status: reviewed design and isolated operator work only. Nothing in this
document authorizes a production deployment, provider mutation, database
fixture, payout, notification, cleanup, RLS activation or grant change.

Prepared: 2026-08-15

## Why this proof exists

The retained Stripe Connect proof established that the separately signed
test-mode `payout.failed` endpoint accepts one real provider event, records one
durable webhook lease and leaves an exact retry unchanged. Its disposable
connected account was deliberately absent from Grainline, so the accepted
result was zero `SellerPayoutEvent` and zero payout notification rows.

The SellerPayoutEvent release needs the complementary linked-seller proof:
one real signed test-mode failure must map through the current unique
`SellerProfile.stripeAccountId`, create exactly one payout projection, create
exactly one source-bound `PAYOUT_FAILED` notification for that seller and stay
unchanged after an exact provider retry.

## Chosen topology

Use the existing canonical test-mode Connect endpoint and one already-linked,
eligible test-mode seller. Do not create a second webhook endpoint, move the
canonical endpoint, install another signing secret, create a Vercel Preview or
create a Neon child solely for this check.

This is narrower than the child/Preview alternative in the original audit:

- signature, routing, application code, pooled runtime credentials and fixed
  PostgreSQL functions are proved in the real production topology;
- no Stripe/Vercel/Neon topology or secret changes are required;
- no customer order, payment, refund or live-mode Stripe object is created;
- the exact payout projection and notification are removed after acceptance;
  the processed `StripeWebhookEvent` lease remains under the normal retention
  contract as authenticated provider evidence; and
- the test-mode charge and failed payout remain in Stripe's immutable provider
  history, but do not move live money.

The site is pre-launch, but the operator must still treat every existing seller
as non-disposable. It may select exactly one seller from a bounded candidate set
only if the database row is active and the Stripe test-mode account is
retrievable, charges-enabled and payouts-enabled, and its default USD external
account is Stripe's documented payout-failure test bank ending `1116`. If no
candidate meets that complete source shape, the operator stops before creating
a charge or payout. It never changes the seller row or the Stripe account
configuration. The reviewed test charge and failed payout do add test-mode
balance/history entries and are part of the explicit future execution boundary.

## Restart-safe stages

The operator uses one mode-0600 local recovery record containing the raw IDs
needed for exact cleanup. Sanitized evidence contains only SHA-256 digests.

1. **Preflight** — require an exact clean reviewed main commit, successful
   exact-main CI, the exact READY production deployment and canonical aliases,
   healthy `/api/health`, the expected Vercel project, the sensitive production
   Connect secret binding and provider stage 4 with only `payout.failed`.
2. **Select** — in an engine-read-only owner transaction, find bounded active
   seller candidates and select one eligible Stripe test-mode account without
   printing any identifier.
3. **Prepare source** — atomically write the recovery record before each
   provider mutation; create only a five-dollar test funding charge and a
   one-dollar standard payout bearing a release-bound marker and idempotency
   keys. Require settled available USD before creating the payout, require the
   payout to fail with `no_account` and resolve exactly one fresh
   `payout.failed` event.
4. **Prove delivery** — wait for the canonical endpoint to process the event.
   Through the actual pooled `grainline_app_runtime` credential, set the seller
   actor context and prove the fixed latest projection plus exactly one visible
   source-bound `PAYOUT_FAILED` notification. Through an engine-read-only owner
   transaction, prove one matching webhook lease, one matching payout row and
   their exact source relationship.
5. **Prove retry** — resend only that event to only the canonical Connect
   endpoint. Require the lease generation and update time, payout row identity
   and update time, notification identity and dedup key all to remain unchanged.
6. **Clean exact application rows** — in one owner transaction, lock and
   revalidate the exact seller, payout, lease and notification relationship;
   delete only that notification and payout row, in that order. Never delete or
   rewrite the seller, webhook lease or any unrelated notification. Roll back
   on any count other than exactly one.
7. **Postflight** — prove the payout and notification fixture rows are absent,
   the seller and processed webhook lease remain, provider stage is still 4,
   production health is good and no configuration changed. Only then write
   sanitized evidence and remove the recovery record.

If any step fails after a provider object exists, preserve the mode-0600
recovery record and stop. A rerun must resume from its exact recorded stage and
may not create a second payout. Cleanup is a separately visible production
mutation and must be included in the eventual exact authorization.

Stripe does not expose an idempotency key for its event-resend operation. A
process crash after Stripe accepts the resend but before the recovery stage is
persisted can therefore cause a restart to resend the same already-recorded
event again. The proof guarantees at least one retry of only the exact source
event, never creates another payout, and requires every resulting delivery to
leave the lease generation, projection and notification identities unchanged;
it does not claim an exactly-once network delivery count.

## Evidence and privacy contract

Durable evidence may contain release commit, CI/deployment identifiers,
provider stage, counts, booleans, timestamps and SHA-256 digests of Stripe,
seller, payout, notification and webhook IDs. It must not contain database
URLs, credentials, raw provider IDs, user/seller IDs, email, payout failure
message, notification body or row payloads.

The operator must redact Stripe keys, signing secrets, bearer tokens, database
URLs and provider object IDs from every surfaced error. The recovery record is
not evidence and must never be committed or uploaded.

## Release boundary after proof

Passing this proof closes the provider-authenticated linked write and
notification gate only. Predecessor application deployments must still drain,
the source tree must prove zero direct SellerPayoutEvent access, and policyless
ENABLE plus direct-grant revocation and FORCE remain separate releases with
their own owner and pooled-runtime proofs.
