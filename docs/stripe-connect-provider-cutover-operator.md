# Stripe Connect provider cutover and signed payout proof

Status: prepared and locally tested; not executed by this change.

This is the test-mode provider step that follows the disabled bootstrap and
compatible production deployment. It corrects the three reviewed webhook
subscription surfaces, moves the classic Connect endpoint to its canonical
route while it is still disabled, then uses a fresh disposable test connected
account to prove one provider-authenticated `payout.failed` delivery and an
exact retry. No application deploy, migration, RLS policy, database grant,
provider secret or live-mode object is part of these operators.

The implementation is deliberately split at disabled canonical stage 3:

1. `scripts/stripe-connect-provider-cutover.mjs` corrects provider
   configuration but stops with the Connect endpoint disabled.
2. `scripts/stripe-connect-signed-payout-proof.mjs` first creates the fresh
   failed-payout source while delivery is disabled, then enables the endpoint
   only inside the delivery proof. Any delivery or replay failure returns the
   endpoint to disabled canonical stage 3.

This split prevents an asynchronous payout from leaving an unproved endpoint
enabled and makes retries unambiguous.

## Exact predecessor and target

The configuration operator accepts only five monotonic provider states:

| Stage | Platform events | v2 events | Connect URL and status |
|---|---|---|---|
| 0 | six exact predecessor events | fifteen exact predecessor events | bootstrap URL, disabled |
| 1 | ten reviewed events | predecessor | bootstrap URL, disabled |
| 2 | reviewed | twelve reviewed account events | bootstrap URL, disabled |
| 3 | reviewed | reviewed | canonical URL, disabled |
| 4 | reviewed | reviewed | canonical URL, enabled |

The configuration operator may resume stages 0 through 3 and finishes only at
stage 3. Stage 4 is owned by the signed-delivery operator and is rejected by
the staging operator so a successful delivery release cannot be accidentally
rolled back.

