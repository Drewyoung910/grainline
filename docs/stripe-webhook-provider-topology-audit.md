# Stripe webhook provider topology audit

Status: read-only production/provider audit complete; design gate open. No
Stripe endpoint, event subscription, signing secret, application deployment,
database row, migration, RLS posture or grant was changed by this audit.

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

Do not mutate Stripe until this source split has an implementation, tests and
separate review.

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

## Required implementation and release proof

Before any provider mutation:

1. implement the separately signed Connect route and share handler logic
   without accepting either secret on the wrong URL;
2. prove first delivery, exact retry, wrong-secret rejection, stale-event
   rejection, payout deduplication and zero cross-route replay ambiguity in
   disposable/local tests;
3. update the read-only provider proof to require three exact URLs, payload
   modes and event sets, while retaining separate Dashboard evidence for the
   classic account-versus-Connect source scope;
4. deploy the compatible route with the new secret present but no provider
   destination yet, then verify health;
5. create/update provider destinations in a separately authorized boundary,
   send a provider-authenticated test delivery to each, and retain sanitized
   delivery evidence;
6. rerun the exact provider proof and the Stripe webhook aggregate health
   route; and
7. only then drain the predecessor and run the final StripeWebhookEvent
   predecessor postflight before policyless RLS activation.

The provider work needs no StripeWebhookEvent table grant, RLS policy or new
database function. All three routes must use the already-reviewed fixed lease
operations so the later activation can still revoke direct table access.
