# Stripe webhook provider topology audit

Status: compatible three-surface application and reviewed test-mode provider
topology are live. Exact subscription proof passed for the platform snapshot,
classic Connect payout and thin Connect v2 account surfaces; separate signed
classic snapshot and classic Connect payout delivery/retry proofs passed.
Connect v2 signed-delivery evidence, StripeWebhookEvent RLS, table-grant
revocation and all Stripe live-mode work remain separate gates.

Audited: 2026-08-09

## Why the current exact-set correction must pause

Stripe separates classic account webhooks from classic Connect webhooks:
account destinations receive activity on the platform account, while Connect
destinations receive activity on connected accounts. Stripe requires a
Connect destination (API creation uses `connect=true`) for connected-account
events. See [Stripe Connect webhooks](https://docs.stripe.com/connect/webhooks)
and [Stripe webhook destinations](https://docs.stripe.com/webhooks).

The current Grainline launch contract incorrectly places both source scopes in
one classic `/api/stripe/webhook` expected event set:

- platform-owned Checkout, refund and dispute events; and
- connected-account `account.updated`,
  `account.application.deauthorized` and `payout.failed` events.

Blindly adding that combined set to the existing classic endpoint would not
prove the connected-account events can reach it. Conversely, converting the
existing endpoint to Connect scope would strand platform Checkout/refund/
dispute deliveries. Provider correction therefore requires a topology
decision, not only an event-list update.

## Read-only evidence

Exact compatible application:

- main commit: `423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1`;
- production deployment: `dpl_67W8RkxzdQwbNTy3rmsEL6WK42D3`;
- sanitized provider artifact:
  `archive/stripe-webhook-subscriptions-compatible-production-20260808.json`.

The test-mode provider inventory found exactly one enabled destination for
each existing URL:

- classic `/api/stripe/webhook`: six events; it contains
  `checkout.session.completed`, `checkout.session.expired` and four unused
  `charge.*`/`payment_intent.*` events. Against the existing combined contract,
  it is missing 11 handled events;
- thin `/api/stripe/webhook/v2`: enabled, `event_payload=thin`,
  `events_from=other_accounts`; it contains the reviewed `v2.core.account`
  family plus three unused `v2.core.account_person.*` events.

The classic Webhook Endpoint response does not expose its creation-time
`connect` source flag, so event names alone cannot prove source scope. That
scope must be retained through Stripe Dashboard evidence and an actual signed
delivery from each destination.

An engine-attested pooled `grainline_app_runtime` aggregate query ran in a
repeatable-read read-only transaction and exported no seller/account IDs:

| Version class | Seller profiles | Linked Stripe accounts | Linked and orderable |
|---|---:|---:|---:|
| `v2` | 2 | 2 | 2 |
| null/blank | 1 | 0 | 0 |
| other/legacy | 0 | 0 | 0 |

There is no currently linked legacy/null seller account. The v2 account
destination is therefore the current account-state path. This does not remove
the separate connected-account payout requirement: `payout.failed` carries a
top-level connected account ID and drives durable `SellerPayoutEvent` plus
seller notification state in the classic handler.

## Recommended three-surface contract

Do not mutate Stripe until this source split has passed implementation tests,
CI and separate release review.

1. **Platform snapshot destination** — keep `/api/stripe/webhook` and its
   existing `STRIPE_WEBHOOK_SECRET`, explicitly scoped in Stripe to events on
   the platform account. Subscribe only to the ten handled platform families:
   four Checkout completion/failure/expiry events, `charge.refunded`, and the
   five handled charge-dispute events. Remove unused `charge.succeeded`,
   `charge.updated`, `payment_intent.created` and
   `payment_intent.succeeded`.
2. **Connect v2 account destination** — keep `/api/stripe/webhook/v2` and the
   distinct `STRIPE_V2_WEBHOOK_SECRET`, `event_payload=thin` and
   `events_from=other_accounts`. Retain only reviewed `v2.core.account` events;
   remove `v2.core.account_person.created/deleted/updated` unless an explicit
   future product path is designed for them.
3. **Classic Connect payout destination** — add a separate route such as
   `/api/stripe/webhook/connect`, a distinct Sensitive
   `STRIPE_CONNECT_WEBHOOK_SECRET`, and an enabled Stripe destination scoped to
   connected accounts. Initially subscribe only to `payout.failed`. Reuse the
   same bounded-body, stale-event, generation-bound begin/complete/fail,
   sanitization, failure-spike and payout-idempotency invariants. Do not expose
   new table authority or a second webhook ledger.

The existing `account.updated` and `account.application.deauthorized` classic
branches need an explicit retirement/compatibility decision. With zero linked
legacy accounts, they must not be used as a reason to broaden the new Connect
destination silently. If legacy v1 linking remains supported, prove it and add
only the necessary events to the separate Connect route; otherwise document
their retirement while the v2 account path and reconciliation cron remain the
account-state controls.

## Compatible implementation checkpoint

PR #169 merged exact implementation head
`e45a42b9a6b63acef675d0a86276c96a5da9e22f` as exact `main`
`6126105b81c79948b6b77066461dd9ac0b8e5e73`. Exact-main CI
`31321837327` and Conversation/Message FORCE regression run `31321837383`
passed. The application has not been deployed and the production/provider
state remains the compatible predecessor recorded above.

The merged application adds `/api/stripe/webhook/connect` with only
`STRIPE_CONNECT_WEBHOOK_SECRET`, a 512 KiB raw-body cap, classic Stripe HMAC
verification, stale-event rejection and the existing generation-bound fixed
lease functions. Valid signed events other than `payout.failed` are
acknowledged before lease acquisition; the exact provider proof still rejects
any subscription beyond `payout.failed`.

`src/lib/stripePayoutWebhook.ts` is the single mutation implementation for the
new Connect route and the predecessor platform-route compatibility branch. It
derives the connected account and payout ID from the authenticated Stripe
envelope, upserts by the durable payout ID, and binds the notification to the
resulting payout row. A missing account ID or payout ID fails the owned lease
instead of silently marking malformed provider evidence processed. No new
table grant, policy, function or ledger was introduced.

The provider proof now requires all three exact URLs and event sets, but it
continues to state the two limits that Stripe's API cannot attest: endpoint
signing-secret equality and the classic endpoint's connected-account source
scope. Those require separate Stripe/Vercel dashboard evidence and a signed
delivery after the compatible application is deployed.

Adding the exact provider-authenticated path to the public, Terms, suspended
account and geo middleware bypasses changes the repository's byte-pinned
production middleware fingerprint. The SavedSearch-era artifact guard is
repinned to this reviewed middleware source; its temporary context-gate route
and exemption detection remain unchanged and fail closed.

## Disabled bootstrap execution checkpoint

PR #172 merged the mode-bound operator correction as exact `main`
`eda20f6f18d08d194b0a44a7414510e3c3a9ef58`; exact-main CI run
`31328107308` passed. The exact-main read-only preflight and the separately
authorized guarded bootstrap both passed in Stripe test mode on 2026-08-09.

Provider step 4 is therefore complete for the pre-launch test-mode topology.
The new classic Connect endpoint is still at
`/api/stripe/webhook/connect-bootstrap-disabled`, is disabled, has
`livemode=false`, and subscribes only to `payout.failed`; its creation request
was `connect=true`. The one-time signing secret is installed only as the
unbranched Sensitive Production Vercel variable
`STRIPE_CONNECT_WEBHOOK_SECRET`. Secret-free evidence lives at
`archive/stripe-connect-disabled-bootstrap-test-20260809-eda20f6f.json`.

Nothing was deployed and no database state changed. The next boundary is step
5: deploy the already-compatible application while the endpoint remains
disabled, then prove alias, health and secret isolation before any canonical
URL move or enablement. The later live-money switch remains a separate
endpoint, secret, deployment and signed-delivery release.

## Compatible production deployment checkpoint

Provider step 5 completed on 2026-08-09 from exact `main`
`69c14c0618ea7ab9c74756422273d17d66db7efa` after exact-main CI run
`31329961638` passed. Vercel production deployment
`dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP` is `READY`; the canonical homepage and
health route returned HTTP 200, and the canonical asset marker identifies that
deployment. The runtime database guard attested pooled
`grainline_app_runtime`.

Missing, intentionally wrong and platform-secret cross-route signature probes
all failed closed with HTTP 400 on `/api/stripe/webhook/connect`. The probe
event type was deliberately outside the accepted `payout.failed` path, keeping
lease acquisition impossible even if signature isolation had regressed. A
final read-only provider check proved the endpoint remained at the absent
bootstrap URL, disabled, test-mode and subscribed only to `payout.failed`; the
Sensitive Vercel secret classification remained exact. Evidence is retained at
`archive/stripe-connect-compatible-production-deployment-20260809.json`.

No migration, RLS policy, grant or live-mode Stripe state changed. The next
separate boundary is provider step 6: move the still-disabled test endpoint to
the canonical URL, reverify its retained `connect=true` creation attestation
and exact event set, then enable it for a provider-authenticated delivery and
exact retry.

## Test-mode provider acceptance (2026-08-10)

Provider steps 6 and 7 now pass for test mode. The corrected proof release is
exact `main` `b9444e3488db9276c0d9f895043fe1fc32c850d1`, exact-main CI
`31366490630`, preparation release
`0b718171e71700990bf8f9106ee880b116707bd3` / CI `31357207924`, and compatible
production deployment `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP`.

The signed classic Connect proof delivered one prepared test-mode
`payout.failed` event and exactly retried it. The pooled runtime database saw
one processed generation-1 lease and no seller or payout projection for the
unlinked disposable account; the retry did not change the lease. Cleanup
deleted the disposable account and every raw-ID local recovery record. The
hashed, secret-free proof is retained at
`archive/stripe-connect-signed-payout-proof-test-20260810-b9444e34.json`.

The immediate read-only provider audit passed all exact test-mode topology
checks and is retained at
`archive/stripe-webhook-subscriptions-test-20260810-b9444e34.json`:

- the platform snapshot endpoint is enabled with exactly ten reviewed events;
- the classic Connect endpoint is enabled with only `payout.failed`; and
- the thin v2 destination is enabled for `other_accounts` with exactly the
  twelve reviewed `v2.core.account` events.

The subsequent authenticated aggregate-health request acquired a fresh
UTC-hour bucket and returned HTTP 200 with `skipped=false`, all four Stripe
failure/lease counts at zero, a healthy SavedSearch canary and every other
operational issue count at zero. Sanitized evidence is retained at
`archive/stripe-webhook-ops-health-connect-acceptance-20260810-b9444e34.json`.

None of these artifacts proves Stripe live-mode configuration or live-money
signed delivery. Those require separately scoped endpoints, secrets,
deployment and provider evidence before launch. The read-only topology artifact
also does not replace a valid Connect v2 signed-delivery proof. The remaining
immediate RLS predecessor steps are Connect v2 signed delivery or a separately
reviewed decision that it is launch-only, drain and the final compatibility
postflight.

## Required implementation and release proof

Stripe returns a classic webhook endpoint's signing secret only in the create
response. The compatible route therefore cannot literally be deployed with its
real secret before any endpoint exists. Preserve the intended fail-closed order
with a disabled bootstrap instead:

1. implement the separately signed Connect route and share handler logic
   without accepting either secret on the wrong URL;
2. prove first delivery, exact retry, wrong-secret rejection, stale-event
   rejection, payout deduplication and zero cross-route replay ambiguity in
   disposable/local tests;
3. update the read-only provider proof to require three exact URLs, payload
   modes and event sets, while retaining separate Dashboard evidence for the
   classic account-versus-Connect source scope;
4. in a separately authorized provider boundary, create the classic endpoint
   in the same explicit Stripe mode as the currently deployed payment
   configuration, with `connect=true`, only `payout.failed`, and the
   deliberately absent bootstrap URL
   `https://thegrainline.com/api/stripe/webhook/connect-bootstrap-disabled`;
   capture the creation-only signing secret without printing or persisting it,
   then immediately set the endpoint to disabled. If disabling cannot be
   verified, delete the new endpoint and stop. The absent URL makes any event
   delivered during the create-to-disable interval fail closed, while the
   predecessor compatibility handler remains available during the cutover;
   the prepared, unexecuted operator and its rollback contract are documented
   in `docs/stripe-connect-webhook-bootstrap-operator.md`;
5. install the captured value as the Sensitive production-only
   `STRIPE_CONNECT_WEBHOOK_SECRET`, deploy exact reviewed `main`, verify the
   production alias and health, and prove that missing, wrong and cross-route
   secrets are rejected. Keep the Stripe endpoint disabled throughout;
6. update the still-disabled endpoint to the canonical
   `https://thegrainline.com/api/stripe/webhook/connect` URL, reverify
   `connect=true` from the retained creation request evidence and the exact
   `payout.failed` subscription. Correct the platform and v2 destination event
   sets without changing source scope, payload mode or signing secrets, but
   stop with Connect disabled at canonical stage 3. Create a fresh disposable
   test connected account and real failed payout while delivery remains
   disabled. Only then enable Connect inside the provider-authenticated
   delivery plus exact-retry proof. Any proof failure must return Connect to
   disabled canonical stage 3. Retain only sanitized durable evidence and
   delete the disposable account after replay proof;
7. rerun the exact provider proof and the Stripe webhook aggregate health
   route; and
8. only then drain the predecessor and run the final StripeWebhookEvent
   predecessor postflight before policyless RLS activation.

The current pre-launch correction is test-mode first, matching the retained
provider inventory and required payment smoke program. Test and live endpoints
are mode-separated Stripe objects with different signing secrets. Switching to
live money therefore requires a later, separately reviewed live endpoint,
production secret replacement, deployment and signed-delivery proof; test-mode
success must never be reused as live-mode evidence.

Never use a random placeholder as the production signing secret: replacing it
would require another deployment and would create an avoidable interval where
the canonical route exists but cannot authenticate provider deliveries. Never
write the creation response, signing secret, Stripe API key or Vercel secret
input to a repository artifact, shell trace or CI log.

The restart-safe implementation and accepted test-mode execution of step 6 are documented in
`docs/stripe-connect-provider-cutover-operator.md`. Its provider-state machine
pins the exact observed predecessor: six platform events; twelve reviewed v2
account events plus exactly three removable `account_person` extras; and the
disabled, single-event Connect bootstrap. The configuration operator stopped
at disabled canonical stage 3. The separate signed-payout operator created
only a fresh test account, derived the release marker internally, proved the
real `no_account` failure, enabled only inside delivery proof, resent the exact
event, proved the processed lease unchanged by replay, journaled that verified
lease before account cleanup and deleted the disposable account. Its guarded
failure path still disables on every pre-completion failure after a fresh
provider read, including an enable response lost after Stripe accepted the
mutation. A post-deletion restart performs no additional resend.

The provider work needs no StripeWebhookEvent table grant, RLS policy or new
database function. All three routes must use the already-reviewed fixed lease
operations so the later activation can still revoke direct table access.