The exact platform target is:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`
- `charge.dispute.funds_withdrawn`
- `charge.dispute.funds_reinstated`

The v2 target retains the twelve observed `v2.core.account` notifications and
removes only the three proven unused `v2.core.account_person.created`,
`v2.core.account_person.deleted`, and `v2.core.account_person.updated` events.
It requires `thin`, `events_from=other_accounts`, the canonical v2 URL, test
mode and enabled status before and after the change. The API cannot change
`events_from` or payload mode through the update used here.

The classic Connect target remains exactly `payout.failed`. Its endpoint ID
must hash to the retained disabled-bootstrap digest, and retained creation
evidence must attest that the endpoint was created with `connect=true`.
Classic endpoint source scope is not returned by the read API and is therefore
never inferred from URL or event names.

## Configuration rollback and restart behavior

Each mutation is followed by a full provider re-read. The pending mode-`0600`
journal contains only commit, CI run, deployment and stage; it contains no
provider ID or secret. A killed process may resume only when the actual
provider objects still form one of the five exact states.

Updates to existing provider objects use invocation-scoped idempotency keys
that are distinct for every forward, rollback, enable and disable direction.
This prevents Stripe from replaying an earlier forward response for the
opposite rollback request, while a fresh invocation can retry after a completed
rollback. Creation of the disposable account, funding charge and failed payout
uses a mode-`0600` preparation-attempt UUID that is written before the first
source mutation and reused across an interrupted attempt. The journal also
retains the first event-search timestamp and, after Stripe returns it, the raw
disposable account ID. Source idempotency keys bind that attempt UUID. A fully
cleaned failed attempt removes the journal so its replacement receives fresh
keys instead of replaying a deleted account; incomplete cleanup preserves the
journal and resumes the exact account rather than creating another one.

Any ordinary staging failure rolls back in reverse order:

1. disable Connect and restore the absent bootstrap URL;
2. restore the exact fifteen-event v2 predecessor; and
3. restore the exact six-event platform predecessor.

Incomplete rollback is reported and preserves the pending journal. Multiple
objects at a reviewed URL, wildcard events, a different Connect endpoint ID,
live-mode objects, a changed payload/source scope, an unexpected event set, or
an illegal cross-stage combination fail closed.

## Disposable signed-delivery source

Stripe's CLI cannot synthesize `payout.failed`; Stripe documents manual resend
of an existing event and special test bank accounts that cause real test-mode
payout failures. The proof therefore creates a fresh Express-equivalent test
connected account with a deterministic release marker, manual payout schedule,
and the documented US test bank account ending `1116`, which fails with
`no_account`. Its controller matches Grainline's seller-account responsibility
contract: application-paid fees and losses, Stripe-collected requirements, and
the Express dashboard. The proof never submits individual identity data or
accepts Stripe's service agreement through the API on behalf of the disposable
account. A newly created Stripe-collected Express account is not payout-capable
until its owner passes through Stripe-hosted test onboarding. Preparation
therefore pauses before funding, writes a separate mode-`0600` onboarding
record containing the raw account ID and one-time Account Link URL, and returns
only a sanitized `onboarding-required` result. The one-time URL is opened only
in the operator-controlled local browser; it is never printed, committed,
uploaded, emailed or copied into evidence. A rerun retrieves the same account
from the durable attempt journal and proceeds only after Stripe reports both
charges and payouts enabled. It then deletes the onboarding record before it
funds that account with Stripe's `tok_bypassPending` test token, creates a
one-dollar payout, waits for the real failed payout and exact `payout.failed`
event, and writes:

- sanitized durable evidence containing SHA-256 ID digests; and
- a temporary mode-`0600` handoff containing the raw account, payout and event
  IDs needed for exact resend.

The disposable account uses the same responsibility shape as Grainline's
Accounts v2 seller contract (`requirement_collection=stripe`, application-paid
fees and losses, and the Express dashboard). It deliberately omits a legacy
top-level `type`: Stripe rejects requests that send `type` and `controller`
together. The returned account must re-attest the exact controller properties
before funding or payout creation proceeds.

Stripe's Account object does not expose a `livemode` property. The operator
therefore permits that property to be absent, rejects any explicit value other
than `false`, and binds test mode independently through the required
`sk_test_` credential. The funding charge, payout and event must each later
re-attest `livemode=false` before preparation evidence can be written.

If returned-account attestation fails, the operator reports only whether an ID
and release marker were present, whether `livemode` was present, plus the
non-secret controller enum values. It
never includes the account ID, marker value, identity fields, bank details or
credentials. That diagnostic is emitted before the same exact account-deletion
cleanup path runs, so provider normalization can be classified without leaving
an untracked disposable source.

The proof handoff, hosted-onboarding record and preparation-attempt journal stay under `/private/tmp` (or the
system temporary directory), are never committed, and contain no API key or
signing secret. The onboarding record does contain Stripe's one-time Account
Link URL and is therefore treated as a credential: it is mode `0600`, excluded
from terminal output and removed as soon as the account is ready. If
preparation fails and exact account deletion succeeds, the script removes all
local records. If deletion cannot be proved, it preserves
the mode-`0600` attempt state for exact recovery. A successful preparation
intentionally leaves only that disposable account and its bounded local
recovery records until the signed proof completes. Provider object IDs are
also redacted from terminal error messages; only those temporary records may
retain their raw values.

Account creation and deletion can generate v2 account notifications. Because
the disposable account is deliberately absent from `SellerProfile`, those
events have no marketplace projection. Their processed webhook lease rows,
like the payout proof lease, remain bounded retention evidence until the
existing webhook prune function removes them.

## Signed delivery and exact retry

Before enabling Connect, the proof re-retrieves and validates the marked test
account, failed payout and event; rejects stale, live-mode, wrong-account,
wrong-payout or wrong-failure evidence; and opens an engine-enforced read-only
transaction through the reviewed pooled `grainline_app_runtime` URL. It
requires:

- zero `SellerProfile` rows for the disposable account;
- zero `SellerPayoutEvent` projection rows for the disposable payout; and
- no preexisting `StripeWebhookEvent` row, unless a restart finds the exact
  already-processed row from the same handoff.

It then enables the exact Connect endpoint, re-reads stage 4, and uses Stripe
CLI `events resend` with the event ID, endpoint ID and connected account ID.
The Stripe API key is passed only as inherited `STRIPE_API_KEY`, never as an
argument. The child environment is allowlisted to system path/TLS settings plus
that one key; database and Vercel credentials are not inherited by Stripe CLI.
CLI configuration lives in a fresh temporary directory and is deleted after
each resend. The reviewed CLI version is `1.39.0`.

The first delivery must create exactly one processed `payout.failed` lease at
claim generation 1. Since no seller maps to the disposable account, it must
create no payout projection. The exact retry must leave claim generation and
the lease update timestamp unchanged. Before cleanup, the proof atomically
advances the mode-`0600` handoff to `delivery-verified` with that database
identity. It can therefore resume after account deletion without resending the
event. The proof deletes the disposable test account, writes only hashed,
mode-`0600` durable evidence, and removes the raw-ID handoff last. If durable
evidence was completed but handoff removal was interrupted, a rerun verifies
the exact evidence/provider binding and performs only that local cleanup.

Any failure before durable proof completion re-reads Stripe rather than trusting
local process state. If the endpoint is actually enabled—even when the enable
response was lost in transit—the operator disables it and verifies canonical
stage 3 before returning an error. The handoff is retained for a safe retry.

Stripe documents that manual CLI resend works for events up to 30 days old,
and that a failed payout disables the external payout account. This proof uses
only a fresh disposable account so no seller payout destination is touched:

- <https://docs.stripe.com/webhooks#manual-retries>
- <https://docs.stripe.com/connect/testing#payouts>
- <https://docs.stripe.com/connect/marketplace/tasks/payout#webhooks>

## Invocation boundary

Preparation of these files is not authorization to execute them. A future
provider release must bind an exact clean `main` commit, successful exact-main
CI run, the compatible deployment ID, the fresh cutover evidence path and
fresh evidence/handoff paths. `STRIPE_SECRET_KEY` and `DATABASE_URL` must come
from the protected local environment and must never be pasted into a command,
artifact, PR, issue or chat.

Generated evidence is intentionally written under `archive/` before a later
record commit. The payout operator's git guard therefore permits only the
exact configured untracked cutover, preparation and final evidence paths; any
source edit, tracked-file change or differently named untracked artifact still
fails closed. Each permitted file is then content-validated and bound to the
same commit, CI run, deployment and temporary source before it is trusted.

Run the read-only configuration preflight first:

```sh
STRIPE_CONNECT_CUTOVER_MODE=preflight \
STRIPE_CONNECT_CUTOVER_CONFIRM=inspect-test-connect-provider-cutover \
STRIPE_CONNECT_CUTOVER_EXPECTED_COMMIT=<exact-main-sha> \
STRIPE_CONNECT_CUTOVER_CI_RUN_ID=<successful-exact-main-ci-run> \
STRIPE_CONNECT_CUTOVER_DEPLOYMENT_ID=<compatible-production-deployment> \
STRIPE_CONNECT_CUTOVER_VERCEL_PROJECT_DIRECTORY=/Users/drewyoung/grainline \
npm run ops:stripe-connect-provider-cutover
```

The separately authorized staging mutation adds a fresh
`STRIPE_CONNECT_CUTOVER_EVIDENCE_PATH` and uses:

```text
STRIPE_CONNECT_CUTOVER_MODE=cutover
STRIPE_CONNECT_CUTOVER_CONFIRM=execute-test-connect-provider-cutover
```

The payout preparation and signed proof use the same exact release bindings,
the independently pinned stage-3 cutover commit and CI run, the cutover
evidence path, separate fresh durable evidence paths, and one shared temporary
handoff path. A later operator-only fix does not rewrite or re-run the earlier
provider cutover; the proof validates both exact releases instead. Their
confirmations are:

```text
STRIPE_CONNECT_PAYOUT_PROOF_MODE=prepare
STRIPE_CONNECT_PAYOUT_PROOF_CONFIRM=create-disposable-test-payout-failure
STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_COMMIT=<exact-cutover-main-sha>
STRIPE_CONNECT_PAYOUT_PROOF_CUTOVER_CI_RUN_ID=<successful-cutover-main-ci-run>

