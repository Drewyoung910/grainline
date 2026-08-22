# SellerPayoutEvent linked-seller production proof

Revised: 2026-08-21

Status: the corrected proof was attempted from exact main
`c221b1871ee73bbce8f092daf49536c4381cf9de`, CI `32537455244`, on
2026-08-21 and failed closed before any Stripe or database mutation because no
existing linked test seller met the complete failure-bank requirement. An
aggregate-only engine-read-only follow-up found two retrievable linked sellers;
both were Stripe-controlled Express accounts with charges and payouts enabled,
and neither used the documented payout-failure bank ending `1116`. Changing
either seller's payout account was rejected. The replacement candidate instead
uses one release-bound disposable Express account plus one temporary hidden
Grainline User/SellerProfile pair, and removes all of them after the proof.
The corrected verifier uses Vercel's authenticated read-only
`/v13/deployments/{id}` API and requires the exact source commit and every
canonical alias. The compatible application is
live at exact source `e9239463a71860451191344b26dd20b45298f239`, CI
`31927548800`, deployment `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h`; deployment and
predecessor compatibility are accepted separately. Nothing in this document
authorizes a provider mutation, database fixture, payout, notification,
cleanup, RLS activation or grant change.

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

Use the existing canonical test-mode Connect endpoint and create one
release-bound disposable Stripe test-mode Express account. Complete that
account through Stripe-hosted test onboarding with the documented
`no_account` failure bank. Immediately before the signed event, create one
exact temporary User/SellerProfile pair directly in production, link only that
pair to the disposable account, and keep the seller in vacation mode so it is
not publicly discoverable. Do not create a second webhook endpoint, move the
canonical endpoint, install another signing secret, create a Vercel Preview or
create a Neon child solely for this check.

This is narrower than the child/Preview alternative in the original audit:

- signature, routing, application code, pooled runtime credentials and fixed
  PostgreSQL functions are proved in the real production topology;
- no webhook, Vercel, Neon topology or secret changes are required;
- no customer order, payment, refund or live-mode Stripe object is created;
- the exact payout projection, notification, temporary seller and temporary
  user are removed after acceptance; the processed `StripeWebhookEvent` lease
  remains under the normal retention
  contract as authenticated provider evidence; and
- the disposable connected account is deleted after acceptance. Its test-mode
  charge and failed payout may remain in Stripe's provider history, but do not
  move live money.

The site is pre-launch, but every existing seller remains non-disposable. The
operator no longer contains an existing-seller selection path. The disposable
account, temporary database identities, provider metadata marker, recovery
state, commit, CI run and deployment are all mutually bound. A collision,
partial fixture, unexpected relationship or missing cleanup object stops the
run. The reviewed test charge, failed payout, temporary production rows and
connected-account deletion are part of a new explicit execution boundary; code
review or merge does not authorize them.

## Restart-safe stages

The operator uses separate mode-0600 provider-canary and database-proof
recovery records containing the raw IDs needed for exact cleanup. Sanitized
evidence contains only SHA-256 digests.

1. **Preflight** — require a clean checkout of the exact reviewed operator
   commit, successful push CI for that exact commit on GitHub `main`, the exact
   READY production deployment and canonical aliases,
   healthy `/api/health`, the expected Vercel project, the sensitive production
   Connect secret binding and provider stage 4 with only `payout.failed`.
2. **Prepare disposable provider source** — persist a mode-0600 reservation
   before account creation. Create one marker-bound test-mode Express account
   with the failure bank and use only a Stripe-hosted onboarding link. Persist
   the raw account/link only in the private local handoff. Reruns use a
   persisted link generation; abort may delete only the exact marker-bound
   account and is blocked once the database proof state exists.
3. **Create hidden database fixture** — persist a `fixture-reserved` recovery
   state before mutation. In one serializable owner transaction, insert or
   exactly revalidate one deterministic temporary User and one vacation-mode
   SellerProfile linked to the disposable account. Any ID, Clerk ID, email or
   Stripe-account collision fails closed.
4. **Prepare signed source** — create only a five-dollar test funding charge
   and a one-dollar standard payout bearing release-bound idempotency keys.
   Require settled available USD before creating the payout, require the payout
   to fail with `no_account` and resolve exactly one fresh `payout.failed`
   event.
5. **Prove delivery** — wait for the canonical endpoint to process the event.
   Through the actual pooled `grainline_app_runtime` credential, set the seller
   actor context and prove the fixed latest projection plus exactly one visible
   source-bound `PAYOUT_FAILED` notification. Through an engine-read-only owner
   transaction, prove one matching webhook lease, one matching payout row and
   their exact source relationship.
6. **Prove retry** — resend only that event to only the canonical Connect
   endpoint. Require the lease generation and update time, payout row identity
   and update time, notification identity and dedup key all to remain unchanged.
7. **Clean exact application rows** — in one owner transaction, lock and
   revalidate the exact seller, user, payout, lease and notification
   relationship; delete only that notification, payout, temporary seller and
   temporary user, in that order. While the seller/user locks are held, inspect
   every PostgreSQL foreign key and require zero remaining dependents before
   either parent delete, so an `ON DELETE CASCADE` cannot silently broaden
   cleanup. Never delete the webhook lease or any unrelated row. Roll back on
   any count other than exactly one.
8. **Clean provider and postflight** — after database cleanup is durably
   recorded, delete only the exact marker-bound disposable account. Prove the
   temporary rows and account are absent, the processed webhook lease remains,
   provider stage is still 4, production health is good and no configuration
   changed. Only then write sanitized evidence and remove both recovery files.

The operator commit and deployed application source are deliberately separate
immutable bindings. Documentation may advance `main` after the compatible app
is deployed: execution therefore binds the operator and successful exact-main
CI to the current reviewed commit, while Vercel inspection independently binds
deployment `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h` to application source
`e9239463a71860451191344b26dd20b45298f239`. A detached local checkout is
accepted only when its HEAD is the exact successful-main-CI commit and it is
clean; arbitrary feature-branch execution remains rejected.

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
URLs, provider object IDs, hosted-onboarding links and deterministic canary
IDs/email from every surfaced error. The recovery records are not evidence and
must never be committed or uploaded.

## Release boundary after proof

Passing this proof closes the provider-authenticated linked write and
notification gate only. Predecessor application deployments must still drain,
the source tree must prove zero direct SellerPayoutEvent access, and policyless
ENABLE plus direct-grant revocation and FORCE remain separate releases with
their own owner and pooled-runtime proofs.
