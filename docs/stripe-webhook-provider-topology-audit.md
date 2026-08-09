# Stripe webhook provider topology audit

Status: compatible three-surface application merged on `main`; provider and
release gates remain open. No Stripe endpoint, event subscription, signing
secret, application deployment, database row, migration, RLS posture or grant
was changed by the merge or this sequencing correction.

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
   with `connect=true`, only `payout.failed`, and the deliberately absent
   bootstrap URL
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
   `payout.failed` subscription, then enable it. Send one
   provider-authenticated delivery plus exact retry and retain only sanitized
   delivery evidence. Correct the platform and v2 destination event sets in
   this separately reviewed provider boundary without changing their source
   scopes or signing secrets;
7. rerun the exact provider proof and the Stripe webhook aggregate health
   route; and
8. only then drain the predecessor and run the final StripeWebhookEvent
   predecessor postflight before policyless RLS activation.

Never use a random placeholder as the production signing secret: replacing it
would require another deployment and would create an avoidable interval where
the canonical route exists but cannot authenticate provider deliveries. Never
write the creation response, signing secret, Stripe API key or Vercel secret
input to a repository artifact, shell trace or CI log.

The provider work needs no StripeWebhookEvent table grant, RLS policy or new
database function. All three routes must use the already-reviewed fixed lease
operations so the later activation can still revoke direct table access.