STRIPE_CONNECT_PAYOUT_PROOF_MODE=prove
STRIPE_CONNECT_PAYOUT_PROOF_CONFIRM=enable-and-prove-signed-test-payout-failure
STRIPE_CONNECT_PAYOUT_PROOF_PREPARATION_EVIDENCE_PATH=<preparation-evidence>
```

After success, rerun `audit:stripe-webhooks` and the authenticated aggregate
Stripe webhook health proof. Only after those pass may the StripeWebhookEvent
predecessor drain and policyless RLS activation resume. Live money remains a
separate endpoint, secret, deployment and signed-delivery release; test-mode
evidence cannot authorize it.

## Test payout preparation record (2026-08-10)

PR #182 merged the hosted-onboarding correction as exact `main`
`0b718171e71700990bf8f9106ee880b116707bd3`; exact-main CI `31357207924`
passed. The preparation operator remained bound to compatible deployment
`dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP` and immutable stage-3 cutover commit
`abd49d703ec37349c84b0c70912ffb655faac5e3` / CI `31339275512`.

The first hosted submission left `individual.id_number` past due. A refreshed
single-use link collected Stripe's successful test identity number, after
which Stripe reported `charges_enabled=true`, `payouts_enabled=true`, no
current or past-due requirements and no verification errors. Only then did the
restart-safe operator create the reviewed test funding charge and USD 1.00
payout. The payout failed with `no_account` and yielded exactly one fresh
`payout.failed` event, as required.

Sanitized preparation evidence is retained at
`archive/stripe-connect-disposable-payout-preparation-test-20260810-0b718171.json`
with SHA-256
`d0b05d3f131eb64ca5b55eee9a283d8089a310ecb8c05cc92e60964cd83f0077`.
The immutable cutover predecessor is retained at
`archive/stripe-connect-provider-cutover-test-20260809-abd49d70.json` with
SHA-256
`3e0fd8a53d2f9870e270c5751dc53edbd9868fac956268781ce6c3ef829b41a8`.
Neither artifact contains raw Stripe object IDs, credentials, Account Link
URLs or personal identity values.

The raw handoff and attempt journal remain mode `0600` in `/private/tmp` so the
later signed-delivery proof can resume and delete the disposable account
without creating or replaying money movement. The onboarding record is gone.
Connect remains disabled at canonical provider stage 3; this pass performed no
event delivery or resend, endpoint enablement, deployment, migration, database
write, grant/RLS change, Vercel-variable change or live-mode Stripe operation.
The signed-delivery/exact-retry proof is a separate mutation boundary.
